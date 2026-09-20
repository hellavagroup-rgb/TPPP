import { describe, expect, it } from "vitest";
import {
  AWAITING_CONFIRMATION_STATUSES,
  MATCHED_ALLOCATION_STATUSES,
  isAwaitingConfirmationStatus,
  isMatchedAllocationStatus,
  registrationProgressCopy,
} from "./clientWorkflowColumns";
import { CLIENT_STATUSES } from "@shared/clientWorkflow";

describe("client workflow column membership", () => {
  it.each(["Assigned", "OptionsSent", "OptionSelected"])(
    "keeps %s visible in the allocation column",
    (status) => {
      expect(isMatchedAllocationStatus(status)).toBe(true);
    },
  );

  it.each(["AwaitingConfirmation", "RegistrationPending", "BookingConfirmed"])(
    "keeps %s visible in the confirmation column",
    (status) => {
      expect(isAwaitingConfirmationStatus(status)).toBe(true);
    },
  );

  it.each(CLIENT_STATUSES)(
    "classifies %s from the canonical status vocabulary",
    (status) => {
      expect(isMatchedAllocationStatus(status)).toBe(MATCHED_ALLOCATION_STATUSES.includes(status as never));
      expect(isAwaitingConfirmationStatus(status)).toBe(AWAITING_CONFIRMATION_STATUSES.includes(status as never));
    },
  );
});

describe("registration progress copy", () => {
  it.each([
    ["waiting_for_option", "Waiting for option selection"],
    ["allocation_incomplete", "Allocation incomplete"],
    ["automatic_pending", "Automatic registration delivery pending"],
    ["sending", "Automatic registration delivery in progress"],
    ["failed", "Registration delivery failed"],
    ["sent", "Registration sent"],
    ["completed", "Registration completed"],
  ] as const)("describes %s accurately", (state, title) => {
    expect(registrationProgressCopy(state)[0]).toBe(title);
  });

  it("shows the recorded provider failure when delivery needs retry", () => {
    expect(registrationProgressCopy("failed", "Provider rejected it")[1]).toBe("Provider rejected it");
  });
});