import { describe, expect, it } from "vitest";
import type { AuditLog } from "@shared/schema";
import { toRecentActivityItem } from "./activity";

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

describe("recent activity mapping", () => {
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
});