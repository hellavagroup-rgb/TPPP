import { describe, expect, it } from "vitest";
import {
  ACTIVE_ALLOCATION_STATUSES,
  CLIENT_STATUSES,
  CLIENT_STATUS_LABELS,
  FINALIZED_BOOKING_STATUSES,
  getAdminStatusOptions,
  getAdminStatusTransitions,
  getClientStatusLabel,
  isClientStatus,
  isStatusAvailableForTenant,
  normalizeStoredClientStatus,
  validateAdminStatusTransition,
  type ClientStatus,
} from "./clientWorkflow";

const standardWorkflow = {
  multiClinicianAllocationEnabled: false,
  registrationFormEnabled: false,
};

const registrationWorkflow = {
  multiClinicianAllocationEnabled: true,
  registrationFormEnabled: true,
};

const EXPECTED_ADMIN_TRANSITIONS: Record<ClientStatus, readonly ClientStatus[]> = {
  New: ["Forms Sent", "Forms Completed", "Waitlist"],
  "Forms Sent": ["New", "Forms Completed", "Waitlist"],
  "Forms Completed": ["New", "Forms Sent", "Waitlist", "Assigned"],
  Waitlist: ["New", "Forms Sent", "Forms Completed", "Assigned", "AwaitingConfirmation", "Scheduled"],
  Assigned: ["New", "Forms Sent", "Forms Completed", "Waitlist", "AwaitingConfirmation", "Scheduled"],
  OptionsSent: ["New", "Forms Sent", "Forms Completed", "Waitlist", "Assigned"],
  AwaitingConfirmation: ["New", "Forms Sent", "Forms Completed", "Waitlist", "Assigned", "Scheduled"],
  OptionSelected: ["New", "Forms Sent", "Forms Completed", "Waitlist", "Assigned"],
  RegistrationPending: ["New", "Forms Sent", "Forms Completed", "Waitlist", "Assigned"],
  Scheduled: ["New", "Forms Sent", "Forms Completed", "Waitlist", "Assigned", "AwaitingConfirmation"],
  BookingConfirmed: ["New", "Forms Sent", "Forms Completed", "Waitlist", "Assigned"],
};

describe("canonical client statuses", () => {
  it("defines a human-readable label for every stored value", () => {
    expect(Object.keys(CLIENT_STATUS_LABELS)).toEqual(expect.arrayContaining([...CLIENT_STATUSES]));
    expect(Object.keys(CLIENT_STATUS_LABELS)).toHaveLength(CLIENT_STATUSES.length);
    for (const status of CLIENT_STATUSES) {
      expect(isClientStatus(status)).toBe(true);
      expect(getClientStatusLabel(status)).toBe(CLIENT_STATUS_LABELS[status]);
    }
  });

  it("keeps labels separate from canonical stored values", () => {
    expect(isClientStatus("Awaiting Confirmation")).toBe(false);
    expect(CLIENT_STATUS_LABELS.AwaitingConfirmation).toBe("Awaiting Confirmation");
  });

  it("normalizes the known persisted legacy alias without accepting it as canonical", () => {
    expect(normalizeStoredClientStatus("Awaiting Confirmation")).toBe("AwaitingConfirmation");
    expect(normalizeStoredClientStatus("AwaitingConfirmation")).toBe("AwaitingConfirmation");
    expect(normalizeStoredClientStatus("Something Else")).toBeNull();
  });

  it("centralises allocated and finalized status membership", () => {
    expect(ACTIVE_ALLOCATION_STATUSES).toEqual([
      "Assigned",
      "AwaitingConfirmation",
      "Scheduled",
      "OptionSelected",
      "RegistrationPending",
      "BookingConfirmed",
    ]);
    expect(FINALIZED_BOOKING_STATUSES).toEqual(["Scheduled", "BookingConfirmed"]);
  });
});

describe("admin client status transitions", () => {
  it.each(CLIENT_STATUSES)("enumerates every supported transition from %s", (status) => {
    expect(getAdminStatusTransitions(status, registrationWorkflow)).toEqual(EXPECTED_ADMIN_TRANSITIONS[status]);
  });

  it.each(CLIENT_STATUSES)("exposes only canonical values for the %s UI options", (status) => {
    const options = getAdminStatusOptions(status, registrationWorkflow);
    expect(options.map(option => option.value)).toEqual([status, ...EXPECTED_ADMIN_TRANSITIONS[status]]);
    for (const option of options) {
      expect(isClientStatus(option.value)).toBe(true);
      expect(option.label).toBe(CLIENT_STATUS_LABELS[option.value]);
    }
  });

  it("accepts supported forward, backward, and no-op transitions", () => {
    expect(validateAdminStatusTransition("New", "Forms Sent", standardWorkflow).ok).toBe(true);
    expect(validateAdminStatusTransition("Scheduled", "Forms Completed", standardWorkflow).ok).toBe(true);
    expect(validateAdminStatusTransition("Waitlist", "AwaitingConfirmation", standardWorkflow).ok).toBe(true);
    expect(validateAdminStatusTransition("Assigned", "Assigned", standardWorkflow).ok).toBe(true);
  });

  it("lets a legacy awaiting-confirmation client recover using canonical values", () => {
    expect(getAdminStatusOptions("Awaiting Confirmation", standardWorkflow)[0]).toEqual({
      value: "AwaitingConfirmation",
      label: "Awaiting Confirmation",
    });
    expect(validateAdminStatusTransition(
      "Awaiting Confirmation",
      "Forms Completed",
      standardWorkflow,
    )).toEqual({ ok: true, status: "Forms Completed" });
    expect(validateAdminStatusTransition(
      "Awaiting Confirmation",
      "AwaitingConfirmation",
      standardWorkflow,
    )).toEqual({ ok: true, status: "AwaitingConfirmation" });
  });

  it("rejects unknown and disallowed values with safe explanations", () => {
    expect(validateAdminStatusTransition("Waitlist", "Awaiting Confirmation", standardWorkflow)).toMatchObject({
      ok: false,
      code: "unknown_status",
    });
    expect(validateAdminStatusTransition("New", "Scheduled", standardWorkflow)).toMatchObject({
      ok: false,
      code: "transition_not_allowed",
    });
  });

  it("keeps feature-gated states valid only for the registration journey", () => {
    for (const status of ["OptionsSent", "OptionSelected", "RegistrationPending", "BookingConfirmed"] as const) {
      expect(isStatusAvailableForTenant(status, standardWorkflow)).toBe(false);
    }
    const optionsWithoutRegistration = {
      multiClinicianAllocationEnabled: true,
      registrationFormEnabled: false,
    };
    expect(isStatusAvailableForTenant("OptionsSent", optionsWithoutRegistration)).toBe(true);
    expect(isStatusAvailableForTenant("BookingConfirmed", optionsWithoutRegistration)).toBe(true);
    expect(isStatusAvailableForTenant("OptionSelected", optionsWithoutRegistration)).toBe(false);
    expect(isStatusAvailableForTenant("RegistrationPending", optionsWithoutRegistration)).toBe(false);
    for (const status of ["OptionSelected", "RegistrationPending", "BookingConfirmed"] as const) {
      expect(isStatusAvailableForTenant(status, registrationWorkflow)).toBe(true);
    }
    expect(validateAdminStatusTransition("Assigned", "BookingConfirmed", standardWorkflow)).toMatchObject({
      ok: false,
      code: "feature_disabled",
    });
  });

  it("hides allocation-only status choices when the status-only UI has no allocation", () => {
    const options = getAdminStatusOptions("Waitlist", standardWorkflow, { hasAllocation: false });
    expect(options.map(option => option.value)).toEqual([
      "Waitlist",
      "New",
      "Forms Sent",
      "Forms Completed",
    ]);
  });
});