import { and, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import { clients, formDeliveries, formDeliveryAttempts, tenants } from "@shared/schema";
import { db } from "./db";
import { buildFromAddress, getEmailDeliveryEvent, sendEmail } from "./email";
import { storage } from "./storage";

// Resend's last_event is metadata, not proof of inbox placement.
export function isIntakeBounce(event: string | null | undefined): boolean {
  return ["bounced", "complained", "suppressed", "email.bounced", "email.complained", "email.suppressed"]
    .includes(event?.toLowerCase() || "");
}

export type IntakeBounceCandidate = {
  id: string;
  tenantId: string;
  providerMessageId: string;
  providerEvent: string | null;
  displayId: string;
};

type AlertDependencies = {
  find: (id: string) => Promise<IntakeBounceCandidate | undefined>;
  event: (messageId: string) => Promise<string | null>;
  saveEvent: (id: string, tenantId: string, event: string) => Promise<void>;
  claim: (id: string, tenantId: string) => Promise<Date | undefined>;
  admins: (tenantId: string) => Promise<{ id: string; email: string }[]>;
  tenant: (tenantId: string) => Promise<{ id: string; name: string; fromEmail?: string | null; intakeDeliveryDiagnosticsEnabled?: boolean | null } | undefined>;
  send: typeof sendEmail;
  finish: (id: string, tenantId: string, claim: Date, accepted: boolean) => Promise<void>;
};

const dependencies: AlertDependencies = {
  async find(id) {
    const [row] = await db.select({
      id: formDeliveryAttempts.id, tenantId: formDeliveryAttempts.tenantId,
      providerMessageId: formDeliveryAttempts.providerMessageId,
      providerEvent: formDeliveryAttempts.providerEvent, displayId: clients.displayId,
    }).from(formDeliveryAttempts)
      .innerJoin(formDeliveries, and(eq(formDeliveries.id, formDeliveryAttempts.deliveryId),
        eq(formDeliveries.tenantId, formDeliveryAttempts.tenantId)))
      .innerJoin(clients, and(eq(clients.id, formDeliveries.clientId),
        eq(clients.tenantId, formDeliveryAttempts.tenantId)))
      .innerJoin(tenants, eq(tenants.id, formDeliveryAttempts.tenantId))
      .where(and(eq(formDeliveryAttempts.id, id), eq(formDeliveryAttempts.outcome, "accepted"),
        eq(tenants.intakeDeliveryDiagnosticsEnabled, true),
        eq(tenants.intakeFormTemplateId, formDeliveries.formTemplateId)));
    if (!row?.providerMessageId) return undefined;
    return { ...row, providerMessageId: row.providerMessageId };
  },
  event: getEmailDeliveryEvent,
  saveEvent: (id, tenantId, event) => storage.updateFormDeliveryAttemptEvent(id, tenantId, event),
  async claim(id, tenantId) {
    const now = new Date();
    const [claimed] = await db.update(formDeliveryAttempts).set({ alertClaimedAt: now })
      .where(and(eq(formDeliveryAttempts.id, id), eq(formDeliveryAttempts.tenantId, tenantId),
        eq(formDeliveryAttempts.outcome, "accepted"), isNull(formDeliveryAttempts.alertedAt),
        or(isNull(formDeliveryAttempts.alertClaimedAt),
          lt(formDeliveryAttempts.alertClaimedAt, new Date(Date.now() - 5 * 60_000)))))
      .returning({ alertClaimedAt: formDeliveryAttempts.alertClaimedAt });
    return claimed?.alertClaimedAt || undefined;
  },
  admins: (tenantId) => storage.getAdminUsersByTenantId(tenantId),
  tenant: (tenantId) => storage.getTenantById(tenantId),
  send: sendEmail,
  async finish(id, tenantId, claim, accepted) {
    await db.update(formDeliveryAttempts).set(accepted
      ? { alertedAt: new Date(), alertClaimedAt: null }
      : { alertClaimedAt: null })
      .where(and(eq(formDeliveryAttempts.id, id), eq(formDeliveryAttempts.tenantId, tenantId),
        eq(formDeliveryAttempts.alertClaimedAt, claim)));
  },
};

// Only the stored, tenant-owned provider ID can be queried. An accepted send by
// itself is not bounce evidence. A stored bounce remains evidence if lookup fails.
export async function alertIntakeBounce(attemptId: string, deps: AlertDependencies = dependencies): Promise<void> {
  const attempt = await deps.find(attemptId);
  if (!attempt) return;
  let event = attempt.providerEvent;
  try {
    const latest = await deps.event(attempt.providerMessageId);
    if (latest) {
      event = latest;
      if (latest !== attempt.providerEvent) await deps.saveEvent(attempt.id, attempt.tenantId, latest);
    }
  } catch {
    // Provider unavailable: previously recorded evidence is still valid.
  }
  if (!isIntakeBounce(event)) return;
  const claim = await deps.claim(attempt.id, attempt.tenantId);
  if (!claim) return;
  let sent = false;
  try {
    const tenant = await deps.tenant(attempt.tenantId);
    if (!tenant?.intakeDeliveryDiagnosticsEnabled) return;
    const admins = await deps.admins(attempt.tenantId);
    if (!admins.length) throw new Error("No staff recipient");
    const safeDisplayId = attempt.displayId.replace(/[&<>"']/g, char =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
    for (const admin of admins) {
      const result = await deps.send({
        to: admin.email,
        from: buildFromAddress(tenant),
        subject: "Intake invitation delivery needs attention",
        text: `The email provider reported a bounce or suppression for the intake invitation to client ${attempt.displayId}. Check the client's intake delivery panel before contacting them or resending. Provider acceptance does not confirm inbox delivery.`,
        html: `<p>The email provider reported a bounce or suppression for the intake invitation to client ${safeDisplayId}.</p><p>Check the client's intake delivery panel before contacting them or resending. Provider acceptance does not confirm inbox delivery.</p>`,
        idempotencyKey: `intake-bounce-${attempt.tenantId}-${attempt.id}-${admin.id}`,
      });
      if (!result.success) throw new Error("Alert email not accepted");
    }
    await deps.finish(attempt.id, attempt.tenantId, claim, true);
    sent = true;
  } catch (error) {
    console.error("Intake bounce alert failed", { tenantId: attempt.tenantId, attemptId: attempt.id, error });
  } finally {
    // On failure, a later poll retries with the same provider idempotency key.
    if (!sent) await deps.finish(attempt.id, attempt.tenantId, claim, false);
  }
}

let polling = false;
export async function pollIntakeBounceAlerts(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    // Retain recent accepted attempts long enough for delayed bounce reports.
    const rows = await db.select({ id: formDeliveryAttempts.id }).from(formDeliveryAttempts)
      .innerJoin(tenants, eq(tenants.id, formDeliveryAttempts.tenantId))
      .innerJoin(formDeliveries, and(eq(formDeliveries.id, formDeliveryAttempts.deliveryId),
        eq(formDeliveries.tenantId, formDeliveryAttempts.tenantId)))
      .where(and(eq(tenants.intakeDeliveryDiagnosticsEnabled, true),
        eq(tenants.intakeFormTemplateId, formDeliveries.formTemplateId),
        eq(formDeliveryAttempts.outcome, "accepted"),
        isNotNull(formDeliveryAttempts.providerMessageId),
        isNull(formDeliveryAttempts.alertedAt),
        gte(formDeliveryAttempts.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60_000))));
    for (const row of rows) {
      try {
        await alertIntakeBounce(row.id);
      } catch (error) {
        console.error("Intake bounce check failed", { attemptId: row.id, error });
      }
    }
  } finally {
    polling = false;
  }
}