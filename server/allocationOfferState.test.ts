import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => {
  const options: any[] = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => {
        let condition: any;
        const query: any = {
          where(value: any) {
            condition = value;
            return query;
          },
          orderBy() {
            return query;
          },
          then(resolve: any, reject: any) {
            const { sql, params } = new PgDialect().sqlToQuery(condition);
            const rows = options.filter(option => {
              if (sql.includes('"client_clinician_options"."tenant_id"') && option.tenantId !== params[0]) return false;
              if (sql.includes('"client_clinician_options"."client_id"')) {
                const clientIds = params.slice(1);
                if (!clientIds.includes(option.clientId)) return false;
              }
              return true;
            }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return Promise.resolve(rows).then(resolve, reject);
          },
        };
        return query;
      }),
    })),
  };
  return { options, db };
});

vi.mock("./db", () => ({ db: h.db }));

import { getAllocationOfferStates } from "./allocationOfferState";
import type { Client } from "@shared/schema";

const clients = [
  { id: "client-a-pending", tenantId: "practice-a", status: "OptionsSent" },
  { id: "client-a-declined", tenantId: "practice-a", status: "OptionsSent" },
  { id: "client-a-closed", tenantId: "practice-a", status: "OptionsSent" },
  { id: "client-a-failed-reoffer", tenantId: "practice-a", status: "OptionsSent" },
  { id: "client-a-completed", tenantId: "practice-a", status: "BookingConfirmed" },
  { id: "client-b-pending", tenantId: "practice-b", status: "OptionsSent" },
] as Client[];

function addOption(clientId: string, tenantId: string, status: string, createdAt: string, token: string) {
  h.options.push({
    clientId,
    tenantId,
    status,
    createdAt: new Date(createdAt),
    selectionToken: token,
  });
}

describe("allocation offer-state summaries", () => {
  beforeEach(() => {
    h.options.splice(0);
    vi.clearAllMocks();

    addOption("client-a-pending", "practice-a", "declined", "2026-01-01T00:00:00Z", "old-a");
    addOption("client-a-pending", "practice-a", "pending", "2026-02-01T00:00:00Z", "current-a");

    addOption("client-a-declined", "practice-a", "unavailable", "2026-01-01T00:00:00Z", "old-declined");
    addOption("client-a-declined", "practice-a", "declined", "2026-02-01T00:00:00Z", "declined-a-1");
    addOption("client-a-declined", "practice-a", "declined", "2026-02-01T00:00:00Z", "declined-a-2");

    addOption("client-a-closed", "practice-a", "declined", "2026-01-01T00:00:00Z", "old-closed");
    addOption("client-a-closed", "practice-a", "unavailable", "2026-02-01T00:00:00Z", "closed-a");

    // A failed fresh send retires the preceding generation and leaves only the
    // newest, undelivered generation unavailable; report that generation closed.
    addOption("client-a-failed-reoffer", "practice-a", "unavailable", "2026-01-01T00:00:00Z", "retired-failed");
    addOption("client-a-failed-reoffer", "practice-a", "unavailable", "2026-02-01T00:00:00Z", "failed-fresh-send");

    addOption("client-b-pending", "practice-b", "pending", "2026-02-01T00:00:00Z", "current-b");
    // Even if a foreign tenant has an option tied to a different client, it
    // cannot influence the summary for practice A.
    addOption("client-a-pending", "practice-b", "declined", "2026-03-01T00:00:00Z", "foreign-a-token");
  });

  it("summarizes the latest offer generation for each practice without exposing tokens", async () => {
    const practiceA = await getAllocationOfferStates(clients, "practice-a");
    expect([...practiceA.entries()]).toEqual([
      ["client-a-pending", "pending"],
      ["client-a-declined", "declined"],
      ["client-a-closed", "closed"],
      ["client-a-failed-reoffer", "closed"],
    ]);
    expect(practiceA.has("client-a-completed")).toBe(false);
    expect(practiceA.has("client-b-pending")).toBe(false);
    expect(JSON.stringify([...practiceA.entries()])).not.toContain("token");

    const practiceB = await getAllocationOfferStates(clients, "practice-b");
    expect([...practiceB.entries()]).toEqual([["client-b-pending", "pending"]]);
    expect(practiceB.has("client-a-pending")).toBe(false);
  });

  it("keeps offer summaries independent of allocation-detail visibility settings", async () => {
    const statesWithDetailsHidden = await getAllocationOfferStates(
      clients.map(client => ({ ...client, allocationVisibilityEnabled: false })) as Client[],
      "practice-a",
    );
    const statesWithDetailsVisible = await getAllocationOfferStates(
      clients.map(client => ({ ...client, allocationVisibilityEnabled: true })) as Client[],
      "practice-a",
    );

    expect(statesWithDetailsHidden).toEqual(statesWithDetailsVisible);
    expect([...statesWithDetailsVisible.values()]).toEqual(["pending", "declined", "closed", "closed"]);
  });
});