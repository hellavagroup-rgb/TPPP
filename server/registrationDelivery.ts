import crypto from "crypto";
import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { Client, Tenant } from "@shared/schema";
import { clients, formTemplates } from "@shared/schema";
import { db } from "./db";
import { generateRegistrationInviteEmail, sendEmail } from "./email";
import { storage } from "./storage";
import { canSendRegistration } from "./registrationWorkflow";
import { assertReservationOpen } from "./reservationLifecycle";

const ELIGIBLE_STATUSES: Client["status"][] = ["Assigned", "AwaitingConfirmation", "OptionSelected"];

export class RegistrationDeliveryError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type RegistrationDeliveryResult = {
  success: true;
  idempotent?: boolean;
  resent?: boolean;
  registrationToken: string;
};

export async function deliverRegistration(input: {
  tenant: Tenant;
  clientId: string;
  attemptKey: string;
  preferredToken?: string | null;
  recordSent?: (client: Client) => Promise<void>;
}): Promise<RegistrationDeliveryResult> {
  const { tenant } = input;
  let claimedAttemptKey: string | null = null;
  let claimedClaimId: string | null = null;
  let providerAcceptedSend = false;
  let priorRegistrationEmailSentAt: Date | null = null;

  try {
    if (!tenant.registrationFormEnabled) {
      throw new RegistrationDeliveryError(400, "Registration forms are disabled for this practice");
    }
    if (tenant.registrationFormTemplateId === null) {
      throw new RegistrationDeliveryError(400, "A registration form template must be configured before sending");
    }
    if (tenant.registrationFormTemplateId) {
      const [template] = await db.select({ id: formTemplates.id }).from(formTemplates).where(and(
        eq(formTemplates.id, tenant.registrationFormTemplateId),
        eq(formTemplates.tenantId, tenant.id),
      )).limit(1);
      if (!template) throw new RegistrationDeliveryError(400, "The configured registration form template is unavailable");
    }
    if (!/^[a-zA-Z0-9-]{16,200}$/.test(input.attemptKey)) {
      throw new RegistrationDeliveryError(400, "A valid send attempt key is required");
    }

    const client = await storage.getClientById(input.clientId);
    if (!client) throw new RegistrationDeliveryError(404, "Client not found");
    if (client.tenantId !== tenant.id) throw new RegistrationDeliveryError(403, "Access denied");
    if (!client.email) throw new RegistrationDeliveryError(400, "This client has no email address");
    priorRegistrationEmailSentAt = client.registrationEmailSentAt;
    if (!client.assignedClinicianId || !client.assignedSlotId) {
      throw new RegistrationDeliveryError(400, "Registration can only be sent to an allocated client");
    }
    const reservation = await assertReservationOpen(client);
    if (!canSendRegistration({
      featureEnabled: tenant.registrationFormEnabled === true,
      requestTenantId: tenant.id,
      clientTenantId: client.tenantId,
      assignedClinicianId: client.assignedClinicianId,
      assignedSlotId: client.assignedSlotId,
      status: client.status,
    })) {
      throw new RegistrationDeliveryError(409, "Registration can only be sent before the booking is confirmed");
    }

    const appBase = process.env.APP_BASE_URL;
    if (!appBase) throw new RegistrationDeliveryError(503, "Registration links are not configured");
    if (client.registrationEmailAttemptKey === input.attemptKey && client.registrationEmailSentAt) {
      return {
        success: true,
        resent: true,
        idempotent: true,
        registrationToken: client.registrationToken!,
      };
    }

    const recoverableAttempt = !!client.registrationEmailAttemptKey
      && !client.registrationEmailSentAt
      && (!client.registrationEmailSendingAt
        || client.registrationEmailSendingAt < new Date(Date.now() - 5 * 60 * 1000));
    const effectiveAttemptKey = recoverableAttempt ? client.registrationEmailAttemptKey! : input.attemptKey;
    const claimId = crypto.randomUUID();
    const sendClaim = await db.update(clients).set({
      registrationEmailAttemptKey: effectiveAttemptKey,
      registrationEmailClaimId: claimId,
      registrationEmailSendingAt: new Date(),
      registrationEmailSentAt: null,
      registrationEmailFailedAt: null,
      registrationEmailFailureReason: null,
      updatedAt: new Date(),
    }).where(and(
      eq(clients.id, client.id),
      eq(clients.assignedSlotId, client.assignedSlotId),
      ...(reservation ? [eq(clients.registrationToken, client.registrationToken!)] : []),
      eq(clients.tenantId, tenant.id),
      inArray(clients.status, ELIGIBLE_STATUSES),
      or(
        isNull(clients.registrationEmailSendingAt),
        lt(clients.registrationEmailSendingAt, new Date(Date.now() - 5 * 60 * 1000)),
      ),
    )).returning({ id: clients.id });
    if (!sendClaim.length) {
      const current = await storage.getClientById(client.id);
      if (current && current.registrationEmailAttemptKey === effectiveAttemptKey && current.registrationEmailSentAt) {
        return {
          success: true,
          resent: true,
          idempotent: true,
          registrationToken: current.registrationToken!,
        };
      }
      throw new RegistrationDeliveryError(409, "A registration email is already being sent. Please wait a moment.");
    }
    claimedAttemptKey = effectiveAttemptKey;
    claimedClaimId = claimId;

    let token = recoverableAttempt && client.registrationEmailPendingToken
      ? client.registrationEmailPendingToken
      : recoverableAttempt && client.registrationToken
        ? client.registrationToken
        : input.preferredToken || crypto.randomBytes(32).toString("hex");
    const tokenUpdate = await db.update(clients).set({
      registrationEmailPendingToken: token,
      updatedAt: new Date(),
    }).where(and(
      eq(clients.id, client.id),
      eq(clients.tenantId, tenant.id),
      eq(clients.registrationEmailAttemptKey, effectiveAttemptKey),
      eq(clients.registrationEmailClaimId, claimId),
    )).returning({ registrationEmailPendingToken: clients.registrationEmailPendingToken });
    if (!tokenUpdate.length) {
      const current = await storage.getClientById(client.id);
      if (!current?.registrationEmailPendingToken) {
        await db.update(clients).set({
          registrationEmailSendingAt: null,
          registrationEmailAttemptKey: null,
          registrationEmailClaimId: null,
          updatedAt: new Date(),
        }).where(and(
          eq(clients.id, client.id),
          eq(clients.registrationEmailAttemptKey, effectiveAttemptKey),
          eq(clients.registrationEmailClaimId, claimId),
        ));
        claimedAttemptKey = null;
        claimedClaimId = null;
        throw new RegistrationDeliveryError(409, "Registration is already being prepared. Please retry.");
      }
      token = current.registrationEmailPendingToken;
    }

    const registrationUrl = `${appBase.replace(/\/$/, "")}/register/${client.id}/${token}`;
    const email = await generateRegistrationInviteEmail(registrationUrl, {
      id: tenant.id,
      name: tenant.name,
      fromEmail: tenant.fromEmail,
      primaryColor: tenant.primaryColor,
    }, reservation);
    const delivery = await sendEmail({
      ...email,
      to: client.email,
      idempotencyKey: `registration-${client.id}-${effectiveAttemptKey}`,
    });
    providerAcceptedSend = delivery.outcome !== "rejected";
    if (!delivery.success) {
      await db.update(clients).set({
        registrationEmailSendingAt: null,
        registrationEmailFailedAt: new Date(),
        registrationEmailFailureReason: delivery.outcome === "rejected"
          ? "The email provider rejected the registration message."
          : "Delivery could not be confirmed.",
        registrationEmailAttemptKey: delivery.outcome === "rejected" ? null : effectiveAttemptKey,
        registrationEmailClaimId: null,
        ...(delivery.outcome === "rejected" ? {
          registrationEmailSentAt: client.registrationEmailSentAt,
          registrationEmailPendingToken: null,
        } : {}),
        updatedAt: new Date(),
      }).where(and(
        eq(clients.id, client.id),
        eq(clients.registrationEmailAttemptKey, effectiveAttemptKey),
        eq(clients.registrationEmailClaimId, claimId),
      ));
      claimedAttemptKey = null;
      claimedClaimId = null;
      throw new RegistrationDeliveryError(502, "Registration email could not be delivered. Please try again.");
    }

    const completedSend = await db.update(clients).set({
      registrationEmailSentAt: new Date(),
      registrationEmailSendingAt: null,
      registrationEmailFailedAt: null,
      registrationEmailFailureReason: null,
      registrationEmailClaimId: null,
      registrationEmailPendingToken: null,
      registrationToken: token,
      registrationTokenExpiresAt: reservation?.deadline || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      registrationTokenRevokedAt: null,
      status: "OptionSelected",
      updatedAt: new Date(),
    }).where(and(
      eq(clients.id, client.id),
      eq(clients.tenantId, tenant.id),
      eq(clients.assignedSlotId, client.assignedSlotId),
      inArray(clients.status, ELIGIBLE_STATUSES),
      eq(clients.registrationEmailAttemptKey, effectiveAttemptKey),
      eq(clients.registrationEmailClaimId, claimId),
      isNotNull(clients.registrationEmailSendingAt),
      inArray(clients.status, ELIGIBLE_STATUSES),
    )).returning({ id: clients.id });
    if (!completedSend.length) {
      throw new RegistrationDeliveryError(409, "The client workflow changed while the email was being sent. Please refresh.");
    }
    await input.recordSent?.(client);
    claimedAttemptKey = null;
    claimedClaimId = null;
    return { success: true, resent: !!client.registrationEmailSentAt, registrationToken: token };
  } catch (error) {
    if (claimedAttemptKey && claimedClaimId) {
      try {
        await db.update(clients).set({
          registrationEmailSendingAt: null,
          registrationEmailFailedAt: new Date(),
          registrationEmailFailureReason: providerAcceptedSend
            ? "Delivery was accepted but the workflow could not finish. Retry safely."
            : "Registration delivery failed before provider acceptance.",
          registrationEmailAttemptKey: providerAcceptedSend ? claimedAttemptKey : null,
          registrationEmailClaimId: null,
          ...(!providerAcceptedSend ? {
            registrationEmailSentAt: priorRegistrationEmailSentAt,
            registrationEmailPendingToken: null,
          } : {}),
          updatedAt: new Date(),
        }).where(and(
          eq(clients.id, input.clientId),
          eq(clients.registrationEmailAttemptKey, claimedAttemptKey),
          eq(clients.registrationEmailClaimId, claimedClaimId),
        ));
      } catch (cleanupError) {
        console.error("Failed to release registration email claim:", cleanupError);
      }
    }
    throw error;
  }
}