import { describe, expect, it, vi } from "vitest";
import {
  childNameFromClientNotes,
  chargeOffSession,
  createPaymentLink,
  paymentLinkCreationIdempotencyKey,
  shouldDeactivatePreviousPaymentLink,
} from "./stripe";
import { buildIntakeClientSummary } from "./intakeClientSummary";

const keys = vi.hoisted(() => [] as string[]);
vi.mock("stripe", () => ({
  default: class MockStripe {
    constructor(key: string) { keys.push(key); }
    prices = { create: async () => ({ id: "price_1" }) };
    paymentLinks = {
      create: async () => ({ id: "plink_1", active: true, url: "https://pay.test/link" }),
      update: async () => ({ active: false }),
    };
    paymentIntents = { create: async () => ({ id: "pi_1", status: "succeeded" }) };
  },
}));

describe("legacy registration payment account ownership", () => {
  it("keeps a link and later charge on the same global account while opt-in is off", async () => {
    const previous = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_other";
    keys.length = 0;
    try {
      await createPaymentLink({
        clientId: "client-a", clientDisplayId: "A-001", amountPence: 12000,
        successUrl: "https://app.test/return", tenantId: "tenant-a",
        tenantStripeKey: "sk_tenant", registrationAttemptKey: "attempt-a",
      });
      await chargeOffSession({
        customerId: "cus_1", paymentMethodId: "pm_1", amountPence: 12000,
        clientDisplayId: "A-001", tenantStripeKey: "sk_tenant", tenantId: "tenant-a",
      });
      expect(keys).toEqual(["sk_other", "sk_other"]);
    } finally {
      if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previous;
    }
  });
});

describe("shouldDeactivatePreviousPaymentLink", () => {
  it("never deactivates the link returned by an idempotent retry", () => {
    expect(shouldDeactivatePreviousPaymentLink("plink_same", "plink_same")).toBe(false);
  });

  it("deactivates a genuinely superseded payment link", () => {
    expect(shouldDeactivatePreviousPaymentLink("plink_old", "plink_new")).toBe(true);
  });
});

describe("paymentLinkCreationIdempotencyKey", () => {
  it("does not reuse payment links created under the old lifecycle", () => {
    expect(paymentLinkCreationIdempotencyKey("registration-payment-client-attempt"))
      .toBe("registration-payment-client-attempt-link-v3");
  });
});

describe("childNameFromClientNotes", () => {
  it("passes a new parent-and-child conversion summary through to payment metadata", () => {
    const notes = buildIntakeClientSummary({
      fields: { "Your name": "Victoria Traore", "Child's name": "Alex Traore" },
      email: "victoria@example.com",
    }).join("\n");
    expect(childNameFromClientNotes(notes)).toBe("Alex Traore");
  });

  it("keeps explicitly identified child-only summaries and excludes adult-only summaries", () => {
    expect(childNameFromClientNotes(buildIntakeClientSummary({
      fields: { "Young person's name": "Sam Jones" },
    }).join("\n"))).toBe("Sam Jones");
    expect(childNameFromClientNotes(buildIntakeClientSummary({
      fields: { "Your name": "Victoria Traore" },
    }).join("\n"))).toBeUndefined();
  });

  it("extracts the child name recorded during intake conversion", () => {
    expect(childNameFromClientNotes("Client name: Parent Name\nChild's name: Alex Example"))
      .toBe("Alex Example");
  });

  it("supports a typographic apostrophe and omits absent names", () => {
    expect(childNameFromClientNotes("Child’s name: Sam Example")).toBe("Sam Example");
    expect(childNameFromClientNotes("Client name: Adult Example")).toBeUndefined();
    expect(childNameFromClientNotes("Client name: Adult Example\nSome other contact: Sam"))
      .toBeUndefined();
  });
});