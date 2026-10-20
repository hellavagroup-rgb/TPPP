import { isCyaPsychologyTenant } from "./practicePolicies";

export const DEFAULT_RESERVATION_HOURS = 12;
export const MAX_RESERVATION_HOURS = 168;
export function flexibleBookingAvailable(tenant: { id?: string | null; flexibleBookingEnabled?: boolean | null; paymentReconciliationEnabled?: boolean | null }): boolean {
  return isCyaPsychologyTenant(tenant.id) && tenant.flexibleBookingEnabled === true && tenant.paymentReconciliationEnabled === true;
}
export function validReservationHours(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_RESERVATION_HOURS;
}
export function reservationDeadline(hours: number, now = new Date()): Date {
  if (!validReservationHours(hours)) throw new Error("Reservation duration must be a whole number from 1 to 168 hours.");
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}
export function formatReservationDeadline(value: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(value));
}
