import type { AuditLog, Client, FormTemplate, Task } from "@shared/schema";

export const RECENT_ACTIVITY_ACTIONS = [
  "add_slots",
  "activity_client_created",
  "activity_client_details_updated",
  "activity_client_status_changed",
  "activity_client_archived",
  "activity_client_restored",
  "activity_client_deleted",
  "activity_client_allocated",
  "activity_client_reallocated",
  "activity_client_deallocated",
  "activity_client_options_sent",
  "activity_form_completed",
  "activity_form_sent",
  "activity_form_template_created",
  "activity_form_template_updated",
  "activity_form_template_deleted",
  "activity_clinician_created",
  "activity_clinician_updated",
  "activity_clinician_deleted",
  "activity_clinician_login_generated",
  "activity_admin_invited",
  "activity_admin_deleted",
  "activity_admin_promoted",
  "activity_admin_clinician_link_updated",
  "activity_practice_availability_updated",
  "activity_appointment_option_selected",
  "activity_appointment_options_declined",
  "activity_registration_submitted",
  "activity_booking_confirmed",
  "activity_slot_added",
  "activity_slot_removed",
  "activity_slot_location_changed",
  "activity_task_created",
  "activity_task_updated",
  "activity_task_completed",
  "activity_task_deleted",
] as const;

export const RECENT_ACTIVITY_CATEGORY_ACTIONS = {
  clients: [
    "activity_client_created",
    "activity_client_details_updated",
    "activity_client_status_changed",
    "activity_client_archived",
    "activity_client_restored",
    "activity_client_deleted",
    "activity_client_allocated",
    "activity_client_reallocated",
    "activity_client_deallocated",
    "activity_client_options_sent",
    "activity_form_completed",
    "activity_form_sent",
    "activity_form_template_created",
    "activity_form_template_updated",
    "activity_form_template_deleted",
    "activity_appointment_option_selected",
    "activity_appointment_options_declined",
    "activity_registration_submitted",
    "activity_booking_confirmed",
  ],
  tasks: [
    "activity_task_created",
    "activity_task_updated",
    "activity_task_completed",
    "activity_task_deleted",
  ],
  availability: [
    "add_slots",
    "activity_slot_added",
    "activity_slot_removed",
    "activity_slot_location_changed",
    "activity_practice_availability_updated",
  ],
} as const;

export type RecentActivityCategory = keyof typeof RECENT_ACTIVITY_CATEGORY_ACTIONS;

export function isRecentActivityCategory(value: string): value is RecentActivityCategory {
  return value in RECENT_ACTIVITY_CATEGORY_ACTIONS;
}

export interface RecentActivityItem {
  id: string;
  eventType: "client" | "form" | "availability" | "task" | "team" | "settings";
  title: string;
  description?: string;
  actorName?: string;
  timestamp: Date;
}

type TaskActivityFallback = Pick<Task, "id" | "title" | "createdAt" | "tenantId">;

export type HistoricalClientActivity = Pick<
  Client,
  | "id"
  | "displayId"
  | "tenantId"
  | "intakeDate"
  | "formsSentAt"
  | "formsCompletedAt"
  | "allocatedAt"
  | "awaitingConfirmationAt"
  | "confirmedAt"
  | "isArchived"
  | "archivedAt"
>;

export type HistoricalFormTemplateActivity = Pick<
  FormTemplate,
  "id" | "title" | "tenantId" | "createdAt" | "updatedAt"
>;

export interface HistoricalFormSubmissionActivity {
  id: string;
  clientId: string;
  formTemplateId: string;
  clientDisplayId: string;
  formTitle: string;
  isDraft: boolean;
  submittedAt: Date;
}

export interface HistoricalActivitySources {
  clients: HistoricalClientActivity[];
  formTemplates: HistoricalFormTemplateActivity[];
  formSubmissions: HistoricalFormSubmissionActivity[];
}

type ActivityDetails = Record<string, unknown>;

function detailsFor(log: AuditLog): ActivityDetails {
  return log.details && typeof log.details === "object" && !Array.isArray(log.details)
    ? log.details as ActivityDetails
    : {};
}

function text(details: ActivityDetails, key: string, fallback = ""): string {
  const value = details[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function number(details: ActivityDetails, key: string, fallback = 0): number {
  const value = details[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function legacySlotDescription(log: AuditLog): string {
  const [clinicianName = "Clinician", slotInfo = "availability", slotDetails = ""] = (log.ipAddress || "").split("|");
  return [clinicianName, "added", slotInfo, slotDetails].filter(Boolean).join(" ");
}

export function toRecentActivityItem(log: AuditLog): RecentActivityItem {
  const details = detailsFor(log);
  const actorName = text(details, "actorName") || undefined;
  const clientDisplayId = text(details, "clientDisplayId", "Client");
  const clinicianName = text(details, "clinicianName", "a clinician");
  const slotDescription = text(details, "slotDescription");
  const taskTitle = text(details, "taskTitle", "Untitled task");

  switch (log.action) {
    case "activity_client_created":
      return { id: log.id, eventType: "client", title: "Client added", description: `${clientDisplayId} was added to the practice.`, actorName, timestamp: log.timestamp };
    case "activity_client_details_updated":
      return { id: log.id, eventType: "client", title: "Client details updated", description: `${clientDisplayId}'s record was updated.`, actorName, timestamp: log.timestamp };
    case "activity_client_status_changed":
      return { id: log.id, eventType: "client", title: "Client status changed", description: `${clientDisplayId} moved from ${text(details, "oldStatus", "its previous status")} to ${text(details, "newStatus", "a new status")}.`, actorName, timestamp: log.timestamp };
    case "activity_client_archived":
      return { id: log.id, eventType: "client", title: "Client archived", description: `${clientDisplayId} was archived${text(details, "archiveCategory") ? ` (${text(details, "archiveCategory")})` : ""}.`, actorName, timestamp: log.timestamp };
    case "activity_client_restored":
      return { id: log.id, eventType: "client", title: "Client restored", description: `${clientDisplayId} was restored to the active client list.`, actorName, timestamp: log.timestamp };
    case "activity_client_deleted":
      return { id: log.id, eventType: "client", title: "Client permanently deleted", description: `${clientDisplayId}'s archived record was permanently deleted.`, actorName, timestamp: log.timestamp };
    case "activity_client_allocated":
      return { id: log.id, eventType: "client", title: "Client allocated", description: `${clientDisplayId} was allocated to ${clinicianName}${slotDescription ? ` (${slotDescription})` : ""}.`, actorName, timestamp: log.timestamp };
    case "activity_client_reallocated":
      return { id: log.id, eventType: "client", title: "Client reallocated", description: `${clientDisplayId} was moved to ${clinicianName}${slotDescription ? ` (${slotDescription})` : ""}.`, actorName, timestamp: log.timestamp };
    case "activity_client_deallocated":
      return { id: log.id, eventType: "client", title: "Client allocation released", description: `${clientDisplayId} was released from ${clinicianName}.`, actorName, timestamp: log.timestamp };
    case "activity_client_options_sent":
      return { id: log.id, eventType: "client", title: "Appointment options sent", description: `${number(details, "optionCount", 1)} appointment option${number(details, "optionCount", 1) === 1 ? "" : "s"} sent for ${clientDisplayId}.`, actorName, timestamp: log.timestamp };
    case "activity_form_completed":
      return { id: log.id, eventType: "form", title: "Form completed", description: `${clientDisplayId} completed ${text(details, "formTitle", "an intake form")}.`, actorName, timestamp: log.timestamp };
    case "activity_form_sent":
      return { id: log.id, eventType: "form", title: "Form sent", description: `${text(details, "formTitle", "An intake form")} sent to ${clientDisplayId}.`, actorName, timestamp: log.timestamp };
    case "activity_form_template_created":
      return { id: log.id, eventType: "form", title: "Form created", description: text(details, "formTitle", "An intake form"), actorName, timestamp: log.timestamp };
    case "activity_form_template_updated":
      return { id: log.id, eventType: "form", title: "Form updated", description: text(details, "formTitle", "An intake form"), actorName, timestamp: log.timestamp };
    case "activity_form_template_deleted":
      return { id: log.id, eventType: "form", title: "Form deleted", description: text(details, "formTitle", "An intake form"), actorName, timestamp: log.timestamp };
    case "activity_clinician_created":
      return { id: log.id, eventType: "team", title: "Clinician added", description: text(details, "clinicianName", "A clinician"), actorName, timestamp: log.timestamp };
    case "activity_clinician_updated":
      return { id: log.id, eventType: "team", title: "Clinician details updated", description: text(details, "clinicianName", "A clinician"), actorName, timestamp: log.timestamp };
    case "activity_clinician_deleted":
      return { id: log.id, eventType: "team", title: "Clinician removed", description: text(details, "clinicianName", "A clinician"), actorName, timestamp: log.timestamp };
    case "activity_clinician_login_generated":
      return { id: log.id, eventType: "team", title: "Clinician login generated", description: text(details, "clinicianName", "A clinician"), actorName, timestamp: log.timestamp };
    case "activity_admin_invited":
      return { id: log.id, eventType: "team", title: "Administrator invited", description: text(details, "teamMemberName", "A practice administrator"), actorName, timestamp: log.timestamp };
    case "activity_admin_deleted":
      return { id: log.id, eventType: "team", title: "Administrator removed", description: text(details, "teamMemberName", "A practice administrator"), actorName, timestamp: log.timestamp };
    case "activity_admin_promoted":
      return { id: log.id, eventType: "team", title: "Clinician promoted to administrator", description: text(details, "clinicianName", "A clinician"), actorName, timestamp: log.timestamp };
    case "activity_admin_clinician_link_updated":
      return { id: log.id, eventType: "team", title: "Administrator clinician link updated", description: text(details, "teamMemberName", "A practice administrator"), actorName, timestamp: log.timestamp };
    case "activity_practice_availability_updated":
      return { id: log.id, eventType: "settings", title: "Practice availability settings updated", actorName, timestamp: log.timestamp };
    case "activity_appointment_option_selected":
      return { id: log.id, eventType: "client", title: "Appointment option selected", description: `${clientDisplayId} selected an appointment option.`, actorName, timestamp: log.timestamp };
    case "activity_appointment_options_declined":
      return { id: log.id, eventType: "client", title: "Appointment options declined", description: `${clientDisplayId} declined the appointment options.`, actorName, timestamp: log.timestamp };
    case "activity_registration_submitted":
      return { id: log.id, eventType: "client", title: "Client registration submitted", description: `${clientDisplayId} submitted their registration.`, actorName, timestamp: log.timestamp };
    case "activity_booking_confirmed":
      return { id: log.id, eventType: "client", title: "Booking confirmed", description: `${clientDisplayId}'s appointment is confirmed.`, actorName, timestamp: log.timestamp };
    case "activity_slot_added":
      return { id: log.id, eventType: "availability", title: "Availability added", description: `${clinicianName} added ${number(details, "slotCount", 1)} slot${number(details, "slotCount", 1) === 1 ? "" : "s"}${slotDescription ? `: ${slotDescription}` : ""}.`, actorName, timestamp: log.timestamp };
    case "activity_slot_removed":
      return { id: log.id, eventType: "availability", title: "Availability removed", description: `${clinicianName}'s ${slotDescription || "availability slot"} was removed.`, actorName, timestamp: log.timestamp };
    case "activity_slot_location_changed":
      return { id: log.id, eventType: "availability", title: "Slot location changed", description: `${clinicianName}'s ${slotDescription || "availability slot"} is now ${text(details, "newLocationType", "updated")}.`, actorName, timestamp: log.timestamp };
    case "activity_task_created":
      return { id: log.id, eventType: "task", title: "Task created", description: taskTitle, actorName, timestamp: log.timestamp };
    case "activity_task_completed":
      return { id: log.id, eventType: "task", title: "Task completed", description: taskTitle, actorName, timestamp: log.timestamp };
    case "activity_task_deleted":
      return { id: log.id, eventType: "task", title: "Task deleted", description: taskTitle, actorName, timestamp: log.timestamp };
    case "activity_task_updated":
      return { id: log.id, eventType: "task", title: "Task updated", description: taskTitle, actorName, timestamp: log.timestamp };
    case "add_slots":
      return { id: log.id, eventType: "availability", title: "Availability added", description: legacySlotDescription(log), timestamp: log.timestamp };
    default:
      return { id: log.id, eventType: "client", title: "Practice activity", timestamp: log.timestamp };
  }
}

function toRecoveredTaskActivityItem(task: TaskActivityFallback): RecentActivityItem {
  return {
    id: `recovered-task-${task.id}`,
    eventType: "task",
    title: "Task created",
    description: task.title,
    timestamp: task.createdAt,
  };
}

function recoveredActivity(
  id: string,
  eventType: RecentActivityItem["eventType"],
  title: string,
  description: string,
  timestamp: Date,
): RecentActivityItem {
  return { id, eventType, title, description, timestamp };
}

function hasLoggedResourceActivity(
  logs: AuditLog[],
  action: string,
  resourceType: string,
  resourceId: string,
): boolean {
  return logs.some((log) =>
    log.action === action &&
    log.resourceType === resourceType &&
    log.resourceId === resourceId,
  );
}

function hasLoggedClientDisplayActivity(logs: AuditLog[], action: string, displayId: string): boolean {
  return logs.some((log) =>
    log.action === action &&
    text(detailsFor(log), "clientDisplayId") === displayId,
  );
}

function hasLoggedClientStatusActivity(logs: AuditLog[], clientId: string, status: string): boolean {
  return logs.some((log) =>
    log.action === "activity_client_status_changed" &&
    log.resourceType === "client" &&
    log.resourceId === clientId &&
    text(detailsFor(log), "newStatus") === status,
  );
}

function reconstructHistoricalActivity(
  logs: AuditLog[],
  sources: HistoricalActivitySources,
  tenantId: string,
): RecentActivityItem[] {
  const tenantClients = sources.clients.filter((client) => client.tenantId === tenantId);
  const tenantClientIds = new Set(tenantClients.map((client) => client.id));
  const completedSubmissionClientIds = new Set(
    sources.formSubmissions
      .filter((submission) => !submission.isDraft && tenantClientIds.has(submission.clientId))
      .map((submission) => submission.clientId),
  );

  const clientMilestones = tenantClients.flatMap((client) => {
    const events: RecentActivityItem[] = [];

    if (!hasLoggedResourceActivity(logs, "activity_client_created", "client", client.id)) {
      events.push(recoveredActivity(
        `recovered-client-${client.id}-intake`,
        "client",
        "Client intake received",
        `${client.displayId} was added to the practice.`,
        client.intakeDate,
      ));
    }
    if (
      client.formsSentAt &&
      !hasLoggedClientDisplayActivity(logs, "activity_form_sent", client.displayId) &&
      !hasLoggedClientStatusActivity(logs, client.id, "Forms Sent")
    ) {
      events.push(recoveredActivity(
        `recovered-client-${client.id}-form-sent`,
        "form",
        "Form sent",
        `An intake form was sent to ${client.displayId}.`,
        client.formsSentAt,
      ));
    }
    if (
      client.formsCompletedAt &&
      !completedSubmissionClientIds.has(client.id) &&
      !hasLoggedClientDisplayActivity(logs, "activity_form_completed", client.displayId) &&
      !hasLoggedClientStatusActivity(logs, client.id, "Forms Completed")
    ) {
      events.push(recoveredActivity(
        `recovered-client-${client.id}-forms-completed`,
        "form",
        "Forms completed",
        `${client.displayId} completed their intake forms.`,
        client.formsCompletedAt,
      ));
    }
    if (
      client.allocatedAt &&
      !hasLoggedResourceActivity(logs, "activity_client_allocated", "client", client.id) &&
      !hasLoggedClientStatusActivity(logs, client.id, "Assigned")
    ) {
      events.push(recoveredActivity(
        `recovered-client-${client.id}-allocated`,
        "client",
        "Client allocated",
        `${client.displayId} was allocated to a clinician.`,
        client.allocatedAt,
      ));
    }
    if (
      client.awaitingConfirmationAt &&
      !hasLoggedClientStatusActivity(logs, client.id, "AwaitingConfirmation")
    ) {
      events.push(recoveredActivity(
        `recovered-client-${client.id}-awaiting-confirmation`,
        "client",
        "Appointment confirmation requested",
        `${client.displayId} was asked to confirm their appointment.`,
        client.awaitingConfirmationAt,
      ));
    }
    if (
      client.confirmedAt &&
      !hasLoggedResourceActivity(logs, "activity_booking_confirmed", "client", client.id) &&
      !hasLoggedClientStatusActivity(logs, client.id, "Scheduled")
    ) {
      events.push(recoveredActivity(
        `recovered-client-${client.id}-confirmed`,
        "client",
        "Booking confirmed",
        `${client.displayId}'s appointment is confirmed.`,
        client.confirmedAt,
      ));
    }
    if (
      client.isArchived &&
      client.archivedAt &&
      !hasLoggedResourceActivity(logs, "activity_client_archived", "client", client.id)
    ) {
      events.push(recoveredActivity(
        `recovered-client-${client.id}-archived`,
        "client",
        "Client archived",
        `${client.displayId} was archived.`,
        client.archivedAt,
      ));
    }

    return events;
  });

  const submissionMilestones = sources.formSubmissions
    .filter((submission) =>
      !submission.isDraft &&
      tenantClientIds.has(submission.clientId) &&
      !hasLoggedResourceActivity(logs, "activity_form_completed", "form", submission.id),
    )
    .map((submission) => recoveredActivity(
      `recovered-form-submission-${submission.id}`,
      "form",
      "Form completed",
      `${submission.clientDisplayId} completed ${submission.formTitle}.`,
      submission.submittedAt,
    ));

  const templateMilestones = sources.formTemplates
    .filter((template) => template.tenantId === tenantId)
    .flatMap((template) => {
      const events: RecentActivityItem[] = [];
      if (!hasLoggedResourceActivity(logs, "activity_form_template_created", "form", template.id)) {
        events.push(recoveredActivity(
          `recovered-form-template-${template.id}-created`,
          "form",
          "Form created",
          template.title,
          template.createdAt,
        ));
      }
      if (
        template.updatedAt.getTime() !== template.createdAt.getTime() &&
        !hasLoggedResourceActivity(logs, "activity_form_template_updated", "form", template.id)
      ) {
        events.push(recoveredActivity(
          `recovered-form-template-${template.id}-updated`,
          "form",
          "Form updated",
          template.title,
          template.updatedAt,
        ));
      }
      return events;
    });

  return [...clientMilestones, ...submissionMilestones, ...templateMilestones];
}

export function mergeRecentActivityItems(
  logs: AuditLog[],
  recoveredTasks: TaskActivityFallback[],
  tenantId: string,
  limit: number,
  historicalSources?: HistoricalActivitySources,
): RecentActivityItem[] {
  const taskCreationLogIds = new Set(
    logs
      .filter((log) => log.action === "activity_task_created" && log.resourceType === "task" && log.resourceId)
      .map((log) => log.resourceId),
  );

  return [
    ...logs.map(toRecentActivityItem),
    ...recoveredTasks
      .filter((task) => task.tenantId === tenantId && !taskCreationLogIds.has(task.id))
      .map(toRecoveredTaskActivityItem),
    ...(historicalSources ? reconstructHistoricalActivity(logs, historicalSources, tenantId) : []),
  ]
    .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())
    .slice(0, limit);
}