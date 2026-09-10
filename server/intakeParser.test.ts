import { describe, expect, it } from "vitest";
import { parseIntakeEmailBody } from "./intakeParser";

describe("intake next-step parsing", () => {
  it.each([
    [
      "I'd like to complete a full intake form so you can recommend next steps",
      "email",
    ],
    [
      "I'd like the practice administrator to call me",
      "phone",
    ],
    [
      "I'm not sure – please advise",
      null,
    ],
  ])("classifies the submitted answer %s", (answer, expected) => {
    const parsed = parseIntakeEmailBody(
      `*What would feel most helpful next?*\n${answer}\n*Email*\nclient@example.com`,
    );
    expect(parsed.nextStep).toBe(expected);
  });
});