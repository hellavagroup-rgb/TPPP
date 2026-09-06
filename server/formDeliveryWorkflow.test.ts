import { describe, expect, it } from "vitest";
import {
  allDeliveredFormsCompleted,
  allSelectedFormsSent,
  belongsToTenant,
  creationFormSelectionError,
  requiresFormsForNewClient,
  submittedPacketIsComplete,
} from "./formDeliveryWorkflow";

describe("form delivery workflow decisions", () => {
  it("does not require or send email forms for the call-client path", () => {
    expect(requiresFormsForNewClient(true, "phone")).toBe(false);
    expect(creationFormSelectionError(true, "phone", [])).toBeNull();
  });
  it("requires a selected form when creation will email the client", () => {
    expect(creationFormSelectionError(true, "email", [])).toMatch(/Select at least one/);
    expect(creationFormSelectionError(true, "email", ["form-1"])).toBeNull();
  });
  it("advances status and formsSentAt eligibility after a successful full batch", () => {
    expect(allSelectedFormsSent(["sent", "sent"])).toBe(true);
    expect(allSelectedFormsSent(["failed"])).toBe(false);
    expect(allSelectedFormsSent(["sent", "failed"])).toBe(false);
    // A retry/duplicate that finds an already sent durable delivery is safe.
    expect(allSelectedFormsSent(["sent", "completed"])).toBe(true);
  });
  it("does not advance status after a total delivery failure", () => {
    expect(allSelectedFormsSent(["failed"])).toBe(false);
  });
  it("does not advance status after a partial failure, but a retry is duplicate-safe", () => {
    expect(allSelectedFormsSent(["sent", "failed"])).toBe(false);
    // Once the durable failed item is retried, existing sent items are not
    // resent and the complete persisted packet can advance.
    expect(allSelectedFormsSent(["sent", "sent"])).toBe(true);
  });
  it("requires every delivered form before completion", () => {
    expect(allDeliveredFormsCompleted(["completed", "completed"])).toBe(true);
    expect(allDeliveredFormsCompleted(["completed", "sent"])).toBe(false);
  });
  it("preserves phone/manual completion when no delivery packet exists", () => {
    expect(submittedPacketIsComplete([])).toBe(true);
    expect(submittedPacketIsComplete(["completed"])).toBe(true);
    expect(submittedPacketIsComplete(["completed", "sent"])).toBe(false);
  });
  it("keeps delivery operations tenant isolated", () => {
    expect(belongsToTenant("tenant-a", "tenant-a")).toBe(true);
    expect(belongsToTenant("tenant-a", "tenant-b")).toBe(false);
    expect(belongsToTenant(null, "tenant-a")).toBe(false);
  });
});