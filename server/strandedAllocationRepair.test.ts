import { describe, expect, it } from "vitest";
import {
  isUnallocatedClientStatus,
  UNALLOCATED_CLIENT_STATUSES,
} from "./strandedAllocationRepair";

describe("stranded allocation repair status eligibility", () => {
  it.each(UNALLOCATED_CLIENT_STATUSES)(
    "treats %s as unallocated",
    (status) => {
      expect(isUnallocatedClientStatus(status)).toBe(true);
    },
  );

  it.each([
    "Assigned",
    "AwaitingConfirmation",
    "Scheduled",
    "OptionSelected",
    "RegistrationPending",
    "BookingConfirmed",
  ])("preserves legitimate slot ownership for %s", (status) => {
    expect(isUnallocatedClientStatus(status)).toBe(false);
  });
});
