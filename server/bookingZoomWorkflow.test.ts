import { describe, expect, it } from "vitest";
import {
  isValidZoomLink,
  onlineBookingNeedsZoomLink,
  shouldResetZoomDelivery,
} from "@shared/bookingZoom";
import { zoomDeliveryIdempotencyKey } from "./bookingZoomWorkflow";

describe("booking Zoom decisions", () => {
  it("accepts secure Zoom hosts and rejects unsafe or unrelated links", () => {
    expect(isValidZoomLink("https://zoom.us/j/123")).toBe(true);
    expect(isValidZoomLink("https://us02web.zoom.us/j/123")).toBe(true);
    expect(isValidZoomLink("http://zoom.us/j/123")).toBe(false);
    expect(isValidZoomLink("https://zoom.us.example.com/j/123")).toBe(false);
  });

  it("requires links only for online bookings", () => {
    expect(onlineBookingNeedsZoomLink("online")).toBe(true);
    expect(onlineBookingNeedsZoomLink("in_person")).toBe(false);
  });

  it("resets delivery when the recipient, clinician, or slot changes", () => {
    const current = { email: "client@example.com", assignedClinicianId: "c1", assignedSlotId: "s1" };
    expect(shouldResetZoomDelivery(current, { email: "new@example.com" })).toBe(true);
    expect(shouldResetZoomDelivery(current, { assignedClinicianId: "c2" })).toBe(true);
    expect(shouldResetZoomDelivery(current, { assignedSlotId: "s2" })).toBe(true);
    expect(shouldResetZoomDelivery(current, { assignedSlotId: "s1" })).toBe(false);
  });

  it("reuses a key for the same delivery but rotates it for recipient or link changes", () => {
    const delivery = {
      clientId: "client-1",
      slotId: "slot-1",
      clinicianId: "clinician-1",
      clientEmail: "client@example.com",
      zoomLink: "https://zoom.us/j/123",
    };
    expect(zoomDeliveryIdempotencyKey(delivery)).toBe(zoomDeliveryIdempotencyKey(delivery));
    expect(zoomDeliveryIdempotencyKey({ ...delivery, clientEmail: "new@example.com" }))
      .not.toBe(zoomDeliveryIdempotencyKey(delivery));
    expect(zoomDeliveryIdempotencyKey({ ...delivery, zoomLink: "https://zoom.us/j/456" }))
      .not.toBe(zoomDeliveryIdempotencyKey(delivery));
  });
});