import { describe, expect, it } from "vitest";
import { buildIntakeClientSummary } from "./intakeClientSummary";

describe("buildIntakeClientSummary", () => {
  it("summarises the adult, email address, and child without mixing name fields", () => {
    expect(buildIntakeClientSummary({
      fields: {
        "Your Name": "Victoria Traore",
        "Email": "victoria@example.com",
        "Child's Name": "Alex Traore",
      },
      fallbackClientName: "Wrong fallback",
      email: "victoria@example.com",
    })).toEqual([
      "Client name: Victoria Traore",
      "Email address: victoria@example.com",
      "Child's name: Alex Traore",
    ]);
  });

  it("recognises young-person wording and omits missing values", () => {
    expect(buildIntakeClientSummary({
      fields: { "Young person’s name": "Sam Jones" },
    })).toEqual(["Child's name: Sam Jones"]);
  });
});