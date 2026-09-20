import { describe, expect, it } from "vitest";
import { APIError, classifyLoginFailure } from "./api";

describe("login failure classification", () => {
  it("keeps rejected credentials distinct from service failures", () => {
    expect(classifyLoginFailure(new APIError(401, "Invalid email or password"))).toEqual({
      kind: "credentials",
      message: "Invalid email or password",
    });
  });

  it("preserves an actionable session-service error", () => {
    expect(classifyLoginFailure(new APIError(
      503,
      "Login service is temporarily unavailable. Please try again.",
    ))).toEqual({
      kind: "service",
      message: "Login service is temporarily unavailable. Please try again.",
    });
  });

  it("uses a safe message for unexpected failures", () => {
    expect(classifyLoginFailure(new Error("network details"))).toEqual({
      kind: "service",
      message: "Login service is temporarily unavailable. Please try again.",
    });
  });
});