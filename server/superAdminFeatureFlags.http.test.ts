import express from "express";
import { createServer, type Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => {
  const state = {
    tenants: [] as any[],
    updates: [] as Array<{ tenantId: string; patch: any }>,
  };

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
        orderBy: () => Promise.resolve([]),
      }),
    }),
    update: () => {
      let patch: any;
      let tenantId: string | undefined;
      return {
        set: (values: any) => {
          patch = values;
          return {
            where: (condition: any) => {
              tenantId = new PgDialect().sqlToQuery(condition).params[0] as string;
              return {
                returning: async () => {
                  if (!tenantId) return [];
                  state.updates.push({ tenantId, patch: { ...patch } });
                  const tenant = state.tenants.find(candidate => candidate.id === tenantId);
                  if (!tenant) return [];
                  Object.assign(tenant, patch);
                  return [{ ...tenant }];
                },
              };
            },
          };
        },
      };
    },
  };

  const storage = {};

  return { state, db, storage };
});

vi.mock("./db", () => ({ db: h.db }));
vi.mock("./storage", () => ({
  storage: h.storage,
  ClientAllocationUpdateError: class extends Error {},
  ManualAssignmentError: class extends Error {},
  SlotRetirementConflictError: class extends Error {},
}));
vi.mock("./auth", () => ({
  setupAuth: vi.fn(),
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireClinician: (_req: any, _res: any, next: any) => next(),
  hashPassword: vi.fn(),
  auditLog: () => (_req: any, _res: any, next: any) => next(),
  destroySessionsForUser: vi.fn(),
}));
vi.mock("./middleware/tenant", () => ({
  requireTenant: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("./seed", () => ({ forceReseedDatabase: vi.fn() }));
vi.mock("./seedDemo", () => ({ seedDemoData: vi.fn() }));
vi.mock("./gmailSync", () => ({
  syncAllActiveConnections: vi.fn(),
  getAuthUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  syncConnection: vi.fn(),
  buildRedirectUri: vi.fn(),
}));
vi.mock("./stripe", () => ({
  isStripeConfigured: vi.fn(() => false),
  getStripeInstance: vi.fn(),
  createPaymentLink: vi.fn(),
  chargeOffSession: vi.fn(),
  constructWebhookEvent: vi.fn(),
  childNameFromClientNotes: vi.fn(),
}));
vi.mock("./email", () => ({
  GENERIC_PRACTICE_NAME: "Practice",
}));
vi.mock("./intakeBounceAlerts", () => ({
  alertIntakeBounce: vi.fn(),
  isIntakeBounce: vi.fn(),
}));

import { registerRoutes } from "./routes";

const SUPER_ADMIN_KEY = "test-super-admin-key";
let server: Server | undefined;
let baseUrl = "";

async function patchFeatures(tenantId: string, body: unknown, withKey = true) {
  const response = await fetch(`${baseUrl}/api/super-admin/tenants/${tenantId}/features`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(withKey ? { "x-super-admin-key": SUPER_ADMIN_KEY } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

function tenant(id: string, allocationVisibilityEnabled: boolean) {
  return {
    id,
    name: `Practice ${id}`,
    allocationVisibilityEnabled,
    paymentsEnabled: false,
    stripeSecretKey: null,
    stripeWebhookSecret: null,
  };
}

beforeEach(async () => {
  process.env.SUPER_ADMIN_KEY = SUPER_ADMIN_KEY;
  h.state.tenants = [tenant("tenant-a", false), tenant("tenant-b", false)];
  h.state.updates = [];

  const app = express();
  app.use(express.json());
  server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(async () => {
  delete process.env.SUPER_ADMIN_KEY;
  if (server?.listening) {
    await new Promise<void>((resolve, reject) =>
      server!.close(error => error ? reject(error) : resolve()));
  }
});

describe("super-admin tenant allocation visibility feature", () => {
  it("allows a super-admin to enable the flag for only the requested tenant", async () => {
    const result = await patchFeatures("tenant-a", { allocationVisibilityEnabled: true });

    expect(result.status).toBe(200);
    expect(result.body.allocationVisibilityEnabled).toBe(true);
    expect(h.state.tenants.map(({ id, allocationVisibilityEnabled }) => ({
      id,
      allocationVisibilityEnabled,
    }))).toEqual([
      { id: "tenant-a", allocationVisibilityEnabled: true },
      { id: "tenant-b", allocationVisibilityEnabled: false },
    ]);
    expect(h.state.updates).toEqual([{
      tenantId: "tenant-a",
      patch: { allocationVisibilityEnabled: true },
    }]);
  });

  it("allows a super-admin to turn the flag off", async () => {
    h.state.tenants[0].allocationVisibilityEnabled = true;

    const result = await patchFeatures("tenant-a", { allocationVisibilityEnabled: false });

    expect(result.status).toBe(200);
    expect(result.body.allocationVisibilityEnabled).toBe(false);
    expect(h.state.tenants[0].allocationVisibilityEnabled).toBe(false);
    expect(h.state.tenants[1].allocationVisibilityEnabled).toBe(false);
  });

  it("rejects the patch when no super-admin key is provided", async () => {
    const result = await patchFeatures("tenant-a", { allocationVisibilityEnabled: true }, false);

    expect(result.status).toBe(401);
    expect(h.state.updates).toHaveLength(0);
    expect(h.state.tenants[0].allocationVisibilityEnabled).toBe(false);
  });

  it("rejects non-boolean allocation visibility values without changing tenant state", async () => {
    const result = await patchFeatures("tenant-a", { allocationVisibilityEnabled: "true" });

    expect(result.status).toBe(400);
    expect(h.state.updates).toHaveLength(0);
    expect(h.state.tenants[0].allocationVisibilityEnabled).toBe(false);
  });
});