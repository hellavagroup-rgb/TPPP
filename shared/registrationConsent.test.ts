import { describe, expect, it } from "vitest";
import {
  activeRegistrationFields,
  buildRegistrationConsentEvidence,
  findRegistrationConsent,
} from "./registrationConsent";

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

  it("records each affirmative explicitly marked consent with one server timestamp", () => {
    const acceptedAt = new Date("2026-09-10T12:34:56.000Z");
    const evidence = buildRegistrationConsentEvidence([
      { id: "share", label: "I consent to information sharing", isConsentConfirmation: true },
      { id: "contact", label: "I consent to contact", isConsentConfirmation: true },
      { id: "declined", label: "Optional consent", isConsentConfirmation: true },
      { id: "ordinaryDate", label: "Appointment date", type: "date" },
    ], { share: "Yes", contact: true, declined: "No", ordinaryDate: "2026-09-01" }, acceptedAt);
    expect(evidence).toEqual([
      { fieldId: "share", statement: "I consent to information sharing", answer: "Yes", acceptedAt: acceptedAt.toISOString() },
      { fieldId: "contact", statement: "I consent to contact", answer: true, acceptedAt: acceptedAt.toISOString() },
    ]);
  });

  it("removes only explicitly configured consent-date fields from the active form", () => {
    const fields = [
      { id: "consentDate", type: "date", isConsentDate: true },
      { id: "birthDate", type: "date", label: "Date of birth" },
    ];
    expect(activeRegistrationFields(fields)).toEqual([fields[1]]);
  });
});