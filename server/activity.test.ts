import { describe, expect, it } from "vitest";
import type { AuditLog, Task } from "@shared/schema";
import {
  mergeRecentActivityItems,
  RECENT_ACTIVITY_CATEGORY_ACTIONS,
  type HistoricalActivitySources,
  toRecentActivityItem,
} from "./activity";

function activityLog(overrides: Partial<AuditLog>): AuditLog {
  return {
    id: "activity-1",
    userId: "user-1",
    tenantId: "tenant-1",
    action: "activity_client_allocated",
    resourceType: "client",
    resourceId: "client-1",
    ipAddress: "127.0.0.1",
    details: {},
    timestamp: new Date("2026-08-27T10:00:00Z"),
    ...overrides,
  };
}

function task(overrides: Partial<Task>): Task {
  return {
    id: "task-1",
    title: "Follow up with W12345",
    description: "",
    assignee: "Practice Admin",
    dueDate: new Date("2026-08-28T10:00:00Z"),
    priority: "Medium",
    status: "Pending",
    comments: null,
    relatedClientId: null,
    createdAt: new Date("2026-08-26T10:00:00Z"),
    tenantId: "tenant-1",
    ...overrides,
  };
}

function historicalSources(overrides: Partial<HistoricalActivitySources> = {}): HistoricalActivitySources {
  return {
    clients: [
      {
        id: "client-1",
        displayId: "W12345",
        tenantId: "tenant-1",
        intakeDate: new Date("2026-08-20T10:00:00Z"),
        formsSentAt: new Date("2026-08-21T10:00:00Z"),
        formsCompletedAt: new Date("2026-08-22T10:00:00Z"),
        allocatedAt: new Date("2026-08-23T10:00:00Z"),
        awaitingConfirmationAt: new Date("2026-08-24T10:00:00Z"),
        confirmedAt: new Date("2026-08-25T10:00:00Z"),
        isArchived: true,
        archivedAt: new Date("2026-08-26T10:00:00Z"),
      } satisfies HistoricalActivitySources["clients"][number],
    ],
    formTemplates: [
      {
        id: "form-1",
        title: "Initial Assessment",
        tenantId: "tenant-1",
        createdAt: new Date("2026-08-18T10:00:00Z"),
        updatedAt: new Date("2026-08-19T10:00:00Z"),
      } satisfies HistoricalActivitySources["formTemplates"][number],
    ],
    formSubmissions: [
      {
        id: "submission-1",
        clientId: "client-1",
        formTemplateId: "form-1",
        clientDisplayId: "W12345",
        formTitle: "Initial Assessment",
        isDraft: false,
        submittedAt: new Date("2026-08-22T10:00:00Z"),
      },
    ],
    ...overrides,
  };
}

describe("recent activity mapping", () => {
  it("keeps client/form, task, and availability actions in separate feed categories", () => {
    expect(RECENT_ACTIVITY_CATEGORY_ACTIONS.clients).toContain("activity_form_completed");
    expect(RECENT_ACTIVITY_CATEGORY_ACTIONS.clients).toContain("activity_client_allocated");
    expect(RECENT_ACTIVITY_CATEGORY_ACTIONS.tasks).toEqual(expect.arrayContaining([
      "activity_task_created",
      "activity_task_updated",
      "activity_task_completed",
      "activity_task_deleted",
    ]));
    expect(RECENT_ACTIVITY_CATEGORY_ACTIONS.availability).toContain("add_slots");
    expect(RECENT_ACTIVITY_CATEGORY_ACTIONS.availability).toContain("activity_slot_added");
    expect(RECENT_ACTIVITY_CATEGORY_ACTIONS.tasks).not.toContain("activity_form_completed");
    expect(RECENT_ACTIVITY_CATEGORY_ACTIONS.availability).not.toContain("activity_task_created");
  });

  it("renders an allocation without exposing client names or form data", () => {
    const event = toRecentActivityItem(activityLog({
      details: {
        actorName: "Practice Admin",
        clientDisplayId: "W12345",
        clinicianName: "Dr Jones",
        slotDescription: "Tuesday · 10:00–11:00 · online",
      },
    }));

    expect(event).toMatchObject({
      eventType: "client",
      title: "Client allocated",
      actorName: "Practice Admin",
    });
    expect(event.description).toContain("W12345");
    expect(event.description).toContain("Dr Jones");
  });

  it("maps legacy slot records without relying on the former structured payload", () => {
    const event = toRecentActivityItem(activityLog({
      action: "add_slots",
      resourceType: "timeslot",
      details: null,
      ipAddress: "Dr Green|2 slots|Monday 09:00-10:00 (+1 more)",
    }));

    expect(event.eventType).toBe("availability");
    expect(event.title).toBe("Availability added");
    expect(event.description).toContain("Dr Green added 2 slots");
  });

  it("identifies completed forms as client activity", () => {
    const event = toRecentActivityItem(activityLog({
      action: "activity_form_completed",
      resourceType: "form",
      details: { actorName: "Client", clientDisplayId: "W555", formTitle: "Initial Assessment" },
    }));

    expect(event).toMatchObject({ eventType: "form", title: "Form completed", actorName: "Client" });
    expect(event.description).toContain("W555");
    expect(event.description).toContain("Initial Assessment");
  });

  it("includes archive, restore, client-edit, and form-template lifecycle events", () => {
    const expectedTitles = [
      ["activity_client_details_updated", "Client details updated"],
      ["activity_client_archived", "Client archived"],
      ["activity_client_restored", "Client restored"],
      ["activity_form_template_created", "Form created"],
      ["activity_form_template_updated", "Form updated"],
      ["activity_form_template_deleted", "Form deleted"],
    ] as const;

    for (const [action, title] of expectedTitles) {
      const event = toRecentActivityItem(activityLog({
        action,
        details: { clientDisplayId: "W100", formTitle: "Intake Form" },
      }));
      expect(event.title).toBe(title);
    }
  });

  it("recovers open tasks without a task-created audit entry for the current tenant", () => {
    const events = mergeRecentActivityItems(
      [],
      [
        task({ id: "task-tenant-1", title: "Call back client" }),
        task({ id: "task-tenant-2", tenantId: "tenant-2", title: "Other practice task" }),
      ],
      "tenant-1",
      20,
    );

    expect(events).toEqual([
      expect.objectContaining({
        id: "recovered-task-task-tenant-1",
        eventType: "task",
        title: "Task created",
        description: "Call back client",
      }),
    ]);
  });

  it("does not duplicate a task when its creation was already logged", () => {
    const existingLog = activityLog({
      action: "activity_task_created",
      resourceType: "task",
      resourceId: "task-1",
      details: { taskTitle: "Follow up with W12345" },
    });
    const events = mergeRecentActivityItems([existingLog], [task({})], "tenant-1", 20);

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(existingLog.id);
  });

  it("orders recovered task activity with audit activity and respects the requested limit", () => {
    const events = mergeRecentActivityItems(
      [activityLog({ id: "newer-log", timestamp: new Date("2026-08-27T10:00:00Z") })],
      [task({ id: "older-task", createdAt: new Date("2026-08-26T10:00:00Z") })],
      "tenant-1",
      1,
    );

    expect(events).toEqual([expect.objectContaining({ id: "newer-log" })]);
  });

  it("reconstructs timestamp-based client, form submission, and template milestones", () => {
    const events = mergeRecentActivityItems([], [], "tenant-1", 20, historicalSources());

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "recovered-client-client-1-intake", title: "Client intake received" }),
      expect.objectContaining({ id: "recovered-client-client-1-form-sent", title: "Form sent" }),
      expect.objectContaining({ id: "recovered-form-submission-submission-1", title: "Form completed", description: "W12345 completed Initial Assessment." }),
      expect.objectContaining({ id: "recovered-client-client-1-allocated", title: "Client allocated" }),
      expect.objectContaining({ id: "recovered-client-client-1-awaiting-confirmation", title: "Appointment confirmation requested" }),
      expect.objectContaining({ id: "recovered-client-client-1-confirmed", title: "Booking confirmed" }),
      expect.objectContaining({ id: "recovered-client-client-1-archived", title: "Client archived" }),
      expect.objectContaining({ id: "recovered-form-template-form-1-created", title: "Form created" }),
      expect.objectContaining({ id: "recovered-form-template-form-1-updated", title: "Form updated" }),
    ]));
    expect(events.map((event) => event.timestamp.getTime())).toEqual(
      [...events].map((event) => event.timestamp.getTime()).sort((left, right) => right - left),
    );
    expect(events.some((event) => event.title === "Forms completed")).toBe(false);
  });

  it("keeps reconstructed client and form milestones tenant scoped", () => {
    const sources = historicalSources({
      clients: [
        ...historicalSources().clients,
        { ...historicalSources().clients[0], id: "client-2", displayId: "W99999", tenantId: "tenant-2" },
      ],
      formTemplates: [
        ...historicalSources().formTemplates,
        { ...historicalSources().formTemplates[0], id: "form-2", title: "Other practice form", tenantId: "tenant-2" },
      ],
      formSubmissions: [
        ...historicalSources().formSubmissions,
        {
          ...historicalSources().formSubmissions[0],
          id: "submission-2",
          clientId: "client-2",
          formTemplateId: "form-2",
          clientDisplayId: "W99999",
          formTitle: "Other practice form",
        },
      ],
    });

    const events = mergeRecentActivityItems([], [], "tenant-1", 30, sources);

    expect(events.some((event) => event.description?.includes("W99999") || event.description?.includes("Other practice"))).toBe(false);
  });

  it("does not duplicate historical milestones already represented by structured activity", () => {
    const logs = [
      activityLog({ action: "activity_client_created", resourceType: "client", resourceId: "client-1" }),
      activityLog({ id: "sent", action: "activity_form_sent", resourceType: "form", resourceId: "form-1", details: { clientDisplayId: "W12345" } }),
      activityLog({ id: "completed", action: "activity_form_completed", resourceType: "form", resourceId: "submission-1" }),
      activityLog({ id: "allocated", action: "activity_client_allocated", resourceType: "client", resourceId: "client-1" }),
      activityLog({ id: "awaiting", action: "activity_client_status_changed", resourceType: "client", resourceId: "client-1", details: { newStatus: "AwaitingConfirmation" } }),
      activityLog({ id: "confirmed", action: "activity_booking_confirmed", resourceType: "client", resourceId: "client-1" }),
      activityLog({ id: "archived", action: "activity_client_archived", resourceType: "client", resourceId: "client-1" }),
      activityLog({ id: "form-created", action: "activity_form_template_created", resourceType: "form", resourceId: "form-1" }),
      activityLog({ id: "form-updated", action: "activity_form_template_updated", resourceType: "form", resourceId: "form-1" }),
    ];

    const events = mergeRecentActivityItems(logs, [], "tenant-1", 30, historicalSources());

    expect(events).toHaveLength(logs.length);
    expect(events.every((event) => !event.id.startsWith("recovered-"))).toBe(true);
  });

  it("does not invent unavailable client transitions or form template updates", () => {
    const sources = historicalSources({
      clients: [{
        ...historicalSources().clients[0],
        formsSentAt: null,
        formsCompletedAt: null,
        allocatedAt: null,
        awaitingConfirmationAt: null,
        confirmedAt: null,
        isArchived: false,
        archivedAt: null,
      }],
      formTemplates: [{
        ...historicalSources().formTemplates[0],
        createdAt: new Date("2026-08-20T10:00:00Z"),
        updatedAt: new Date("2026-08-20T10:00:00Z"),
      }],
      formSubmissions: [],
    });

    const events = mergeRecentActivityItems([], [], "tenant-1", 20, sources);

    expect(events.map((event) => event.title)).toEqual(["Client intake received", "Form created"]);
    expect(events.some((event) => event.title === "Client restored" || event.title === "Client status changed")).toBe(false);
  });
});