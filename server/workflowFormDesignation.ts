export type WorkflowTemplate = {
  id: string;
  tenantId: string | null;
  title: string;
};

/** Only the opted-in portal intake workflow requires recorded submission/delivery evidence. */
export function shouldValidateIntakeCompletion(
  requestedStatus: unknown,
  currentStatus: string,
  portalIntakeWorkflowEnabled: boolean,
): boolean {
  // Returning from allocation/booking is a repair of an existing journey,
  // not a claim that a newly delivered intake form has just been completed.
  // Historic submissions may predate the designated delivery records.
  const returningFromAllocation = [
    "Assigned", "OptionsSent", "OptionSelected", "RegistrationPending",
    "AwaitingConfirmation", "BookingConfirmed", "Scheduled",
  ].includes(currentStatus);
  return portalIntakeWorkflowEnabled
    && requestedStatus === "Forms Completed"
    && currentStatus !== "Forms Completed"
    && !returningFromAllocation;
}

export function validateWorkflowFormDesignations(input: {
  tenantId: string;
  intakeFormTemplateId: string | null;
  registrationFormTemplateId: string | null;
  registrationFormEnabled: boolean;
  templates: WorkflowTemplate[];
}): string | null {
  const byId = new Map(input.templates.map(template => [template.id, template]));
  if (!input.intakeFormTemplateId) return "Choose a designated intake form";
  const intake = byId.get(input.intakeFormTemplateId);
  if (!intake || intake.tenantId !== input.tenantId) {
    return "The designated intake form must be an available template owned by this tenant";
  }
  if (input.registrationFormEnabled && !input.registrationFormTemplateId) {
    return "Choose a designated registration form before enabling Registration Form";
  }
  if (input.registrationFormTemplateId) {
    const registration = byId.get(input.registrationFormTemplateId);
    if (!registration || registration.tenantId !== input.tenantId) {
      return "The designated registration form must be an available template owned by this tenant";
    }
    if (registration.id === intake.id) {
      return "Intake and registration forms must be different templates";
    }
  }
  return null;
}

export function designatedIntakeCompletionBlocker(
  template: WorkflowTemplate | undefined,
  hasSubmission: boolean,
  deliveryRequired: boolean,
  deliveryStatus: string | undefined,
): { error: string; blocker?: { formTemplateId: string; title: string; state: string } } | null {
  if (!template) return { error: "Designated intake form is unavailable; choose a valid tenant form in Super Admin" };
  if (!hasSubmission) {
    return {
      error: `Designated intake form "${template.title}" has not been submitted`,
      blocker: { formTemplateId: template.id, title: template.title, state: "not_submitted" },
    };
  }
  if (!deliveryRequired || deliveryStatus === "completed") return null;
  const state = deliveryStatus || "not_delivered";
  return {
    error: `Designated intake form "${template.title}" is ${deliveryStatus || "not delivered"}`,
    blocker: { formTemplateId: template.id, title: template.title, state },
  };
}