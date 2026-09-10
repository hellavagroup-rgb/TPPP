import { describe, expect, it } from "vitest";
import { classifyIntakeNextStepAnswer } from "./intakeNextStep";

describe("classifyIntakeNextStepAnswer", () => {
  it("recognises a request for the full intake form", () => {
    expect(classifyIntakeNextStepAnswer(
      "I'd like to complete a full intake form so you can recommend next steps",
    )).toBe("email");
  });

  it("recognises a request for an administrator call", () => {
    expect(classifyIntakeNextStepAnswer(
      "I'd like the practice administrator to call me",
    )).toBe("phone");
  });

  it("leaves an unsure answer for the administrator to decide", () => {
    expect(classifyIntakeNextStepAnswer("I'm not sure – please advise")).toBeNull();
  });
});