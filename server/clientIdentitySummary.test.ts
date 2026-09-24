import { describe, expect, it } from "vitest";
import { correctSummaryClientName, editClientStatusPatch, getSummaryClientName } from "../shared/clientIdentitySummary";

describe("client summary editing", () => {
  it("corrects a legacy child enquiry without losing the adult contact, email, or other notes", () => {
    const notes = "Client name: Victoria Traore\nEmail address: victoria@example.com\nChild's name: Alex Traore\nClinical context";
    expect(getSummaryClientName(notes)).toBe("Victoria Traore");
    expect(correctSummaryClientName(notes, "Alex Traore")).toBe(
      "Client name: Alex Traore\nParent/guardian contact: Victoria Traore\nEmail address: victoria@example.com\nChild's name: Alex Traore\nClinical context",
    );
  });

  it("adds a name to otherwise unstructured notes and rejects empty corrections", () => {
    expect(correctSummaryClientName("Keep this note", " Sam Jones ")).toBe("Client name: Sam Jones\nKeep this note");
    expect(() => correctSummaryClientName("Keep this note", "  ")).toThrow("Client name cannot be empty");
  });

  it("omits an unchanged status only for opted-in editors", () => {
    expect(editClientStatusPatch("Forms Completed", "Forms Completed", true)).toEqual({});
    expect(editClientStatusPatch("Forms Completed", "Forms Sent", true)).toEqual({ status: "Forms Completed" });
    expect(editClientStatusPatch("Forms Completed", "Forms Completed", false)).toEqual({ status: "Forms Completed" });
  });
});