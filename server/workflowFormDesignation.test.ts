import { describe, expect, it } from "vitest";
import { designatedIntakeCompletionBlocker, shouldValidateIntakeCompletion, validateWorkflowFormDesignations } from "./workflowFormDesignation";

const intake = { id: "intake", tenantId: "tenant-a", title: "Verified intake" };
const registration = { id: "registration", tenantId: "tenant-a", title: "Verified registration" };

describe("intake completion on admin edits", () => {
  it("does not recheck an opted-in Forms Completed client when notes or an unchanged status are saved", () => {
    expect(shouldValidateIntakeCompletion(undefined, "Forms Completed", true)).toBe(false);
    expect(shouldValidateIntakeCompletion("Forms Completed", "Forms Completed", true)).toBe(false);
    // Existing legacy record: submission exists, but no matching delivery.
    expect(designatedIntakeCompletionBlocker(intake, true, true, undefined)?.blocker?.state).toBe("not_delivered");
  });

  it("still rejects an actual opted-in transition without a completed delivery", () => {
    expect(shouldValidateIntakeCompletion("Forms Completed", "Forms Sent", true)).toBe(true);
    expect(designatedIntakeCompletionBlocker(intake, true, true, undefined)?.blocker?.state).toBe("not_delivered");
    expect(designatedIntakeCompletionBlocker(intake, false, true, "completed")?.blocker?.state).toBe("not_submitted");
  });

  it("preserves the opted-out status validation path", () => {
    expect(shouldValidateIntakeCompletion("Forms Completed", "Forms Completed", false)).toBe(true);
    expect(shouldValidateIntakeCompletion(undefined, "Forms Completed", false)).toBe(false);
    expect(shouldValidateIntakeCompletion("Forms Completed", "Forms Sent", false)).toBe(true);
  });
});

describe("workflow form designations", () => {
  it("keeps legacy tenants explicitly in setup instead of guessing", () => {
    expect(validateWorkflowFormDesignations({
      tenantId: "tenant-a",
      intakeFormTemplateId: null,
      registrationFormTemplateId: null,
      registrationFormEnabled: false,
      templates: [intake],
    })).toBe("Choose a designated intake form");
  });

  it("requires registration configuration when the feature is enabled", () => {
    expect(validateWorkflowFormDesignations({
      tenantId: "tenant-a",
      intakeFormTemplateId: intake.id,
      registrationFormTemplateId: null,
      registrationFormEnabled: true,
      templates: [intake],
    })).toContain("registration form");
  });

  it("rejects cross-tenant and same-template designations", () => {
    expect(validateWorkflowFormDesignations({
      tenantId: "tenant-a",
      intakeFormTemplateId: intake.id,
      registrationFormTemplateId: "foreign",
      registrationFormEnabled: true,
      templates: [intake, { id: "foreign", tenantId: "tenant-b", title: "Foreign" }],
    })).toContain("owned by this tenant");
    expect(validateWorkflowFormDesignations({
      tenantId: "tenant-a",
      intakeFormTemplateId: intake.id,
      registrationFormTemplateId: intake.id,
      registrationFormEnabled: true,
      templates: [intake],
    })).toContain("different templates");
  });

  it("accepts one distinct tenant-owned form for each enabled purpose", () => {
    expect(validateWorkflowFormDesignations({
      tenantId: "tenant-a",
      intakeFormTemplateId: intake.id,
      registrationFormTemplateId: registration.id,
      registrationFormEnabled: true,
      templates: [intake, registration],
    })).toBeNull();
  });
});

describe("designated intake completion blocker", () => {
  it("names the exact designated form and delivery state", () => {
    expect(designatedIntakeCompletionBlocker(intake, true, true, "failed")).toEqual({
      error: 'Designated intake form "Verified intake" is failed',
      blocker: { formTemplateId: "intake", title: "Verified intake", state: "failed" },
    });
    expect(designatedIntakeCompletionBlocker(intake, true, true, undefined)?.blocker?.state).toBe("not_delivered");
  });

  it("always requires a durable submission", () => {
    expect(designatedIntakeCompletionBlocker(intake, false, false, undefined)?.blocker?.state).toBe("not_submitted");
    expect(designatedIntakeCompletionBlocker(intake, false, true, "completed")?.blocker?.state).toBe("not_submitted");
  });

  it("requires delivery completion for email but waives it for phone intake", () => {
    expect(designatedIntakeCompletionBlocker(intake, true, true, "completed")).toBeNull();
    expect(designatedIntakeCompletionBlocker(intake, true, false, undefined)).toBeNull();
  });
});
