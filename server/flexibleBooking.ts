import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { requireAdmin } from "./auth";
import { storage } from "./storage";
import { tenants, clients, clinicians, timeSlots, availabilityTimeOffBlocks, users, formTemplates, formSubmissions, clientClinicianOptions, clinicianInvitations, bookingReservations, auditLogs, type Client, type Tenant, type Clinician, type TimeSlot } from "@shared/schema";
import { flexibleBookingAvailable, reservationDeadline, validReservationHours, formatReservationDeadline } from "@shared/reservationPolicy";
import { isCyaPsychologyTenant } from "@shared/practicePolicies";
import { slotUnavailableReason } from "@shared/slotEligibility";
import { isSlotBlockedForBooking } from "@shared/timeOffBlocks";
import { findTimeOffBlockForSlot } from "./availabilityTimeOff";
import { regularSessionConstraints, FIRST_SESSION_TO_AGREE } from "@shared/regularSessionCopy";
import { isValidZoomLink } from "@shared/bookingZoom";
import { findSessionFormatPreference, getSessionFormatMismatch } from "../client/src/lib/availability-utils";
import { buildFromAddress, sendEmail, wrapInHtmlTemplate } from "./email";
import { deliverRegistration } from "./registrationDelivery";
import { assertReservationOpen, latestReservation, reconcileDueReservations, reservationAudit, ReservationError, resolveReservationPaymentConflict, settleReservation } from "./reservationLifecycle";

function fail(status: number, message: string): never { throw new ReservationError(status, message); }
async function clientLocked(tx: any, clientId: string, tenantId: string): Promise<Client> {
  const [client] = await tx.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId))).for("update");
  if (!client) fail(404, "Client not found");
  return client;
}
async function checkUnallocated(tx: any, client: Client) {
  if (client.isArchived || client.completedAt || client.managerConfirmedAt || client.assignedSlotId || client.assignedClinicianId ||
      !["New", "Forms Sent", "Forms Completed", "Waitlist", "OptionsSent"].includes(client.status)) {
    fail(409, "This client already has an allocation or confirmed booking. Review it before offering another.");
  }
  const hold = await latestReservation(client.id, tx);
  if (hold && ["active", "payment_check", "payment_review"].includes(hold.status)) fail(409, "Resolve this client's existing reservation first.");
  const explicitlyReleasedUnpaidConflict = hold && (await tx.select({ details: auditLogs.details }).from(auditLogs).where(and(
    eq(auditLogs.tenantId, client.tenantId!), eq(auditLogs.resourceId, client.id),
    eq(auditLogs.action, "activity_reservation_payment_conflict_resolution"),
  ))).some(({ details }: { details: Record<string, unknown> | null }) =>
    details?.reservationId === hold.id && details?.result === "released_unpaid");
  if (client.paymentStatus === "active" ||
      ((client.registrationPaymentAttemptKey || client.stripePaymentLinkId) &&
        !explicitlyReleasedUnpaidConflict &&
        (!hold || !["expired", "cancelled"].includes(hold.status) ||
          hold.paymentAttemptKey !== client.registrationPaymentAttemptKey || hold.paymentLinkId !== client.stripePaymentLinkId))) {
    fail(409, "Resolve the client's previous payment attempt before offering another booking.");
  }
  const external = await tx.select({ id: auditLogs.id }).from(auditLogs).where(and(
    eq(auditLogs.tenantId, client.tenantId!), eq(auditLogs.resourceId, client.id),
    inArray(auditLogs.action, ["activity_external_booking_reviewed", "activity_writeupp_appointment_arranged", "activity_reservation_late_payment"]),
  )).limit(1);
  if (external.length) fail(409, "This client has an external booking or financial review record. Staff must resolve it before another booking.");
}
async function configuredTenant(tx: any, tenantId: string): Promise<Tenant> {
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant || !flexibleBookingAvailable(tenant)) fail(404, "This booking route is not available.");
  if (!tenant.multiClinicianAllocationEnabled || !tenant.registrationFormEnabled || !tenant.registrationFormTemplateId) {
    fail(409, "Configure multi-clinician allocation and the registration form before offering bookings.");
  }
  const [template] = await tx.select({ id: formTemplates.id }).from(formTemplates).where(and(
    eq(formTemplates.id, tenant.registrationFormTemplateId), eq(formTemplates.tenantId, tenantId),
  )).limit(1);
  if (!template) fail(409, "The practice registration form is unavailable.");
  return tenant;
}
export function clinicianEligible(clinician: Clinician, client: Pick<Client, "insurer">): boolean {
  return clinician.isActive && (clinician.maxNewClients ?? 0) > 0
    && clinician.currentLoad < clinician.capacity
    && (!client.insurer || client.insurer === "Private" || Boolean(clinician.insurers?.includes(client.insurer)));
}
async function formatPreference(tx: any, client: Client) {
  const submissions = await tx.select({ responses: formSubmissions.responses, formFields: formTemplates.fields })
    .from(formSubmissions).innerJoin(formTemplates, eq(formTemplates.id, formSubmissions.formTemplateId))
    .where(and(eq(formSubmissions.clientId, client.id), eq(formSubmissions.tenantId, client.tenantId!), eq(formSubmissions.isDraft, false)))
    .orderBy(desc(formSubmissions.submittedAt));
  return findSessionFormatPreference(submissions);
}
function slotEligible(slot: TimeSlot, clinician: Clinician, tenant: Tenant, preference: Awaited<ReturnType<typeof formatPreference>>) {
  return !slotUnavailableReason(slot) && slot.tenantId === tenant.id
    && slot.clinicianId === clinician.id && !getSessionFormatMismatch(preference, slot.locationType)
    && (slot.type !== "SpecificDate" || tenant.oneOffSlotsEnabled === true)
    && (!tenant.zoomLinkEmailEnabled || slot.locationType !== "online" || isValidZoomLink(clinician.zoomLink));
}
async function liveClinicians(tx: any, client: Client, tenant: Tenant, ids: string[]) {
  const preference = await formatPreference(tx, client);
  const results = [];
  for (const id of ids) {
    const [clinician] = await tx.select().from(clinicians).where(and(eq(clinicians.id, id), eq(clinicians.tenantId, tenant.id)));
    if (!clinician || !clinicianEligible(clinician, client)) continue;
    const [user] = clinician.userId ? await tx.select({ name: users.name }).from(users).where(eq(users.id, clinician.userId)) : [];
    const slots: TimeSlot[] = await tx.select().from(timeSlots).where(and(eq(timeSlots.clinicianId, id), eq(timeSlots.tenantId, tenant.id), isNull(timeSlots.retiredAt)));
    const timeOffBlocks = await tx.select().from(availabilityTimeOffBlocks).where(and(
      eq(availabilityTimeOffBlocks.tenantId, tenant.id),
      eq(availabilityTimeOffBlocks.clinicianId, id),
    ));
    const owners: Client[] = await tx.select().from(clients).where(and(
      eq(clients.tenantId, tenant.id), eq(clients.assignedClinicianId, id),
      inArray(clients.status, ["Assigned", "AwaitingConfirmation", "OptionSelected", "RegistrationPending", "Scheduled", "BookingConfirmed"]),
    ));
    const available = slots.filter(slot =>
      slotEligible(slot, clinician, tenant, preference)
      && !isSlotBlockedForBooking(slot, timeOffBlocks)
      && !owners.some(owner =>
        owner.assignedSlotId === slot.id || (!owner.assignedSlotId && owner.assignedSlot?.toLowerCase() === `${slot.day || slot.date} ${slot.startTime}`.toLowerCase())),
    );
    results.push({
      id: clinician.id, name: user?.name || "Your clinician", bio: clinician.bio,
      sessionRatePence: client.agreedRatePence || clinician.sessionRatePence,
      slots: available.map(({ id, type, day, date, startDate, endDate, startTime, endTime, frequency, locationType }) =>
        ({ id, type, day, date, startDate, endDate, startTime, endTime, frequency, locationType })),
    });
  }
  return results;
}

export async function reserveFlexibleSlot(input: { clientId: string; tenantId: string; clinicianId: string; slotId: string; route: "online" | "phone"; invitationToken?: string; allocationReason?: string; userId?: string }) {
  await reconcileDueReservations(input.tenantId);
  return db.transaction(async tx => {
    const client = await clientLocked(tx, input.clientId, input.tenantId);
    const tenant = await configuredTenant(tx, input.tenantId);
    const old = await latestReservation(client.id, tx);
    if (old?.status === "active" && old.slotId === input.slotId && old.clinicianId === input.clinicianId) {
      if (input.route === "online") {
        const [inv] = await tx.select().from(clinicianInvitations).where(and(
          eq(clinicianInvitations.id, old.invitationId!), eq(clinicianInvitations.token, input.invitationToken!),
        ));
        if (!inv || inv.status !== "selected") fail(410, "This invitation is no longer active.");
      }
      await assertReservationOpen(client, tx);
      return { client, tenant, reservation: old, registrationUrl: `/register/${client.id}/${client.registrationToken}` };
    }
    await checkUnallocated(tx, client);
    let invitationId: string | null = null;
    let previousStatus: string = client.status === "OptionsSent" ? "Forms Completed" : client.status;
    if (input.route === "online") {
      const [invitation] = await tx.select().from(clinicianInvitations).where(and(
        eq(clinicianInvitations.token, input.invitationToken!), eq(clinicianInvitations.clientId, client.id), eq(clinicianInvitations.tenantId, tenant.id),
      ));
      if (!invitation || invitation.status !== "sent" || !invitation.clinicianIds.includes(input.clinicianId)) fail(410, "This invitation is no longer active.");
      invitationId = invitation.id;
      previousStatus = invitation.previousStatus;
    }
    // Capacity checks and increments are serialized for competing clients as well as a competing slot.
    const [clinician] = await tx.select().from(clinicians).where(and(
      eq(clinicians.id, input.clinicianId), eq(clinicians.tenantId, tenant.id),
    )).for("update");
    if (!clinician || !clinicianEligible(clinician, client)) fail(409, "This clinician no longer has eligible availability for this client.");
    const [slot] = await tx.select().from(timeSlots).where(and(eq(timeSlots.id, input.slotId), eq(timeSlots.tenantId, tenant.id))).for("update");
    const preference = await formatPreference(tx, client);
    if (!slot || !slotEligible(slot, clinician, tenant, preference)) fail(409, "This slot is no longer eligible or available. Please choose another.");
    if (await findTimeOffBlockForSlot(tx, tenant.id, slot)) {
      fail(409, "This appointment overlaps clinician time off, including a future recurring session. Please choose another.");
    }
    const owners = await tx.select({ id: clients.id }).from(clients).where(and(
      eq(clients.tenantId, tenant.id), ne(clients.id, client.id),
      inArray(clients.status, ["Assigned", "AwaitingConfirmation", "OptionSelected", "RegistrationPending", "Scheduled", "BookingConfirmed"]),
      sql`(${clients.assignedSlotId} = ${slot.id} or (${clients.assignedSlotId} is null and ${clients.assignedClinicianId} = ${clinician.id} and lower(${clients.assignedSlot}) = lower(${`${slot.day || slot.date} ${slot.startTime}`})))`,
    )).limit(1);
    if (owners.length) fail(409, "Another client has reserved this slot. Please choose another.");
    const durationHours = tenant.reservationDurationHours;
    const deadline = reservationDeadline(durationHours);
    const [user] = clinician.userId ? await tx.select({ name: users.name }).from(users).where(eq(users.id, clinician.userId)) : [];
    const label = `${slot.type === "SpecificDate" ? slot.date : slot.day} ${slot.startTime}–${slot.endTime}, ${slot.locationType === "online" ? "online" : "in person"}${slot.type === "Recurring" ? ` (${slot.frequency || "weekly"}). ${FIRST_SESSION_TO_AGREE} ${regularSessionConstraints(slot.startDate, slot.endDate).join(" ")}` : ""}`;
    const [reservation] = await tx.insert(bookingReservations).values({
      tenantId: tenant.id, clientId: client.id, invitationId, clinicianId: clinician.id, slotId: slot.id,
      route: input.route, previousStatus, durationHours, deadline, status: "active", clinicianName: user?.name || "Your clinician", appointmentLabel: label,
    }).returning();
    const token = crypto.randomBytes(32).toString("hex");
    await tx.update(timeSlots).set({ isBooked: true }).where(eq(timeSlots.id, slot.id));
    await tx.update(clinicians).set({ currentLoad: sql`${clinicians.currentLoad} + 1` }).where(eq(clinicians.id, clinician.id));
    await tx.update(clinicianInvitations).set({ status: "closed" }).where(and(eq(clinicianInvitations.clientId, client.id), ne(clinicianInvitations.status, "closed")));
    if (invitationId) await tx.update(clinicianInvitations).set({ status: "selected" }).where(eq(clinicianInvitations.id, invitationId));
    await tx.update(clientClinicianOptions).set({ status: "unavailable" }).where(and(eq(clientClinicianOptions.clientId, client.id), inArray(clientClinicianOptions.status, ["pending", "selected"])));
    const [updated] = await tx.update(clients).set({
      status: "OptionSelected", assignedClinicianId: clinician.id, assignedSlotId: slot.id, assignedSlot: label,
      allocatedAt: new Date(), allocationMethod: input.route === "phone" ? "manual" : "form", allocationReason: input.allocationReason || null,
      registrationToken: token, registrationTokenExpiresAt: deadline, registrationTokenRevokedAt: null,
      registrationEmailAttemptKey: null, registrationEmailClaimId: null, registrationEmailSendingAt: null, registrationEmailSentAt: null,
      registrationEmailPendingToken: null, registrationEmailFailedAt: null, registrationEmailFailureReason: null,
      // Original submissions and immutable consent remain in form_submissions.
      registrationFormSubmissionId: null, registrationPaymentAttemptKey: null,
      stripeCheckoutUrl: null, stripePaymentLinkId: null, paymentStatus: "none",
      registrationPaymentFailedAt: null, registrationPaymentFailureCode: null, registrationPaymentFailureReason: null,
      paymentType: null, insurerDetails: null, termsAcceptedAt: null, termsAcceptedContent: null, termsAcceptedVersion: null,
      agreedRatePence: client.agreedRatePence && client.agreedRatePence > 0 ? client.agreedRatePence : clinician.sessionRatePence,
      zoomLinkSentAt: null, updatedAt: new Date(),
    }).where(eq(clients.id, client.id)).returning();
    await reservationAudit(tx, tenant.id, client.id, "activity_reservation_created", { reservationId: reservation.id, route: input.route, deadline: deadline.toISOString(), durationHours }, input.userId);
    return { client: updated, tenant, reservation, registrationUrl: `/register/${client.id}/${token}` };
  });
}

async function registrationInstructions(result: Awaited<ReturnType<typeof reserveFlexibleSlot>>) {
  try {
    await deliverRegistration({ tenant: result.tenant, clientId: result.client.id, preferredToken: result.client.registrationToken, attemptKey: `hold-${result.reservation.id}` });
    return true;
  } catch {
    console.error("Reservation created but registration email needs retry", { reservationId: result.reservation.id });
    return false;
  }
}

export function registerFlexibleBookingRoutes(app: Express) {
  const route = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try { await handler(req, res); }
    catch (err) {
      if (err instanceof ReservationError) return res.status(err.status).json({ error: err.message });
      if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues[0]?.message || "Invalid booking request" });
      console.error("Flexible booking request failed", { path: req.route?.path });
      return res.status(503).json({ error: "Booking could not be completed. Please retry; no confirmed booking should be assumed." });
    }
  };
  app.get("/api/tenant/booking-settings", requireAdmin, route(async (req, res) => {
    if (!isCyaPsychologyTenant(req.tenant?.id)) fail(404, "Settings not available");
    res.json({ enabled: req.tenant!.flexibleBookingEnabled, durationHours: req.tenant!.reservationDurationHours });
  }));
  app.patch("/api/tenant/booking-settings", requireAdmin, route(async (req, res) => {
    if (!isCyaPsychologyTenant(req.tenant?.id)) fail(404, "Settings not available");
    const { enabled, durationHours } = req.body;
    if (typeof enabled !== "boolean" || !validReservationHours(durationHours)) fail(400, "Choose a whole number from 1 to 168 hours.");
    if (enabled && (!req.tenant!.multiClinicianAllocationEnabled || !req.tenant!.registrationFormEnabled || !req.tenant!.registrationFormTemplateId)) {
      fail(409, "Enable multi-clinician allocation and configure the registration form first.");
    }
    await db.transaction(async tx => {
      const [before] = await tx.select().from(tenants).where(eq(tenants.id, req.tenant!.id)).for("update");
      if (enabled && !before.paymentReconciliationEnabled) fail(409, "Enable payment reconciliation before offering flexible bookings.");
      await tx.update(tenants).set({ flexibleBookingEnabled: enabled, reservationDurationHours: durationHours }).where(eq(tenants.id, before.id));
      await tx.insert(auditLogs).values({
        tenantId: before.id, userId: req.user!.id, action: "activity_booking_settings_changed", resourceType: "tenant", resourceId: before.id,
        details: { before: { enabled: before.flexibleBookingEnabled, durationHours: before.reservationDurationHours }, after: { enabled, durationHours } },
      });
    });
    res.json({ enabled, durationHours });
  }));
  app.get("/api/booking-reservations", requireAdmin, route(async (req, res) => {
    if (!isCyaPsychologyTenant(req.tenant?.id)) return res.json([]);
    await reconcileDueReservations(req.tenant!.id);
    const rows = await db.select().from(bookingReservations).where(eq(bookingReservations.tenantId, req.tenant!.id)).orderBy(desc(bookingReservations.createdAt), desc(bookingReservations.id));
    const financialReviews = new Map(rows.filter(row => row.latePaymentReviewRequired).map(row => [row.clientId, row]));
    const seen = new Set<string>();
    res.json(rows.filter(row => !seen.has(row.clientId) && Boolean(seen.add(row.clientId))).map(row =>
      ({
        id: row.id, clientId: row.clientId,
        status: financialReviews.has(row.clientId) ? "payment_review" : row.status,
        deadline: row.deadline, durationHours: row.durationHours, route: row.route,
        reason: financialReviews.get(row.clientId)?.reason || row.reason,
        clinicianName: row.clinicianName, appointmentLabel: row.appointmentLabel,
        canResolvePaymentConflict: !row.latePaymentReviewRequired && ["payment_check", "payment_review"].includes(row.status),
      })));
  }));
  for (const action of ["cancel", "check"] as const) app.post(`/api/clients/:clientId/${action}-reservation`, requireAdmin, route(async (req, res) => {
    const { reservationId } = z.object({ reservationId: z.string().min(1) }).parse(req.body);
    const hold = await latestReservation(req.params.clientId);
    if (!hold || hold.id !== reservationId || hold.tenantId !== req.tenant?.id) fail(404, "Reservation not found");
    const result = await settleReservation(hold.id, hold.tenantId, action === "cancel", req.user!.id);
    res.json({ status: result?.status, reason: result?.reason });
  }));
  app.post("/api/clients/:clientId/resolve-reservation-payment", requireAdmin, route(async (req, res) => {
    if (!req.tenant?.id || !req.user?.id) fail(403, "Practice administrator required");
    const data = z.object({
      reservationId: z.string().min(1),
      decision: z.enum(["release_unpaid", "confirm_verified_payment"]),
      paymentLinkIds: z.array(z.string().min(1).max(255)).max(20).default([]),
      reviewedAllAttempts: z.literal(true),
    }).parse(req.body);
    const hold = await latestReservation(req.params.clientId);
    if (!hold || hold.id !== data.reservationId || hold.tenantId !== req.tenant.id) fail(404, "Reservation not found");
    const result = await resolveReservationPaymentConflict({
      reservationId: hold.id,
      tenantId: req.tenant.id,
      userId: req.user.id,
      decision: data.decision,
      additionalPaymentLinkIds: data.paymentLinkIds,
    });
    res.json({ status: result?.status, reason: result?.reason, resolved: result?.status === "cancelled" || result?.status === "confirmed" });
  }));
  app.post("/api/clients/:clientId/reserve-slot", requireAdmin, route(async (req, res) => {
    if (!flexibleBookingAvailable(req.tenant || {})) fail(404, "Booking route unavailable");
    const data = z.object({ clinicianId: z.string().min(1), slotId: z.string().min(1), allocationReason: z.string().max(2000).optional() }).parse(req.body);
    const result = await reserveFlexibleSlot({ ...data, clientId: req.params.clientId, tenantId: req.tenant!.id, route: "phone", userId: req.user!.id });
    const emailSent = await registrationInstructions(result);
    res.json({ success: true, emailSent, registrationUrl: result.registrationUrl });
  }));
  app.post("/api/clients/:clientId/clinician-invitation", requireAdmin, route(async (req, res) => {
    if (!flexibleBookingAvailable(req.tenant || {})) fail(404, "Booking route unavailable");
    const { clinicianIds, reoffer, sendAttemptKey } = z.object({
      clinicianIds: z.array(z.string().min(1)).min(1).max(30), reoffer: z.boolean().optional(),
      sendAttemptKey: z.string().uuid().optional(),
    }).parse(req.body);
    if (new Set(clinicianIds).size !== clinicianIds.length) fail(400, "Choose each clinician once.");
    const base = process.env.APP_BASE_URL?.replace(/\/$/, "");
    if (!base) fail(503, "Booking email links are not configured.");
    const prepared = await db.transaction(async tx => {
      const client = await clientLocked(tx, req.params.clientId, req.tenant!.id);
      const tenant = await configuredTenant(tx, req.tenant!.id);
      await checkUnallocated(tx, client);
      if (!["Forms Completed", "Waitlist", "OptionsSent"].includes(client.status)) {
        fail(409, "Complete the designated intake before sending online clinician choices, or use the phone-intake reservation route.");
      }
      const [existing] = await tx.select().from(clinicianInvitations).where(and(
        eq(clinicianInvitations.clientId, client.id), inArray(clinicianInvitations.status, ["prepared", "uncertain", "sent"]),
      )).orderBy(desc(clinicianInvitations.createdAt)).limit(1);
      if (existing) {
        const same = existing.clinicianIds.length === clinicianIds.length && clinicianIds.every(id => existing.clinicianIds.includes(id));
        if (!same && (!reoffer || existing.status !== "sent")) fail(409, "Resolve or resend the existing invitation before changing clinicians.");
        if (same) {
          if (existing.status === "sent" && existing.emailAttemptAcceptedAt && sendAttemptKey && sendAttemptKey !== existing.emailAttemptKey) {
            const [resend] = await tx.update(clinicianInvitations).set({
              emailAttemptKey: sendAttemptKey, emailAttemptStartedAt: new Date(), emailAttemptAcceptedAt: null,
            }).where(eq(clinicianInvitations.id, existing.id)).returning();
            return resend;
          }
          return existing;
        }
        await tx.update(clinicianInvitations).set({ status: "closed" }).where(eq(clinicianInvitations.id, existing.id));
      }
      const eligible = await liveClinicians(tx, client, tenant, clinicianIds);
      if (eligible.length !== clinicianIds.length || eligible.some(item => !item.slots.length)) fail(409, "Each approved clinician needs eligible available slots for this client.");
      const [invitation] = await tx.insert(clinicianInvitations).values({
        tenantId: tenant.id, clientId: client.id, clinicianIds, token: crypto.randomBytes(32).toString("hex"), status: "prepared",
        previousStatus: client.status === "OptionsSent" ? "Forms Completed" : client.status,
        ...(sendAttemptKey ? { emailAttemptKey: sendAttemptKey } : {}),
      }).returning();
      return invitation;
    });
    const outcome = await db.transaction(async tx => {
      const client = await clientLocked(tx, prepared.clientId, prepared.tenantId);
      const [invitation] = await tx.select().from(clinicianInvitations).where(eq(clinicianInvitations.id, prepared.id));
      if (invitation.status === "sent" && invitation.emailAttemptAcceptedAt) return true;
      if (!["prepared", "uncertain", "sent"].includes(invitation.status)) fail(410, "This invitation has been replaced.");
      if (Date.now() - invitation.emailAttemptStartedAt.getTime() > 23 * 60 * 60 * 1000) fail(409, "Invitation delivery needs staff review; its safe email retry window elapsed.");
      await checkUnallocated(tx, client);
      const tenant = await configuredTenant(tx, prepared.tenantId);
      const body = `Our team has matched you with suitable clinicians.\n\nChoose a session from their live availability:\n${base}/book/${invitation.token}\n\nNo slot is reserved until you choose it. You will then need to complete registration and any required payment before the reservation deadline shown.\n\n${tenant.name}`;
      const delivery = await sendEmail({
        to: client.email, from: buildFromAddress(tenant), subject: `Choose your session — ${tenant.name}`,
        html: wrapInHtmlTemplate(body, "Choose your session", tenant.name, tenant.primaryColor), text: body,
        idempotencyKey: `clinician-invitation-${invitation.id}-${invitation.emailAttemptKey}`,
      });
      await tx.update(clinicianInvitations).set({
        status: delivery.success || invitation.status === "sent" ? "sent" : "uncertain",
        sentAt: delivery.success ? new Date() : invitation.sentAt,
        emailAttemptAcceptedAt: delivery.success ? new Date() : null,
      }).where(eq(clinicianInvitations.id, invitation.id));
      if (!delivery.success) return false;
      await tx.update(clientClinicianOptions).set({ status: "unavailable" }).where(and(eq(clientClinicianOptions.clientId, client.id), eq(clientClinicianOptions.status, "pending")));
      await tx.update(clients).set({ status: "OptionsSent", updatedAt: new Date() }).where(eq(clients.id, client.id));
      await reservationAudit(tx, tenant.id, client.id, "activity_clinician_choices_sent", { clinicianCount: invitation.clinicianIds.length }, req.user!.id);
      return true;
    });
    if (!outcome) fail(502, "Invitation delivery could not be confirmed. Retry safely; do not assume it was sent.");
    res.json({ success: true });
  }));
  app.get("/api/public/booking/:token", route(async (req, res) => {
    const [invitation] = await db.select().from(clinicianInvitations).where(eq(clinicianInvitations.token, req.params.token));
    if (!invitation) fail(404, "Invitation not found");
    await reconcileDueReservations(invitation.tenantId);
    const client = await storage.getClientById(invitation.clientId);
    if (!client || client.tenantId !== invitation.tenantId) fail(404, "Invitation not found");
    if (invitation.status === "selected") {
      const hold = await assertReservationOpen(client);
      if (hold?.invitationId !== invitation.id) fail(410, "This invitation is no longer active.");
      if (hold.status === "confirmed") return res.json({ status: "confirmed", tenantName: "", clinicians: [] });
      return res.json({ tenantName: "", status: "selected", clinicians: [], registrationUrl: `/register/${client.id}/${client.registrationToken}` });
    }
    if (invitation.status !== "sent") fail(410, "This invitation is no longer active. Please contact the practice for fresh choices.");
    const tenant = await configuredTenant(db, invitation.tenantId);
    const current = await storage.getClientById(client.id);
    if (current?.status !== "OptionsSent") fail(410, "These choices are no longer active.");
    res.json({ tenantName: tenant.name, primaryColor: tenant.primaryColor, status: "sent", clinicians: await liveClinicians(db, client, tenant, invitation.clinicianIds) });
  }));
  app.post("/api/public/booking/:token", route(async (req, res) => {
    const [invitation] = await db.select().from(clinicianInvitations).where(eq(clinicianInvitations.token, req.params.token));
    if (!invitation) fail(404, "Invitation not found");
    if (req.body.decline === true) {
      await db.transaction(async tx => {
        const client = await clientLocked(tx, invitation.clientId, invitation.tenantId);
        const [current] = await tx.select().from(clinicianInvitations).where(eq(clinicianInvitations.id, invitation.id));
        if (current.status !== "sent" || client.status !== "OptionsSent") fail(410, "This invitation is no longer active.");
        await tx.update(clinicianInvitations).set({ status: "declined" }).where(eq(clinicianInvitations.id, invitation.id));
        await tx.update(clients).set({ needsAdminCall: true }).where(eq(clients.id, client.id));
        await reservationAudit(tx, invitation.tenantId, client.id, "activity_clinician_choices_declined");
      });
      return res.json({ declined: true });
    }
    const { clinicianId, slotId } = z.object({ clinicianId: z.string().min(1), slotId: z.string().min(1) }).parse(req.body);
    const result = await reserveFlexibleSlot({ clientId: invitation.clientId, tenantId: invitation.tenantId, clinicianId, slotId, route: "online", invitationToken: req.params.token });
    await registrationInstructions(result);
    res.json({ registrationUrl: result.registrationUrl });
  }));
}
