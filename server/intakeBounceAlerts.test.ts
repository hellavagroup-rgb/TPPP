import { describe, expect, it, vi } from "vitest";
import { alertIntakeBounce, isIntakeBounce, type IntakeBounceCandidate } from "./intakeBounceAlerts";

function harness(options: { event?: string | null; stored?: string | null; enabled?: boolean; accepted?: boolean } = {}) {
  const attempts: Record<string, IntakeBounceCandidate> = {
    a: { id: "a", tenantId: "practice-a", providerMessageId: "provider-a", providerEvent: options.stored ?? null, displayId: "A10" },
    b: { id: "b", tenantId: "practice-b", providerMessageId: "provider-b", providerEvent: null, displayId: "B20" },
  };
  let claimed = false;
  let alerted = false;
  const deps = {
    find: vi.fn(async (id: string) => options.enabled === false || options.accepted === false ? undefined : attempts[id]),
    event: vi.fn(async (id: string) => id === "provider-a" ? options.event ?? null : null),
    saveEvent: vi.fn(async (id: string, tenantId: string, event: string) => {
      if (attempts[id]?.tenantId === tenantId) attempts[id].providerEvent = event;
    }),
    claim: vi.fn(async (_id: string, _tenantId: string) => {
      if (claimed || alerted) return undefined;
      claimed = true;
      return new Date("2026-09-25T00:00:00Z");
    }),
    admins: vi.fn(async (tenantId: string) => [{ id: `admin-${tenantId}`, email: `${tenantId}@example.test` }]),
    tenant: vi.fn(async (tenantId: string) => ({
      id: tenantId, name: tenantId, intakeDeliveryDiagnosticsEnabled: options.enabled !== false,
    })),
    send: vi.fn(async () => ({ success: true, outcome: "accepted" as const })),
    finish: vi.fn(async (_id: string, _tenantId: string, _claim: Date, accepted: boolean) => {
      if (accepted) alerted = true;
      claimed = false;
    }),
  };
  return { deps, attempts };
}

describe("intake bounce alert", () => {
  it("alerts only the owner practice's staff after a verified provider bounce, once across repeated checks", async () => {
    const { deps } = harness({ event: "bounced" });
    await Promise.all([alertIntakeBounce("a", deps), alertIntakeBounce("a", deps)]);
    await alertIntakeBounce("a", deps);
    expect(deps.event).toHaveBeenCalledWith("provider-a");
    expect(deps.saveEvent).toHaveBeenCalledWith("a", "practice-a", "bounced");
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "practice-a@example.test",
      idempotencyKey: "intake-bounce-practice-a-a-admin-practice-a",
    }));
    expect(deps.admins).toHaveBeenCalledWith("practice-a");
    expect(deps.admins).not.toHaveBeenCalledWith("practice-b");
  });

  it("does not alert for accepted-only sends or an opted-out practice", async () => {
    const accepted = harness({ event: "delivered" });
    await alertIntakeBounce("a", accepted.deps);
    expect(accepted.deps.claim).not.toHaveBeenCalled();
    const missing = harness();
    await alertIntakeBounce("a", missing.deps);
    expect(missing.deps.send).not.toHaveBeenCalled();
    const optedOut = harness({ event: "bounced", enabled: false });
    await alertIntakeBounce("a", optedOut.deps);
    expect(optedOut.deps.event).not.toHaveBeenCalled();
    const rejected = harness({ event: "bounced", accepted: false });
    await alertIntakeBounce("a", rejected.deps);
    expect(rejected.deps.send).not.toHaveBeenCalled();
  });

  it("recognizes suppression and uses previously verified evidence when the provider is unavailable", async () => {
    expect(isIntakeBounce("email.suppressed")).toBe(true);
    expect(isIntakeBounce("complained")).toBe(true);
    expect(isIntakeBounce("sent")).toBe(false);
    const { deps } = harness({ stored: "suppressed" });
    deps.event.mockRejectedValueOnce(new Error("Unavailable"));
    await alertIntakeBounce("a", deps);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.saveEvent).not.toHaveBeenCalled();
  });

  it("releases an unsuccessful alert claim for retry with the same provider key", async () => {
    const { deps } = harness({ event: "bounced" });
    deps.send.mockResolvedValueOnce({ success: false, outcome: "rejected" });
    await alertIntakeBounce("a", deps);
    await alertIntakeBounce("a", deps);
    expect(deps.send).toHaveBeenCalledTimes(2);
    expect(deps.send.mock.calls[0][0].idempotencyKey).toBe(deps.send.mock.calls[1][0].idempotencyKey);
    expect(deps.finish).toHaveBeenCalledWith("a", "practice-a", expect.any(Date), false);
    expect(deps.finish).toHaveBeenCalledWith("a", "practice-a", expect.any(Date), true);
  });
});