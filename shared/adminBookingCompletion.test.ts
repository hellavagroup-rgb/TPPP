import { describe, expect, it } from "vitest";
import { adminCompletionBlocker, isAdminCompletionRecord } from "./adminBookingCompletion";
import { CYA_PSYCHOLOGY_TENANT_ID as CYA } from "./practicePolicies";

const client = { tenantId: CYA, status: "Scheduled", isArchived: false,
  writeuppAppointmentConfirmed: true, writeuppDataTransferred: true };
const options = { tenantId: CYA, enabled: true, writeuppArranged: false };
describe("administrative completion eligibility", () => {
  it("permits old confirmations without inventing payment or registration requirements", () => {
    expect(adminCompletionBlocker(client, options)).toBeNull();
  });
  it("requires both saved checks even when the practice normally hides that checklist", () => {
    expect(adminCompletionBlocker({ ...client, writeuppDataTransferred: false }, options)).toMatch(/both WriteUpp/);
  });
  it("never weakens normal portal confirmation", () => {
    expect(adminCompletionBlocker({ ...client, status: "BookingConfirmed" }, options)).toMatch(/normal portal/);
    expect(isAdminCompletionRecord({ ...client, status: "OptionsSent", managerConfirmedAt: new Date() }, true)).toBe(false);
  });
  it("only permits unconfirmed statuses with explicit WriteUpp evidence", () => {
    expect(adminCompletionBlocker({ ...client, status: "RegistrationPending" }, options)).toMatch(/normal portal/);
    expect(adminCompletionBlocker({ ...client, status: "RegistrationPending" }, { ...options, writeuppArranged: true })).toBeNull();
  });
  it("denies other practices, opt-outs and archived records", () => {
    expect(adminCompletionBlocker(client, { ...options, enabled: false })).not.toBeNull();
    expect(adminCompletionBlocker({ ...client, tenantId: "foreign" }, options)).not.toBeNull();
    expect(adminCompletionBlocker(client, { ...options, tenantId: "foreign" })).not.toBeNull();
    expect(adminCompletionBlocker({ ...client, isArchived: true }, options)).not.toBeNull();
  });
});
