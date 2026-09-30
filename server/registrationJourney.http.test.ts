import express from "express";
import { createServer, type Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingSnapshots } from "@shared/schema";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => {
  const state = {
    client: {} as any,
    tenant: {} as any,
    options: [] as any[],
    slot: {} as any,
    clinician: {} as any,
    user: { name: "Dr Test" } as any,
    activities: [] as any[],
    emails: [] as any[],
    paymentLinks: [] as any[],
    registrationTemplate: null as any,
    submissions: [] as any[],
    deliveries: [] as any[],
    bookingSnapshots: [] as any[],
    slotClaimFails: false,
    stripeLinkActive: true,
    deactivatedLinks: [] as string[],
    returnProviderKeys: [] as string[],
    legacyProviderKeys: [] as string[],
    emailResult: { success: true, outcome: "accepted" } as any,
    emailThrows: false,
    paymentResult: { url: "https://pay.test/session", paymentLinkId: "plink_1" } as any,
    checkoutSession: null as any,
    checkoutSessions: [] as any[],
    checkoutError: null as any,
    preventCheckoutSave: false,
    charges: [] as any[],
    webhookFailures: [] as any[],
    webhookLookupIsForeign: false,
    intent: null as any,
    stripeLinkMetadata: null as any,
    customerUpdates: [] as any[],
    rateChangeBeforeTransaction: null as number | null,
  };
  let transactionTail: Promise<void> = Promise.resolve();

  const tableName = (table: any) => {
    const symbol = Object.getOwnPropertySymbols(table).find(s => s.description === "drizzle:Name");
    return symbol ? table[symbol] : "";
  };

  const rowsFor = (table: any) => {
    switch (tableName(table)) {
      case "clients": return state.client?.id && state.client.tenantId === state.tenant.id ? [state.client] : [];
      case "tenants": return state.tenant?.id ? [state.tenant] : [];
      case "time_slots": return state.slot?.id ? [state.slot] : [];
      case "clinicians": return state.clinician?.id ? [state.clinician] : [];
      case "users": return state.user ? [state.user] : [];
      case "client_clinician_options": return state.options;
      // The harness has no SQL predicate evaluator; enforce the tenant predicate
      // for template reads here so cross-practice configuration is testable.
      case "form_templates": return state.registrationTemplate?.id
        && state.registrationTemplate.tenantId === state.tenant?.id ? [state.registrationTemplate] : [];
      case "form_submissions": return state.submissions;
      case "booking_snapshots": return state.bookingSnapshots;
      case "payment_charges": return state.charges;
      case "stripe_webhook_failures": return state.webhookFailures.filter(f =>
        f.tenantId === state.tenant.id && !f.resolvedAt && f.attempts >= 3);
      case "audit_logs": return state.activities;
      default: return [];
    }
  };

  const chain = (run: () => any[]) => {
    let result: any[] | undefined;
    const execute = () => result ??= run();
    const builder: any = {
      where: (condition: any) => {
        const originalRun = run;
        if (condition) run = () => {
          const rows = originalRun();
          // Enforce the real SQL ownership predicate for snapshot reads. A foreign
          // row with the same client ID must not satisfy an idempotent confirmation.
          const sql = new PgDialect().sqlToQuery(condition).sql;
          return sql.includes('"booking_snapshots"."tenant_id"')
            ? rows.filter(row => row.tenantId === state.tenant.id)
            : rows;
        };
        result = undefined;
        return builder;
      },
      leftJoin: () => builder,
      orderBy: () => builder,
      limit: (count: number) => Promise.resolve(execute().slice(0, count)),
      returning: () => Promise.resolve(execute()),
      for: () => builder,
      then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject),
    };
    return builder;
  };

  const db: any = {
    execute: vi.fn(async () => []),
    select: (selection?: any) => ({
      from: (table: any) => chain(() => selection?.conflictingClientId && tableName(table) === "clients"
        ? []
        : selection?.sentAt && tableName(table) === "clients"
        ? [{ sentAt: state.client.zoomLinkSentAt || null }]
        : selection?.displayId && tableName(table) === "clients" && state.webhookLookupIsForeign
          ? []
        : selection?.eventId && tableName(table) === "stripe_webhook_failures"
          ? rowsFor(table).map(f => ({
              ...f, clientId: f.clientId || null,
              displayId: f.clientId === state.client.id ? state.client.displayId : null,
            }))
        : rowsFor(table)),
    }),
    insert: (table: any) => ({
      values: (values: any | any[]) => {
        let inserted: any[] = [];
        if (tableName(table) === "client_clinician_options") {
          inserted = (Array.isArray(values) ? values : [values]).map((value, index) => ({
            id: value.id || `inserted-option-${index}`,
            ...value,
          }));
          state.options.push(...inserted);
        } else if (tableName(table) === "form_submissions") {
          inserted = (Array.isArray(values) ? values : [values]).map((value, index) => ({
            id: `submission-${state.submissions.length + index + 1}`, ...value,
          }));
          state.submissions.push(...inserted);
        } else if (table === bookingSnapshots || tableName(table) === "booking_snapshots") {
          if (state.bookingSnapshots.some(row => row.clientId === (Array.isArray(values) ? values[0] : values).clientId)) {
            throw new Error("booking_snapshots_client_unique");
          }
          inserted = (Array.isArray(values) ? values : [values]).map((value, index) => ({
            id: `booking-snapshot-${state.bookingSnapshots.length + index + 1}`, ...value,
          }));
          state.bookingSnapshots.push(...inserted);
        } else if (tableName(table) === "payment_charges") {
          const charge = Array.isArray(values) ? values[0] : values;
          if (!state.charges.some(c => c.stripePaymentIntentId === charge.stripePaymentIntentId)) {
            state.charges.push({ id: `charge-${state.charges.length + 1}`, ...charge });
          }
          inserted = state.charges;
        } else if (tableName(table) === "stripe_webhook_failures") {
          const value = Array.isArray(values) ? values[0] : values;
          const existing = state.webhookFailures.find(f => f.eventId === value.eventId && f.tenantId === value.tenantId);
          if (existing) {
            existing.attempts = existing.resolvedAt ? 1 : existing.attempts + 1;
            if (existing.resolvedAt) {
              existing.generation++;
              existing.alertedAt = null;
              existing.alertClaimedAt = null;
            }
            existing.resolvedAt = null;
            existing.reason = value.reason;
            inserted = [existing];
          } else {
            const failure = { id: `webhook-failure-${state.webhookFailures.length}`, attempts: 1, generation: 1,
              alertedAt: null, alertClaimedAt: null, resolvedAt: null, ...value };
            state.webhookFailures.push(failure);
            inserted = [failure];
          }
        } else if (tableName(table) === "audit_logs") {
          inserted = (Array.isArray(values) ? values : [values]).map(value => ({
            id: `activity-${state.activities.length + 1}`, ...value,
          }));
          state.activities.push(...inserted);
        }
        const result: any = {
          returning: () => Promise.resolve(inserted),
          onConflictDoNothing: () => Promise.resolve(inserted),
          onConflictDoUpdate: () => ({ returning: () => Promise.resolve(inserted) }),
          then: (resolve: any, reject: any) => Promise.resolve(inserted).then(resolve, reject),
        };
        return result;
      },
    }),
    delete: (table: any) => ({
      where: async () => {
        if (tableName(table) !== "client_clinician_options") return [];
        const deleted = [...state.options];
        state.options = [];
        return deleted;
      },
    }),
    update: (table: any) => ({
      set: (patch: any) => chain(() => {
        const name = tableName(table);
        if (name === "time_slots") {
          if (patch.isBooked && (state.slotClaimFails || state.slot.isBooked)) return [];
          Object.assign(state.slot, patch);
          return [state.slot];
        }
        if (name === "client_clinician_options") {
          for (const option of state.options) {
            if (patch.status === "declined" || patch.status === "unavailable"
              ? option.status === "pending"
              : true) Object.assign(option, patch);
          }
          return state.options;
        }
        if (name === "payment_charges") {
          for (const charge of state.charges) Object.assign(charge, patch);
          return state.charges;
        }
        if (name === "stripe_webhook_failures") {
          const failure = state.webhookFailures.find(f => f.tenantId === state.tenant.id && !f.resolvedAt);
          if (!failure) return [];
          if (patch.alertClaimedAt instanceof Date && (failure.alertedAt || failure.alertClaimedAt)) return [];
          Object.assign(failure, patch);
          return [failure];
        }
        if (name !== "clients") return [];
        if (state.client.tenantId !== state.tenant.id) return [];
        if ("completedAt" in patch && patch.completedAt === null
          && (!state.client.completedAt || state.client.isArchived)) return [];

        if (patch.registrationEmailClaimId && state.client.registrationEmailSendingAt
          && state.client.registrationEmailSendingAt > new Date(Date.now() - 5 * 60 * 1000)) return [];
        if (patch.status === "RegistrationPending" && state.client.status !== "OptionSelected") return [];
        if (["BookingConfirmed", "Scheduled"].includes(patch.status)
          && !["OptionsSent", "RegistrationPending", "AwaitingConfirmation", "BookingConfirmed", "Scheduled"].includes(state.client.status)) return [];
        if (patch.stripeCheckoutUrl
          && ((state.client.stripeCheckoutUrl && state.stripeLinkActive) || state.preventCheckoutSave)) return [];
        const resolvedPatch = { ...patch };
        if (resolvedPatch.agreedRatePence && typeof resolvedPatch.agreedRatePence === "object") {
          resolvedPatch.agreedRatePence = state.client.agreedRatePence > 0
            ? state.client.agreedRatePence
            : state.clinician.sessionRatePence;
        }
        Object.assign(state.client, resolvedPatch);
        return [state.client];
      }),
    }),
    transaction: async (callback: any) => {
      if (state.rateChangeBeforeTransaction !== null) {
        state.client.agreedRatePence = state.rateChangeBeforeTransaction;
        state.rateChangeBeforeTransaction = null;
      }
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const backup = structuredClone({
        client: state.client, slot: state.slot, options: state.options,
        snapshots: state.bookingSnapshots, submissions: state.submissions, charges: state.charges,
        activities: state.activities,
      });
      try {
        return await callback(db);
      } catch (error) {
        state.client = backup.client;
        state.slot = backup.slot;
        state.options = backup.options;
        state.bookingSnapshots = backup.snapshots;
        state.submissions = backup.submissions;
        state.charges = backup.charges;
        state.activities = backup.activities;
        throw error;
      } finally {
        release();
      }
    },
  };

  const storage: any = new Proxy({
    getClientById: vi.fn(async () => state.client?.id ? { ...state.client } : undefined),
    getAdminUsersByTenantId: vi.fn(async (tenantId: string) =>
      tenantId === state.tenant.id ? [{ id: "admin-a", email: "admin@practice.test" }] : []),
    getClinicianById: vi.fn(async (id: string) =>
      state.clinician?.id === id ? { ...state.clinician } : undefined),
    getTenantById: vi.fn(async () => state.tenant?.id ? { ...state.tenant } : undefined),
    getClientClinicianOptionByToken: vi.fn(async (token: string) =>
      state.options.find(option => option.selectionToken === token)),
    getClientClinicianOptions: vi.fn(async () => state.options.map(option => ({ ...option }))),
    getFormSubmissionsByClientId: vi.fn(async (clientId: string) =>
      state.submissions.filter(submission => submission.clientId === clientId).map(submission => ({ ...submission }))),
    getDraftSubmission: vi.fn(async () => undefined),
    createFormSubmission: vi.fn(async (submission: any, tenantId: string) => {
      const created = {
        id: `submission-${state.submissions.length + 1}`,
        ...submission,
        tenantId,
        isDraft: false,
      };
      state.submissions.push(created);
      return { ...created };
    }),
    getFormDeliveries: vi.fn(async (clientId: string, tenantId: string) =>
      state.deliveries.filter(delivery => delivery.clientId === clientId && delivery.tenantId === tenantId)
        .map(delivery => ({ ...delivery }))),
    getFormTemplateById: vi.fn(async (id: string) =>
      state.registrationTemplate?.id === id ? { ...state.registrationTemplate } : undefined),
    updateClient: vi.fn(async (id: string, patch: any) => {
      if (state.client.id !== id) return undefined;
      Object.assign(state.client, patch);
      return { ...state.client };
    }),
    assignClinicianToClient: vi.fn(async (clientId: string, clinicianId: string, slotId: string, tenantId: string) => {
      if (state.client.id !== clientId || state.client.tenantId !== tenantId) {
        throw new Error("client not found");
      }
      Object.assign(state.client, {
        assignedClinicianId: clinicianId,
        assignedSlotId: slotId,
        status: "Assigned",
      });
      state.slot.isBooked = true;
      return { ...state.client };
    }),
    getTimeSlotById: vi.fn(async (id: string) => state.slot.id === id ? { ...state.slot } : undefined),
    createAuditLog: vi.fn(async (activity: any) => {
      state.activities.push(activity);
      return activity;
    }),
  }, {
    get(target, property) {
      if (!(property in target)) (target as any)[property] = vi.fn();
      return (target as any)[property];
    },
  });

  return { state, db, storage };
});

vi.mock("./db", () => ({ db: h.db }));
vi.mock("./storage", () => ({ storage: h.storage, ClientAllocationUpdateError: class ClientAllocationUpdateError extends Error {} }));
vi.mock("./auth", () => {
  const pass = (req: any, res: any, next: any) => {
    req.user = { id: "admin-1", name: "Admin", role: req.headers["x-role"] || "admin", tenantId: req.tenant?.id };
    next();
  };
  const admin = (req: any, res: any, next: any) => {
    pass(req, res, () => {
      if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
      next();
    });
  };
  return {
    setupAuth: vi.fn(),
    requireAuth: pass,
    requireAdmin: admin,
    requireClinician: pass,
    hashPassword: vi.fn(async (value: string) => value),
    auditLog: () => pass,
    destroySessionsForUser: vi.fn(),
  };
});
vi.mock("./middleware/tenant", () => ({
  requireTenant: (req: any, _res: any, next: any) => {
    req.tenant = req.headers["x-tenant"] === h.state.tenant.id ? h.state.tenant : undefined;
    next();
  },
}));
vi.mock("./middleware/superAdmin", () => ({ requireSuperAdmin: (_req: any, _res: any, next: any) => next() }));
vi.mock("./seed", () => ({ forceReseedDatabase: vi.fn() }));
vi.mock("./seedDemo", () => ({ seedDemoData: vi.fn() }));
vi.mock("./gmailSync", () => ({
  syncAllActiveConnections: vi.fn(), getAuthUrl: vi.fn(), exchangeCodeForTokens: vi.fn(),
  syncConnection: vi.fn(), buildRedirectUri: vi.fn(),
}));
vi.mock("./stripe", () => ({
  isStripeConfigured: vi.fn(() => true),
  getStripeInstance: vi.fn((tenantKey?: string | null) => {
    h.state.legacyProviderKeys.push(process.env.STRIPE_SECRET_KEY || tenantKey || "");
    return ({
    paymentLinks: {
        retrieve: vi.fn(async () => ({ active: h.state.stripeLinkActive })),
         update: vi.fn(async (id: string) => {
           h.state.deactivatedLinks.push(id);
           return { active: false };
         }),
    },
    checkout: {
      sessions: {
        retrieve: vi.fn(async () => {
          if (h.state.checkoutError) throw h.state.checkoutError;
          return h.state.checkoutSession;
        }),
        list: vi.fn(() => ({
          async *[Symbol.asyncIterator]() {
            for (const session of h.state.checkoutSessions) yield session;
          },
        })),
      },
    },
    paymentIntents: { retrieve: vi.fn(async () => h.state.intent) },
    customers: { update: vi.fn(async () => ({})) },
  });
  }),
  createPaymentLink: vi.fn(async (input: any) => {
    h.state.paymentLinks.push(input);
    return h.state.paymentResult;
  }),
  chargeOffSession: vi.fn(),
  constructWebhookEvent: vi.fn(),
}));
vi.mock("stripe", () => ({
  default: class MockStripe {
    constructor(key: string) { h.state.returnProviderKeys.push(key); }
    paymentLinks = {
      retrieve: vi.fn(async () => ({
        active: h.state.stripeLinkActive,
        metadata: h.state.stripeLinkMetadata || {
          tenantId: h.state.tenant.id, clientId: h.state.client.id,
          registrationAttemptKey: h.state.client.registrationPaymentAttemptKey,
        },
      })),
       update: vi.fn(async (id: string) => {
         h.state.deactivatedLinks.push(id);
         return { active: false };
       }),
    };
    checkout = { sessions: {
      retrieve: vi.fn(async () => {
        if (h.state.checkoutError) throw h.state.checkoutError;
        if (!h.state.checkoutSession) throw Object.assign(new Error("not found"), { code: "resource_missing" });
        return h.state.checkoutSession;
      }),
      list: vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        if (h.state.checkoutError) throw h.state.checkoutError;
        for (const session of h.state.checkoutSessions) yield session;
      },
    })) } };
    paymentIntents = { retrieve: vi.fn(async () => h.state.intent) };
    customers = { update: vi.fn(async (id: string, payload: any) => {
      h.state.customerUpdates.push({ id, payload });
      return {};
    }) };
  },
}));
vi.mock("./encryption", () => ({
  encryptSecret: vi.fn((value: string) => value),
  decryptSecret: vi.fn((value: string) => value),
  isEncryptionConfigured: vi.fn(() => true),
}));
vi.mock("./email", async importOriginal => {
  const actual = await importOriginal<typeof import("./email")>();
  return {
    ...actual,
    sendEmail: vi.fn(async (email: any) => {
      h.state.emails.push(email);
      if (h.state.emailThrows) throw new Error("transport failed");
      return h.state.emailResult;
    }),
  };
});

import { registerRoutes } from "./routes";

const ATTEMPT_KEY = "registration-attempt-123456";
let server: Server | undefined;
let baseUrl = "";

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-tenant": h.state.tenant.id,
      ...init.headers,
    },
  });
  return { status: response.status, body: await response.json() as any };
}

function resetState(overrides: { client?: any; tenant?: any } = {}) {
  h.state.tenant = {
    id: "tenant-a",
    name: "Practice A",
    fromEmail: "hello@practice.test",
    primaryColor: "#123456",
    registrationFormEnabled: true,
    registrationTermsContent: "Current terms",
    registrationTermsVersion: 4,
    paymentsEnabled: false,
    stripeSecretKey: "sk_test_tenant",
    stripeWebhookSecret: "whsec_test_tenant",
    bookingConfirmedEmailEnabled: true,
    ...overrides.tenant,
  };
  h.state.client = {
    id: "client-a",
    displayId: "A-001",
    tenantId: "tenant-a",
    email: "client@example.test",
    status: "OptionsSent",
    assignedClinicianId: "clinician-a",
    assignedSlotId: "slot-a",
    agreedRatePence: 12000,
    registrationToken: null,
    registrationTokenExpiresAt: null,
    registrationTokenRevokedAt: null,
    registrationEmailSentAt: null,
    registrationEmailSendingAt: null,
    registrationEmailAttemptKey: null,
    registrationEmailClaimId: null,
    registrationEmailPendingToken: null,
    registrationPaymentAttemptKey: null,
    registrationPaymentFailedAt: null,
    registrationPaymentFailureCode: null,
    registrationPaymentFailureReason: null,
    stripeCheckoutUrl: null,
    stripePaymentLinkId: null,
    paymentType: null,
    bookingConfirmationSentAt: null,
    ...overrides.client,
  };
  h.state.options = [{
    id: "option-a",
    clientId: "client-a",
    clinicianId: "clinician-a",
    slotId: "slot-a",
    tenantId: "tenant-a",
    status: "pending",
    selectionToken: "selection-token-a",
  }];
  h.state.slot = {
    id: "slot-a", tenantId: "tenant-a", clinicianId: "clinician-a", isBooked: false,
    type: "SpecificDate", day: null, date: "2026-09-10",
    startTime: "10:00", endTime: "11:00", locationType: "online",
  };
  h.state.clinician = {
    id: "clinician-a",
    tenantId: "tenant-a",
    userId: "user-a",
    zoomLink: null,
    sessionRatePence: 11000,
  };
  h.state.activities = [];
  h.state.emails = [];
  h.state.paymentLinks = [];
  h.state.registrationTemplate = null;
  h.state.submissions = [];
  h.state.deliveries = [];
  h.state.bookingSnapshots = [];
  h.state.slotClaimFails = false;
  h.state.stripeLinkActive = true;
  h.state.deactivatedLinks = [];
  h.state.returnProviderKeys = [];
  h.state.legacyProviderKeys = [];
  h.state.emailResult = { success: true, outcome: "accepted" };
  h.state.emailThrows = false;
  h.state.paymentResult = { url: "https://pay.test/session", paymentLinkId: "plink_1" };
  h.state.checkoutSession = null;
  h.state.checkoutSessions = [];
  h.state.checkoutError = null;
  h.state.preventCheckoutSave = false;
  h.state.charges = [];
  h.state.webhookFailures = [];
  h.state.webhookLookupIsForeign = false;
  h.state.intent = null;
  h.state.stripeLinkMetadata = null;
  h.state.customerUpdates = [];
  h.state.rateChangeBeforeTransaction = null;
  vi.clearAllMocks();
}

beforeEach(async () => {
  resetState();
  process.env.APP_BASE_URL = "https://app.test";
  const app = express();
  app.use(express.json({ verify: (req: any, _res, body) => { req.rawBody = body; } }));
  server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(async () => {
  delete process.env.APP_BASE_URL;
  if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
});

describe("registration journey HTTP routes", () => {
  it("refuses a foreign booking snapshot instead of treating it as this tenant's confirmation", async () => {
    resetState({
      tenant: { confirmationRecoveryEnabled: true, paymentsEnabled: false },
      client: { status: "AwaitingConfirmation", paymentType: "insurer" },
    });
    h.state.slot.isBooked = true;
    h.state.bookingSnapshots = [{
      id: "foreign-booking", clientId: "client-a", tenantId: "tenant-b",
      clinicianName: "Other practice", confirmedAt: new Date(),
    }];
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Scheduled" }),
    });
    expect(response.status).not.toBe(200);
    expect(JSON.stringify(response.body)).not.toContain("Other practice");
    expect(h.state.client.status).toBe("AwaitingConfirmation");
    expect(h.state.bookingSnapshots).toEqual([expect.objectContaining({ tenantId: "tenant-b" })]);
    expect(h.state.emails).toHaveLength(0);
  });

  it("requires an administrator for manual confirmation, without affecting the legacy practice path", async () => {
    resetState({
      tenant: { confirmationRecoveryEnabled: false, paymentsEnabled: false },
      client: { status: "AwaitingConfirmation", paymentType: "insurer" },
    });
    h.state.slot.isBooked = true;
    const denied = await request("/api/clients/client-a", {
      method: "PATCH", headers: { "x-role": "clinician" },
      body: JSON.stringify({ status: "Scheduled" }),
    });
    expect(denied.status).toBe(403);
    expect(h.state.bookingSnapshots).toHaveLength(0);
    const [first, retry] = await Promise.all([
      request("/api/clients/client-a", { method: "PATCH", body: JSON.stringify({ status: "Scheduled" }) }),
      request("/api/clients/client-a", { method: "PATCH", body: JSON.stringify({ status: "Scheduled" }) }),
    ]);
    expect([first.status, retry.status].sort()).toEqual([200, 409]);
    expect(h.state.bookingSnapshots).toHaveLength(1);
    expect(h.state.client.status).toBe("BookingConfirmed");
  });

  it("authorizes, tenant-scopes and serializes completion without archiving a confirmed client", async () => {
    resetState({
      tenant: { completedBookingsEnabled: true, writeuppChecklistEnabled: true },
      client: {
        status: "BookingConfirmed", confirmedAt: new Date(),
        paymentType: "self_pay", paymentStatus: "active",
        writeuppAppointmentConfirmed: true, writeuppDataTransferred: true,
        isArchived: false, completedAt: null,
      },
    });
    h.state.bookingSnapshots = [{ id: "booking-a", clientId: "client-a", tenantId: "tenant-a" }];
    const path = "/api/clients/client-a/complete";
    expect((await request(path, { method: "POST", headers: { "x-role": "clinician" } })).status).toBe(403);
    expect((await request("/api/clients/client-a/reopen-completion", {
      method: "POST", headers: { "x-role": "clinician" },
    })).status).toBe(403);
    expect(h.state.client.completedAt).toBeNull();

    const [first, second] = await Promise.all([
      request(path, { method: "POST" }), request(path, { method: "POST" }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.completedAt).toBeTruthy();
    expect(second.body.completedAt).toBe(first.body.completedAt);
    expect(h.state.client.isArchived).toBe(false);
    expect(h.state.bookingSnapshots).toHaveLength(1);
    expect(h.state.activities.filter(a => a.action === "activity_booking_completed")).toHaveLength(1);

    const reopened = await request("/api/clients/client-a/reopen-completion", { method: "POST" });
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({ id: "client-a", completedAt: null });
    expect(h.state.activities.filter(a => a.action === "activity_booking_reopened")).toHaveLength(1);
    expect((await request("/api/clients/client-a/reopen-completion", { method: "POST" })).status).toBe(409);
  });

  it("denies completion for a foreign client and for an opted-out practice", async () => {
    resetState({
      tenant: { completedBookingsEnabled: true },
      client: { status: "BookingConfirmed", tenantId: "tenant-b", completedAt: null },
    });
    expect((await request("/api/clients/client-a/complete", { method: "POST" })).status).toBe(404);
    expect(h.state.activities).toHaveLength(0);
    resetState({
      tenant: { completedBookingsEnabled: false },
      client: { status: "BookingConfirmed", completedAt: null },
    });
    expect((await request("/api/clients/client-a/complete", { method: "POST" })).status).toBe(403);
    expect((await request("/api/clients/client-a/reopen-completion", { method: "POST" })).status).toBe(403);
    expect(h.state.client.completedAt).toBeNull();
  });

  it("blocks unverified manual confirmation for the opted-in practice without creating a booking", async () => {
    resetState({
      tenant: { confirmationRecoveryEnabled: true, paymentsEnabled: true },
      client: { status: "AwaitingConfirmation", paymentType: "self_pay", paymentStatus: "active" },
    });
    h.state.slot.isBooked = true;
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Scheduled" }),
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("payment_unverified");
    expect(h.state.client.status).toBe("AwaitingConfirmation");
    expect(h.state.bookingSnapshots).toHaveLength(0);
  });

  it("requires a valid allocation for opted-in confirmation and keeps the other practice's legacy path", async () => {
    resetState({
      tenant: { confirmationRecoveryEnabled: true, paymentsEnabled: false },
      client: { status: "AwaitingConfirmation", paymentType: "insurer", assignedSlotId: null, assignedClinicianId: null },
    });
    const missing = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Scheduled" }),
    });
    expect(missing.status).toBe(409);
    expect(h.state.bookingSnapshots).toHaveLength(0);

    h.state.client.assignedSlotId = "slot-a";
    h.state.client.assignedClinicianId = "clinician-a";
    h.state.slot.isBooked = true;
    const confirmed = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Scheduled" }),
    });
    expect(confirmed.status).toBe(200);
    expect(h.state.bookingSnapshots).toHaveLength(1);
    expect(h.state.client.status).toBe("BookingConfirmed");
    const repeat = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Scheduled" }),
    });
    expect(repeat.status).toBe(409);
    expect(h.state.bookingSnapshots).toHaveLength(1);

    resetState({
      tenant: { confirmationRecoveryEnabled: false, paymentsEnabled: true },
      client: { status: "AwaitingConfirmation", paymentType: "self_pay", paymentStatus: "active" },
    });
    const legacy = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Scheduled" }),
    });
    expect(legacy.status).toBe(200);
    expect(h.state.bookingSnapshots).toHaveLength(1);
  });

  it("rejects confirmation on registration-pending records even with a paid badge", async () => {
    resetState({
      tenant: { confirmationRecoveryEnabled: true, paymentsEnabled: true },
      client: { status: "RegistrationPending", registrationFormSubmissionId: "submission",
        paymentType: "self_pay", paymentStatus: "active" },
    });
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Scheduled" }),
    });
    expect(response.status).toBe(409);
    expect(h.state.bookingSnapshots).toHaveLength(0);
  });

  it("does not let an administrator write payment evidence through the general edit route", async () => {
    resetState({
      tenant: { confirmationRecoveryEnabled: true, paymentsEnabled: true },
      client: { status: "AwaitingConfirmation", paymentType: "self_pay", paymentStatus: "setup_pending" },
    });
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ paymentStatus: "active", stripePaymentLinkId: "plink_fake" }),
    });
    expect(response.status).toBe(200);
    expect(h.state.client.paymentStatus).toBe("setup_pending");
    expect(h.state.client.stripePaymentLinkId).toBeNull();
  });

  function readyForReconciliation() {
    resetState({
      tenant: { paymentsEnabled: true, paymentReconciliationEnabled: true },
      client: {
        status: "RegistrationPending", paymentType: "self_pay", paymentStatus: "setup_pending",
        registrationPaymentAttemptKey: ATTEMPT_KEY, stripePaymentLinkId: "plink_current",
        stripeCheckoutUrl: "https://pay.test/current",
      },
    });
    const metadata = { tenantId: "tenant-a", clientId: "client-a", registrationAttemptKey: ATTEMPT_KEY };
    h.state.checkoutSessions = [{
      id: "cs_paid", status: "complete", payment_status: "paid",
      payment_link: "plink_current", payment_intent: "pi_paid", customer: "cus_1",
      amount_total: 12000, currency: "gbp", metadata,
    }];
    h.state.intent = {
      id: "pi_paid", status: "succeeded", amount_received: 12000, currency: "gbp",
      payment_method: "pm_1", metadata,
    };
  }

  it("diagnoses and reconciles a verified paid checkout once without charging or creating a link", async () => {
    readyForReconciliation();
    const before = await request("/api/clients/client-a/payment-reconciliation");
    expect(before.body).toMatchObject({ state: "paid_unrecorded" });
    expect(before.body.confirmationEmail).toBe("not_recorded");
    expect(h.state.client.paymentStatus).toBe("setup_pending");
    const [first, second] = await Promise.all([
      request("/api/clients/client-a/payment-reconciliation", { method: "POST" }),
      request("/api/clients/client-a/payment-reconciliation", { method: "POST" }),
    ]);
    expect(first.body.state).toBe("recorded");
    expect(second.body.state).toBe("recorded");
    expect(h.state.client.paymentStatus).toBe("active");
    expect(h.state.client.status).toBe("BookingConfirmed");
    expect(h.state.bookingSnapshots).toHaveLength(1);
    expect(h.state.charges).toHaveLength(1);
    expect(h.state.emails).toHaveLength(1);
    expect(first.body.confirmationEmail).toBe("accepted_by_provider");
    expect(h.state.customerUpdates).toContainEqual({
      id: "cus_1", payload: { metadata: { clientId: "client-a", displayId: "A-001" } },
    });
    expect(h.state.paymentLinks).toHaveLength(0);
  });

  it("does not record a payment or confirm a booking against a foreign snapshot", async () => {
    readyForReconciliation();
    h.state.bookingSnapshots = [{
      id: "foreign-booking", clientId: "client-a", tenantId: "tenant-b",
      clinicianName: "Other practice", confirmedAt: new Date(),
    }];
    const response = await request("/api/clients/client-a/payment-reconciliation", { method: "POST" });
    expect(response.status).toBe(409);
    expect(response.body.state).toBe("paid_unrecorded");
    expect(JSON.stringify(response.body)).not.toContain("Other practice");
    expect(h.state.client.status).toBe("RegistrationPending");
    // Verified provider payment remains recorded even if booking finalization
    // fails. Retrying must not prompt staff to send another payment request.
    expect(h.state.client.paymentStatus).toBe("active");
    expect(h.state.charges).toHaveLength(1);
    expect(h.state.bookingSnapshots).toEqual([expect.objectContaining({ tenantId: "tenant-b" })]);
    expect(h.state.emails).toHaveLength(0);
  });

  it("does not alter records when checkout is open, unpaid, or provider verification fails", async () => {
    readyForReconciliation();
    h.state.checkoutSessions[0].status = "open";
    h.state.checkoutSessions[0].payment_status = "unpaid";
    expect((await request("/api/clients/client-a/payment-reconciliation", { method: "POST" })).body.state).toBe("open");
    h.state.checkoutSessions = [];
    expect((await request("/api/clients/client-a/payment-reconciliation", { method: "POST" })).body.state).toBe("awaiting");
    h.state.checkoutError = new Error("provider unavailable");
    expect((await request("/api/clients/client-a/payment-reconciliation", { method: "POST" })).body.state).toBe("uncertain");
    expect(h.state.charges).toHaveLength(0);
    expect(h.state.bookingSnapshots).toHaveLength(0);
    expect(h.state.paymentLinks).toHaveLength(0);
  });

  it("promotes a previously pending ledger row only after Stripe confirms the payment", async () => {
    readyForReconciliation();
    h.state.charges = [{
      id: "charge-existing", clientId: "client-a", tenantId: "tenant-a",
      stripePaymentIntentId: "pi_paid", amountPence: 12000, status: "pending",
    }];
    const response = await request("/api/clients/client-a/payment-reconciliation", { method: "POST" });
    expect(response.body.state).toBe("recorded");
    expect(h.state.charges).toHaveLength(1);
    expect(h.state.charges[0].status).toBe("succeeded");
  });

  it("repairs a missing ledger row even when booking and email acceptance were already recorded", async () => {
    readyForReconciliation();
    const first = await request("/api/clients/client-a/payment-reconciliation", { method: "POST" });
    expect(first.body.state).toBe("recorded");
    h.state.charges = [];
    expect((await request("/api/clients/client-a/payment-reconciliation")).body.state).toBe("paid_unrecorded");
    expect((await request("/api/clients/client-a/payment-reconciliation", { method: "POST" })).body.state).toBe("recorded");
    expect(h.state.charges).toHaveLength(1);
    expect(h.state.emails).toHaveLength(1);
  });

  it("reports an unaccepted confirmation email and retries without another charge or booking", async () => {
    readyForReconciliation();
    h.state.emailResult = { success: false, outcome: "rejected" };
    const first = await request("/api/clients/client-a/payment-reconciliation", { method: "POST" });
    expect(first.status).toBe(409);
    expect(first.body).toMatchObject({ state: "paid_unrecorded", confirmationEmail: "not_recorded" });
    expect(h.state.client.bookingConfirmationSentAt).toBeNull();
    expect(h.state.charges).toHaveLength(1);
    expect(h.state.bookingSnapshots).toHaveLength(1);
    h.state.emailResult = { success: true, outcome: "accepted" };
    const retry = await request("/api/clients/client-a/payment-reconciliation", { method: "POST" });
    expect(retry.body.confirmationEmail).toBe("accepted_by_provider");
    expect(h.state.client.bookingConfirmationSentAt).toBeInstanceOf(Date);
    expect(h.state.charges).toHaveLength(1);
    expect(h.state.bookingSnapshots).toHaveLength(1);
    expect(h.state.emails[0].idempotencyKey).toBe(h.state.emails[1].idempotencyKey);
  });

  it("rejects a rate change between provider verification and the payment lock", async () => {
    readyForReconciliation();
    h.state.rateChangeBeforeTransaction = 14000;
    const response = await request("/api/clients/client-a/payment-reconciliation", { method: "POST" });
    expect(response.status).toBe(409);
    expect(response.body.state).toBe("paid_unrecorded");
    expect(h.state.charges).toHaveLength(0);
    expect(h.state.client.paymentStatus).toBe("setup_pending");
    expect(h.state.bookingSnapshots).toHaveLength(0);
  });

  it("keeps booking activity and online Zoom follow-up once-only on reconciliation retries", async () => {
    readyForReconciliation();
    h.state.tenant.zoomLinkEmailEnabled = true;
    h.state.clinician.zoomLink = "https://zoom.us/j/12345678901";
    const first = await request("/api/clients/client-a/payment-reconciliation", { method: "POST" });
    const retry = await request("/api/clients/client-a/payment-reconciliation", { method: "POST" });
    expect(first.body.state).toBe("recorded");
    expect(retry.body.state).toBe("recorded");
    expect(h.state.emails).toHaveLength(2);
    expect(h.state.activities.filter(a => a.action === "activity_booking_confirmed")).toHaveLength(1);
    expect(h.state.client.zoomLinkSentAt).toBeInstanceOf(Date);
  });

  it("rejects mismatched tenant, client, attempt and amount without changing payment", async () => {
    readyForReconciliation();
    for (const override of [
      { tenantId: "other" }, { clientId: "other" }, { registrationAttemptKey: "other" },
    ]) {
      Object.assign(h.state.checkoutSessions[0].metadata, override);
      expect((await request("/api/clients/client-a/payment-reconciliation", { method: "POST" })).body.state).toBe("uncertain");
      Object.assign(h.state.checkoutSessions[0].metadata, {
        tenantId: "tenant-a", clientId: "client-a", registrationAttemptKey: ATTEMPT_KEY,
      });
    }
    h.state.checkoutSessions[0].amount_total = 500;
    expect((await request("/api/clients/client-a/payment-reconciliation", { method: "POST" })).body.state).toBe("uncertain");
    expect(h.state.charges).toHaveLength(0);
    expect(h.state.client.status).toBe("RegistrationPending");
    h.state.client.tenantId = "other";
    expect((await request("/api/clients/client-a/payment-reconciliation")).status).toBe(404);
  });

  it("keeps reconciliation disabled for an unopted practice", async () => {
    readyForReconciliation();
    h.state.tenant.paymentReconciliationEnabled = false;
    expect((await request("/api/clients/client-a/payment-reconciliation")).status).toBe(404);
    expect((await request("/api/clients/client-a/payment-reconciliation", { method: "POST" })).status).toBe(404);
    expect(h.state.charges).toHaveLength(0);
  });

  it("preserves ordinary checkout and resend after the tenant opts into registration recovery", async () => {
    readyForReconciliation();
    Object.assign(h.state.client, {
      status: "AwaitingConfirmation", registrationPaymentAttemptKey: null,
      stripePaymentLinkId: "plink_regular",
    });
    h.state.checkoutSessions[0] = {
      ...h.state.checkoutSessions[0], payment_link: "plink_regular",
      metadata: { clientId: "client-a", tenantId: "tenant-a" },
    };
    const { constructWebhookEvent } = await import("./stripe");
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_regular", type: "checkout.session.completed",
      data: { object: h.state.checkoutSessions[0] },
    } as any);
    const webhook = await request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "test-signature" },
      body: JSON.stringify({ id: "evt_regular" }),
    });
    expect(webhook.status).toBe(200);
    expect(h.state.client.paymentStatus).toBe("active");
    expect(h.storage.createPaymentCharge).toHaveBeenCalledTimes(1);
    expect(h.state.bookingSnapshots).toHaveLength(0);

    h.state.client.paymentStatus = "setup_pending";
    const resend = await request("/api/clients/client-a/resend-payment-link", { method: "POST" });
    expect(resend.status).toBe(200);
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.paymentLinks).toHaveLength(0);
  });

  it("replays an opted-in webhook through provider verification without duplicate charges", async () => {
    readyForReconciliation();
    const { constructWebhookEvent } = await import("./stripe");
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_paid", type: "checkout.session.completed",
      data: { object: h.state.checkoutSessions[0] },
    } as any);
    const send = () => request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "test-signature" },
      body: JSON.stringify({ id: "evt_paid" }),
    });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect(h.state.bookingSnapshots).toHaveLength(1);
    expect(h.state.charges).toHaveLength(1);
    expect(h.state.emails).toHaveLength(1);
  });

  it("does not acknowledge an opted-in webhook when Stripe is temporarily unreachable", async () => {
    readyForReconciliation();
    const { constructWebhookEvent } = await import("./stripe");
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_retry", type: "checkout.session.completed",
      data: { object: h.state.checkoutSessions[0] },
    } as any);
    h.state.checkoutError = new Error("temporary network error");
    const response = await request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "test-signature" },
      body: JSON.stringify({ id: "evt_retry" }),
    });
    expect(response.status).toBe(503);
    expect(h.state.charges).toHaveLength(0);
    expect(h.state.bookingSnapshots).toHaveLength(0);
  });

  it("alerts only the verified practice after three failures, once per event, then resolves on retry", async () => {
    readyForReconciliation();
    const { constructWebhookEvent } = await import("./stripe");
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_repeated", type: "checkout.session.completed",
      data: { object: h.state.checkoutSessions[0] },
    } as any);
    h.state.checkoutError = new Error("provider details must not be sent");
    const send = () => request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "test-signature" },
      body: JSON.stringify({ id: "evt_repeated" }),
    });
    expect((await send()).status).toBe(503);
    expect((await send()).status).toBe(503);
    expect(h.state.emails).toHaveLength(0);
    expect((await request("/api/stripe/webhook-failures")).body).toEqual([]);
    expect((await send()).status).toBe(503);
    expect((await send()).status).toBe(503);
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.emails[0].to).toBe("admin@practice.test");
    expect(h.state.emails[0].text).toContain("A-001");
    expect(h.state.emails[0].text).not.toContain("provider details");
    expect(h.state.webhookFailures).toMatchObject([{
      tenantId: "tenant-a", eventId: "evt_repeated", clientId: "client-a",
      reason: "stripe_unavailable", attempts: 4,
    }]);
    expect((await request("/api/stripe/webhook-failures")).body).toMatchObject([
      { eventId: "evt_repeated", displayId: "A-001", attempts: 4 },
    ]);
    h.state.checkoutError = null;
    expect((await send()).status).toBe(200);
    expect((await request("/api/stripe/webhook-failures")).body).toEqual([]);
    expect(h.state.emails).toHaveLength(2); // one alert, one booking confirmation
    h.state.checkoutError = new Error("unavailable again");
    expect((await send()).status).toBe(503);
    expect(h.state.webhookFailures[0].attempts).toBe(1);
    expect(h.state.webhookFailures[0].generation).toBe(2);
    expect(h.state.webhookFailures[0].alertedAt).toBeNull();
    expect(h.state.emails).toHaveLength(2);
    expect((await request("/api/stripe/webhook-failures")).body).toEqual([]);
    expect((await send()).status).toBe(503);
    expect((await send()).status).toBe(503);
    expect(h.state.emails).toHaveLength(3);
    expect(h.state.emails[0].idempotencyKey).not.toBe(h.state.emails[2].idempotencyKey);
  });

  it("does not attribute invalid signatures or another practice's registration to the current tenant", async () => {
    readyForReconciliation();
    const { constructWebhookEvent } = await import("./stripe");
    vi.mocked(constructWebhookEvent).mockImplementation(() => { throw new Error("invalid signature"); });
    const send = () => request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "bad" },
      body: JSON.stringify({ id: "evt_unverified", metadata: { tenantId: "tenant-a" } }),
    });
    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(400);
    expect(h.state.webhookFailures).toEqual([]);
    expect(h.state.emails).toEqual([]);

    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_other", type: "checkout.session.completed",
      data: { object: { ...h.state.checkoutSessions[0], metadata: { clientId: "other-client", tenantId: "tenant-b" } } },
    } as any);
    h.state.tenant.paymentReconciliationEnabled = false;
    h.state.webhookLookupIsForeign = true;
    // Processing fails, but the foreign client reference cannot be linked to
    // this practice, even though it appears inside a signed event.
    for (let i = 0; i < 3; i++) {
      vi.mocked(h.storage.getClientById).mockRejectedValueOnce(new Error("database failed"));
      expect((await request("/api/stripe/webhook", {
        method: "POST", headers: { "stripe-signature": "valid" },
        body: JSON.stringify({ id: "evt_other" }),
      })).status).toBe(500);
    }
    expect(h.state.webhookFailures).toMatchObject([{ tenantId: "tenant-a", clientId: null }]);
    h.state.webhookFailures.push({ id: "foreign", tenantId: "tenant-b", eventId: "evt_foreign",
      resolvedAt: null, lastFailedAt: new Date(), reason: "processing_error", attempts: 3 });
    const listed = (await request("/api/stripe/webhook-failures")).body;
    expect(listed).toHaveLength(1);
    expect(listed[0].eventId).toBe("evt_other");
    expect(listed[0].displayId).toBeNull();
    expect((await request("/api/stripe/webhook-failures", { headers: { "x-tenant": "tenant-b" } })).status).toBe(403);
    // The next delivery is intentionally acknowledged as uncorrelated; the
    // previous processing failure must not remain in the admin list.
    expect((await request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "valid" },
      body: JSON.stringify({ id: "evt_other" }),
    })).status).toBe(200);
    expect(h.state.webhookFailures[0].resolvedAt).toBeInstanceOf(Date);
    expect((await request("/api/stripe/webhook-failures")).body).toEqual([]);
  });

  it("clears a previously failed event when an early checkout exit is acknowledged", async () => {
    readyForReconciliation();
    const { constructWebhookEvent } = await import("./stripe");
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_early", type: "checkout.session.completed",
      data: { object: h.state.checkoutSessions[0] },
    } as any);
    h.state.checkoutError = new Error("provider unavailable");
    const send = () => request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "valid" },
      body: JSON.stringify({ id: "evt_early" }),
    });
    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(503);
    expect((await request("/api/stripe/webhook-failures")).body).toHaveLength(1);
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_early", type: "checkout.session.completed",
      data: { object: { ...h.state.checkoutSessions[0], metadata: {} } },
    } as any);
    expect((await send()).status).toBe(200);
    expect((await request("/api/stripe/webhook-failures")).body).toEqual([]);
  });

  it("claims one alert for simultaneous Stripe retries", async () => {
    readyForReconciliation();
    const { constructWebhookEvent } = await import("./stripe");
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_concurrent", type: "checkout.session.completed",
      data: { object: h.state.checkoutSessions[0] },
    } as any);
    h.state.checkoutError = new Error("unavailable");
    const send = () => request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "valid" },
      body: JSON.stringify({ id: "evt_concurrent" }),
    });
    expect((await Promise.all([send(), send(), send(), send()])).map(result => result.status)).toEqual([503, 503, 503, 503]);
    expect(h.state.webhookFailures[0].attempts).toBe(4);
    expect(h.state.emails).toHaveLength(1);
  });

  it("retries an opted-in webhook until Stripe lists its completed session", async () => {
    readyForReconciliation();
    const { constructWebhookEvent } = await import("./stripe");
    const session = h.state.checkoutSessions[0];
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_delayed", type: "checkout.session.completed",
      data: { object: session },
    } as any);
    h.state.checkoutSessions = [];
    const response = await request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "test-signature" },
      body: JSON.stringify({ id: "evt_delayed" }),
    });
    expect(response.status).toBe(503);
    expect(h.state.charges).toHaveLength(0);
    h.state.checkoutSessions = [session];
    expect((await request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "test-signature" },
      body: JSON.stringify({ id: "evt_delayed" }),
    })).status).toBe(200);
    expect(h.state.charges).toHaveLength(1);
  });

  it("does not finalize an opted-in webhook with mismatched client metadata", async () => {
    readyForReconciliation();
    const { constructWebhookEvent } = await import("./stripe");
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_mismatch", type: "checkout.session.completed",
      data: { object: { ...h.state.checkoutSessions[0], metadata: { clientId: "client-a" } } },
    } as any);
    h.state.checkoutSessions[0].metadata.clientId = "another-client";
    const response = await request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "test-signature" },
      body: JSON.stringify({ id: "evt_mismatch" }),
    });
    expect(response.status).toBe(200);
    expect(h.state.client.paymentStatus).toBe("setup_pending");
    expect(h.state.charges).toHaveLength(0);
    expect(h.state.deactivatedLinks).toHaveLength(0);
  });

  it("acknowledges an uncorrelated opted-in event without falling through to legacy payment handling", async () => {
    readyForReconciliation();
    const { constructWebhookEvent } = await import("./stripe");
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_stale", type: "checkout.session.completed",
      data: { object: { ...h.state.checkoutSessions[0], metadata: {
        clientId: "client-a", tenantId: "tenant-a", registrationAttemptKey: "old-attempt",
      } } },
    } as any);
    const response = await request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "test-signature" },
      body: JSON.stringify({ id: "evt_stale" }),
    });
    expect(response.status).toBe(200);
    expect(h.state.client.paymentStatus).toBe("setup_pending");
    expect(h.state.deactivatedLinks).toHaveLength(0);
    expect(h.state.bookingSnapshots).toHaveLength(0);
    expect(h.state.charges).toHaveLength(0);
  });

  it("leaves an unverified legacy registration link active after an ignored event", async () => {
    readyForReconciliation();
    h.state.tenant.paymentReconciliationEnabled = false;
    const { constructWebhookEvent } = await import("./stripe");
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_unpaid", type: "checkout.session.completed",
      data: { object: { ...h.state.checkoutSessions[0], payment_status: "unpaid" } },
    } as any);
    const response = await request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "test-signature" },
      body: JSON.stringify({ id: "evt_unpaid" }),
    });
    expect(response.status).toBe(200);
    expect(h.state.deactivatedLinks).toHaveLength(0);
    expect(h.state.charges).toHaveLength(0);
  });

  it("leaves the existing unopted webhook path working", async () => {
    readyForReconciliation();
    h.state.tenant.paymentReconciliationEnabled = false;
    const { constructWebhookEvent } = await import("./stripe");
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_legacy", type: "checkout.session.completed",
      data: { object: h.state.checkoutSessions[0] },
    } as any);
    const response = await request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "test-signature" },
      body: JSON.stringify({ id: "evt_legacy" }),
    });
    expect(response.status).toBe(200);
    expect(h.state.client.status).toBe("BookingConfirmed");
    expect(h.state.bookingSnapshots).toHaveLength(1);
  });

  it("keeps an unopted registration webhook on the legacy global account when both keys exist", async () => {
    readyForReconciliation();
    h.state.tenant.paymentReconciliationEnabled = false;
    const previous = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_global";
    const { constructWebhookEvent, chargeOffSession } = await import("./stripe");
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_both_keys", type: "checkout.session.completed",
      data: { object: h.state.checkoutSessions[0] },
    } as any);
    try {
      const response = await request("/api/stripe/webhook", {
        method: "POST", headers: { "stripe-signature": "test-signature" },
        body: JSON.stringify({ id: "evt_both_keys" }),
      });
      expect(response.status).toBe(200);
      expect(h.state.client.stripePaymentMethodId).toBe("pm_1");
      expect(h.state.client.paymentStatus).toBe("active");
      expect(h.state.legacyProviderKeys).toEqual(["sk_test_global", "sk_test_global"]);
      vi.mocked(h.storage.createPaymentCharge).mockResolvedValueOnce({ id: "charge-next" });
      vi.mocked(h.storage.updatePaymentCharge).mockResolvedValueOnce({ id: "charge-next", status: "succeeded" });
      vi.mocked(chargeOffSession).mockResolvedValueOnce({ paymentIntentId: "pi_next", status: "succeeded" });
      const next = await request("/api/stripe/charge", {
        method: "POST", body: JSON.stringify({ clientId: "client-a", amountPence: 12000 }),
      });
      expect(next.status).toBe(200);
      expect(chargeOffSession).toHaveBeenCalledWith(expect.objectContaining({
        customerId: "cus_1", paymentMethodId: "pm_1", tenantStripeKey: "sk_test_tenant",
      }));
      // The real charge helper's key selection is exercised alongside link
      // creation in stripe.test.ts; this request verifies the saved method is
      // carried through the actual admin charge route.
    } finally {
      if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previous;
    }
  });

  it("blocks automatic replacement of an inactive paid link for opted-in tenants", async () => {
    readyForReconciliation();
    h.state.client.registrationToken = "registration-token";
    h.state.client.registrationTokenExpiresAt = new Date(Date.now() + 60_000);
    h.state.stripeLinkActive = false;
    const response = await request("/api/public/register/client-a/registration-token", {
      method: "POST", body: JSON.stringify({ paymentType: "self_pay" }),
    });
    expect(response.status).toBe(409);
    expect(h.state.client.stripePaymentLinkId).toBe("plink_current");
    expect(h.state.paymentLinks).toHaveLength(0);
  });

  function configureIntakeCompletion(contactPreference: "email" | "phone") {
    h.state.tenant.intakeFormTemplateId = "intake-form-a";
    h.state.registrationTemplate = {
      id: "intake-form-a", tenantId: "tenant-a", title: "Intake details", fields: [],
    };
    Object.assign(h.state.client, { status: contactPreference === "email" ? "Forms Sent" : "New", contactPreference });
    h.state.submissions = [{
      id: "intake-submission-a",
      clientId: "client-a",
      tenantId: "tenant-a",
      formTemplateId: "intake-form-a",
      isDraft: false,
    }];
  }

  it("advances a phone-intake client when the admin submits the designated form without creating delivery", async () => {
    configureIntakeCompletion("phone");
    h.state.submissions = [];

    const response = await request("/api/form-submissions", {
      method: "POST",
      body: JSON.stringify({
        formId: "intake-form-a",
        clientId: "client-a",
        data: { presentingIssue: "Anxiety" },
      }),
    });

    expect(response.status).toBe(200);
    expect(h.state.submissions).toHaveLength(1);
    expect(h.storage.prepareFormDeliveries).not.toHaveBeenCalled();
    expect(h.state.client.status).toBe("Forms Completed");
    expect(h.state.client.formsCompletedAt).toBeInstanceOf(Date);
  });

  it("keeps requiring completed delivery for an email-intake client", async () => {
    configureIntakeCompletion("email");
    h.state.deliveries = [{
      id: "delivery-a",
      clientId: "client-a",
      tenantId: "tenant-a",
      formTemplateId: "intake-form-a",
      status: "sent",
    }];

    const blocked = await request("/api/clients/client-a", {
      method: "PATCH",
      body: JSON.stringify({ status: "Forms Completed" }),
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.blocker.state).toBe("sent");

    h.state.deliveries[0].status = "completed";
    const completed = await request("/api/clients/client-a", {
      method: "PATCH",
      body: JSON.stringify({ status: "Forms Completed" }),
    });
    expect(completed.status).toBe(200);
    expect(h.state.client.status).toBe("Forms Completed");
  });

  it("does not allow either intake path to complete without a durable submission", async () => {
    configureIntakeCompletion("phone");
    h.state.submissions = [];

    const response = await request("/api/clients/client-a", {
      method: "PATCH",
      body: JSON.stringify({ status: "Forms Completed" }),
    });

    expect(response.status).toBe(400);
    expect(response.body.blocker.state).toBe("not_submitted");
    expect(h.state.client.status).toBe("New");
  });

  function checkoutSession(overrides: Record<string, unknown> = {}) {
    return {
      id: "cs_test_return",
      payment_status: "paid",
      status: "complete",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      payment_link: "plink_current",
      metadata: {
        tenantId: "tenant-a",
        clientId: "client-a",
        registrationAttemptKey: "attempt-current",
      },
      ...overrides,
    };
  }

  it("reports a registration payment as processing until the webhook advances durable state", async () => {
    resetState({ client: {
      status: "RegistrationPending",
      registrationPaymentAttemptKey: "attempt-current",
      stripePaymentLinkId: "plink_current",
    } });
    h.state.checkoutSession = checkoutSession();

    const response = await request("/api/public/payment-return?session_id=cs_test_return");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "processing",
      practice: { name: "Practice A", primaryColor: "#123456" },
    });
    expect(h.state.client.status).toBe("RegistrationPending");
    expect(h.state.activities).toHaveLength(0);
    expect(h.state.emails).toHaveLength(0);
    expect(h.state.returnProviderKeys).toContain("sk_test_tenant");
  });

  it("checks the tenant account first even when a global Stripe account is configured", async () => {
    resetState({ client: {
      status: "RegistrationPending", registrationPaymentAttemptKey: "attempt-current",
      stripePaymentLinkId: "plink_current",
    } });
    h.state.checkoutSession = checkoutSession();
    const previous = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_other_account";
    try {
      const response = await request("/api/public/payment-return?session_id=cs_test_return");
      expect(response.body.status).toBe("processing");
      expect(h.state.returnProviderKeys).toEqual(["sk_test_tenant"]);
    } finally {
      if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previous;
    }
  });

  it("reports confirmed only after a registration workflow reaches its final state", async () => {
    resetState({ client: {
      status: "BookingConfirmed",
      registrationPaymentAttemptKey: "attempt-current",
      stripePaymentLinkId: "plink_current",
    } });
    h.state.checkoutSession = checkoutSession();

    const first = await request("/api/public/payment-return?session_id=cs_test_return");
    const refresh = await request("/api/public/payment-return?session_id=cs_test_return");

    expect(first.body.status).toBe("confirmed");
    expect(refresh.body.status).toBe("confirmed");
    expect(h.state.activities).toHaveLength(0);
    expect(h.state.emails).toHaveLength(0);
  });

  it("reports an ordinary paid link without claiming booking confirmation", async () => {
    resetState({ client: {
      status: "AwaitingConfirmation",
      registrationPaymentAttemptKey: null,
      stripePaymentLinkId: "plink_current",
    } });
    h.state.checkoutSession = checkoutSession({
      metadata: { tenantId: "tenant-a", clientId: "client-a" },
    });

    const response = await request("/api/public/payment-return?session_id=cs_test_return");

    expect(response.body).toMatchObject({ status: "paid", practice: { name: "Practice A" } });
    expect(response.body.status).not.toBe("confirmed");
  });

  it("returns generic states for unpaid, stale-link, and cross-tenant sessions", async () => {
    resetState({ client: {
      status: "RegistrationPending",
      registrationPaymentAttemptKey: "attempt-current",
      stripePaymentLinkId: "plink_current",
    } });
    h.state.checkoutSession = checkoutSession({ payment_status: "unpaid", status: "open" });
    expect((await request("/api/public/payment-return?session_id=cs_test_return")).body.status).toBe("incomplete");

    h.state.checkoutSession = checkoutSession({ payment_link: "plink_stale" });
    expect((await request("/api/public/payment-return?session_id=cs_test_return")).body).toEqual({ status: "invalid" });

    h.state.checkoutSession = checkoutSession({
      metadata: {
        tenantId: "tenant-b",
        clientId: "client-a",
        registrationAttemptKey: "attempt-current",
      },
    });
    expect((await request("/api/public/payment-return?session_id=cs_test_return")).body).toEqual({ status: "invalid" });
  });

  it("returns a generic failure when Stripe verification is unavailable", async () => {
    h.state.checkoutError = Object.assign(new Error("Stripe unavailable"), { code: "api_connection_error" });

    const response = await request("/api/public/payment-return?session_id=cs_test_return");

    expect(response.body).toEqual({ status: "failed" });
  });

  function configureRegistrationTemplate(fields: any[] = [{ id: "address", label: "Address", required: true }]) {
    h.state.tenant.registrationFormTemplateId = "registration-form-a";
    h.state.registrationTemplate = {
      id: "registration-form-a", tenantId: "tenant-a", title: "Registration details",
      description: "Please complete",
      updatedAt: new Date("2026-09-06T12:00:00.000Z"),
      fields: [
        ...fields,
        { id: "terms-copy", type: "info", content: "Current registration terms" },
        { id: "agreement", type: "radio", label: "I agree to the terms and conditions", required: true, options: ["Yes"], isTermsAcceptance: true },
      ],
    };
  }

  it("cannot clear the registration designation through either tenant settings route while enabled", async () => {
    configureRegistrationTemplate();
    const canonical = await request("/api/tenant/registration-form-template", {
      method: "PATCH",
      body: JSON.stringify({ formTemplateId: null }),
    });
    expect(canonical.status).toBe(400);
    expect(canonical.body.error).toMatch(/enabled.*required/i);

    const compatibility = await request("/api/tenant/settings", {
      method: "PATCH",
      body: JSON.stringify({ registrationFormId: null }),
    });
    expect(compatibility.status).toBe(400);
    expect(compatibility.body.error).toMatch(/enabled.*required/i);
    expect(h.state.tenant.registrationFormTemplateId).toBe("registration-form-a");
  });

  it("does not claim options were sent when the allocation email is rejected", async () => {
    h.state.options = [];
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.emailResult = { success: false, outcome: "rejected", error: "Rejected" };

    const response = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });

    expect(response.status).toBe(502);
    expect(response.body.error).toMatch(/not moved to Options Sent/i);
    expect(h.state.client.status).toBe("FormsCompleted");
    expect(h.state.options).toHaveLength(1);
    expect(h.state.options[0].status).toBe("unavailable");
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.activities.filter(a => a.action === "activity_client_options_sent")).toHaveLength(0);
  });

  it("moves the client to Options Sent only after the allocation email is accepted", async () => {
    h.state.options = [];
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;

    const response = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });

    expect(response.status).toBe(200);
    expect(h.state.client.status).toBe("OptionsSent");
    expect(h.state.options).toHaveLength(1);
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.activities.filter(a => a.action === "activity_client_options_sent")).toHaveLength(1);
  });

  it("records a verified session-format override when allocation options are sent", async () => {
    h.state.options = [];
    h.state.client.status = "FormsCompleted";
    h.state.slot.locationType = "in_person";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;

    const response = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({
        selections: [{
          clinicianId: "clinician-a",
          slotId: "slot-a",
          formatOverride: { preference: "online", slotFormat: "in_person" },
        }],
      }),
    });

    expect(response.status).toBe(200);
    expect(h.state.activities).toContainEqual(expect.objectContaining({
      tenantId: h.state.tenant.id,
      action: "activity_session_format_override",
      resourceId: "client-a",
      details: expect.objectContaining({
        clientDisplayId: h.state.client.displayId,
        submittedPreference: "online",
        selectedSlotFormat: "in_person",
      }),
    }));
  });

  it("replaces stale options instead of including them in a new allocation email", async () => {
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.options = [
      { ...h.state.options[0], id: "stale-option-1", selectionToken: "stale-token-1" },
      { ...h.state.options[0], id: "stale-option-2", selectionToken: "stale-token-2" },
      { ...h.state.options[0], id: "stale-option-3", selectionToken: "stale-token-3" },
    ];

    const response = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });

    expect(response.status).toBe(200);
    expect(h.state.options).toHaveLength(4);
    expect(h.state.options.filter(option => option.status === "unavailable")).toHaveLength(3);
    const currentOption = h.state.options.find(option => option.status === "pending");
    expect(currentOption?.selectionToken).not.toMatch(/^stale-token-/);
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.emails[0].html).toContain("Option 1:");
    expect(h.state.emails[0].html).not.toContain("Option 2:");

    const stalePortal = await request("/api/public/options/stale-token-1");
    expect(stalePortal.status).toBe(410);
    expect(stalePortal.body.error).toMatch(/no longer active/i);

    const currentPortal = await request(`/api/public/options/${currentOption?.selectionToken}`);
    expect(currentPortal.status).toBe(200);
    expect(currentPortal.body.options).toHaveLength(1);
    expect(currentPortal.body.options[0].id).toBe(currentOption?.id);
  });

  it("does not let a stale token select from a newer option generation", async () => {
    h.state.client.status = "OptionsSent";
    h.state.options = [
      { ...h.state.options[0], id: "stale-option", selectionToken: "stale-token", status: "unavailable" },
      { ...h.state.options[0], id: "current-option", selectionToken: "current-token", status: "pending" },
    ];

    const response = await request("/api/public/options/stale-token/select", {
      method: "POST",
      body: JSON.stringify({ clinicianOptionId: "current-option" }),
    });

    expect(response.status).toBe(410);
    expect(response.body.error).toMatch(/no longer active/i);
    expect(h.state.options.find(option => option.id === "current-option")?.status).toBe("pending");
  });

  it("automatically delivers registration after option selection exactly once", async () => {
    const first = await request("/api/public/options/selection-token-a/select", {
      method: "POST", body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });
    const retry = await request("/api/public/options/selection-token-a/select", {
      method: "POST", body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });

    expect(first.status).toBe(200);
    expect(first.body.registrationUrl).toMatch(/^\/register\/client-a\//);
    expect(h.state.emails[0].html).toContain(first.body.registrationUrl.split("/").at(-1));
    expect(retry.body).toMatchObject({ registrationUrl: first.body.registrationUrl, idempotent: true });
    expect(h.state.client.status).toBe("OptionSelected");
    expect(h.state.client.agreedRatePence).toBe(12000);
    expect(h.state.client.registrationTokenExpiresAt).toBeInstanceOf(Date);
    expect(h.state.activities.filter(a => a.action === "activity_appointment_option_selected")).toHaveLength(1);
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.client.registrationEmailSentAt).toBeInstanceOf(Date);
    expect(h.state.activities.filter(a => a.action === "activity_registration_sent")).toHaveLength(1);
  });

  it("records option-selection delivery failure while preserving the direct registration link", async () => {
    h.state.emailResult = { success: false, outcome: "rejected" };

    const response = await request("/api/public/options/selection-token-a/select", {
      method: "POST", body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });

    expect(response.status).toBe(200);
    expect(response.body.registrationUrl).toMatch(/^\/register\/client-a\//);
    expect(h.state.client.registrationEmailSentAt).toBeNull();
    expect(h.state.client.registrationEmailFailedAt).toBeInstanceOf(Date);
    expect(h.state.client.registrationToken).toBeTruthy();
  });

  it("automatically delivers registration after a complete manual allocation", async () => {
    resetState({ client: {
      status: "FormsCompleted",
      assignedClinicianId: null,
      assignedSlotId: null,
    } });

    const response = await request("/api/clients/client-a/assign", {
      method: "POST",
      body: JSON.stringify({ clinicianId: "clinician-a", slotId: "slot-a", allocationMethod: "manual" }),
    });

    expect(response.status).toBe(200);
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.client.registrationEmailSentAt).toBeInstanceOf(Date);
    expect(h.state.client.status).toBe("OptionSelected");
  });

  it("records a verified session-format override after manual allocation", async () => {
    resetState({ client: {
      status: "FormsCompleted",
      assignedClinicianId: null,
      assignedSlotId: null,
    } });
    h.state.slot.locationType = "in_person";

    const response = await request("/api/clients/client-a/assign", {
      method: "POST",
      body: JSON.stringify({
        clinicianId: "clinician-a",
        slotId: "slot-a",
        allocationMethod: "manual",
        formatOverride: { preference: "online", slotFormat: "in_person" },
      }),
    });

    expect(response.status).toBe(200);
    expect(h.state.activities).toContainEqual(expect.objectContaining({
      tenantId: h.state.tenant.id,
      action: "activity_session_format_override",
      resourceId: "client-a",
      details: expect.objectContaining({
        clientDisplayId: h.state.client.displayId,
        submittedPreference: "online",
        selectedSlotFormat: "in_person",
      }),
    }));
    const override = h.state.activities.find(a => a.action === "activity_session_format_override");
    expect(override.details).not.toHaveProperty("formResponses");
  });

  it("does not record an unverified session-format override", async () => {
    resetState({ client: {
      status: "FormsCompleted",
      assignedClinicianId: null,
      assignedSlotId: null,
    } });
    h.state.slot.locationType = "online";

    const response = await request("/api/clients/client-a/assign", {
      method: "POST",
      body: JSON.stringify({
        clinicianId: "clinician-a",
        slotId: "slot-a",
        allocationMethod: "manual",
        formatOverride: { preference: "online", slotFormat: "in_person" },
      }),
    });

    expect(response.status).toBe(200);
    expect(h.state.activities.filter(a => a.action === "activity_session_format_override")).toHaveLength(0);
  });

  it("deduplicates repeated manual-allocation automatic delivery", async () => {
    resetState({ client: {
      status: "FormsCompleted",
      assignedClinicianId: null,
      assignedSlotId: null,
    } });
    const body = JSON.stringify({ clinicianId: "clinician-a", slotId: "slot-a", allocationMethod: "manual" });

    expect((await request("/api/clients/client-a/assign", { method: "POST", body })).status).toBe(200);
    expect((await request("/api/clients/client-a/assign", { method: "POST", body })).status).toBe(200);

    expect(h.state.emails).toHaveLength(1);
    expect(h.state.activities.filter(a => a.action === "activity_registration_sent")).toHaveLength(1);
  });

  it("records manual-allocation delivery failure without claiming registration was sent", async () => {
    resetState({ client: {
      status: "FormsCompleted",
      assignedClinicianId: null,
      assignedSlotId: null,
    } });
    h.state.emailResult = { success: false, outcome: "rejected" };

    const response = await request("/api/clients/client-a/assign", {
      method: "POST",
      body: JSON.stringify({ clinicianId: "clinician-a", slotId: "slot-a", allocationMethod: "manual" }),
    });

    expect(response.status).toBe(200);
    expect(h.state.client.registrationEmailSentAt).toBeNull();
    expect(h.state.client.registrationEmailFailedAt).toBeInstanceOf(Date);
    expect(h.state.client).toMatchObject({
      assignedClinicianId: "clinician-a",
      assignedSlotId: "slot-a",
    });
  });

  it("applies the selected clinician rate when the client has no specific rate", async () => {
    h.state.client.agreedRatePence = null;
    h.state.clinician.sessionRatePence = 13500;

    const response = await request("/api/public/options/selection-token-a/select", {
      method: "POST", body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });

    expect(response.status).toBe(200);
    expect(h.state.client.agreedRatePence).toBe(13500);
  });

  it("confirms directly when registration is off and sends one confirmation", async () => {
    h.state.tenant.registrationFormEnabled = false;
    const first = await request("/api/public/options/selection-token-a/select", {
      method: "POST", body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });
    const retry = await request("/api/public/options/selection-token-a/select", {
      method: "POST", body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });

    expect(first.body).toMatchObject({ selected: true, bookingConfirmed: true });
    expect(retry.body).toMatchObject({ bookingConfirmed: true, idempotent: true });
    expect(h.state.client.status).toBe("BookingConfirmed");
    expect(h.state.slot).toMatchObject({ isBooked: false, retirementReason: "Appointment confirmed" });
    expect(h.state.slot.retiredAt).toBeInstanceOf(Date);
    expect(h.state.bookingSnapshots).toHaveLength(1);
    expect(h.state.bookingSnapshots[0]).toMatchObject({
      clientId: "client-a",
      clinicianId: "clinician-a",
      clinicianName: "Dr Test",
      slotType: "SpecificDate",
      date: "2026-09-10",
      day: null,
      startTime: "10:00",
      endTime: "11:00",
      locationType: "online",
    });
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.activities.filter(a => a.action === "activity_booking_confirmed")).toHaveLength(1);
  });

  it("retires the same recurring slot but uses legacy Scheduled when confirmation email is disabled", async () => {
    resetState({
      tenant: {
        registrationFormEnabled: false,
        bookingConfirmedEmailEnabled: false,
      },
    });
    Object.assign(h.state.slot, {
      type: "Recurring",
      day: "Tuesday",
      date: null,
      startTime: "14:00",
      endTime: "15:00",
      locationType: "in_person",
    });

    const first = await request("/api/public/options/selection-token-a/select", {
      method: "POST", body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });
    const retry = await request("/api/public/options/selection-token-a/select", {
      method: "POST", body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });

    expect(first.body).toMatchObject({ selected: true, bookingConfirmed: true });
    expect(retry.body).toMatchObject({ bookingConfirmed: true, idempotent: true });
    expect(h.state.client.status).toBe("Scheduled");
    expect(h.state.client).toMatchObject({
      assignedClinicianId: null,
      assignedSlotId: null,
      assignedSlot: null,
    });
    expect(h.state.slot).toMatchObject({
      isBooked: false,
      retirementReason: "Appointment confirmed",
    });
    expect(h.state.slot.retiredAt).toBeInstanceOf(Date);
    expect(h.state.bookingSnapshots).toHaveLength(1);
    expect(h.state.bookingSnapshots[0]).toMatchObject({
      clientId: "client-a",
      clinicianName: "Dr Test",
      slotType: "Recurring",
      date: null,
      day: "Tuesday",
      startTime: "14:00",
      endTime: "15:00",
      locationType: "in_person",
    });
    expect(h.state.emails).toHaveLength(0);
    expect(h.state.activities.filter(a => a.action === "activity_booking_confirmed")).toHaveLength(1);
  });

  it("rejects a cross-tenant option token and a conflicting slot without side effects", async () => {
    h.state.client.tenantId = "tenant-b";
    const isolated = await request("/api/public/options/selection-token-a/select", {
      method: "POST", body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });
    expect(isolated.status).toBe(404);

    h.state.client.tenantId = "tenant-a";
    h.state.slotClaimFails = true;
    const conflict = await request("/api/public/options/selection-token-a/select", {
      method: "POST", body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatch(/no longer available/i);
    expect(h.state.activities).toHaveLength(0);
    expect(h.state.emails).toHaveLength(0);
  });

  it("rejects feature-off and cross-tenant administrator registration sends", async () => {
    resetState({ client: { status: "Assigned", assignedClinicianId: "clinician-a", assignedSlotId: "slot-a" } });
    h.state.tenant.registrationFormEnabled = false;
    const disabled = await request("/api/clients/client-a/send-registration", {
      method: "POST", body: JSON.stringify({ attemptKey: ATTEMPT_KEY }),
    });
    expect(disabled.status).toBe(400);

    h.state.tenant.registrationFormEnabled = true;
    h.state.client.tenantId = "tenant-b";
    const isolated = await request("/api/clients/client-a/send-registration", {
      method: "POST", body: JSON.stringify({ attemptKey: ATTEMPT_KEY }),
    });
    expect(isolated.status).toBe(403);
    expect(h.state.emails).toHaveLength(0);
    expect(h.state.activities).toHaveLength(0);
  });

  it("deduplicates administrator response-loss retries and recovers stale claims", async () => {
    resetState({ client: { status: "Assigned", assignedClinicianId: "clinician-a", assignedSlotId: "slot-a" } });
    const first = await request("/api/clients/client-a/send-registration", {
      method: "POST", body: JSON.stringify({ attemptKey: ATTEMPT_KEY }),
    });
    const retry = await request("/api/clients/client-a/send-registration", {
      method: "POST", body: JSON.stringify({ attemptKey: ATTEMPT_KEY }),
    });
    expect(first.status).toBe(200);
    expect(retry.body).toMatchObject({ success: true, idempotent: true });
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.activities.filter(a => a.action === "activity_registration_sent")).toHaveLength(1);
    const originalToken = h.state.client.registrationToken;
    expect(h.state.client.registrationTokenExpiresAt).toBeInstanceOf(Date);

    const resent = await request("/api/clients/client-a/send-registration", {
      method: "POST", body: JSON.stringify({ attemptKey: "new-admin-resend-654321" }),
    });
    expect(resent.status).toBe(200);
    expect(h.state.client.registrationToken).not.toBe(originalToken);
    expect(h.state.client.registrationTokenExpiresAt).toBeInstanceOf(Date);
    expect(h.state.emails).toHaveLength(2);

    resetState({ client: {
      status: "Assigned", assignedClinicianId: "clinician-a", assignedSlotId: "slot-a",
      registrationToken: "previously-delivered-token",
      registrationEmailPendingToken: "recovery-token",
      registrationEmailAttemptKey: ATTEMPT_KEY,
      registrationEmailSendingAt: new Date(Date.now() - 10 * 60 * 1000),
    } });
    const recovered = await request("/api/clients/client-a/send-registration", {
      method: "POST", body: JSON.stringify({ attemptKey: "different-attempt-654321" }),
    });
    expect(recovered.status).toBe(200);
    expect(h.state.emails[0].idempotencyKey).toBe(`registration-client-a-${ATTEMPT_KEY}`);
    expect(h.state.client.registrationToken).toBe("recovery-token");
    expect(h.state.client.registrationEmailPendingToken).toBeNull();
    expect(h.state.activities.filter(a => a.action === "activity_registration_sent")).toHaveLength(1);

    resetState({ client: {
      status: "Assigned", assignedClinicianId: "clinician-a", assignedSlotId: "slot-a",
      registrationToken: "pre-migration-recovery-token",
      registrationEmailPendingToken: null,
      registrationEmailAttemptKey: ATTEMPT_KEY,
      registrationEmailSendingAt: new Date(Date.now() - 10 * 60 * 1000),
    } });
    const migratedRecovery = await request("/api/clients/client-a/send-registration", {
      method: "POST", body: JSON.stringify({ attemptKey: "post-migration-attempt-654321" }),
    });
    expect(migratedRecovery.status).toBe(200);
    expect(h.state.emails[0].idempotencyKey).toBe(`registration-client-a-${ATTEMPT_KEY}`);
    expect(h.state.client.registrationToken).toBe("pre-migration-recovery-token");
  });

  it("keeps the previously delivered link active when a resend is rejected", async () => {
    const previousSentAt = new Date("2026-09-01T12:00:00Z");
    resetState({ client: {
      status: "Assigned",
      assignedClinicianId: "clinician-a",
      assignedSlotId: "slot-a",
      registrationToken: "previously-delivered-token",
      registrationEmailSentAt: previousSentAt,
    } });
    h.state.emailResult = { success: false, outcome: "rejected" };

    const response = await request("/api/clients/client-a/send-registration", {
      method: "POST", body: JSON.stringify({ attemptKey: "rejected-resend-654321" }),
    });

    expect(response.status).toBe(502);
    expect(h.state.client.registrationToken).toBe("previously-delivered-token");
    expect(h.state.client.registrationEmailPendingToken).toBeNull();
    expect(h.state.client.registrationEmailSentAt).toEqual(previousSentAt);
  });

  it("releases the delivery claim and records failure when email transport throws", async () => {
    const previousSentAt = new Date("2026-09-01T12:00:00Z");
    resetState({ client: {
      status: "Assigned",
      assignedClinicianId: "clinician-a",
      assignedSlotId: "slot-a",
      registrationToken: "previously-delivered-token",
      registrationEmailSentAt: previousSentAt,
    } });
    h.state.emailThrows = true;

    const response = await request("/api/clients/client-a/send-registration", {
      method: "POST", body: JSON.stringify({ attemptKey: "throwing-send-654321" }),
    });

    expect(response.status).toBe(500);
    expect(h.state.client.registrationEmailSendingAt).toBeNull();
    expect(h.state.client.registrationEmailClaimId).toBeNull();
    expect(h.state.client.registrationEmailFailedAt).toBeInstanceOf(Date);
    expect(h.state.client.registrationEmailSentAt).toEqual(previousSentAt);
  });

  it("rejects stale consent before mutating registration", async () => {
    resetState({ client: {
      status: "OptionSelected",
      registrationToken: "registration-token",
      registrationTokenExpiresAt: new Date(Date.now() + 60_000),
    } });
    configureRegistrationTemplate();
    const response = await request("/api/public/register/client-a/registration-token", {
      method: "POST",
      body: JSON.stringify({ paymentType: "insurer", termsVersion: 3, registrationTemplateUpdatedAt: "2026-09-06T12:00:00.000Z", registrationResponses: { address: "1 High Street", agreement: "Yes" } }),
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/changed/i);
    expect(h.state.client.status).toBe("OptionSelected");
    expect(h.state.emails).toHaveLength(0);
    expect(h.state.activities).toHaveLength(0);
  });

  it("renders only the configured tenant form and validates required fields before claiming", async () => {
    configureRegistrationTemplate();
    resetState({ client: {
      status: "OptionSelected", registrationToken: "registration-token",
      registrationTokenExpiresAt: new Date(Date.now() + 60_000),
    } });
    // resetState intentionally clears durable rows, so configure after it.
    configureRegistrationTemplate();
    const rendered = await request("/api/public/register/client-a/registration-token");
    expect(rendered.status).toBe(200);
    expect(rendered.body.registrationTemplate.id).toBe("registration-form-a");
    expect(rendered.body.registrationTemplate.fields[0]).toMatchObject({ id: "address" });
    expect(rendered.body.registrationTemplateUpdatedAt).toBe("2026-09-06T12:00:00.000Z");

    const missing = await request("/api/public/register/client-a/registration-token", {
      method: "POST", body: JSON.stringify({ paymentType: "insurer", termsVersion: 4, registrationTemplateUpdatedAt: "2026-09-06T12:00:00.000Z", registrationResponses: { agreement: "Yes" } }),
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/address.*required/i);
    expect(h.state.client.status).toBe("OptionSelected");
    expect(h.state.submissions).toHaveLength(0);

    const payload = JSON.stringify({
      paymentType: "insurer", insurerName: "Bupa", insurancePolicyNumber: "Policy", preauthorisationCode: "Auth", termsVersion: 4,
      registrationTemplateUpdatedAt: "2026-09-06T12:00:00.000Z",
      registrationResponses: { address: "1 High Street", agreement: "Yes" },
    });
    const first = await request("/api/public/register/client-a/registration-token", { method: "POST", body: payload });
    const retry = await request("/api/public/register/client-a/registration-token", { method: "POST", body: payload });
    expect(first.status).toBe(200);
    expect(retry.body).toMatchObject({ success: true, alreadyCompleted: true });
    expect(h.state.submissions).toHaveLength(1);
    expect(h.state.client.registrationFormSubmissionId).toBe("submission-1");
    expect(h.state.submissions[0]).toMatchObject({
      registrationTemplateTitle: "Registration details",
    });
    expect(h.state.client.termsAcceptedAt).toBeInstanceOf(Date);
    expect(h.state.client.termsAcceptedVersion).toBe(4);
    expect(h.state.client.termsAcceptedContent).toContain("Current registration terms");
    expect(h.state.client.insurerDetails).toBe(
      "Insurer name: Bupa\nInsurance policy number: Policy\nPreauthorisation code: Auth",
    );
    expect(h.state.submissions[0].responses.agreement).toBe("Yes");
    expect(h.state.submissions[0].registrationConsentEvidence).toEqual([{
      fieldId: "agreement",
      statement: "I agree to the terms and conditions",
      answer: "Yes",
      acceptedAt: h.state.client.termsAcceptedAt.toISOString(),
    }]);
    expect(h.state.submissions[0].registrationTermsAcceptedAt).toBe(h.state.client.termsAcceptedAt);
    expect(h.state.submissions[0].registrationTermsAcceptedVersion).toBe(4);
    expect(h.state.submissions[0].registrationTermsAcceptedContent).toContain("Current registration terms");
  });

  it("omits only explicitly marked consent-date fields from new registrations", async () => {
    resetState({ client: {
      status: "OptionSelected", registrationToken: "registration-token",
      registrationTokenExpiresAt: new Date(Date.now() + 60_000),
    } });
    configureRegistrationTemplate([
      { id: "manualConsentDate", type: "date", label: "Date of Consent", required: true, isConsentDate: true },
      { id: "birthDate", type: "date", label: "Date of birth", required: true },
    ]);
    const rendered = await request("/api/public/register/client-a/registration-token");
    expect(rendered.body.registrationTemplate.fields.map((field: any) => field.id)).toEqual([
      "birthDate", "terms-copy", "agreement",
    ]);
    const submitted = await request("/api/public/register/client-a/registration-token", {
      method: "POST",
      body: JSON.stringify({
        paymentType: "insurer", insurerName: "Bupa", insurancePolicyNumber: "Policy",
        preauthorisationCode: "Auth", termsVersion: 4,
        registrationTemplateUpdatedAt: "2026-09-06T12:00:00.000Z",
        registrationResponses: { birthDate: "2010-04-03", agreement: "Yes" },
      }),
    });
    expect(submitted.status).toBe(200);
    expect(h.state.submissions[0].registrationTemplateFields.map((field: any) => field.id)).not.toContain("manualConsentDate");
    expect(h.state.submissions[0].responses.birthDate).toBe("2010-04-03");
  });

  it("keeps registration and intake submissions in separate tenant-scoped admin routes", async () => {
    h.state.client.registrationFormSubmissionId = "registration-1";
    h.state.submissions = [
      { id: "registration-1", clientId: "client-a", tenantId: "tenant-a", formTemplateId: null, registrationTemplateTitle: "Registration", registrationTemplateFields: [] },
      { id: "intake-1", clientId: "client-a", tenantId: "tenant-a", formTemplateId: null, responses: {} },
      { id: "foreign-intake", clientId: "client-a", tenantId: "tenant-b", formTemplateId: null, responses: {} },
    ];
    const intake = await request("/api/clients/client-a/submissions");
    expect(intake.status).toBe(200);
    expect(intake.body.map((submission: any) => submission.id)).toEqual(["intake-1"]);
    const registration = await request("/api/clients/client-a/registration-submission");
    expect(registration.status).toBe(200);
    expect(registration.body).toMatchObject({ id: "registration-1", formTitle: "Registration" });

    h.state.client.tenantId = "tenant-b";
    expect((await request("/api/clients/client-a/registration-submission")).status).toBe(403);
  });

  it("does not require a hidden conditional field, but requires it when shown", async () => {
    resetState({ client: {
      status: "OptionSelected", registrationToken: "registration-token",
      registrationTokenExpiresAt: new Date(Date.now() + 60_000),
    } });
    configureRegistrationTemplate([
      { id: "hasPolicy", label: "Has policy", required: true },
      { id: "policyNumber", label: "Policy number", required: true, showWhen: { field: "hasPolicy", equals: "yes" } },
    ]);
    const hidden = await request("/api/public/register/client-a/registration-token", {
      method: "POST",
      body: JSON.stringify({ paymentType: "insurer", insurerName: "Bupa", insurancePolicyNumber: "Policy", preauthorisationCode: "Auth", termsVersion: 4, registrationTemplateUpdatedAt: "2026-09-06T12:00:00.000Z", registrationResponses: { hasPolicy: "no", agreement: "Yes" } }),
    });
    expect(hidden.status).toBe(200);

    resetState({ client: {
      status: "OptionSelected", registrationToken: "registration-token",
      registrationTokenExpiresAt: new Date(Date.now() + 60_000),
    } });
    configureRegistrationTemplate([
      { id: "hasPolicy", required: true },
      { id: "policyNumber", label: "Policy number", required: true, showWhen: { field: "hasPolicy", equals: "yes" } },
    ]);
    const shown = await request("/api/public/register/client-a/registration-token", {
      method: "POST",
      body: JSON.stringify({ paymentType: "insurer", termsVersion: 4, registrationTemplateUpdatedAt: "2026-09-06T12:00:00.000Z", registrationResponses: { hasPolicy: "yes", agreement: "Yes" } }),
    });
    expect(shown.status).toBe(400);
    expect(shown.body.error).toMatch(/policy number.*required/i);
  });

  it("matches legacy conditional field visibility for required validation", async () => {
    const fields = [
      { id: "hasReferral", required: true },
      { id: "referrer", label: "Referrer", required: true, conditional: { fieldId: "hasReferral", value: "yes" } },
    ];
    resetState({ client: {
      status: "OptionSelected", registrationToken: "registration-token",
      registrationTokenExpiresAt: new Date(Date.now() + 60_000),
    } });
    configureRegistrationTemplate(fields);
    const hidden = await request("/api/public/register/client-a/registration-token", {
      method: "POST",
      body: JSON.stringify({ paymentType: "insurer", insurerName: "Bupa", insurancePolicyNumber: "Policy", preauthorisationCode: "Auth", termsVersion: 4, registrationTemplateUpdatedAt: "2026-09-06T12:00:00.000Z", registrationResponses: { hasReferral: "no", agreement: "Yes" } }),
    });
    expect(hidden.status).toBe(200);

    resetState({ client: {
      status: "OptionSelected", registrationToken: "registration-token",
      registrationTokenExpiresAt: new Date(Date.now() + 60_000),
    } });
    configureRegistrationTemplate(fields);
    const shown = await request("/api/public/register/client-a/registration-token", {
      method: "POST",
      body: JSON.stringify({ paymentType: "insurer", termsVersion: 4, registrationTemplateUpdatedAt: "2026-09-06T12:00:00.000Z", registrationResponses: { hasReferral: "yes", agreement: "Yes" } }),
    });
    expect(shown.status).toBe(400);
    expect(shown.body.error).toMatch(/referrer.*required/i);
  });

  it("rejects missing and cross-tenant registration template configuration", async () => {
    resetState({ client: {
      status: "OptionSelected", registrationToken: "registration-token",
      registrationTokenExpiresAt: new Date(Date.now() + 60_000),
    }, tenant: { registrationFormTemplateId: null } });
    const missing = await request("/api/public/register/client-a/registration-token");
    expect(missing.status).toBe(503);

    resetState({ client: {
      status: "OptionSelected", registrationToken: "registration-token",
      registrationTokenExpiresAt: new Date(Date.now() + 60_000),
    }, tenant: { registrationFormTemplateId: "other-form" } });
    h.state.registrationTemplate = { id: "other-form", tenantId: "tenant-b", title: "Other", description: "", fields: [] };
    const crossTenant = await request("/api/public/register/client-a/registration-token");
    expect(crossTenant.status).toBe(503);

    resetState({ tenant: { registrationFormTemplateId: null } });
    const selection = await request("/api/public/options/selection-token-a/select", {
      method: "POST", body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });
    expect(selection.status).toBe(409);
    expect(selection.body.error).toMatch(/not configured/i);
    expect(h.state.client.status).toBe("OptionsSent");
  });

  it("never confirms enabled self-pay without a rate or Stripe, but confirms disabled payments after the form", async () => {
    resetState({ client: {
      status: "OptionSelected", registrationToken: "registration-token",
      registrationTokenExpiresAt: new Date(Date.now() + 60_000), agreedRatePence: null,
    }, tenant: { paymentsEnabled: true } });
    configureRegistrationTemplate([]);
    const payload = JSON.stringify({ paymentType: "self_pay", termsVersion: 4, registrationTemplateUpdatedAt: "2026-09-06T12:00:00.000Z", registrationResponses: { agreement: "Yes" } });
    const noRate = await request("/api/public/register/client-a/registration-token", { method: "POST", body: payload });
    expect(noRate.status).toBe(422);
    expect(h.state.client).toMatchObject({
      status: "RegistrationPending",
      registrationPaymentFailureCode: "client_rate_required",
    });

    h.state.client.agreedRatePence = 12000;
    const stripe = await import("./stripe");
    vi.mocked(stripe.isStripeConfigured).mockReturnValue(false);
    const noStripe = await request("/api/public/register/client-a/registration-token", { method: "POST", body: payload });
    expect(noStripe.status).toBe(503);
    expect(h.state.client).toMatchObject({
      status: "RegistrationPending",
      registrationPaymentFailureCode: "stripe_unavailable",
    });
    vi.mocked(stripe.isStripeConfigured).mockReturnValue(true);

    h.state.tenant.paymentsEnabled = false;
    const disabled = await request("/api/public/register/client-a/registration-token", { method: "POST", body: payload });
    expect(disabled.status).toBe(200);
    expect(h.state.client.status).toBe("BookingConfirmed");
    expect(h.state.submissions).toHaveLength(1);
  });

  it("lets an administrator retry the same failed automatic payment attempt", async () => {
    resetState({
      tenant: { paymentsEnabled: true },
      client: {
        status: "RegistrationPending",
        paymentType: "self_pay",
        registrationFormSubmissionId: "submission-1",
        registrationPaymentAttemptKey: "stable-attempt",
        registrationPaymentFailedAt: new Date(),
        registrationPaymentFailureCode: "provider_transient",
        registrationPaymentFailureReason: "Retry the existing automatic setup.",
      },
    });

    const first = await request("/api/clients/client-a/retry-payment-setup", { method: "POST" });
    const second = await request("/api/clients/client-a/retry-payment-setup", { method: "POST" });

    expect(first).toMatchObject({ status: 200, body: { url: "https://pay.test/session", idempotent: false } });
    expect(second).toMatchObject({ status: 200, body: { url: "https://pay.test/session", idempotent: true } });
    expect(h.state.paymentLinks).toHaveLength(1);
    expect(h.state.paymentLinks[0].idempotencyKey).toBe("registration-payment-client-a-stable-attempt");
    expect(h.state.client).toMatchObject({
      registrationPaymentFailedAt: null,
      registrationPaymentFailureCode: null,
      registrationPaymentFailureReason: null,
      stripePaymentLinkId: "plink_1",
    });
  });

  it("resends an existing payment link without creating or replacing it", async () => {
    resetState({
      tenant: { paymentsEnabled: true },
      client: {
        paymentStatus: "setup_pending",
        stripeCheckoutUrl: "https://pay.test/existing",
        stripePaymentLinkId: "plink_existing",
      },
    });

    const response = await request("/api/clients/client-a/resend-payment-link", { method: "POST" });

    expect(response).toMatchObject({
      status: 200,
      body: { success: true, url: "https://pay.test/existing" },
    });
    expect(h.state.paymentLinks).toHaveLength(0);
    expect(h.state.client.stripeCheckoutUrl).toBe("https://pay.test/existing");
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.emails[0].to).toBe("client@example.test");
  });

  it("safely replaces an inactive unpaid link before resending it", async () => {
    resetState({
      tenant: { paymentsEnabled: true },
      client: {
        paymentStatus: "setup_pending",
        stripeCheckoutUrl: "https://pay.test/inactive",
        stripePaymentLinkId: "plink_inactive",
      },
    });
    h.state.stripeLinkActive = false;

    const response = await request("/api/clients/client-a/resend-payment-link", { method: "POST" });

    expect(response).toMatchObject({
      status: 200,
      body: {
        success: true,
        url: "https://pay.test/session",
        replacedInactiveLink: true,
      },
    });
    expect(h.state.paymentLinks).toHaveLength(1);
    expect(h.state.client).toMatchObject({
      stripeCheckoutUrl: "https://pay.test/session",
      stripePaymentLinkId: "plink_1",
    });
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.emails[0].html).toContain("https://pay.test/session");
  });

  it("does not replace an inactive link when Stripe shows a completed payment", async () => {
    resetState({
      tenant: { paymentsEnabled: true },
      client: {
        paymentStatus: "setup_pending",
        stripeCheckoutUrl: "https://pay.test/inactive",
        stripePaymentLinkId: "plink_inactive",
      },
    });
    h.state.stripeLinkActive = false;
    h.state.checkoutSessions = [{
      id: "cs_paid",
      status: "complete",
      payment_status: "paid",
    }];

    const response = await request("/api/clients/client-a/resend-payment-link", { method: "POST" });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("completed payment");
    expect(h.state.paymentLinks).toHaveLength(0);
    expect(h.state.emails).toHaveLength(0);
    expect(h.state.client.stripeCheckoutUrl).toBe("https://pay.test/inactive");
  });

  it("does not replace an inactive link while a checkout session is still open", async () => {
    resetState({
      tenant: { paymentsEnabled: true },
      client: {
        paymentStatus: "setup_pending",
        stripeCheckoutUrl: "https://pay.test/inactive",
        stripePaymentLinkId: "plink_inactive",
      },
    });
    h.state.stripeLinkActive = false;
    h.state.checkoutSessions = [{
      id: "cs_open",
      status: "open",
      payment_status: "unpaid",
    }];

    const response = await request("/api/clients/client-a/resend-payment-link", { method: "POST" });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("open checkout");
    expect(h.state.paymentLinks).toHaveLength(0);
    expect(h.state.emails).toHaveLength(0);
  });

  it("keeps payment-link resends tenant scoped", async () => {
    resetState({
      tenant: { id: "tenant-b", paymentsEnabled: true },
      client: {
        tenantId: "tenant-a",
        paymentStatus: "setup_pending",
        stripeCheckoutUrl: "https://pay.test/existing",
      },
    });

    const response = await request("/api/clients/client-a/resend-payment-link", { method: "POST" });

    expect(response.status).toBe(404);
    expect(h.state.emails).toHaveLength(0);
  });

  it("does not resend a setup link after payment is active", async () => {
    resetState({
      tenant: { paymentsEnabled: true },
      client: {
        paymentStatus: "active",
        stripeCheckoutUrl: "https://pay.test/completed",
      },
    });

    const response = await request("/api/clients/client-a/resend-payment-link", { method: "POST" });

    expect(response.status).toBe(409);
    expect(h.state.emails).toHaveLength(0);
  });

  it("does not replace an existing payment link through routine manual generation", async () => {
    resetState({
      tenant: { paymentsEnabled: true },
      client: {
        paymentStatus: "setup_pending",
        stripeCheckoutUrl: "https://pay.test/existing",
        stripePaymentLinkId: "plink_existing",
      },
    });

    const response = await request("/api/stripe/checkout", {
      method: "POST",
      body: JSON.stringify({ clientId: "client-a" }),
    });

    expect(response.status).toBe(409);
    expect(h.state.paymentLinks).toHaveLength(0);
    expect(h.state.client.stripeCheckoutUrl).toBe("https://pay.test/existing");
  });

  it("does not create a new payment link after payment is active", async () => {
    resetState({
      tenant: { paymentsEnabled: true },
      client: {
        paymentStatus: "active",
        stripeCheckoutUrl: null,
        stripePaymentLinkId: null,
      },
    });

    const response = await request("/api/stripe/checkout", {
      method: "POST",
      body: JSON.stringify({ clientId: "client-a" }),
    });

    expect(response.status).toBe(409);
    expect(h.state.paymentLinks).toHaveLength(0);
  });

  it("creates only one routine payment link across concurrent requests", async () => {
    resetState({
      tenant: { paymentsEnabled: true },
      client: {
        paymentStatus: "none",
        stripeCheckoutUrl: null,
        stripePaymentLinkId: null,
      },
    });

    const [first, second] = await Promise.all([
      request("/api/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ clientId: "client-a" }),
      }),
      request("/api/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ clientId: "client-a" }),
      }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(h.state.paymentLinks).toHaveLength(1);
    expect(h.state.client.stripeCheckoutUrl).toBe("https://pay.test/session");
    expect(h.state.emails).toHaveLength(1);
  });

  it("uses the tenant key already decrypted by authenticated middleware", async () => {
    resetState({
      tenant: { paymentsEnabled: true, stripeSecretKey: "sk_plaintext_from_middleware" },
      client: {
        status: "RegistrationPending",
        paymentType: "self_pay",
        registrationFormSubmissionId: "submission-1",
        registrationPaymentAttemptKey: "stable-attempt",
        registrationPaymentFailedAt: new Date(),
        registrationPaymentFailureCode: "stripe_unavailable",
      },
    });
    const encryption = await import("./encryption");
    vi.mocked(encryption.decryptSecret).mockImplementation(() => {
      throw new Error("plaintext must not be decrypted twice");
    });

    const response = await request("/api/clients/client-a/retry-payment-setup", { method: "POST" });

    expect(response.status).toBe(200);
    expect(h.state.paymentLinks[0].tenantStripeKey).toBe("sk_plaintext_from_middleware");
    expect(encryption.decryptSecret).not.toHaveBeenCalled();
  });

  it("serializes concurrent administrator retries", async () => {
    resetState({
      tenant: { paymentsEnabled: true },
      client: {
        status: "RegistrationPending",
        paymentType: "self_pay",
        registrationFormSubmissionId: "submission-1",
        registrationPaymentAttemptKey: "stable-attempt",
        registrationPaymentFailedAt: new Date(),
        registrationPaymentFailureCode: "interrupted",
      },
    });

    const [first, second] = await Promise.all([
      request("/api/clients/client-a/retry-payment-setup", { method: "POST" }),
      request("/api/clients/client-a/retry-payment-setup", { method: "POST" }),
    ]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(h.state.paymentLinks).toHaveLength(1);
    expect([first.body.idempotent, second.body.idempotent].sort()).toEqual([false, true]);
  });

  it("reuses the provider identity after acceptance is interrupted before persistence", async () => {
    resetState({
      tenant: { paymentsEnabled: true },
      client: {
        status: "RegistrationPending",
        paymentType: "self_pay",
        registrationFormSubmissionId: "submission-1",
        registrationPaymentAttemptKey: "stable-attempt",
        registrationPaymentFailedAt: new Date(),
        registrationPaymentFailureCode: "interrupted",
      },
    });
    h.state.preventCheckoutSave = true;
    const interrupted = await request("/api/clients/client-a/retry-payment-setup", { method: "POST" });
    h.state.preventCheckoutSave = false;
    const recovered = await request("/api/clients/client-a/retry-payment-setup", { method: "POST" });

    expect(interrupted.status).toBe(409);
    expect(recovered.status).toBe(200);
    expect(h.state.paymentLinks).toHaveLength(2);
    expect(new Set(h.state.paymentLinks.map(link => link.idempotencyKey))).toEqual(
      new Set(["registration-payment-client-a-stable-attempt"]),
    );
  });

  it("keeps automatic payment recovery tenant scoped", async () => {
    resetState({
      tenant: { id: "tenant-b", paymentsEnabled: true },
      client: {
        tenantId: "tenant-a",
        status: "RegistrationPending",
        paymentType: "self_pay",
        registrationFormSubmissionId: "submission-1",
        registrationPaymentAttemptKey: "stable-attempt",
        registrationPaymentFailedAt: new Date(),
      },
    });

    const response = await request("/api/clients/client-a/retry-payment-setup", { method: "POST" });
    expect(response.status).toBe(404);
    expect(h.state.paymentLinks).toHaveLength(0);
  });

  it("updates the existing warning when an administrator retry fails again", async () => {
    resetState({
      tenant: { paymentsEnabled: true },
      client: {
        status: "RegistrationPending",
        paymentType: "self_pay",
        registrationFormSubmissionId: "submission-1",
        registrationPaymentAttemptKey: "stable-attempt",
        registrationPaymentFailedAt: new Date("2026-09-01"),
        registrationPaymentFailureCode: "interrupted",
      },
    });
    h.state.paymentResult = null;

    const response = await request("/api/clients/client-a/retry-payment-setup", { method: "POST" });

    expect(response.status).toBe(502);
    expect(h.state.client.registrationPaymentFailureCode).toBe("provider_transient");
    expect(h.state.client.registrationPaymentFailedAt).toBeInstanceOf(Date);
    expect(h.state.paymentLinks).toHaveLength(1);
  });

  it("completes non-payment registration once across response-loss retries", async () => {
    resetState({ client: {
      status: "OptionSelected", assignedClinicianId: "clinician-a", assignedSlotId: "slot-a",
      registrationToken: "registration-token", registrationTokenExpiresAt: new Date(Date.now() + 60_000),
    } });
    configureRegistrationTemplate([]);
    const payload = JSON.stringify({ paymentType: "insurer", insurerName: "Bupa", insurancePolicyNumber: "Policy", preauthorisationCode: "Auth", termsVersion: 4, registrationTemplateUpdatedAt: "2026-09-06T12:00:00.000Z", registrationResponses: { agreement: "Yes" } });
    const first = await request("/api/public/register/client-a/registration-token", { method: "POST", body: payload });
    const retry = await request("/api/public/register/client-a/registration-token", { method: "POST", body: payload });

    expect(first.body).toMatchObject({ success: true });
    expect(retry.body).toMatchObject({ success: true, alreadyCompleted: true });
    expect(h.state.client.status).toBe("BookingConfirmed");
    expect(h.state.slot).toMatchObject({ isBooked: false, retirementReason: "Appointment confirmed" });
    expect(h.state.slot.retiredAt).toBeInstanceOf(Date);
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.activities.filter(a => a.action === "activity_registration_submitted")).toHaveLength(0);
    expect(h.state.activities.filter(a => a.action === "activity_booking_confirmed")).toHaveLength(1);
  });

  it("creates one payment setup and reuses it on retry", async () => {
    resetState({
      tenant: { paymentsEnabled: true },
      client: {
        status: "OptionSelected", assignedClinicianId: "clinician-a", assignedSlotId: "slot-a",
        registrationToken: "registration-token", registrationTokenExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    configureRegistrationTemplate([]);
    const payload = JSON.stringify({ paymentType: "self_pay", termsVersion: 4, registrationTemplateUpdatedAt: "2026-09-06T12:00:00.000Z", registrationResponses: { agreement: "Yes" } });
    const first = await request("/api/public/register/client-a/registration-token", { method: "POST", body: payload });
    const retry = await request("/api/public/register/client-a/registration-token", { method: "POST", body: payload });

    expect(first.body.checkoutUrl).toBe("https://pay.test/session");
    expect(retry.body).toMatchObject({ checkoutUrl: "https://pay.test/session", idempotent: true });
    expect(h.state.paymentLinks).toHaveLength(1);
    expect(h.state.client.paymentStatus).toBe("setup_pending");
    expect(h.state.activities.filter(a => a.action === "activity_registration_submitted")).toHaveLength(1);
    expect(h.state.emails).toHaveLength(0);
  });

  it("replaces an inactive stored registration payment link", async () => {
    resetState({
      tenant: { paymentsEnabled: true },
      client: {
        status: "RegistrationPending",
        paymentType: "self_pay",
        assignedClinicianId: "clinician-a",
        assignedSlotId: "slot-a",
        registrationToken: "registration-token",
        registrationTokenExpiresAt: new Date(Date.now() + 60_000),
        registrationPaymentAttemptKey: "old-attempt",
        stripeCheckoutUrl: "https://pay.test/inactive",
        stripePaymentLinkId: "plink_inactive",
      },
    });
    h.state.stripeLinkActive = false;

    const response = await request("/api/public/register/client-a/registration-token", {
      method: "POST",
      body: JSON.stringify({ paymentType: "self_pay" }),
    });

    expect(response.status).toBe(200);
    expect(response.body.checkoutUrl).toBe("https://pay.test/session");
    expect(h.state.client.stripePaymentLinkId).toBe("plink_1");
    expect(h.state.client.registrationPaymentAttemptKey).not.toBe("old-attempt");
    expect(h.state.paymentLinks).toHaveLength(1);
  });
});
