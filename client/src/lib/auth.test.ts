import { describe, expect, it } from "vitest";
import { isPublicAuthLocation } from "./auth";

describe("public authentication locations", () => {
  it.each([
    "/fill/client-a/form-a",
    "/options/token-a",
    "/register/client-a/token-a",
    "/payment-success",
    "/payment-cancel",
    "/accept-invite/token-a",
    "/reset-password/token-a",
  ])("does not treat %s as a staff session", (location) => {
    expect(isPublicAuthLocation(location)).toBe(true);
  });

  it("keeps staff routes protected", () => {
    expect(isPublicAuthLocation("/clients")).toBe(false);
  });
});