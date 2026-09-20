import { describe, expect, it, vi } from "vitest";
import { affectedOperationalQueryKeys } from "./operationalRefresh";
import { invalidateOperationalData } from "./operationalRefresh";

describe("operational refresh policy", () => {
  it("covers workflow and availability data without using absolute URLs", () => {
    const keys = affectedOperationalQueryKeys().map((key) => String(key[0]));
    expect(keys).toEqual(expect.arrayContaining([
      "/api/clients",
      "/api/clinicians",
      "/api/clinicians/me/slot-clients",
      "/api/tenant",
      "/api/tenant/features",
    ]));
    expect(keys.every((key) => key.startsWith("/api/"))).toBe(true);
  });

  it("invalidates every operational query family after a mutation", async () => {
    const invalidated: string[] = [];
    const fakeClient = {
      invalidateQueries: vi.fn(async ({ queryKey }: { queryKey: string[] }) => {
        invalidated.push(queryKey[0]);
      }),
    } as any;
    await invalidateOperationalData(fakeClient);
    expect(invalidated).toEqual(expect.arrayContaining([
      "/api/clients",
      "/api/clinicians",
      "/api/clinicians/me/slot-clients",
      "/api/tenant",
      "/api/tenant/features",
    ]));
  });
});