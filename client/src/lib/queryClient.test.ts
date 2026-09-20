import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPERATIONAL_REFETCH_INTERVAL,
  OPERATIONAL_STALE_TIME,
  UnauthorizedError,
  getQueryFn,
  queryClient,
  setAuthLossHandler,
} from "./queryClient";

describe("QueryClient resilience policy", () => {
  afterEach(() => {
    setAuthLossHandler(null);
    vi.restoreAllMocks();
  });

  it("uses bounded freshness, focus refresh, and periodic refresh", () => {
    const options = queryClient.getDefaultOptions().queries;
    expect(options.staleTime).toBe(OPERATIONAL_STALE_TIME);
    expect(options.refetchInterval).toBe(OPERATIONAL_REFETCH_INTERVAL);
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it("turns a 401 into UnauthorizedError and calls auth-loss handler", async () => {
    const onAuthLoss = vi.fn();
    setAuthLossHandler(onAuthLoss);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    ));

    await expect(getQueryFn({ on401: "throw" })({ queryKey: ["/api/clients"] } as never))
      .rejects.toBeInstanceOf(UnauthorizedError);
    expect(onAuthLoss).toHaveBeenCalledOnce();
  });
});