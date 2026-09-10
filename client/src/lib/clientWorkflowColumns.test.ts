import { describe, expect, it } from "vitest";
import {
  isAwaitingConfirmationStatus,
  isMatchedAllocationStatus,
} from "./clientWorkflowColumns";

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
});