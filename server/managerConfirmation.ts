import type { Express } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { comparePasswords, hashPassword, requireAdmin } from "./auth";
import { auditLogs, clients, clientClinicianOptions, managerConfirmationSettings, users } from "@shared/schema";
import { normalizeStoredClientStatus } from "@shared/clientWorkflow";

const pin = z.string().regex(/^\d{6,12}$/, "Use a PIN with 6–12 digits.");
export const managerSettingsInput = z.object({
  currentPassword: z.string().min(1).max(256),
  newPin: pin.optional(),
  managerUserIds: z.array(z.string().min(1).max(128)).min(1).max(100),
  expectedUpdatedAt: z.string().nullable(),
}).strict();
export const managerConfirmationInput = z.object({
  pin,
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(1000),
}).strict();

type Identity = { tenantId: string; userId: string; ip: string | null };
type Failure = { status: number; error: string };
const fail = (status: number, error: string): Failure => ({ status, error });

async function lockPractice(tx: any, tenantId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext('manager-confirmation'))`);
}

export async function getManagerConfirmationAccess(tenantId: string, userId: string) {
  const [settings] = await db.select().from(managerConfirmationSettings)
    .where(eq(managerConfirmationSettings.tenantId, tenantId)).limit(1);
  const selected = settings?.managerUserIds.includes(userId) === true;
  return {
    configured: !!settings, canConfigure: !settings || selected, canOverride: selected,
    managerUserIds: settings?.managerUserIds ?? [],
    updatedAt: settings?.updatedAt?.toISOString() ?? null,
  };
}

export async function saveManagerConfirmationSettings(identity: Identity, input: z.infer<typeof managerSettingsInput>) {
  return db.transaction(async tx => {
    await lockPractice(tx, identity.tenantId);
    const [actor] = await tx.select().from(users).where(and(
      eq(users.id, identity.userId), eq(users.tenantId, identity.tenantId),
    )).limit(1);
    if (!actor || actor.role !== "admin") return fail(403, "Practice administrator required.");
    const [settings] = await tx.select().from(managerConfirmationSettings)
      .where(eq(managerConfirmationSettings.tenantId, identity.tenantId)).for("update");
    if (settings && !settings.managerUserIds.includes(identity.userId))
      return fail(403, "Only selected managers can change these settings.");
    if ((settings?.updatedAt?.toISOString() ?? null) !== input.expectedUpdatedAt)
      return fail(409, "These settings changed. Reload them before saving.");
    if (!await comparePasswords(input.currentPassword, actor.password))
      return fail(403, "Your account password is incorrect.");
    if (!settings && !input.newPin) return fail(400, "Set a manager PIN for first-time setup.");
    const managerUserIds = Array.from(new Set(input.managerUserIds));
    if (!settings && !managerUserIds.includes(identity.userId))
      return fail(400, "Include your own admin account in the initial manager list.");
    const selectedUsers = await tx.select({ id: users.id }).from(users).where(and(
      eq(users.tenantId, identity.tenantId), eq(users.role, "admin"), inArray(users.id, managerUserIds),
    ));
    if (selectedUsers.length !== managerUserIds.length)
      return fail(400, "Select only admin accounts belonging to this practice.");
    const replacementHash = input.newPin ? await hashPassword(input.newPin) : undefined;
    const patch = {
      managerUserIds, updatedAt: new Date(), updatedBy: identity.userId,
      ...(replacementHash ? { pinHash: replacementHash, failedPinAttempts: {} } : {}),
    };
    if (settings) await tx.update(managerConfirmationSettings).set(patch)
      .where(eq(managerConfirmationSettings.tenantId, identity.tenantId));
    else await tx.insert(managerConfirmationSettings).values({
      tenantId: identity.tenantId, pinHash: replacementHash!, failedPinAttempts: {}, ...patch,
    });
    await tx.insert(auditLogs).values({
      tenantId: identity.tenantId, userId: identity.userId, ipAddress: identity.ip,
      action: "activity_manager_confirmation_settings_changed", resourceType: "tenant",
      resourceId: identity.tenantId,
      details: { managerUserIds, pinChanged: !!replacementHash },
    });
    return { saved: true };
  });
}

export async function managerConfirmClient(
  identity: Identity, clientId: string, input: z.infer<typeof managerConfirmationInput>,
) {
  return db.transaction(async tx => {
    await lockPractice(tx, identity.tenantId);
    const [settings] = await tx.select().from(managerConfirmationSettings)
      .where(eq(managerConfirmationSettings.tenantId, identity.tenantId)).for("update");
    if (!settings || !settings.managerUserIds.includes(identity.userId))
      return fail(403, "Manager confirmation is not enabled for your account.");
    const [actor] = await tx.select({ id: users.id, role: users.role, name: users.name }).from(users).where(and(
      eq(users.id, identity.userId), eq(users.tenantId, identity.tenantId),
    )).limit(1);
    if (!actor || actor.role !== "admin") return fail(403, "Practice manager permission required.");
    const now = new Date();
    const attempt = settings.failedPinAttempts[identity.userId];
    if (attempt?.lockedUntil && new Date(attempt.lockedUntil) > now)
      return fail(429, "Too many incorrect PIN attempts. Try again in 15 minutes.");
    if (!await comparePasswords(input.pin, settings.pinHash)) {
      const count = (attempt?.lockedUntil ? 0 : attempt?.count ?? 0) + 1;
      await tx.update(managerConfirmationSettings).set({
        failedPinAttempts: { ...settings.failedPinAttempts, [identity.userId]: {
          count, lockedUntil: count >= 5 ? new Date(now.getTime() + 15 * 60_000).toISOString() : null,
        } },
      }).where(eq(managerConfirmationSettings.tenantId, identity.tenantId));
      // Return rather than throw: the failed attempt must commit and survive restarts.
      return fail(count >= 5 ? 429 : 403, count >= 5
        ? "Too many incorrect PIN attempts. Try again in 15 minutes." : "Incorrect manager PIN.");
    }
    const [client] = await tx.select().from(clients).where(and(
      eq(clients.id, clientId), eq(clients.tenantId, identity.tenantId),
    )).for("update");
    if (!client) return fail(404, "Client not found.");
    if (client.isArchived || client.completedAt) return fail(409, "Reopen this record before using manager confirmation.");
    const currentStatus = normalizeStoredClientStatus(client.status);
    if (!currentStatus) return fail(409, "This client's status needs review before confirmation.");
    await tx.update(managerConfirmationSettings).set({
      failedPinAttempts: { ...settings.failedPinAttempts, [identity.userId]: { count: 0, lockedUntil: null } },
    }).where(eq(managerConfirmationSettings.tenantId, identity.tenantId));
    if (["Scheduled", "BookingConfirmed"].includes(currentStatus))
      return { confirmed: true, alreadyConfirmed: true, clientId, status: client.status };

    await tx.update(clients).set({
      // Scheduled is the existing administrative Confirmed state, not verified BookingConfirmed.
      status: "Scheduled", confirmedAt: client.confirmedAt || now, updatedAt: now,
      managerConfirmedAt: now, managerConfirmedBy: identity.userId, managerConfirmationReason: input.reason,
      registrationToken: null, registrationTokenExpiresAt: null, registrationTokenRevokedAt: now,
      registrationEmailClaimId: null, registrationEmailPendingToken: null,
      registrationEmailSendingAt: null,
    }).where(and(eq(clients.id, clientId), eq(clients.tenantId, identity.tenantId)));
    await tx.update(clientClinicianOptions).set({ status: "unavailable" }).where(and(
      eq(clientClinicianOptions.clientId, clientId), eq(clientClinicianOptions.tenantId, identity.tenantId),
      inArray(clientClinicianOptions.status, ["pending", "selected"]),
    ));
    await tx.insert(auditLogs).values({
      tenantId: identity.tenantId, userId: identity.userId, ipAddress: identity.ip,
      action: "activity_manager_client_confirmed", resourceType: "client", resourceId: clientId,
      details: {
        clientDisplayId: client.displayId, oldStatus: client.status, newStatus: "Scheduled",
        reason: input.reason, paymentStatusAtOverride: client.paymentStatus,
        registrationSubmittedAtOverride: !!client.registrationFormSubmissionId,
        staffOverride: true, managerUserId: identity.userId, managerName: actor.name,
      },
    });
    return { confirmed: true, alreadyConfirmed: false, clientId, status: "Scheduled" };
  });
}

export function registerManagerConfirmationRoutes(app: Express) {
  app.get("/api/manager-confirmation/settings", requireAdmin, async (req, res) => {
    if (!req.tenant?.id || !req.user?.id) return res.status(403).json({ error: "Practice context required." });
    try {
      res.json(await getManagerConfirmationAccess(req.tenant.id, req.user.id));
    } catch {
      res.status(500).json({ error: "Could not load manager confirmation settings." });
    }
  });
  app.put("/api/manager-confirmation/settings", requireAdmin, async (req, res) => {
    if (!req.tenant?.id || !req.user?.id) return res.status(403).json({ error: "Practice context required." });
    const parsed = managerSettingsInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid settings." });
    try {
      const result = await saveManagerConfirmationSettings(
        { tenantId: req.tenant.id, userId: req.user.id, ip: req.ip || null }, parsed.data,
      );
      if ("error" in result) return res.status(result.status).json({ error: result.error });
      res.json(result);
    } catch {
      res.status(500).json({ error: "Manager confirmation settings could not be saved." });
    }
  });
  app.post("/api/clients/:id/manager-confirm", requireAdmin, async (req, res) => {
    if (!req.tenant?.id || !req.user?.id) return res.status(403).json({ error: "Practice context required." });
    const parsed = managerConfirmationInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid confirmation." });
    try {
      const result = await managerConfirmClient(
        { tenantId: req.tenant.id, userId: req.user.id, ip: req.ip || null }, req.params.id, parsed.data,
      );
      if ("error" in result) return res.status(result.status).json({ error: result.error });
      res.json(result);
    } catch {
      res.status(500).json({ error: "Client could not be confirmed. No confirmation was saved." });
    }
  });
}
