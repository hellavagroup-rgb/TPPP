import { describe, expect, it } from "vitest";
import {
  bookingCompletionNextStep,
  getClientNextStep,
  getCompactClientDescription,
  shouldShowNeedsCall,
} from "./clientNextStep";
import { CYA_PSYCHOLOGY_TENANT_ID } from "@shared/practicePolicies";

describe("Tenant 2 offer call prompts", () => {
  const offer = {
    tenantId: CYA_PSYCHOLOGY_TENANT_ID, status: "OptionsSent", needsAdminCall: true,
    offerState: "pending", offerDeliveryRecorded: true,
    offerEligibility: { pendingCount: 2, availableCount: 2, unavailableCount: 0 },
    isAdmin: true,
  };

  it("shows waiting for the family despite an old intake call flag, without mutating it", () => {
    const before = structuredClone(offer);
    expect(getClientNextStep(offer)).toMatchObject({ kind: "waiting", title: "Waiting for the family to choose" });
    expect(shouldShowNeedsCall(offer)).toBe(false);
    expect(offer).toEqual(before);
  });

  it("shows the real decline follow-up until staff mark the call as completed", () => {
    const declined = { ...offer, offerState: "declined", offerEligibility: undefined };
    expect(getClientNextStep(declined)).toMatchObject({
      kind: "action", title: "Call the family about declined options", action: "review_offer",
    });
    expect(shouldShowNeedsCall(declined)).toBe(true);
    expect(shouldShowNeedsCall({ ...declined, needsAdminCall: false })).toBe(false);
    expect(getClientNextStep({ ...declined, needsAdminCall: false })).toMatchObject({
      title: "Offer new appointment choices",
    });
  });

  it.each([false, undefined])("preserves missing-delivery warnings (accepted=%s)", offerDeliveryRecorded => {
    expect(getClientNextStep({ ...offer, offerDeliveryRecorded })).toMatchObject({
      kind: "action", title: "Review offer delivery", action: "review_offer",
    });
  });

  it("waits for clinician and slot selection on an accepted live invitation without fixed-slot counts", () => {
    expect(getClientNextStep({ ...offer, offerKind: "clinician_invitation", offerEligibility: null })).toMatchObject({
      kind: "waiting", title: "Waiting for the client to choose a clinician and slot",
    });
  });

  it("requires acceptance evidence before waiting on a live invitation", () => {
    expect(getClientNextStep({ ...offer, offerKind: "clinician_invitation", offerEligibility: null,
      offerDeliveryRecorded: false })).toMatchObject({ kind: "action", title: "Review invitation delivery" });
  });

  it("preserves unavailable-choice warnings instead of falsely waiting", () => {
    expect(getClientNextStep({ ...offer,
      offerEligibility: { pendingCount: 2, availableCount: 1, unavailableCount: 1 },
    })).toMatchObject({ kind: "action", title: "Offer new appointment choices" });
  });

  it.each(["closed", null, undefined])("does not infer a decline or call from offer state %s", offerState => {
    const input = { ...offer, offerState, offerEligibility: undefined };
    expect(shouldShowNeedsCall(input)).toBe(false);
    expect(getClientNextStep(input).kind).toBe("action");
    expect(getClientNextStep(input).title).not.toMatch(/Call the family/);
  });

  it.each(["New", "Forms Sent", "Forms Completed", "Assigned"])("preserves existing earlier-stage call flags for %s", status => {
    expect(shouldShowNeedsCall({ ...offer, status })).toBe(true);
  });

  it.each(["0199f88e-fc37-453f-8e14-1152f790d40b", "another-practice", undefined, null])(
    "leaves existing behaviour unchanged for practice %s", tenantId => {
      const input = { ...offer, tenantId };
      expect(shouldShowNeedsCall(input)).toBe(true);
      expect(getClientNextStep(input)).toMatchObject({
        kind: "action", title: "Review the appointment offer",
        detail: "A staff follow-up is flagged; no appointment selection is recorded here.",
      });
    },
  );
});

describe("booking completion guidance", () => {
  const complete = { kind: "action" as const, title: "Complete", detail: "Ready", action: "complete" as const };

  it("makes unverified payment setup a staff review action, not a wait for another payment", () => {
    const next = bookingCompletionNextStep(complete, "payment_setup_unverified");
    expect(next).toMatchObject({
      kind: "action", title: "Payment record needs staff review",
      action: "review_payment_record", actionLabel: "Review payment record",
    });
    expect(next.detail).toContain("do not request another payment");
  });

  it("preserves other blockers and ready completion", () => {
    expect(bookingCompletionNextStep(complete, null)).toBe(complete);
    expect(bookingCompletionNextStep(complete, "booking_unverified")).toMatchObject({
      kind: "waiting", detail: "A confirmed booking with a booking record is required before completion.",
    });
  });

  it("does not replace an earlier WriteUpp or registration action", () => {
    const earlier = getClientNextStep({
      status: "BookingConfirmed", writeuppChecklistEnabled: true,
      writeuppAppointmentConfirmed: false, writeuppDataTransferred: true, completedBookingsEnabled: true,
    });
    expect(earlier.action).toBe("review_writeupp");
    expect(bookingCompletionNextStep(earlier, "writeupp_incomplete")).toBe(earlier);
  });
});

describe("getClientNextStep", () => {
  it("offers appointment choices for an admin when Assigned has no recorded selection", () => {
    expect(getClientNextStep({ status: "Assigned", isAdmin: true })).toEqual({
      kind: "action",
      title: "Review appointment choices",
      detail: "No selected appointment is recorded; review the appointment choices.",
      action: "offer_new_choices",
    });
  });

  it("does not claim a selection from the Assigned status", () => {
    const result = getClientNextStep({ status: "Assigned" });
    expect(result.kind).toBe("action");
    expect(result.action).toBe("review_allocation");
    expect(result.detail).toContain("No selected appointment is recorded");
  });

  it("waits for the family only when an active offer and eligible choices are recorded", () => {
    expect(getClientNextStep({
      status: "OptionsSent",
      offerState: "pending",
      offerDeliveryRecorded: true,
      offerEligibility: { pendingCount: 2, availableCount: 2, unavailableCount: 0 },
    })).toMatchObject({
      kind: "waiting",
      title: "Waiting for the family to choose",
    });
  });

  it.each([false, undefined])(
    "reviews offer delivery when accepted delivery is %s",
    offerDeliveryRecorded => {
      const result = getClientNextStep({
        status: "OptionsSent",
        offerState: "pending",
        offerDeliveryRecorded,
        offerEligibility: { pendingCount: 2, availableCount: 2, unavailableCount: 0 },
      });
      expect(result).toMatchObject({
        kind: "action",
        title: "Review offer delivery",
        action: "review_offer",
      });
      expect(result.detail).not.toMatch(/sent|delivered|mailed/i);
    },
  );

  it("waits for the family when eligible pending choices and accepted delivery are explicit", () => {
    expect(getClientNextStep({
      status: "OptionsSent",
      offerState: "pending",
      offerDeliveryRecorded: true,
      offerEligibility: { pendingCount: 2, availableCount: 2, unavailableCount: 0 },
    })).toMatchObject({ kind: "waiting", title: "Waiting for the family to choose" });
  });

  it("offers fresh choices when pending choices have become unavailable", () => {
    expect(getClientNextStep({
      status: "OptionsSent",
      offerState: "pending",
      offerEligibility: { pendingCount: 2, availableCount: 0, unavailableCount: 2 },
      isAdmin: true,
    })).toMatchObject({ kind: "action", action: "offer_new_choices" });
  });

  it("does not expose the admin-only fresh-choice action to a non-admin", () => {
    expect(getClientNextStep({
      status: "OptionsSent",
      offerState: "closed",
      isAdmin: false,
    })).toMatchObject({ kind: "action", action: "review_offer" });
  });

  it("routes failed registration delivery to retry, subject to the registration feature gate", () => {
    expect(getClientNextStep({
      status: "OptionSelected",
      registrationProgress: "failed",
      registrationEnabled: true,
    })).toMatchObject({ kind: "action", action: "retry_registration" });

    expect(getClientNextStep({
      status: "OptionSelected",
      registrationProgress: "failed",
      registrationEnabled: false,
    })).toMatchObject({ kind: "waiting", title: "Registration delivery failed" });
  });

  it("distinguishes sent, in-progress, and missing registration evidence", () => {
    expect(getClientNextStep({
      status: "RegistrationPending",
      registrationProgress: "sent",
    })).toMatchObject({ kind: "waiting", title: "Waiting for registration" });
    expect(getClientNextStep({
      status: "RegistrationPending",
      registrationProgress: "sending",
    })).toMatchObject({ kind: "waiting", title: "Registration delivery is in progress" });
    const missing = getClientNextStep({ status: "RegistrationPending" });
    expect(missing).toMatchObject({ kind: "waiting", title: "Review registration progress" });
    expect(missing.detail).toContain("do not assume");
  });

  it("requires an explicit submitted registration before using payment progression", () => {
    const result = getClientNextStep({
      status: "RegistrationPending",
      paymentProgress: "recovery_needed",
    });
    expect(result.title).toBe("Review registration progress");
    expect(result.action).toBeUndefined();
  });

  it("offers payment recovery, waits for client setup, and checks unverified payment", () => {
    expect(getClientNextStep({
      status: "RegistrationPending",
      registrationProgress: "completed",
      paymentProgress: "recovery_needed",
    })).toMatchObject({ kind: "action", action: "recover_payment" });

    expect(getClientNextStep({
      status: "RegistrationPending",
      registrationProgress: "completed",
      paymentProgress: "awaiting_client",
    })).toMatchObject({ kind: "waiting", title: "Waiting for payment setup" });

    expect(getClientNextStep({
      status: "RegistrationPending",
      registrationProgress: "completed",
    })).toMatchObject({ kind: "action", action: "check_payment" });
  });

  it("prioritizes the legacy confirmation status and preserves registration/payment evidence", () => {
    const result = getClientNextStep({
      status: "AwaitingConfirmation",
      confirmationBlocker: "registration_pending",
      registrationProgress: "failed",
      paymentProgress: "recovery_needed",
    });
    expect(result).toMatchObject({ kind: "action", action: "record_writeupp" });
    expect(result.title).toBe("Verify appointment in WriteUpp");
    expect(result.detail).toContain("Verify the appointment in WriteUpp");
    expect(result.detail).toContain("retain the existing registration and payment evidence");
  });

  it("treats an externally arranged appointment as already recorded despite registration and allocation blockers", () => {
    const result = getClientNextStep({
      status: "RegistrationPending",
      externallyArranged: true,
      registrationProgress: "allocation_incomplete",
      paymentProgress: "recovery_needed",
      hasSelectedAppointment: false,
    });
    expect(result).toMatchObject({
      kind: "action",
      title: "No further booking action",
      detail: "The appointment is arranged in WriteUpp. No further booking action is needed.",
    });
    expect(result.action).toBeUndefined();
  });

  it("keeps externally arranged booking guidance stable when portal progress is pending", () => {
    const result = getClientNextStep({
      status: "BookingConfirmed",
      externallyArranged: true,
      registrationProgress: "automatic_pending",
      writeuppAppointmentConfirmed: true,
      writeuppDataTransferred: true,
      writeuppChecklistEnabled: true,
      completedBookingsEnabled: true,
    });
    expect(result).toMatchObject({
      kind: "action",
      title: "No further booking action",
      detail: "The appointment is arranged in WriteUpp. No further booking action is needed.",
    });
    expect(result.action).toBeUndefined();
  });

  it("requires both WriteUpp checklist items before completing a confirmed booking", () => {
    expect(getClientNextStep({
      status: "BookingConfirmed",
      writeuppAppointmentConfirmed: true,
      writeuppDataTransferred: false,
      writeuppChecklistEnabled: true,
      completedBookingsEnabled: true,
    })).toMatchObject({ kind: "action", action: "review_writeupp" });

    expect(getClientNextStep({
      status: "BookingConfirmed",
      writeuppAppointmentConfirmed: true,
      writeuppDataTransferred: true,
      writeuppChecklistEnabled: true,
      completedBookingsEnabled: true,
    })).toMatchObject({ kind: "action", action: "complete" });
  });

  it("does not offer completion when the completed-bookings feature is disabled", () => {
    expect(getClientNextStep({
      status: "BookingConfirmed",
      writeuppAppointmentConfirmed: true,
      writeuppDataTransferred: true,
      writeuppChecklistEnabled: true,
      completedBookingsEnabled: false,
    })).toMatchObject({ kind: "waiting", title: "Booking verified" });
  });

  it("does not require the WriteUpp checklist when that checklist is disabled", () => {
    expect(getClientNextStep({
      status: "BookingConfirmed",
      writeuppAppointmentConfirmed: false,
      writeuppDataTransferred: false,
      writeuppChecklistEnabled: false,
      completedBookingsEnabled: true,
    })).toMatchObject({ kind: "action", action: "complete" });
  });

  it("gives the canonical status precedence over contradictory progress fields", () => {
    expect(getClientNextStep({
      status: "BookingConfirmed",
      registrationProgress: "failed",
      paymentProgress: "recovery_needed",
      writeuppAppointmentConfirmed: false,
      writeuppDataTransferred: true,
      writeuppChecklistEnabled: true,
      completedBookingsEnabled: true,
    })).toMatchObject({ kind: "action", action: "review_writeupp" });
  });
});

describe("getCompactClientDescription", () => {
  it("normalizes factual notes and keeps useful context without a parsed client name", () => {
    expect(getCompactClientDescription('  "  Guardian   reports\n sensory concerns  "  ')).toBe(
      "Guardian reports sensory concerns",
    );
  });

  it("uses a supplied real client name without inventing a fallback identity", () => {
    expect(getCompactClientDescription(null, "  Jordan   Lee ")).toBe("Jordan Lee");
    expect(getCompactClientDescription(null)).toBeNull();
  });

  it("includes a supplied name with the factual note", () => {
    expect(getCompactClientDescription("Parent requests evening appointments", "A. Lee")).toBe(
      "A. Lee: Parent requests evening appointments",
    );
  });

  it("limits the normalized description to 160 characters", () => {
    const description = getCompactClientDescription("concern ".repeat(40));
    expect(description).not.toBeNull();
    expect(Array.from(description ?? "").length).toBeLessThanOrEqual(160);
    expect(description?.endsWith("…")).toBe(true);
  });
});