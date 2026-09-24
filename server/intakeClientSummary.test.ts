import { describe, expect, it } from "vitest";
import { buildConversionNameNotes, buildIntakeClientSummary } from "./intakeClientSummary";

describe("buildIntakeClientSummary", () => {
  it("labels an explicitly identified child as the client and the adult as contact for opted-in summaries", () => {
    expect(buildIntakeClientSummary({
      fields: {
        "Your Name": "Victoria Traore",
        "Email": "victoria@example.com",
        "Child's Name": "Alex Traore",
      },
      fallbackClientName: "Wrong fallback",
      email: "victoria@example.com",
    })).toEqual([
      "Client name: Alex Traore",
      "Parent/guardian contact: Victoria Traore",
      "Email address: victoria@example.com",
    ]);
  });

  it("recognises young-person wording and omits missing values", () => {
    expect(buildIntakeClientSummary({
      fields: { "Young person’s name": "Sam Jones" },
      fallbackClientName: "Sam Jones",
    })).toEqual(["Client name: Sam Jones", "Child's name: Sam Jones"]);
  });

  it("keeps adult-only enquiries as the client without inventing a young person", () => {
    expect(buildIntakeClientSummary({
      fields: { "Your Name": "Morgan Jones" },
      email: "morgan@example.com",
    })).toEqual(["Client name: Morgan Jones", "Email address: morgan@example.com"]);
  });

  it("does not infer a child's identity from unrecognised or ambiguous labels", () => {
    expect(buildIntakeClientSummary({
      fields: { "Your name": "Taylor Jones", "Name of respondent": "Sam Jones" },
    })).toEqual(["Client name: Taylor Jones"]);
    expect(buildIntakeClientSummary({
      fields: { "Name of respondent": "Sam Jones" },
      fallbackClientName: "Taylor Jones",
    })).toEqual(["Client name: Taylor Jones"]);
  });

  it("retains the opted-out conversion notes, even with child fields", () => {
    expect(buildConversionNameNotes({
      fields: { "Your name": "Victoria Traore", "Child's name": "Alex Traore" },
      fallbackClientName: "Victoria Traore",
      email: "victoria@example.com",
      referrerEmail: "referrer@example.com",
      dateOfBirth: "2010-01-01",
      intakeClientSummaryEnabled: false,
    })).toEqual([
      "Referred by: referrer@example.com",
      "Client name: Victoria Traore",
      "Date of birth: 2010-01-01",
    ]);
  });
});