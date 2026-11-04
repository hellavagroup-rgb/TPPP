import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import { auditLogs, bookingReservations, bookingSnapshots, clientClinicianOptions, clients, clinicians, timeSlots, type User } from "@shared/schema";
import { availabilityEditSchema, availabilitySlotsOverlap, type AvailabilityEdit } from "@shared/availabilityEdit";
import { ACTIVE_ALLOCATION_STATUSES } from "./clientAllocationWorkflow";
import { findTimeOffBlockForSlot } from "./availabilityTimeOff";
import { ReservationError } from "./reservationLifecycle";

export async function editAvailabilitySlot(id: string, tenantId: string, input: AvailabilityEdit, actor: Pick<User, "id" | "role">) {
  const parsed = availabilityEditSchema.safeParse(input);
  if (!parsed.success) throw new ReservationError(400, parsed.error.issues[0].message);
  if (!actor || !["admin", "clinician"].includes(actor.role)) return undefined;
  return db.transaction(async tx => {
    const [observed] = await tx.select().from(timeSlots).where(eq(timeSlots.id, id));
    if (!observed) return undefined;
    // Same parent-before-slot lock order as reservations and allocation.
    const [clinician] = await tx.select().from(clinicians).where(and(
      eq(clinicians.id, observed.clinicianId), eq(clinicians.tenantId, tenantId),
    )).for("update");
    if (!clinician || (actor.role === "clinician" && clinician.userId !== actor.id)) return undefined;
    const [slot] = await tx.select().from(timeSlots).where(eq(timeSlots.id, id)).for("update");
    if (!slot || slot.clinicianId !== clinician.id || (slot.tenantId && slot.tenantId !== tenantId)) return undefined;
    if (slot.type !== parsed.data.type) throw new ReservationError(400, "The availability type cannot be changed. Edit the existing series or date.");
    if (slot.retiredAt || slot.isBooked) throw new ReservationError(409, "Booked, reserved or retired slots cannot be edited.");
    const owners = await tx.select({ id: clients.id }).from(clients).where(and(
      inArray(clients.status, [...ACTIVE_ALLOCATION_STATUSES]),
      or(eq(clients.assignedSlotId, id), and(isNull(clients.assignedSlotId),
        eq(clients.assignedClinicianId, clinician.id),
        sql`lower(${clients.assignedSlot}) = lower(${`${slot.day || slot.date} ${slot.startTime}`})`)),
    )).limit(1);
    const history = await tx.select({ id: bookingSnapshots.id }).from(bookingSnapshots).where(eq(bookingSnapshots.slotId, id)).limit(1);
    const holds = await tx.select({ id: bookingReservations.id }).from(bookingReservations).where(and(
      eq(bookingReservations.slotId, id), inArray(bookingReservations.status, ["active", "payment_check", "payment_review"]),
    )).limit(1);
    const offers = await tx.select({ id: clientClinicianOptions.id }).from(clientClinicianOptions).where(and(
      eq(clientClinicianOptions.slotId, id), eq(clientClinicianOptions.status, "pending"),
    )).limit(1);
    if (owners.length || history.length || holds.length) throw new ReservationError(409, "This slot is linked to a booking or reservation and cannot be edited. Refresh availability.");
    if (offers.length) throw new ReservationError(409, "This slot is currently offered to a client. Resolve the existing offer before editing it.");
    const patch = parsed.data.type === "Recurring"
      ? { ...parsed.data, date: null, isOngoing: !parsed.data.endDate }
      : { ...parsed.data, day: null, startDate: null, endDate: null, frequency: "weekly" as const, isOngoing: false };
    const proposed = { ...slot, ...patch };
    const siblings = await tx.select().from(timeSlots).where(and(eq(timeSlots.clinicianId, clinician.id), isNull(timeSlots.retiredAt)));
    if (siblings.some(other => other.id !== id && availabilitySlotsOverlap(proposed, other))) {
      throw new ReservationError(409, "The edited availability overlaps another slot or time-off period.");
    }
    if (await findTimeOffBlockForSlot(tx, tenantId, proposed)) throw new ReservationError(409, "The edited availability overlaps saved time off.");
    const [updated] = await tx.update(timeSlots).set(patch).where(eq(timeSlots.id, id)).returning();
    await tx.update(clinicians).set({ lastUpdatedAvailability: new Date() }).where(eq(clinicians.id, clinician.id));
    await tx.insert(auditLogs).values({ tenantId, userId: actor.id, resourceType: "timeslot", resourceId: id,
      action: "activity_availability_edited", details: { before: slot, after: updated, scope: slot.type === "Recurring" ? "whole_series" : "single_date" } });
    return updated;
  });
}
