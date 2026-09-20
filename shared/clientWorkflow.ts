export const CLIENT_STATUSES = [
  "New",
  "Forms Sent",
  "Forms Completed",
  "Waitlist",
  "Assigned",
  "OptionsSent",
  "AwaitingConfirmation",
  "OptionSelected",
  "RegistrationPending",
  "Scheduled",
  "BookingConfirmed",
] as const;

export type ClientStatus = typeof CLIENT_STATUSES[number];

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  New: "Pending Intake",
  "Forms Sent": "Screen Booked/Sent",
  "Forms Completed": "Forms Completed",
  Waitlist: "Waitlist",
  Assigned: "Allocated",
  OptionsSent: "Options Sent",
  AwaitingConfirmation: "Awaiting Confirmation",
  OptionSelected: "Option Selected",
  RegistrationPending: "Registration Pending",
  Scheduled: "Confirmed",
  BookingConfirmed: "Confirmed",
};

export const ACTIVE_ALLOCATION_STATUSES = [
  "Assigned",
  "AwaitingConfirmation",
  "Scheduled",
  "OptionSelected",
  "RegistrationPending",
  "BookingConfirmed",
] as const satisfies readonly ClientStatus[];

export const FINALIZED_BOOKING_STATUSES = [
  "Scheduled",
  "BookingConfirmed",
] as const satisfies readonly ClientStatus[];

export type ClientWorkflowFeatures = {
  multiClinicianAllocationEnabled: boolean;
  registrationFormEnabled: boolean;
};

const RECOVERY_STATUSES = [
  "New",
  "Forms Sent",
  "Forms Completed",
  "Waitlist",
] as const satisfies readonly ClientStatus[];

const ADMIN_TRANSITION_TARGETS: Record<ClientStatus, readonly ClientStatus[]> = {
  New: ["Forms Sent", "Forms Completed", "Waitlist"],
  "Forms Sent": ["New", "Forms Completed", "Waitlist"],
  "Forms Completed": ["New", "Forms Sent", "Waitlist", "Assigned"],
  Waitlist: ["New", "Forms Sent", "Forms Completed", "Assigned", "AwaitingConfirmation", "Scheduled"],
  Assigned: [...RECOVERY_STATUSES, "AwaitingConfirmation", "Scheduled"],
  OptionsSent: [...RECOVERY_STATUSES, "Assigned"],
  AwaitingConfirmation: [...RECOVERY_STATUSES, "Assigned", "Scheduled"],
  OptionSelected: [...RECOVERY_STATUSES, "Assigned"],
  RegistrationPending: [...RECOVERY_STATUSES, "Assigned"],
  Scheduled: [...RECOVERY_STATUSES, "Assigned", "AwaitingConfirmation"],
  BookingConfirmed: [...RECOVERY_STATUSES, "Assigned"],
};

const STATUS_SET = new Set<string>(CLIENT_STATUSES);
const ACTIVE_ALLOCATION_STATUS_SET = new Set<string>(ACTIVE_ALLOCATION_STATUSES);
const FINALIZED_BOOKING_STATUS_SET = new Set<string>(FINALIZED_BOOKING_STATUSES);
const LEGACY_CLIENT_STATUS_ALIASES: Readonly<Record<string, ClientStatus>> = {
  "Awaiting Confirmation": "AwaitingConfirmation",
};

export function isClientStatus(value: unknown): value is ClientStatus {
  return typeof value === "string" && STATUS_SET.has(value);
}

export function normalizeStoredClientStatus(value: unknown): ClientStatus | null {
  if (isClientStatus(value)) return value;
  return typeof value === "string" ? LEGACY_CLIENT_STATUS_ALIASES[value] ?? null : null;
}

export function getClientStatusLabel(status: string): string {
  return isClientStatus(status) ? CLIENT_STATUS_LABELS[status] : status;
}

export function hasActiveClientAllocation(status: string | null | undefined): boolean {
  return Boolean(status && ACTIVE_ALLOCATION_STATUS_SET.has(status));
}

export function hasFinalizedBooking(status: string | null | undefined): boolean {
  return Boolean(status && FINALIZED_BOOKING_STATUS_SET.has(status));
}

export function isStatusAvailableForTenant(
  status: ClientStatus,
  features: ClientWorkflowFeatures,
): boolean {
  if (status === "OptionsSent" || status === "BookingConfirmed") {
    return features.multiClinicianAllocationEnabled;
  }
  if (status === "OptionSelected" || status === "RegistrationPending") {
    return features.multiClinicianAllocationEnabled && features.registrationFormEnabled;
  }
  return true;
}

export function getAdminStatusTransitions(
  currentStatus: ClientStatus,
  features: ClientWorkflowFeatures,
): ClientStatus[] {
  return ADMIN_TRANSITION_TARGETS[currentStatus]
    .filter((status) => isStatusAvailableForTenant(status, features));
}

export type ClientStatusTransitionResult =
  | { ok: true; status: ClientStatus }
  | { ok: false; code: "unknown_status" | "feature_disabled" | "transition_not_allowed"; message: string };

export function validateAdminStatusTransition(
  currentStatus: string,
  requestedStatus: unknown,
  features: ClientWorkflowFeatures,
): ClientStatusTransitionResult {
  if (!isClientStatus(requestedStatus)) {
    return {
      ok: false,
      code: "unknown_status",
      message: "Choose a valid client status and try again.",
    };
  }
  const canonicalCurrentStatus = normalizeStoredClientStatus(currentStatus);
  if (!canonicalCurrentStatus) {
    return {
      ok: false,
      code: "unknown_status",
      message: "This client's current status is not recognised. Refresh the page or contact support.",
    };
  }
  if (requestedStatus === canonicalCurrentStatus) return { ok: true, status: requestedStatus };
  if (!isStatusAvailableForTenant(requestedStatus, features)) {
    return {
      ok: false,
      code: "feature_disabled",
      message: `${getClientStatusLabel(requestedStatus)} is not available for this practice's workflow.`,
    };
  }
  if (!getAdminStatusTransitions(canonicalCurrentStatus, features).includes(requestedStatus)) {
    return {
      ok: false,
      code: "transition_not_allowed",
      message: `A client cannot move directly from ${getClientStatusLabel(canonicalCurrentStatus)} to ${getClientStatusLabel(requestedStatus)}.`,
    };
  }
  return { ok: true, status: requestedStatus };
}

export function getAdminStatusOptions(
  currentStatus: string,
  features: ClientWorkflowFeatures,
  context?: { hasAllocation?: boolean },
): Array<{ value: ClientStatus; label: string }> {
  const canonicalCurrentStatus = normalizeStoredClientStatus(currentStatus);
  if (!canonicalCurrentStatus) return [];
  return [canonicalCurrentStatus, ...getAdminStatusTransitions(canonicalCurrentStatus, features)]
    .filter((status, index, statuses) => statuses.indexOf(status) === index)
    .filter((status) => (
      status === canonicalCurrentStatus
      || context?.hasAllocation !== false
      || !hasActiveClientAllocation(status)
    ))
    .map((value) => ({ value, label: CLIENT_STATUS_LABELS[value] }));
}