import { describe, expect, it } from "vitest";
import { classifyPaymentReturn } from "./paymentReturn";

const session = {
  paymentStatus: "paid",
  checkoutStatus: "complete",
  expiresAt: 2_000_000_000,
  metadataTenantId: "tenant-a",
  metadataClientId: "client-a",
  metadataAttemptKey: "attempt-a",
  paymentLinkId: "plink-a",
};

const client = {
  id: "client-a",
  tenantId: "tenant-a",
  status: "RegistrationPending",
  registrationPaymentAttemptKey: "attempt-a",
  stripePaymentLinkId: "plink-a",
};

describe("classifyPaymentReturn", () => {
  it("shows processing until the webhook advances durable state", () => {
    expect(classifyPaymentReturn({ session, client })).toBe("processing");
  });

  it.each(["Scheduled", "BookingConfirmed"])("accepts the feature-correct final state %s", status => {
    expect(classifyPaymentReturn({ session, client: { ...client, status } })).toBe("confirmed");
  });

  it("reports an ordinary paid link without claiming booking confirmation", () => {
    expect(classifyPaymentReturn({
      session: { ...session, metadataAttemptKey: null },
      client: { ...client, status: "AwaitingConfirmation", registrationPaymentAttemptKey: null },
    })).toBe("paid");
  });

  it("still rejects an ordinary paid link when the current payment link is stale", () => {
    expect(classifyPaymentReturn({
      session: { ...session, metadataAttemptKey: null, paymentLinkId: "plink-old" },
      client: { ...client, status: "AwaitingConfirmation", registrationPaymentAttemptKey: null },
    })).toBe("invalid");
  });

  it("does not accept unpaid or expired checkouts", () => {
    expect(classifyPaymentReturn({
      session: { ...session, paymentStatus: "unpaid", checkoutStatus: "open" },
      client,
    })).toBe("incomplete");
    expect(classifyPaymentReturn({
      session: { ...session, paymentStatus: "unpaid", checkoutStatus: "expired", expiresAt: 1 },
      client,
      nowSeconds: 2,
    })).toBe("invalid");
  });

  it("rejects invalid, stale, and cross-tenant correlations without exposing state", () => {
    expect(classifyPaymentReturn({ session, client: null })).toBe("invalid");
    expect(classifyPaymentReturn({
      session: { ...session, metadataTenantId: "tenant-b" },
      client,
    })).toBe("invalid");
    expect(classifyPaymentReturn({
      session: { ...session, metadataAttemptKey: "old-attempt" },
      client,
    })).toBe("invalid");
    expect(classifyPaymentReturn({
      session: { ...session, paymentLinkId: "plink-old" },
      client,
    })).toBe("invalid");
  });

  it("fails safely when a paid correlated workflow is no longer pending or final", () => {
    expect(classifyPaymentReturn({
      session,
      client: { ...client, status: "Archived" },
    })).toBe("failed");
  });

  it("is read-only and stable across repeated refresh classification", () => {
    const first = classifyPaymentReturn({ session, client });
    const second = classifyPaymentReturn({ session, client });
    expect(first).toBe("processing");
    expect(second).toBe(first);
    expect(client.status).toBe("RegistrationPending");
  });
});