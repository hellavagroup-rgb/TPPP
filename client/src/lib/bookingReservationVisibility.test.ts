import { describe, expect, it } from "vitest";
import { CYA_PSYCHOLOGY_TENANT_ID } from "@shared/practicePolicies";
import { shouldShowBookingReservations } from "./bookingReservationVisibility";

describe("booking reservation visibility", () => {
  it("keeps Tenant 2 admin reservation summaries visible independently of the invitation flag", () => {
    expect(shouldShowBookingReservations(true, CYA_PSYCHOLOGY_TENANT_ID)).toBe(true);
    expect(shouldShowBookingReservations(false, CYA_PSYCHOLOGY_TENANT_ID)).toBe(false);
    expect(shouldShowBookingReservations(true, "another-practice")).toBe(false);
  });
});
