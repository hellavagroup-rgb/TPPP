import { describe, expect, it, vi } from "vitest";
import {
  executeFormDeliveryBatch,
  FormDeliveryRequestError,
  type FormDeliveryDependencies,
} from "./formDeliveryWorkflow";

function harness(sendResults: boolean[], initial: ("pending" | "failed" | "sent" | "sending")[] = ["pending"]) {
  const client = { id: "client-1", tenantId: "tenant-1", email: "client@example.test", displayId: "W1", status: "New", formsSentAt: null };
  const forms = initial.map((_, index) => ({ id: `form-${index + 1}`, tenantId: "tenant-1", title: `Form ${index + 1}` }));
  const deliveries: any[] = initial.map((status, index) => ({
    id: `delivery-${index + 1}`, tenantId: "tenant-1", clientId: client.id,
    formTemplateId: forms[index].id, status, attemptCount: status === "failed" ? 1 : 0,
    idempotencyKey: `stable-${index + 1}`, lease: null,
  }));
  let sendIndex = 0;
  const deps: FormDeliveryDependencies = {
    getClient: vi.fn(async () => client),
    getForm: vi.fn(async (id) => forms.find((form) => form.id === id)),
    prepare: vi.fn(async () => deliveries),
    list: vi.fn(async () => deliveries),
    claim: vi.fn(async (id, _tenant, lease) => {
      const delivery = deliveries.find((item) => item.id === id);
      if (!delivery || !["pending", "failed"].includes(delivery.status)) return undefined;
      delivery.status = "sending"; delivery.lease = lease; delivery.attemptCount++;
      return { ...delivery };
    }),
    finish: vi.fn(async (id, _tenant, lease, status, error) => {
      const delivery = deliveries.find((item) => item.id === id);
      if (delivery.status !== "sending" || delivery.lease !== lease) return undefined;
      delivery.status = status; delivery.lastError = error; delivery.lease = null;
      return { ...delivery };
    }),
    updateClient: vi.fn(async (_id, updates) => Object.assign(client, updates)),
    buildEmail: vi.fn(async () => ({ subject: "Form" })),
    sendEmail: vi.fn(async () => ({ success: sendResults[sendIndex++] ?? false })),
    activity: vi.fn(async () => undefined),
    uuid: vi.fn(() => `lease-${sendIndex + 1}`),
    now: vi.fn(() => new Date("2026-09-01T10:00:00Z")),
  };
  const run = (formIds = forms.map((form) => form.id), tenantId = "tenant-1") =>
    executeFormDeliveryBatch({ tenant: { id: tenantId, name: "Practice" }, clientId: client.id, formIds, baseUrl: "https://app.test" }, deps);
  return { run, deps, client, forms, deliveries };
}

describe("production form delivery orchestration", () => {
  it("sends a complete batch once with stable provider keys, then advances client", async () => {
    const h = harness([true, true], ["pending", "pending"]);
    const result = await h.run();
    expect(result.success).toBe(true);
    expect(h.deps.sendEmail).toHaveBeenCalledTimes(2);
    expect(h.deps.sendEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({ idempotencyKey: "stable-1" }));
    expect(h.deps.updateClient).toHaveBeenCalledWith("client-1", {
      status: "Forms Sent", formsSentAt: new Date("2026-09-01T10:00:00Z"),
    });
  });

  it("keeps status/timestamp unchanged for partial and total failure and stores only generic errors", async () => {
    const partial = harness([true, false], ["pending", "pending"]);
    expect((await partial.run()).success).toBe(false);
    expect(partial.deps.updateClient).not.toHaveBeenCalled();
    expect(partial.deps.finish).toHaveBeenLastCalledWith("delivery-2", "tenant-1", expect.any(String), "failed", "delivery_failed");
    expect(partial.deps.activity).toHaveBeenCalledWith(
      "activity_form_delivery_failed", expect.anything(), expect.anything(), { error: "delivery_failed" },
    );

    const total = harness([false]);
    expect((await total.run()).success).toBe(false);
    expect(total.deps.updateClient).not.toHaveBeenCalled();
  });

  it("retries failed delivery without resending successful forms", async () => {
    const h = harness([true], ["sent", "failed"]);
    const result = await h.run();
    expect(result.success).toBe(true);
    expect(h.deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(h.deps.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "stable-2" }));
    expect(h.deps.activity).toHaveBeenCalledWith("activity_form_delivery_retried", h.forms[1], h.client);
  });

  it("reconciles an already-sent packet after a crash before client advancement", async () => {
    const h = harness([], ["sent", "sent"]);
    const result = await h.run();
    expect(result.success).toBe(true);
    expect(h.deps.sendEmail).not.toHaveBeenCalled();
    expect(h.deps.claim).not.toHaveBeenCalled();
    expect(h.deps.updateClient).toHaveBeenCalledWith("client-1", {
      status: "Forms Sent", formsSentAt: new Date("2026-09-01T10:00:00Z"),
    });
  });

  it("does not move a later client stage backwards while reconciling sent forms", async () => {
    const h = harness([], ["sent"]);
    h.client.status = "Assigned";
    const result = await h.run();
    expect(result.success).toBe(true);
    expect(h.deps.updateClient).not.toHaveBeenCalled();
  });

  it("does not send, finish, log, or update when another request owns the claim", async () => {
    const h = harness([], ["sending"]);
    expect((await h.run()).success).toBe(false);
    expect(h.deps.sendEmail).not.toHaveBeenCalled();
    expect(h.deps.finish).not.toHaveBeenCalled();
    expect(h.deps.activity).not.toHaveBeenCalled();
    expect(h.deps.updateClient).not.toHaveBeenCalled();
  });

  it("denies a foreign tenant before preparing or sending", async () => {
    const h = harness([true]);
    await expect(h.run(undefined, "tenant-2")).rejects.toEqual(expect.objectContaining<FormDeliveryRequestError>({ statusCode: 403 }));
    expect(h.deps.prepare).not.toHaveBeenCalled();
    expect(h.deps.sendEmail).not.toHaveBeenCalled();
  });
});