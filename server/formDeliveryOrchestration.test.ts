import { describe, expect, it, vi } from "vitest";
import {
  executeFormDeliveryBatch,
  FormDeliveryRequestError,
  type FormDeliveryDependencies,
} from "./formDeliveryWorkflow";

function harness(sendResults: boolean[], initial: ("pending" | "failed" | "sent" | "sending" | "completed")[] = ["pending"], diagnostics = false) {
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
    claim: vi.fn(async (id, _tenant, lease, _stale, resend) => {
      const delivery = deliveries.find((item) => item.id === id);
      if (!delivery || !["pending", "failed", ...(resend ? ["sent"] : [])].includes(delivery.status)) return undefined;
      if (delivery.status === "sent") delivery.idempotencyKey = `fresh-${lease}`;
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
  const run = (formIds = forms.map((form) => form.id), tenantId = "tenant-1", resend = false) =>
    executeFormDeliveryBatch({ tenant: { id: tenantId, name: "Practice", intakeDeliveryDiagnosticsEnabled: diagnostics }, clientId: client.id, formIds, baseUrl: "https://app.test", resend }, deps);
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
    expect(partial.deps.finish).toHaveBeenLastCalledWith("delivery-2", "tenant-1", expect.any(String), "failed", "delivery_failed", undefined, false, "unknown");
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

  it("keeps the existing tenant's duplicate-click semantics and rejects deliberate resend", async () => {
    const h = harness([], ["sent"]);
    expect((await h.run()).outcomes[0].skipped).toBeUndefined();
    await expect(h.run(undefined, "tenant-1", true)).rejects.toMatchObject({ statusCode: 404 });
    expect(h.deps.sendEmail).not.toHaveBeenCalled();
  });

  it("reports accepted without claiming mailbox delivery; repeat Send does not resend", async () => {
    const h = harness([true], ["pending"], true);
    vi.mocked(h.deps.sendEmail).mockResolvedValue({ success: true, providerMessageId: "provider-1" });
    expect((await h.run()).outcomes[0].status).toBe("sent");
    expect(h.deps.finish).toHaveBeenCalledWith("delivery-1", "tenant-1", expect.any(String), "sent", undefined, "provider-1", true);
    expect((await h.run()).message).toMatch(/No new email/);
    expect(h.deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("resends an unfinished accepted form with a fresh key but never a completed form", async () => {
    const h = harness([true], ["sent"], true);
    const result = await h.run(undefined, "tenant-1", true);
    expect(result.success).toBe(true);
    expect(h.deps.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "fresh-lease-1" }));
    h.deliveries[0].status = "completed";
    expect((await h.run(undefined, "tenant-1", true)).outcomes[0]).toMatchObject({ status: "completed", skipped: true });
    expect(h.deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate a concurrent resend while another claim is sending", async () => {
    const h = harness([true], ["sent"], true);
    let release!: () => void;
    vi.mocked(h.deps.sendEmail).mockImplementation(() => new Promise(resolve => { release = () => resolve({ success: true }); }));
    const first = h.run(undefined, "tenant-1", true);
    // Wait until the first send starts, then test the competing claim.
    await vi.waitFor(() => expect(h.deps.sendEmail).toHaveBeenCalledTimes(1));
    const second = await h.run(undefined, "tenant-1", true);
    expect(second.outcomes[0].skipped).toBe(true);
    release();
    await first;
    expect(h.deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("retains the same key for a failed retry and records provider rejection", async () => {
    const h = harness([false, true], ["pending"], true);
    vi.mocked(h.deps.sendEmail).mockResolvedValueOnce({ success: false, outcome: "rejected" })
      .mockResolvedValueOnce({ success: true, outcome: "accepted", providerMessageId: "provider-2" });
    expect((await h.run()).success).toBe(false);
    expect(h.deps.finish).toHaveBeenCalledWith("delivery-1", "tenant-1", expect.any(String), "failed", "delivery_failed", undefined, true, "rejected");
    await h.run();
    expect(vi.mocked(h.deps.sendEmail).mock.calls.map(([arg]) => arg.idempotencyKey)).toEqual(["stable-1", "stable-1"]);
  });
});