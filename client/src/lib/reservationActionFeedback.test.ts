import { describe, expect, it } from "vitest";
import { reservationActionFeedback } from "./reservationActionFeedback";

describe("reservationActionFeedback", () => {
  it("keeps a payment-check cancellation explicitly pending", () => {
    expect(reservationActionFeedback("payment_check")).toEqual({
      title: "Payment check required",
      description: "The appointment remains held until the payment has been checked.",
    });
  });

  it("uses the returned status and reason instead of claiming cancellation succeeded", () => {
    expect(reservationActionFeedback("confirmed", "Payment already completed; booking remains confirmed.")).toEqual({
      title: "Reservation confirmed",
      description: "Payment already completed; booking remains confirmed.",
    });
    expect(reservationActionFeedback("cancelled")).toEqual({
      title: "Reservation cancelled",
      description: "The cancellation is complete and the appointment has been released.",
    });
  });
});
