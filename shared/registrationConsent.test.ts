import { describe, expect, it } from "vitest";
import { findRegistrationConsent } from "./registrationConsent";

describe("findRegistrationConsent", () => {
  const fields = [
    { id: "terms-copy", type: "info", content: "The exact terms shown to the client." },
    {
      id: "agreement",
      type: "radio",
      label: "I understand and agree to the terms and conditions",
      options: ["Yes"],
      required: true,
    },
  ];

  it("accepts the agreement recorded by the registration form", () => {
    expect(findRegistrationConsent(fields, { agreement: "Yes" })).toEqual({
      fieldId: "agreement",
      accepted: true,
      evidenceContent: "The exact terms shown to the client.\n\nI understand and agree to the terms and conditions",
    });
  });

  it("does not treat a missing or negative response as consent", () => {
    expect(findRegistrationConsent(fields, {})?.accepted).toBe(false);
    expect(findRegistrationConsent(fields, { agreement: "No" })?.accepted).toBe(false);
  });

  it("prefers an explicitly marked field when wording changes", () => {
    const custom = [{ id: "consent", type: "checkbox", label: "Please confirm", isTermsAcceptance: true }];
    expect(findRegistrationConsent(custom, { consent: ["I agree"] })?.accepted).toBe(true);
  });
});