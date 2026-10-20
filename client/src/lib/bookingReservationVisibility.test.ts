import { describe, expect, it } from "vitest";
import { CYA_PSYCHOLOGY_TENANT_ID } from "@shared/practicePolicies";
import { shouldShowBookingReservations } from "./bookingReservationVisibility";
import { flexibleBookingAvailable } from "@shared/reservationPolicy";

describe("booking reservation visibility", () => {
  it("gates new booking actions on reconciliation without hiding existing reservations", () => {
    for (const flexibleBookingEnabled of [false, true]) {
      for (const paymentReconciliationEnabled of [false, true]) {
        expect(flexibleBookingAvailable({ id: CYA_PSYCHOLOGY_TENANT_ID, flexibleBookingEnabled, paymentReconciliationEnabled }))
          .toBe(flexibleBookingEnabled && paymentReconciliationEnabled);
        expect(shouldShowBookingReservations(true, CYA_PSYCHOLOGY_TENANT_ID)).toBe(true);
      }
    }
    expect(flexibleBookingAvailable({ id: "another-practice", flexibleBookingEnabled: true, paymentReconciliationEnabled: true })).toBe(false);
    expect(flexibleBookingAvailable({ id: CYA_PSYCHOLOGY_TENANT_ID, flexibleBookingEnabled: true })).toBe(false);
  });
  it("keeps Tenant 2 admin reservation summaries visible independently of the invitation flag", () => {
    expect(shouldShowBookingReservations(true, CYA_PSYCHOLOGY_TENANT_ID)).toBe(true);
    expect(shouldShowBookingReservations(false, CYA_PSYCHOLOGY_TENANT_ID)).toBe(false);
    expect(shouldShowBookingReservations(true, "another-practice")).toBe(false);
  });
});
