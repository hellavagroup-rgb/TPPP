import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOriginalEnquiry } from "./originalEnquiry";
import { setAuthLossHandler, UnauthorizedError } from "./queryClient";

describe("original enquiry retrieval", () => {
  afterEach(() => {
    setAuthLossHandler(null);
    vi.unstubAllGlobals();
  });

  it("returns the linked enquiry using the authenticated client endpoint", async () => {
    const message = { id: "message-1", body: "Original enquiry", linkedClientId: "client-1" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(message)));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchOriginalEnquiry("client-1")).toEqual(message);
    expect(fetchMock).toHaveBeenCalledWith("/api/clients/client-1/intake-message", {
      credentials: "include",
    });
  });

  it("returns a missing-source result instead of a loading error for 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "No linked intake message" }), { status: 404 },
    )));
    expect(await fetchOriginalEnquiry("client-1")).toBeNull();
  });

  it.each([403, 500])("does not disguise HTTP %s as a missing enquiry", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Request failed", { status })));
    await expect(fetchOriginalEnquiry("client-1")).rejects.toThrow(`${status}:`);
  });

  it("preserves session-expiry handling", async () => {
    const onAuthLoss = vi.fn();
    setAuthLossHandler(onAuthLoss);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    await expect(fetchOriginalEnquiry("client-1")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(onAuthLoss).toHaveBeenCalledOnce();
  });

  it("preserves genuine network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Network unavailable")));
    await expect(fetchOriginalEnquiry("client-1")).rejects.toThrow("Network unavailable");
  });
});
