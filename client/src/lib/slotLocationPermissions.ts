import type { Clinician, TimeSlot } from "@shared/schema";

export function canEditSlotLocation(
  user: { id: string; role: string } | null,
  clinician: Pick<Clinician, "userId">,
  slot: Pick<TimeSlot, "isBooked" | "retiredAt">,
): boolean {
  return !!user && !slot.isBooked && !slot.retiredAt &&
    (user.role === "admin" || (user.role === "clinician" && clinician.userId === user.id));
}
