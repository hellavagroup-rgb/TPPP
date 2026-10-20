import express from "express";
import { createServer, type Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingSnapshots } from "@shared/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import { CYA_PSYCHOLOGY_TENANT_ID as CYA } from "@shared/practicePolicies";
import { decryptSecret } from "./encryption";

const h = vi.hoisted(() => {
  const state = {
    client: {} as any,
    tenant: {} as any,
    options: [] as any[],
    offerDeliveries: [] as any[],
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
    reservations: [] as any[],
    slotClaimFails: false,
    slotConflict: false,
    failOptionEvidenceWrite: false,
    failOfferCommitAfterAcceptance: false,
    failOfferAcceptanceSave: false,
    providerDeliveries: [] as any[],
    stripeLinkActive: true,
    deactivatedLinks: [] as string[],
    returnProviderKeys: [] as string[],
    legacyProviderKeys: [] as string[],
    emailResult: { success: true, outcome: "accepted" } as any,
    emailThrows: false,
    acceptedWithLostProviderResponse: false,
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
    slotChangeBeforeTransaction: null as Record<string, unknown> | null,
  };
  let transactionTail: Promise<void> = Promise.resolve();
  let durableOfferPatches: Array<{ id: string; patch: any }> | undefined;

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
      case "allocation_offer_deliveries": return state.offerDeliveries;
      // The harness has no SQL predicate evaluator; enforce the tenant predicate
      // for template reads here so cross-practice configuration is testable.
      case "form_templates": return state.registrationTemplate?.id
        && state.registrationTemplate.tenantId === state.tenant?.id ? [state.registrationTemplate] : [];
      case "form_submissions": return state.submissions;
      case "booking_snapshots": return state.bookingSnapshots;
      case "booking_reservations": return state.reservations;
      case "payment_charges": return state.charges;
      case "stripe_webhook_failures": return state.webhookFailures.filter(f =>
        f.tenantId === state.tenant.id && !f.resolvedAt && f.attempts >= 3);
      case "audit_logs": return state.activities;
      default: return [];
    }
  };

  const optionRowsMatching = (condition: any) => {
    if (!condition) return state.options;
    const { sql, params } = new PgDialect().sqlToQuery(condition);
    const fields: Record<string, string> = {
      id: "id",
      clientId: "client_id",
      tenantId: "tenant_id",
      status: "status",
      selectionToken: "selection_token",
    };
    return state.options.filter(option => Object.entries(fields).every(([property, column]) => {
      if (!sql.includes(`"client_clinician_options"."${column}"`)) return true;
      const escapedColumn = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const clause = new RegExp(`"${escapedColumn}"\\s*(=|in\\s*\\()\\s*(.*?)(?:\\s+and\\s+|\\s+or\\s+|\\)|$)`, "i")
        .exec(sql);
      if (!clause) return true;
      const placeholders = [...clause[2].matchAll(/\$(\d+)/g)].map(match => params[Number(match[1]) - 1]);
      const value = option[property];
      return clause[1].toLowerCase() === "="
        ? placeholders.length > 0 && value === placeholders[0]
        : placeholders.includes(value);
    }));
  };

  const submissionRowsMatching = (condition: any) => {
    if (!condition) return state.submissions;
    const { sql, params } = new PgDialect().sqlToQuery(condition);
    const fields: Record<string, string> = {
      id: "id",
      clientId: "client_id",
      tenantId: "tenant_id",
      isDraft: "is_draft",
    };
    return state.submissions.filter(submission => Object.entries(fields).every(([property, column]) => {
      const equality = new RegExp(`"${column}"\\s*=\\s*\\$(\\d+)`, "g");
      for (const match of sql.matchAll(equality)) {
        if (submission[property] !== params[Number(match[1]) - 1]) return false;
      }
      if (column === "is_draft" && new RegExp(`"${column}"\\s*=\\s*false`, "i").test(sql) && submission[property] !== false) {
        return false;
      }
      return true;
    }));
  };

  const chain = (run: () => any[], onWhere?: (condition: any) => void) => {
    let result: any[] | undefined;
    const execute = () => result ??= run();
    const builder: any = {
      where: (condition: any) => {
        onWhere?.(condition);
        const originalRun = run;
        if (condition) run = () => {
          const rows = originalRun();
          if (rows === state.options || (rows.length > 0 && rows.every(row => state.options.includes(row)))) {
            return optionRowsMatching(condition).filter(row => rows.includes(row));
          }
          // Enforce the real SQL ownership predicate for snapshot reads. A foreign
          // row with the same client ID must not satisfy an idempotent confirmation.
          const sql = new PgDialect().sqlToQuery(condition).sql;
          if (sql.includes('"booking_reservations"')) {
            const { params } = new PgDialect().sqlToQuery(condition);
            return rows.filter(row => Object.entries({
              id: "id", tenantId: "tenant_id", clientId: "client_id",
              paymentAttemptKey: "payment_attempt_key", paymentLinkId: "payment_link_id",
            }).every(([property, column]) => {
              for (const match of sql.matchAll(new RegExp(`"${column}"\\s*=\\s*\\$(\\d+)`, "g"))) {
                if (row[property] !== params[Number(match[1]) - 1]) return false;
              }
              return true;
            }));
          }
          if (sql.includes('"allocation_offer_deliveries"')) {
            return offerDeliveryRowsMatching(condition).filter(row => rows.includes(row));
          }
          if (sql.includes('"form_submissions"')) {
            return submissionRowsMatching(condition).filter(row => rows.includes(row));
          }
          if (sql.includes('"audit_logs"')) {
            // Arrangement evidence has a distinct audit action. Evaluating
            // these predicates avoids treating an ordinary review as arranged.
            const { params } = new PgDialect().sqlToQuery(condition);
            return rows.filter(row => Object.entries({
              tenantId: "tenant_id", resourceId: "resource_id", action: "action",
            }).every(([property, column]) => {
              for (const match of sql.matchAll(new RegExp(`"${column}"\\s*=\\s*\\$(\\d+)`, "g"))) {
                if (row[property] !== params[Number(match[1]) - 1]) return false;
              }
              return true;
            }));
          }
          if (sql.includes('"booking_snapshots"."tenant_id"')) {
            return rows.filter(row => row.tenantId === state.tenant.id);
          }
          if (sql.includes('"time_slots"."tenant_id"')) {
            return rows.filter(row => row.tenantId === state.tenant.id);
          }
          return rows;
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

  const offerDeliveryRowsMatching = (condition: any) => {
    if (!condition) return state.offerDeliveries;
    const { sql, params } = new PgDialect().sqlToQuery(condition);
    return state.offerDeliveries.filter(row => {
      for (const [property, column] of Object.entries({
        id: "id", tenantId: "tenant_id", clientId: "client_id",
        generationKey: "generation_key", status: "status",
      })) {
        const equality = new RegExp(`"${column}"\\s*=\\s*\\$(\\d+)`, "g");
        for (const match of sql.matchAll(equality)) {
          if (row[property] !== params[Number(match[1]) - 1]) return false;
        }
        const membership = new RegExp(`"${column}"\\s+(not\\s+)?in\\s*\\(([^)]*)\\)`, "i").exec(sql);
        if (membership) {
          const values = [...membership[2].matchAll(/\$(\d+)/g)].map(match => params[Number(match[1]) - 1]);
          if (membership[1] ? values.includes(row[property]) : !values.includes(row[property])) return false;
        }
      }
      return true;
    });
  };

  const db: any = {
    execute: vi.fn(async () => []),
    select: (selection?: any) => ({
      from: (table: any) => chain(() => selection?.conflictingClientId && tableName(table) === "clients"
        ? state.slotConflict ? [{ conflictingClientId: "client-b" }] : []
        : selection?.sentAt && tableName(table) === "clients"
        ? [{ sentAt: state.client.zoomLinkSentAt || null }]
        : selection?.displayId && tableName(table) === "clients" && state.webhookLookupIsForeign
          ? []
        : selection?.eventId && tableName(table) === "stripe_webhook_failures"
          ? rowsFor(table).map(f => ({
              ...f, clientId: f.clientId || null,
              displayId: f.clientId === state.client.id ? state.client.displayId : null,
            }))
        : tableName(table) === "client_clinician_options"
          ? optionRowsMatching(null)
          : rowsFor(table)),
    }),
    insert: (table: any) => ({
      values: (values: any | any[]) => {
        let inserted: any[] = [];
        if (tableName(table) === "client_clinician_options") {
          inserted = (Array.isArray(values) ? values : [values]).map((value, index) => ({
            id: value.id || `inserted-option-${state.options.length + index + 1}`,
            ...value,
          }));
          state.options.push(...inserted);
        } else if (tableName(table) === "allocation_offer_deliveries") {
          inserted = (Array.isArray(values) ? values : [values]).map(value => ({
            id: `offer-delivery-${state.offerDeliveries.length + 1}`,
            createdAt: new Date(), updatedAt: new Date(), ...value,
          }));
          state.offerDeliveries.push(...inserted);
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
    update: (table: any, transactional = false) => ({
      set: (patch: any) => {
        let optionCondition: any;
        return chain(() => {
        const name = tableName(table);
        if (name === "allocation_offer_deliveries") {
          if (patch.status === "accepted" && state.failOfferAcceptanceSave) {
            state.failOfferAcceptanceSave = false;
            throw new Error("Provider acceptance save failed");
          }
          const matching = offerDeliveryRowsMatching(optionCondition);
          if (!transactional && durableOfferPatches) {
            for (const row of matching) durableOfferPatches.push({ id: row.id, patch: structuredClone(patch) });
          }
          for (const row of matching) Object.assign(row, patch);
          return matching;
        }
        if (name === "time_slots") {
          if (patch.isBooked && (state.slotClaimFails || state.slot.isBooked)) return [];
          Object.assign(state.slot, patch);
          return [state.slot];
        }
        if (name === "client_clinician_options") {
          if (patch.sentAt && state.failOptionEvidenceWrite) throw new Error("sentAt evidence unavailable");
          const matching = optionRowsMatching(optionCondition);
          for (const option of matching) {
            if (patch.status === "declined" || patch.status === "unavailable") {
              if (option.status === "pending") Object.assign(option, patch);
            } else {
              Object.assign(option, patch);
            }
          }
          return matching;
        }
        if (name === "payment_charges") {
          for (const charge of state.charges) Object.assign(charge, patch);
          return state.charges;
        }
        if (name === "booking_reservations") {
          for (const reservation of state.reservations) Object.assign(reservation, patch);
          return state.reservations;
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
        }, condition => { optionCondition = condition; });
      },
    }),
    transaction: async (callback: any) => {
      if (state.rateChangeBeforeTransaction !== null) {
        state.client.agreedRatePence = state.rateChangeBeforeTransaction;
        state.rateChangeBeforeTransaction = null;
      }
      if (state.slotChangeBeforeTransaction) {
        Object.assign(state.slot, state.slotChangeBeforeTransaction);
        state.slotChangeBeforeTransaction = null;
      }
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const backup = structuredClone({
        client: state.client, slot: state.slot, options: state.options,
        snapshots: state.bookingSnapshots, submissions: state.submissions, charges: state.charges,
        activities: state.activities,
        offerDeliveries: state.offerDeliveries,
      });
      durableOfferPatches = [];
      try {
        const result = await callback({
          ...db,
          update: (table: any) => db.update(table, true),
        });
        if (state.failOfferCommitAfterAcceptance
          && state.client.status === "OptionsSent"
          && state.offerDeliveries.some(row => row.status === "finalized"
            && backup.offerDeliveries.find(old => old.id === row.id)?.status !== "finalized")
          && state.providerDeliveries.length) {
          state.failOfferCommitAfterAcceptance = false;
          throw new Error("Transaction commit failed after provider acceptance");
        }
        return result;
      } catch (error) {
        state.client = backup.client;
        state.slot = backup.slot;
        state.options = backup.options;
        state.bookingSnapshots = backup.snapshots;
        state.submissions = backup.submissions;
        state.charges = backup.charges;
        state.activities = backup.activities;
        // Acceptance is written through the independent durable connection,
        // so it survives rollback of the offer finalization transaction.
        state.offerDeliveries = backup.offerDeliveries;
        for (const evidence of durableOfferPatches) {
          const restored = state.offerDeliveries.find(row => row.id === evidence.id);
          if (restored) Object.assign(restored, evidence.patch);
        }
        throw error;
      } finally {
        durableOfferPatches = undefined;
        release();
      }
    },
  };

  const storage: any = new Proxy({
    getClientById: vi.fn(async () => state.client?.id ? { ...state.client } : undefined),
    getAllClients: vi.fn(async (_includeArchived: boolean, tenantId: string) =>
      state.client?.id && state.client.tenantId === tenantId ? [{ ...state.client }] : []),
    getClientsWithFailedPayments: vi.fn(async () => []),
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
    updateClientAndReleaseSlot: vi.fn(async (id: string, patch: any, slotId: string | null, _clinicianId: string | null, tenantId: string) => {
      if (state.client.id !== id || state.client.tenantId !== tenantId) return undefined;
      if (slotId === state.slot.id) state.slot.isBooked = false;
      for (const option of state.options) {
        if (option.clientId === id && option.tenantId === tenantId
          && ["pending", "selected"].includes(option.status)) option.status = "unavailable";
      }
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
      if (h.state.emailResult.success
        && (!email.idempotencyKey || !h.state.providerDeliveries.some(item => item.idempotencyKey === email.idempotencyKey))) {
        h.state.providerDeliveries.push(email);
      }
      if (h.state.acceptedWithLostProviderResponse) {
        h.state.acceptedWithLostProviderResponse = false;
        const sdkError = { name: "application_error", statusCode: null, message: "Unable to fetch data" };
        return { success: false, outcome: actual.classifyEmailProviderError(sdkError), error: sdkError.message };
      }
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
  h.state.offerDeliveries = [];
  h.state.slot = {
    id: "slot-a", tenantId: "tenant-a", clinicianId: "clinician-a", isBooked: false,
    type: "SpecificDate", day: null, date: "2999-09-10",
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
  h.state.reservations = [];
  h.state.slotClaimFails = false;
  h.state.slotConflict = false;
  h.state.failOptionEvidenceWrite = false;
  h.state.failOfferCommitAfterAcceptance = false;
  h.state.failOfferAcceptanceSave = false;
  h.state.providerDeliveries = [];
  h.state.stripeLinkActive = true;
  h.state.deactivatedLinks = [];
  h.state.returnProviderKeys = [];
  h.state.legacyProviderKeys = [];
  h.state.emailResult = { success: true, outcome: "accepted" };
  h.state.emailThrows = false;
  h.state.acceptedWithLostProviderResponse = false;
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
  h.state.slotChangeBeforeTransaction = null;
  vi.clearAllMocks();
  vi.mocked(decryptSecret).mockImplementation((value: string) => value);
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

describe("slot format permission HTTP routes", () => {
  const path = "/api/timeslots/slot-a/location-type";
  beforeEach(() => { h.storage.updateTimeSlotLocationType.mockReset(); });
  afterEach(() => { h.storage.updateTimeSlotLocationType.mockReset(); });

  it.each(["admin", "clinician"])("passes the authenticated %s identity and practice to the guarded update", async role => {
    h.storage.updateTimeSlotLocationType.mockResolvedValueOnce({
      slot: { ...h.state.slot, locationType: "in_person" }, previousLocationType: "online",
    });
    const response = await request(path, {
      method: "PATCH", headers: { "x-role": role },
      body: JSON.stringify({ locationType: "in_person", tenantId: "spoofed", userId: "spoofed", role: "admin" }),
    });
    expect(response.status).toBe(200);
    expect(response.body.locationType).toBe("in_person");
    expect(h.storage.updateTimeSlotLocationType).toHaveBeenCalledWith("slot-a", "tenant-a", "in_person", { id: "admin-1", role });
    expect(h.state.activities).toEqual(expect.arrayContaining([expect.objectContaining({
      action: "activity_slot_location_changed", details: expect.objectContaining({ oldLocationType: "online", newLocationType: "in person" }),
    })]));
  });

  it("returns a non-disclosing response for an inaccessible slot without activity", async () => {
    h.storage.updateTimeSlotLocationType.mockResolvedValueOnce(undefined);
    const response = await request(path, { method: "PATCH", headers: { "x-role": "clinician" }, body: JSON.stringify({ locationType: "online" }) });
    expect(response.status).toBe(404);
    expect(h.state.activities).toHaveLength(0);
  });

  it("returns the booking-conflict message without recording a successful change", async () => {
    const { ReservationError } = await import("./reservationLifecycle");
    h.storage.updateTimeSlotLocationType.mockRejectedValueOnce(new ReservationError(409, "Booked slots cannot change format."));
    const response = await request(path, { method: "PATCH", headers: { "x-role": "clinician" }, body: JSON.stringify({ locationType: "online" }) });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Booked slots cannot change format.");
    expect(h.state.activities).toHaveLength(0);
  });

  it.each([{ locationType: "invalid" }, {}, { locationType: null }])("rejects an invalid format body before storage: %j", async body => {
    const response = await request(path, { method: "PATCH", body: JSON.stringify(body) });
    expect(response.status).toBe(400);
    expect(h.storage.updateTimeSlotLocationType).not.toHaveBeenCalled();
  });
});

describe("occupied WriteUpp slot retirement HTTP routes", () => {
  const path = "/api/timeslots/clinician-a/slot-a/writeupp-retirement";
  const arrange = () => {
    h.state.client.status = "AwaitingConfirmation";
    h.state.slot.isBooked = true;
    h.state.activities.push({ id: "arrangement-a", tenantId: "tenant-a", resourceType: "client",
      resourceId: "client-a", action: "activity_writeupp_appointment_arranged" });
  };

  it("offers a preview and retires explicitly without client changes or notifications", async () => {
    arrange();
    const before = structuredClone(h.state.client);
    const preview = await request(path);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ eligible: true, clientId: "client-a" });
    expect(h.state.slot.retiredAt).toBeFalsy();
    const response = await request(path, { method: "POST",
      body: JSON.stringify({ retireOccupiedSlot: true, clientId: "client-a" }) });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ retired: true });
    expect(h.state.slot.retiredAt).toBeInstanceOf(Date);
    expect(h.state.client).toEqual(before);
    expect(h.state.emails).toEqual([]);
    expect(h.state.paymentLinks).toEqual([]);
    expect(h.state.bookingSnapshots).toEqual([]);
    expect(h.state.activities.some(row => row.action === "activity_writeupp_slot_retired")).toBe(true);
  });

  it("requires explicit confirmation and current client identity", async () => {
    arrange();
    expect((await request(path, { method: "POST", body: "{}" })).status).toBe(400);
    expect((await request(path, { method: "POST",
      body: JSON.stringify({ retireOccupiedSlot: true, clientId: "wrong-client" }) })).status).toBe(409);
    expect(h.state.slot.retiredAt).toBeFalsy();
  });

  it("rejects a slot from a different clinician", async () => {
    arrange();
    h.state.slot.clinicianId = "other-clinician";
    expect((await request(path)).status).toBe(404);
    expect((await request(path, { method: "POST",
      body: JSON.stringify({ retireOccupiedSlot: true, clientId: "client-a" }) })).status).toBe(404);
    expect(h.state.slot.retiredAt).toBeFalsy();
  });
});

describe("manual client creation HTTP errors", () => {
  it.each([false, true])("returns a helpful 409 for duplicate W-numbers (wrapped=%s) without changing a confirmed client", async (wrapped) => {
    h.state.client.status = "BookingConfirmed";
    const before = structuredClone(h.state.client);
    const duplicate = Object.assign(new Error("duplicate key"), {
      code: "23505", constraint: "clients_display_id_unique",
    });
    h.storage.createClientIdempotently.mockRejectedValueOnce(
      wrapped ? new Error("Failed query: insert; params: confidential", { cause: duplicate }) : duplicate,
    );
    const response = await request("/api/clients", {
      method: "POST",
      headers: { "Idempotency-Key": "new-manual-client-attempt" },
      body: JSON.stringify({ displayId: "WU1234567", email: "family@example.test", contactPreference: "email" }),
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("W-number already exists");
    expect(response.body.error).not.toMatch(/confidential|params|insert;/);
    expect(h.storage.createClientIdempotently).toHaveBeenCalledWith(
      expect.objectContaining({ displayId: "WU1234567" }), h.state.tenant.id, "new-manual-client-attempt",
    );
    expect(h.state.client).toEqual(before);
    expect(h.storage.updateClient).not.toHaveBeenCalled();
    expect(h.state.emails).toEqual([]);
    expect(h.state.activities).toEqual([]);
  });

  it("still creates a genuinely new client", async () => {
    const created = { ...h.state.client, id: "new-manual-client", displayId: "WU7654321", status: "New" };
    h.storage.createClientIdempotently.mockResolvedValueOnce({ client: created, created: true });
    const response = await request("/api/clients", {
      method: "POST",
      body: JSON.stringify({ displayId: created.displayId, email: "family@example.test", contactPreference: "email" }),
    });
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(created.id);
    expect(response.body.status).toBe("New");
  });
});

describe("registration journey HTTP routes", () => {
  it.each([
    ["92fbc179-2b4e-41e9-9326-4d8e008ca5be", true],
    ["0199f88e-fc37-453f-8e14-1152f790d40b", false],
    ["other-practice", false],
  ])("derives recurring presentation from the option's verified tenant %s, not a public query flag", async (tenantId, expected) => {
    h.state.tenant.id = tenantId;
    h.state.tenant.name = "CY&A Psychology";
    h.state.client.tenantId = tenantId;
    h.state.clinician.tenantId = tenantId;
    h.state.slot.tenantId = tenantId;
    h.state.options.forEach(option => { option.tenantId = tenantId; });
    const response = await request("/api/public/options/selection-token-a?regularSessionCopy=true");
    expect(response.status).toBe(200);
    expect(response.body.regularSessionCopy).toBe(expected);
    expect(h.state.activities).toEqual([]);
    expect(h.state.emails).toEqual([]);
  });

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

  it("confirms a fully opted-out legacy client once and safely accepts stale timestamp retries", async () => {
    resetState({
      tenant: {
        multiClinicianAllocationEnabled: false, intakeClientSummaryEnabled: false,
        registrationFormEnabled: false, confirmationRecoveryEnabled: false,
        bookingConfirmedEmailEnabled: false, paymentsEnabled: false,
      },
      client: { status: "AwaitingConfirmation", confirmedAt: null },
    });
    h.state.slot.isBooked = true;
    const first = await request("/api/clients/client-a", {
      method: "PATCH",
      body: JSON.stringify({ status: "Scheduled", confirmedAt: "2000-01-01T00:00:00Z" }),
    });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("Scheduled");
    expect(first.body.confirmedAt).not.toBe("2000-01-01T00:00:00Z");
    const clientBefore = structuredClone(h.state.client);
    const slotBefore = structuredClone(h.state.slot);
    const activitiesBefore = structuredClone(h.state.activities);
    const snapshotsBefore = structuredClone(h.state.bookingSnapshots);
    const emailCount = h.state.emails.length;
    const retries = await Promise.all([
      request("/api/clients/client-a", { method: "PATCH", body: JSON.stringify({ status: "Scheduled" }) }),
      request("/api/clients/client-a", { method: "PATCH",
        body: JSON.stringify({ status: "Scheduled", confirmedAt: "not-a-date" }) }),
    ]);
    expect(retries.map(result => result.status)).toEqual([200, 200]);
    expect(retries[0].body.confirmedAt).toBe(first.body.confirmedAt);
    expect(h.state.client).toEqual(clientBefore);
    expect(h.state.slot).toEqual(slotBefore);
    expect(h.state.activities).toEqual(activitiesBefore);
    expect(h.state.bookingSnapshots).toEqual(snapshotsBefore);
    expect(h.state.emails).toHaveLength(emailCount);
    expect(h.state.paymentLinks).toHaveLength(0);
    expect(h.state.charges).toHaveLength(0);
  });

  it("allows ordinary legacy edits with an unchanged confirmed status without accepting browser confirmation time", async () => {
    const confirmedAt = new Date("2026-01-10T12:00:00Z");
    resetState({
      tenant: { multiClinicianAllocationEnabled: false, registrationFormEnabled: false,
        confirmationRecoveryEnabled: false, bookingConfirmedEmailEnabled: false },
      client: { status: "Scheduled", assignedClinicianId: null, assignedSlotId: null, confirmedAt },
    });
    const slotBefore = structuredClone(h.state.slot);
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({
        status: "Scheduled", confirmedAt: "not-a-date", notes: "Staff updated the administrative notes.",
      }),
    });
    expect(response.status).toBe(200);
    expect(h.state.client.confirmedAt).toEqual(confirmedAt);
    expect(h.state.client.notes).toBe("Staff updated the administrative notes.");
    expect(h.state.slot).toEqual(slotBefore);
    expect(h.storage.updateClient.mock.calls.at(-1)?.[1]).not.toHaveProperty("confirmedAt");
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
      tenant: { confirmationRecoveryEnabled: false, registrationFormEnabled: false, paymentsEnabled: true },
      client: { status: "AwaitingConfirmation", paymentType: "self_pay", paymentStatus: "active" },
    });
    const legacy = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Scheduled" }),
    });
    expect(legacy.status).toBe(200);
    expect(h.state.bookingSnapshots).toHaveLength(1);
  });

  it("guards the registration practice even before its confirmation-recovery toggle is enabled", async () => {
    resetState({
      tenant: { confirmationRecoveryEnabled: false, registrationFormEnabled: true, paymentsEnabled: true },
      client: { status: "AwaitingConfirmation", paymentType: "self_pay", paymentStatus: "active" },
    });
    h.state.slot.isBooked = true;
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Scheduled" }),
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("payment_unverified");
    expect(h.state.bookingSnapshots).toHaveLength(0);
  });

  it("records a WriteUpp arrangement without repairing or confirming the portal allocation", async () => {
    resetState({
      tenant: { registrationFormEnabled: true, paymentsEnabled: true },
      client: { status: "AwaitingConfirmation", paymentType: "self_pay", paymentStatus: "setup_pending" },
    });
    h.state.slot.retiredAt = new Date();
    const originalClient = structuredClone(h.state.client);
    const originalSlot = structuredClone(h.state.slot);
    const review = {
      externalReference: "writeupp-appointment-1", clinicianReference: "External clinician",
      appointmentDate: "2026-10-12", startTime: "10:00",
      familyMessageReview: "Original message unavailable; staff verified appointment in WriteUpp.",
      diaryVerified: true, arrangedInWriteupp: true,
    };
    const first = await request("/api/historic-reconciliation/client-a/external-review", {
      method: "POST", body: JSON.stringify(review),
    });
    expect(first.status).toBe(200);
    expect(h.state.client).toEqual(originalClient);
    expect(h.state.slot).toEqual(originalSlot);
    expect(h.state.charges).toHaveLength(0);
    expect(h.state.bookingSnapshots).toHaveLength(0);
    expect(h.state.emails).toHaveLength(0);
    expect(h.state.paymentLinks).toHaveLength(0);
    expect(h.state.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "activity_external_booking_reviewed", tenantId: "tenant-a", userId: "admin-1", resourceId: "client-a" }),
      expect.objectContaining({ action: "activity_writeupp_appointment_arranged", tenantId: "tenant-a", userId: "admin-1", resourceId: "client-a" }),
    ]));
    const inventory = await request("/api/historic-reconciliation");
    expect(inventory.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "client-a", writeuppArranged: true, portalSnapshot: false, paymentStatus: "setup_pending", allocation: "invalid" }),
    ]));
    expect((await request("/api/historic-reconciliation/client-a/external-review", {
      method: "POST", body: JSON.stringify(review),
    })).status).toBe(200);
    expect(h.state.activities.filter(item => item.action === "activity_writeupp_appointment_arranged")).toHaveLength(1);
  });

  it("does not infer a WriteUpp arrangement from an ordinary historic review", async () => {
    resetState({ client: { status: "RegistrationPending" } });
    const response = await request("/api/historic-reconciliation/client-a/external-review", {
      method: "POST", body: JSON.stringify({
        externalReference: "external-reference", clinicianReference: "External clinician",
        appointmentDate: "2026-10-12", startTime: "10:00",
        familyMessageReview: "Staff reviewed the external diary and original message.", diaryVerified: true,
      }),
    });
    expect(response.status).toBe(200);
    const inventory = await request("/api/historic-reconciliation");
    expect(inventory.body[0].writeuppArranged).toBe(false);
    expect(h.state.client.status).toBe("RegistrationPending");
  });

  it("rejects a WriteUpp arrangement for a client belonging to another practice", async () => {
    resetState({ client: { status: "AwaitingConfirmation", tenantId: "tenant-b" } });
    const response = await request("/api/historic-reconciliation/client-a/external-review", {
      method: "POST", body: JSON.stringify({
        externalReference: "foreign-reference", clinicianReference: "External clinician",
        appointmentDate: "2026-10-12", startTime: "10:00",
        familyMessageReview: "Staff verified the external appointment.", diaryVerified: true, arrangedInWriteupp: true,
      }),
    });
    expect(response.status).toBe(409);
    expect(h.state.activities).toHaveLength(0);
    expect(h.state.emails).toHaveLength(0);
  });

  it("records a WriteUpp arrangement directly and idempotently without appointment fields or portal changes", async () => {
    resetState({ client: { status: "AwaitingConfirmation" } });
    const before = structuredClone(h.state.client);
    const input = { method: "POST", body: JSON.stringify({ arrangedInWriteupp: true }) };
    const first = await request("/api/historic-reconciliation/client-a/writeupp-arranged", input);
    const retry = await request("/api/historic-reconciliation/client-a/writeupp-arranged", input);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ arrangedInWriteupp: true, alreadyRecorded: false });
    expect(retry.body).toMatchObject({ arrangedInWriteupp: true, alreadyRecorded: true });
    expect(h.state.client).toEqual(before);
    expect(h.state.activities.filter(row => row.action === "activity_writeupp_appointment_arranged")).toHaveLength(1);
    expect(h.state.emails).toEqual([]);
    expect(h.state.bookingSnapshots).toEqual([]);
    expect(h.state.charges).toEqual([]);
  });

  it.each([{}, { arrangedInWriteupp: false }, { arrangedInWriteupp: true, paymentStatus: "active" }])(
    "rejects a missing assertion or extra evidence on the simple WriteUpp action",
    async body => {
      resetState({ client: { status: "AwaitingConfirmation" } });
      const response = await request("/api/historic-reconciliation/client-a/writeupp-arranged", {
        method: "POST", body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect(h.state.activities).toEqual([]);
    },
  );

  it("does not manufacture a portal booking after a manager's manual confirmation", async () => {
    resetState({
      tenant: { confirmationRecoveryEnabled: true, paymentsEnabled: false },
      client: { status: "AwaitingConfirmation", paymentType: "insurer", managerConfirmedAt: new Date() },
    });
    h.state.slot.isBooked = true;
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Scheduled" }),
    });
    expect(response.status).toBe(409);
    expect(h.state.bookingSnapshots).toEqual([]);
    expect(h.state.emails).toEqual([]);
  });

  it("does not accept manager override metadata through ordinary client edits", async () => {
    resetState({ client: { status: "RegistrationPending" } });
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({
        status: "RegistrationPending", managerConfirmedAt: "2026-10-07T12:00:00Z",
        managerConfirmedBy: "admin-1", managerConfirmationReason: "Attempt to skip manager PIN.",
      }),
    });
    expect(response.status).toBe(200);
    expect(h.state.client.managerConfirmedAt).toBeFalsy();
    expect(h.state.client.managerConfirmedBy).toBeFalsy();
    expect(h.state.client.managerConfirmationReason).toBeFalsy();
  });

  it("clears the current manual confirmation when a manager-confirmed client is explicitly reopened", async () => {
    resetState({ client: { status: "Scheduled", managerConfirmedAt: new Date(),
      managerConfirmedBy: "admin-1", managerConfirmationReason: "Historic booking." } });
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Forms Completed" }),
    });
    expect(response.status).toBe(200);
    expect(h.state.client.status).toBe("Forms Completed");
    expect(h.state.client.managerConfirmedAt).toBeNull();
    expect(h.state.client.managerConfirmedBy).toBeNull();
    expect(h.state.client.managerConfirmationReason).toBeNull();
  });

  it.each(["activity_external_booking_reviewed", "activity_writeupp_appointment_arranged"])("does not create a second portal booking after %s", async (action) => {
    resetState({
      tenant: { confirmationRecoveryEnabled: true, paymentsEnabled: false },
      client: { status: "AwaitingConfirmation", paymentType: "insurer" },
    });
    h.state.slot.isBooked = true;
    h.state.activities.push({ action, tenantId: "tenant-a",
      resourceId: "client-a", details: { externalReference: "diary-1" } });
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Scheduled" }),
    });
    expect(response.status).toBe(409);
    expect(h.state.bookingSnapshots).toHaveLength(0);
  });

  it("blocks confirmation if another active client claims the same slot", async () => {
    resetState({
      tenant: { confirmationRecoveryEnabled: true, paymentsEnabled: false },
      client: { status: "AwaitingConfirmation", paymentType: "insurer" },
    });
    h.state.slot.isBooked = true;
    h.state.slotConflict = true;
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Scheduled" }),
    });
    expect(response.status).not.toBe(200);
    expect(h.state.client.status).toBe("AwaitingConfirmation");
    expect(h.state.bookingSnapshots).toHaveLength(0);
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

  function readyLegacyForReconciliation() {
    readyForReconciliation();
    Object.assign(h.state.client, {
      status: "AwaitingConfirmation",
      registrationFormSubmissionId: "submission-registration",
    });
    h.state.submissions = [{
      id: "submission-registration", clientId: "client-a", tenantId: "tenant-a",
      isDraft: false,
    }];
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

  it("allows read-only Stripe inspection for an eligible legacy awaiting-confirmation client", async () => {
    readyLegacyForReconciliation();
    const clientBefore = structuredClone(h.state.client);
    const response = await request("/api/clients/client-a/payment-reconciliation");
    expect(response.status).toBe(200);
    expect(response.body.state).toBe("paid_unrecorded");
    expect(h.state.client).toEqual(clientBefore);
    expect(h.state.charges).toHaveLength(0);
    expect(h.state.bookingSnapshots).toHaveLength(0);
    expect(h.state.deactivatedLinks).toHaveLength(0);
    expect(h.state.customerUpdates).toHaveLength(0);
    expect(h.state.emails).toHaveLength(0);
    expect(h.state.paymentLinks).toHaveLength(0);
  });

  it("records a genuinely paid legacy checkout and confirms the booking once", async () => {
    readyLegacyForReconciliation();
    const [first, retry] = await Promise.all([
      request("/api/clients/client-a/payment-reconciliation", { method: "POST" }),
      request("/api/clients/client-a/payment-reconciliation", { method: "POST" }),
    ]);
    expect(first.body.state).toBe("recorded");
    expect(retry.body.state).toBe("recorded");
    expect(h.state.client.paymentStatus).toBe("active");
    expect(h.state.client.status).toBe("BookingConfirmed");
    expect(h.state.bookingSnapshots).toHaveLength(1);
    expect(h.state.charges).toHaveLength(1);
    expect(h.state.emails).toHaveLength(1);
    // Each recovery retry safely reasserts link deactivation; booking/payment
    // and the confirmation email still occur once.
    expect(h.state.deactivatedLinks).toEqual(["plink_current", "plink_current"]);
  });

  it("denies legacy reconciliation without a same-tenant submitted registration and makes no changes", async () => {
    const invalidRegistration = [
      {
        name: "missing",
        prepare: () => {
          h.state.client.registrationFormSubmissionId = null;
          h.state.submissions = [];
        },
      },
      {
        name: "foreign",
        prepare: () => {
          h.state.submissions[0].tenantId = "tenant-b";
        },
      },
      {
        name: "draft",
        prepare: () => {
          h.state.submissions[0].isDraft = true;
        },
      },
    ];
    for (const scenario of invalidRegistration) {
      readyLegacyForReconciliation();
      scenario.prepare();
      const clientBefore = structuredClone(h.state.client);
      const submissionsBefore = structuredClone(h.state.submissions);
      expect((await request("/api/clients/client-a/payment-reconciliation")).status, scenario.name).toBe(404);
      expect((await request("/api/clients/client-a/payment-reconciliation", { method: "POST" })).status, scenario.name).toBe(404);
      expect(h.state.returnProviderKeys, scenario.name).toHaveLength(0);
      expect(h.state.client).toEqual(clientBefore);
      expect(h.state.submissions).toEqual(submissionsBefore);
      expect(h.state.charges).toHaveLength(0);
      expect(h.state.bookingSnapshots).toHaveLength(0);
      expect(h.state.deactivatedLinks).toHaveLength(0);
      expect(h.state.customerUpdates).toHaveLength(0);
      expect(h.state.emails).toHaveLength(0);
      expect(h.state.paymentLinks).toHaveLength(0);
    }
  });

  it("does not persist an unverified Stripe mismatch for legacy awaiting-confirmation clients", async () => {
    readyLegacyForReconciliation();
    h.state.checkoutSessions[0].payment_link = "plink_external";
    const response = await request("/api/clients/client-a/payment-reconciliation", { method: "POST" });
    expect(response.status).toBe(503);
    expect(response.body.state).toBe("uncertain");
    expect(h.state.client.status).toBe("AwaitingConfirmation");
    expect(h.state.client.paymentStatus).toBe("setup_pending");
    expect(h.state.charges).toHaveLength(0);
    expect(h.state.bookingSnapshots).toHaveLength(0);
    expect(h.state.deactivatedLinks).toHaveLength(0);
    expect(h.state.emails).toHaveLength(0);
  });

  it("retains the external appointment review block for verified legacy payments", async () => {
    readyLegacyForReconciliation();
    h.state.activities.push({
      id: "external-review", tenantId: "tenant-a", resourceId: "client-a",
      action: "activity_external_booking_reviewed",
    });
    const response = await request("/api/clients/client-a/payment-reconciliation", { method: "POST" });
    expect(response.status).toBe(409);
    expect(response.body.state).toBe("paid_unrecorded");
    expect(h.state.client.status).toBe("AwaitingConfirmation");
    expect(h.state.client.paymentStatus).toBe("active");
    expect(h.state.charges).toHaveLength(1);
    expect(h.state.bookingSnapshots).toHaveLength(0);
    expect(h.state.emails).toHaveLength(0);
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

  it.each(["New", "Forms Sent"])("allows legacy manual forms completion from %s without portal evidence", async (status) => {
    resetState({
      tenant: { multiClinicianAllocationEnabled: false, registrationFormEnabled: false,
        intakeClientSummaryEnabled: false, formsEnabled: true, intakeFormTemplateId: null },
      client: { status, assignedClinicianId: null, assignedSlotId: null, formsCompletedAt: null },
    });
    h.state.options = [];
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Forms Completed" }),
    });
    expect(response.status).toBe(200);
    expect(h.state.client.status).toBe("Forms Completed");
    expect(h.state.client.formsCompletedAt).toBeInstanceOf(Date);
    expect(h.state.submissions).toHaveLength(0);
    expect(h.state.deliveries).toHaveLength(0);
    // Preserve ordinary staff notifications, but do not resend forms to the
    // client merely because staff recorded an externally completed intake.
    expect(h.state.emails.some(email => email.to === h.state.client.email)).toBe(false);
    expect(h.state.paymentLinks).toHaveLength(0);
    expect(h.state.bookingSnapshots).toHaveLength(0);
  });

  it("still requires portal intake evidence when the new workflow is enabled but its name display is off", async () => {
    configureIntakeCompletion("phone");
    h.state.tenant.intakeClientSummaryEnabled = false;
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.submissions = [];
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Forms Completed" }),
    });
    expect(response.status).toBe(400);
    expect(response.body.blocker.state).toBe("not_submitted");
    expect(h.state.client.status).toBe("New");
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

  it.each([
    ["registration-enabled", true],
    ["registration-disabled", false],
  ])("lets a client request fresh choices after declining (%s)", async (_configuration, registrationFormEnabled) => {
    h.state.client.status = "FormsCompleted";
    h.state.client.needsAdminCall = false;
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.tenant.registrationFormEnabled = registrationFormEnabled;
    h.state.options = [];

    const firstOffer = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect(firstOffer.status).toBe(200);
    const firstGeneration = h.state.options.filter(option => option.status === "pending");
    expect(firstGeneration).toHaveLength(1);
    const firstToken = firstGeneration[0].selectionToken;
    const sentBeforeDecline = h.state.emails.length;

    const decline = await request(`/api/public/options/${firstToken}/select`, {
      method: "POST",
      body: JSON.stringify({ decline: true }),
    });
    expect(decline.status).toBe(200);
    expect(decline.body).toMatchObject({ declined: true });
    expect(h.state.options.find(option => option.selectionToken === firstToken)?.status).toBe("declined");
    expect(h.state.client.needsAdminCall).toBe(true);

    const resend = await request("/api/clients/client-a/resend-allocation-options", { method: "POST" });
    expect(resend.status).toBe(409);
    expect(resend.body.code).toBe("OFFER_CLOSED");
    expect(h.state.emails).toHaveLength(sentBeforeDecline);

    const repeatedDecline = await request(`/api/public/options/${firstToken}/select`, {
      method: "POST",
      body: JSON.stringify({ decline: true }),
    });
    expect(repeatedDecline.status).toBe(410);
    expect(h.state.client.needsAdminCall).toBe(true);

    const replacement = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect(replacement.status).toBe(200);
    expect(h.state.client.status).toBe("OptionsSent");
    expect(h.state.client.needsAdminCall).toBe(true);
    const currentOptions = h.state.options.filter(option => option.status === "pending");
    expect(currentOptions).toHaveLength(1);
    expect(currentOptions[0].selectionToken).not.toBe(firstToken);

    const stalePortal = await request(`/api/public/options/${firstToken}`);
    expect(stalePortal.status).toBe(410);
    const staleSelection = await request(`/api/public/options/${firstToken}/select`, {
      method: "POST",
      body: JSON.stringify({ clinicianOptionId: firstGeneration[0].id }),
    });
    expect(staleSelection.status).toBe(410);
    expect(h.state.client.status).toBe("OptionsSent");
    expect(currentOptions[0].status).toBe("pending");

    const currentPortal = await request(`/api/public/options/${currentOptions[0].selectionToken}`);
    expect(currentPortal.status).toBe(200);
    expect(currentPortal.body.options.map((option: any) => option.id)).toEqual([currentOptions[0].id]);

    const selection = await request(`/api/public/options/${currentOptions[0].selectionToken}/select`, {
      method: "POST",
      body: JSON.stringify({ clinicianOptionId: currentOptions[0].id }),
    });
    expect(selection.status, JSON.stringify(selection.body)).toBe(200);
    expect(["OptionSelected", "BookingConfirmed", "Scheduled"]).toContain(h.state.client.status);
    const selectedStatus = h.state.client.status;
    expect(h.state.client.needsAdminCall).toBe(true);
    expect(h.state.options.find(option => option.id === currentOptions[0].id)?.status).toBe("selected");

    const repeatedSelection = await request(`/api/public/options/${currentOptions[0].selectionToken}/select`, {
      method: "POST",
      body: JSON.stringify({ clinicianOptionId: currentOptions[0].id }),
    });
    expect(repeatedSelection.status).toBe(200);
    expect(h.state.client.status).toBe(selectedStatus);
    expect(h.state.client.needsAdminCall).toBe(true);
  });

  it("serializes concurrent declines so only the first can close the offer", async () => {
    h.state.client.status = "OptionsSent";

    const responses = await Promise.all([
      request("/api/public/options/selection-token-a/select", {
        method: "POST",
        body: JSON.stringify({ decline: true }),
      }),
      request("/api/public/options/selection-token-a/select", {
        method: "POST",
        body: JSON.stringify({ decline: true }),
      }),
    ]);

    expect(responses.map(response => response.status).sort()).toEqual([200, 410]);
    expect(h.state.options[0].status).toBe("declined");
    expect(h.state.client.needsAdminCall).toBe(true);
    expect(h.state.activities.filter(activity => activity.action === "activity_appointment_options_declined")).toHaveLength(1);
  });

  it("allows only one concurrent staff reoffer after decline and sends one fresh generation", async () => {
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.options = [];
    const originalOffer = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect(originalOffer.status).toBe(200);
    const original = h.state.options.find(option => option.status === "pending")!;
    const decline = await request(`/api/public/options/${original.selectionToken}/select`, {
      method: "POST",
      body: JSON.stringify({ decline: true }),
    });
    expect(decline.status).toBe(200);
    const emailCountBeforeReoffer = h.state.emails.length;

    const reoffer = () => request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({
        reoffer: true,
        selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }],
      }),
    });
    const responses = await Promise.all([reoffer(), reoffer()]);

    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(h.state.emails).toHaveLength(emailCountBeforeReoffer + 1);
    const currentGeneration = h.state.options.filter(option => option.status === "pending");
    expect(currentGeneration).toHaveLength(1);
    expect(currentGeneration[0].selectionToken).not.toBe(original.selectionToken);
    expect(h.state.options.filter(option => option.status === "declined")).toHaveLength(1);
    expect(h.state.client.status).toBe("OptionsSent");
  });

  it("recovers a fresh accepted offer after commit failure without another email or new tokens", async () => {
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.options = [];
    h.state.failOfferCommitAfterAcceptance = true;
    const offer = () => request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });

    const failed = await offer();
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(h.state.client.status).toBe("FormsCompleted");
    expect(h.state.offerDeliveries).toHaveLength(1);
    expect(h.state.offerDeliveries[0].status).toBe("accepted");
    expect(h.state.providerDeliveries).toHaveLength(1);
    const sentEmail = h.state.providerDeliveries[0];
    expect(sentEmail.idempotencyKey).toBeTruthy();
    const token = h.state.options[0].selectionToken;
    expect(sentEmail.text + sentEmail.html).toContain(`/options/${token}`);
    expect(sentEmail.from).toContain("hello@practice.test");
    expect(sentEmail.text + sentEmail.html).toContain("Practice A");

    const retry = await offer();
    expect(retry.status).toBe(200);
    expect(h.state.client.status).toBe("OptionsSent");
    expect(h.state.offerDeliveries[0].status).toBe("finalized");
    expect(h.state.options).toHaveLength(1);
    expect(h.state.options[0].selectionToken).toBe(token);
    expect(h.state.options[0].sentAt).toBeTruthy();
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.providerDeliveries).toHaveLength(1);
    const portal = await request(`/api/public/options/${token}`);
    expect(portal.status).toBe(200);
  });

  it.each(["commit", "acceptance save"] as const)(
    "blocks ordinary resend after a stale reoffer's %s failure, then safely recovers the original email",
    async failure => {
      h.state.client.status = "OptionsSent";
      h.state.tenant.multiClinicianAllocationEnabled = true;
      h.state.tenant.autoAllocationEmailEnabled = true;
      h.state.options[0].slotId = null;
      const oldToken = h.state.options[0].selectionToken;
      h.state.failOfferCommitAfterAcceptance = failure === "commit";
      h.state.failOfferAcceptanceSave = failure === "acceptance save";
      const offer = () => request("/api/clients/client-a/allocate-options", {
        method: "POST",
        body: JSON.stringify({ reoffer: true, selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
      });
      expect((await offer()).status).toBeGreaterThanOrEqual(500);
      const freshToken = h.state.options.find(row => row.status === "pending")!.selectionToken;
      expect(h.state.client.status).toBe("OptionsSent");
      const emailCount = h.state.emails.length;
      const resend = await request("/api/clients/client-a/resend-allocation-options", { method: "POST" });
      expect(resend.status).toBe(409);
      expect(resend.body.code).toBe("ALLOCATION_DELIVERY_RECOVERY_REQUIRED");
      expect(h.state.emails).toHaveLength(emailCount);
      expect((await offer()).status).toBe(200);
      expect(h.state.providerDeliveries).toHaveLength(1);
      expect(h.state.options.find(row => row.status === "pending")!.selectionToken).toBe(freshToken);
      expect((await request(`/api/public/options/${freshToken}`)).status).toBe(200);
      expect((await request(`/api/public/options/${oldToken}`)).status).toBe(410);
    },
  );

  it("keeps declined tokens closed when an accepted fresh offer is recovered", async () => {
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.options = [];
    const offer = (reoffer = false) => request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ reoffer, selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect((await offer()).status).toBe(200);
    const oldToken = h.state.options[0].selectionToken;
    expect((await request(`/api/public/options/${oldToken}/select`, {
      method: "POST", body: JSON.stringify({ decline: true }),
    })).status).toBe(200);

    h.state.failOfferCommitAfterAcceptance = true;
    expect((await offer(true)).status).toBeGreaterThanOrEqual(500);
    const freshToken = h.state.options.find(row => row.status === "pending")!.selectionToken;
    const emailCount = h.state.emails.length;
    expect((await offer(true)).status).toBe(200);
    expect(h.state.emails).toHaveLength(emailCount);
    expect(h.state.options.find(row => row.selectionToken === oldToken)!.status).toBe("declined");
    expect((await request(`/api/public/options/${oldToken}`)).status).toBe(410);
    expect((await request(`/api/public/options/${freshToken}`)).status).toBe(200);
    expect(h.state.client.needsAdminCall).toBe(true);
  });

  it("does not reactivate a token whose offer was closed before staff recovery", async () => {
    h.state.client.status = "OptionsSent";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.options = [];
    h.state.failOfferCommitAfterAcceptance = true;
    const offer = () => request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect((await offer()).status).toBeGreaterThanOrEqual(500);
    const token = h.state.options[0].selectionToken;
    expect((await request(`/api/public/options/${token}/select`, {
      method: "POST", body: JSON.stringify({ decline: true }),
    })).status).toBe(410);
    // Simulate a separately persisted lifecycle closure. Even an accepted
    // outbox attempt is not authority to turn a closed option back to pending.
    h.state.options[0].status = "declined";
    const emails = h.state.emails.length;
    expect((await offer()).status).toBe(409);
    expect(h.state.emails).toHaveLength(emails);
    expect(h.state.options).toHaveLength(1);
    expect(h.state.options[0].status).toBe("declined");
    expect((await request(`/api/public/options/${token}`)).status).toBe(410);
  });

  it("ignores another tenant's recovery attempt and never sends its saved payload", async () => {
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.options = [];
    h.state.offerDeliveries = [{
      id: "foreign-attempt", clientId: "client-a", tenantId: "tenant-b",
      generationKey: "foreign-generation", idempotencyKey: "foreign-provider-key",
      status: "accepted", optionTokens: ["foreign-token"],
      acceptedAt: new Date(), createdAt: new Date(),
      emailPayload: { to: "foreign@practice.test", subject: "Private", html: "Foreign practice" },
    }];
    const response = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect(response.status).toBe(200);
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.emails[0].idempotencyKey).not.toBe("foreign-provider-key");
    expect(h.state.emails[0].to).not.toBe("foreign@practice.test");
    expect(h.state.offerDeliveries[0].status).toBe("accepted");
    expect(h.state.options[0].selectionToken).not.toBe("foreign-token");
  });

  it("reuses the exact provider key and payload when acceptance evidence could not be saved", async () => {
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.options = [];
    h.state.failOfferAcceptanceSave = true;
    const offer = () => request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect((await offer()).status).toBeGreaterThanOrEqual(500);
    expect(h.state.providerDeliveries).toHaveLength(1);
    const original = structuredClone(h.state.emails[0]);
    const token = h.state.options[0].selectionToken;
    h.state.tenant.name = "Renamed practice";
    expect((await offer()).status).toBe(200);
    expect(h.state.emails).toHaveLength(2);
    expect(h.state.emails[1]).toEqual(original);
    expect(h.state.providerDeliveries).toHaveLength(1);
    expect(h.state.options).toHaveLength(1);
    expect(h.state.options[0].selectionToken).toBe(token);
  });

  it("recovers provider acceptance followed by the SDK's lost-response error without duplicate delivery", async () => {
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.options = [];
    h.state.acceptedWithLostProviderResponse = true;
    const offer = () => request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect((await offer()).status).toBe(502);
    expect(h.state.offerDeliveries[0].status).toBe("sending");
    expect(h.state.options[0].status).toBe("pending");
    const token = h.state.options[0].selectionToken;
    const payload = structuredClone(h.state.emails[0]);
    expect((await offer()).status).toBe(200);
    expect(h.state.emails[1]).toEqual(payload);
    expect(h.state.providerDeliveries).toHaveLength(1);
    expect(h.state.options).toHaveLength(1);
    expect(h.state.options[0].selectionToken).toBe(token);
    expect((await request(`/api/public/options/${token}`)).status).toBe(200);
  });

  it("replaces stale pending choices without automatic email but refuses to replace available choices", async () => {
    h.state.client.status = "OptionsSent";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = false;
    const oldToken = h.state.options[0].selectionToken;
    h.state.options[0].slotId = null;
    const reoffer = () => request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ reoffer: true, selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect((await reoffer()).status).toBe(200);
    expect(h.state.options.find(row => row.selectionToken === oldToken)!.status).toBe("unavailable");
    const fresh = h.state.options.find(row => row.status === "pending")!;
    expect(fresh.selectionToken).not.toBe(oldToken);
    expect((await reoffer()).status).toBe(409);
    expect(h.state.options.filter(row => row.status === "pending")).toHaveLength(1);
    expect(h.state.emails).toHaveLength(0);
  });

  it("blocks an uncertain retry after the provider duplicate-prevention window expires", async () => {
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.options = [];
    h.state.failOfferAcceptanceSave = true;
    const offer = () => request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect((await offer()).status).toBeGreaterThanOrEqual(500);
    h.state.offerDeliveries[0].dedupExpiresAt = new Date(Date.now() - 1000);
    const emailCount = h.state.emails.length;
    expect((await offer()).status).toBe(409);
    expect(h.state.emails).toHaveLength(emailCount);
    expect(h.state.client.status).toBe("FormsCompleted");
    expect(h.state.offerDeliveries[0].status).toBe("uncertain");
  });

  it("keeps a declined request visible through failed reoffer and allows a successful staff retry", async () => {
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.options = [];
    const firstOffer = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect(firstOffer.status).toBe(200);
    const declined = h.state.options.find(option => option.status === "pending")!;
    const decline = await request(`/api/public/options/${declined.selectionToken}/select`, {
      method: "POST",
      body: JSON.stringify({ decline: true }),
    });
    expect(decline.status).toBe(200);
    expect(h.state.client.needsAdminCall).toBe(true);

    h.state.emailResult = { success: false, outcome: "rejected", error: "Rejected" };
    const failedReoffer = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({
        reoffer: true,
        selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }],
      }),
    });
    expect(failedReoffer.status).toBe(502);
    expect(h.state.client.needsAdminCall).toBe(true);
    expect(h.state.client.status).toBe("OptionsSent");
    expect(h.state.options.find(option => option.selectionToken === declined.selectionToken)?.status).toBe("declined");
    const failedGeneration = h.state.options.filter(option => option.status === "unavailable");
    expect(failedGeneration).toHaveLength(1);
    const failedToken = failedGeneration[0].selectionToken;
    expect(failedToken).not.toBe(declined.selectionToken);
    expect((await request(`/api/public/options/${failedToken}`)).status).toBe(410);
    const failedTokenSelection = await request(`/api/public/options/${failedToken}/select`, {
      method: "POST",
      body: JSON.stringify({ clinicianOptionId: failedGeneration[0].id }),
    });
    expect(failedTokenSelection.status).toBe(410);

    const declinedPortal = await request(`/api/public/options/${declined.selectionToken}`);
    expect(declinedPortal.status).toBe(410);
    const declinedSelection = await request(`/api/public/options/${declined.selectionToken}/select`, {
      method: "POST",
      body: JSON.stringify({ decline: true }),
    });
    expect(declinedSelection.status).toBe(410);

    h.state.emailResult = { success: true, outcome: "accepted" };
    const retry = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({
        reoffer: true,
        selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }],
      }),
    });
    expect(retry.status).toBe(200);
    expect(h.state.client.needsAdminCall).toBe(true);
    expect(h.state.client.status).toBe("OptionsSent");
    const successfulGeneration = h.state.options.filter(option => option.status === "pending");
    expect(successfulGeneration).toHaveLength(1);
    expect(successfulGeneration[0].selectionToken).not.toBe(declined.selectionToken);
    expect(successfulGeneration[0].selectionToken).not.toBe(failedToken);
  });

  it("resends only the fresh reoffer and uses its token as the portal entry point", async () => {
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.options = [];
    const initial = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect(initial.status).toBe(200);
    const oldOption = h.state.options.find(option => option.status === "pending")!;
    const decline = await request(`/api/public/options/${oldOption.selectionToken}/select`, {
      method: "POST",
      body: JSON.stringify({ decline: true }),
    });
    expect(decline.status).toBe(200);

    const reoffer = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({
        reoffer: true,
        selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }],
      }),
    });
    expect(reoffer.status).toBe(200);
    const freshOption = h.state.options.find(option => option.status === "pending")!;
    expect(freshOption.selectionToken).not.toBe(oldOption.selectionToken);

    const resend = await request("/api/clients/client-a/resend-allocation-options", { method: "POST" });
    expect(resend.status).toBe(200);
    const resentEmail = h.state.emails[h.state.emails.length - 1];
    expect(resentEmail.text).toContain(`https://app.test/options/${freshOption.selectionToken}`);
    expect(resentEmail.text).not.toContain(oldOption.selectionToken);
    expect(resentEmail.text).toContain("Option 1:");
    expect(resentEmail.text).not.toContain("Option 2:");
  });

  it("keeps a provider-accepted fresh offer live if sent-at evidence cannot be written", async () => {
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.options = [];
    const initial = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect(initial.status).toBe(200);
    const original = h.state.options.find(option => option.status === "pending")!;
    const decline = await request(`/api/public/options/${original.selectionToken}/select`, {
      method: "POST",
      body: JSON.stringify({ decline: true }),
    });
    expect(decline.status).toBe(200);
    h.state.failOptionEvidenceWrite = true;
    const emailCountBeforeReoffer = h.state.emails.length;

    const reoffer = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({
        reoffer: true,
        selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }],
      }),
    });

    expect(reoffer.status).toBe(200);
    expect(h.state.emails).toHaveLength(emailCountBeforeReoffer + 1);
    expect(h.state.client.status).toBe("OptionsSent");
    expect(h.state.client.needsAdminCall).toBe(true);
    const currentOption = h.state.options.find(option => option.status === "pending");
    expect(currentOption).toBeDefined();
    expect(currentOption?.selectionToken).not.toBe(original.selectionToken);
    expect(currentOption?.sentAt).toBeFalsy();
  });

  it("exposes offer state with allocation-detail visibility disabled", async () => {
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.allocationVisibilityEnabled = false;
    h.state.client.status = "OptionsSent";
    h.state.options = [{
      ...h.state.options[0],
      status: "declined",
    }];

    const response = await request("/api/clients");

    expect(response.status).toBe(200);
    const listedClient = response.body.find((client: any) => client.id === h.state.client.id);
    expect(listedClient.allocationOfferState).toBe("declined");
    expect(listedClient).not.toHaveProperty("allocationVisibility");
    expect(listedClient.allocationOfferEligibility).toBeNull();
  });

  it.each([
    ["available", {}, 1],
    ["booked", { isBooked: true }, 0],
    ["expired", { date: "2000-01-01" }, 0],
    ["foreign slot", { tenantId: "tenant-b" }, 0],
  ])("shows %s pending slot eligibility on the staff list without changing history", async (_, changes, availableCount) => {
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.allocationVisibilityEnabled = false;
    h.state.client.needsCall = true;
    Object.assign(h.state.slot, changes);
    const response = await request("/api/clients");
    expect(response.status).toBe(200);
    const listedClient = response.body.find((client: any) => client.id === h.state.client.id);
    expect(listedClient.status).toBe("OptionsSent");
    expect(listedClient.needsCall).toBe(true);
    expect(listedClient.allocationOfferState).toBe("pending");
    expect(listedClient.allocationOfferEligibility).toEqual({
      pendingCount: 1, availableCount, unavailableCount: 1 - availableCount,
    });
    expect(listedClient).not.toHaveProperty("allocationVisibility");
    expect(JSON.stringify(response.body)).not.toContain("selection-token-a");
    expect(h.state.options[0].status).toBe("pending");
  });

  it("reports mixed pending eligibility without reopening a closed public link", async () => {
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.allocationVisibilityEnabled = false;
    h.state.options.push(
      { ...h.state.options[0], id: "option-missing", slotId: "missing-slot", selectionToken: "missing-token" },
      { ...h.state.options[0], id: "option-old", status: "unavailable", selectionToken: "closed-token" },
      { ...h.state.options[0], id: "option-foreign", tenantId: "tenant-b", selectionToken: "foreign-token" },
    );
    const response = await request("/api/clients");
    const listedClient = response.body.find((client: any) => client.id === h.state.client.id);
    expect(listedClient.allocationOfferEligibility).toEqual({
      pendingCount: 2, availableCount: 1, unavailableCount: 1,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/selection-token-a|missing-token|closed-token|foreign-token/);
    expect((await request("/api/public/options/closed-token")).status).toBe(410);
    expect(h.state.options.find((option: any) => option.id === "option-old").status).toBe("unavailable");
  });

  it("offers a future one-off appointment and lets the client select it", async () => {
    h.state.options = [];
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.tenant.autoAllocationEmailEnabled = true;
    h.state.slot.date = "2999-09-10";

    const offer = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });

    expect(offer.status).toBe(200);
    expect(h.state.options).toHaveLength(1);
    expect(h.state.options[0].status).toBe("pending");
    expect(h.state.client.status).toBe("OptionsSent");

    const selection = await request(`/api/public/options/${h.state.options[0].selectionToken}/select`, {
      method: "POST",
      body: JSON.stringify({ clinicianOptionId: h.state.options[0].id }),
    });

    expect(selection.status).toBe(200);
    expect(selection.body.registrationUrl).toMatch(/^\/register\/client-a\//);
    expect(h.state.client.status).toBe("OptionSelected");
    expect(h.state.slot.isBooked).toBe(true);
  });

  it.each([
    ["a past one-off appointment", { type: "SpecificDate", date: "2000-01-01" }],
    ["an expired recurring window", { type: "Recurring", date: null, endDate: "2000-01-01" }],
    ["a vacation", { type: "Vacation", date: null }],
    ["a retired slot", { retiredAt: new Date(), date: null }],
    ["a booked slot", { isBooked: true, date: null }],
    ["a malformed one-off date", { type: "SpecificDate", date: "2026-02-30" }],
  ])("does not offer %s", async (_description, slotPatch) => {
    h.state.options = [];
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    Object.assign(h.state.slot, slotPatch);

    const response = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });

    expect(response.status).toBe(409);
    expect(h.state.options).toHaveLength(0);
    expect(h.state.client.status).toBe("FormsCompleted");
  });

  it("rechecks offer eligibility after locking the slot", async () => {
    h.state.options = [];
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.slotChangeBeforeTransaction = { retiredAt: new Date() };

    const response = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });

    expect(response.status).toBe(409);
    expect(h.state.slot.retiredAt).toBeInstanceOf(Date);
    expect(h.state.options).toHaveLength(0);
    expect(h.state.client.status).toBe("FormsCompleted");
  });

  it.each([false, true])("allows a future recurring window through the portal with multi-clinician workflow=%s", async multiClinician => {
    h.state.tenant.multiClinicianAllocationEnabled = multiClinician;
    Object.assign(h.state.slot, {
      type: "Recurring",
      date: null,
      day: "Monday",
      startDate: "2999-01-01",
    });

    const portal = await request("/api/public/options/selection-token-a");
    expect(portal.status).toBe(200);
    expect(portal.body.options[0].available).toBe(true);

    const selection = await request("/api/public/options/selection-token-a/select", {
      method: "POST",
      body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });

    expect(selection.status).toBe(200);
    expect(h.state.client.status).toBe("OptionSelected");
    expect(h.state.options[0].status).toBe("selected");
    expect(h.state.slot.isBooked).toBe(true);
    expect(h.state.slot.startDate).toBe("2999-01-01");
  });

  it("allows staff to offer a pending recurring slot without bringing forward its availability", async () => {
    h.state.options = [];
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    Object.assign(h.state.slot, { type: "Recurring", date: null, startDate: "2999-01-01" });
    const response = await request("/api/clients/client-a/allocate-options", {
      method: "POST", body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect(response.status).toBe(200);
    expect(h.state.options).toHaveLength(1);
    expect(h.state.slot.startDate).toBe("2999-01-01");
    expect(h.state.slot.isBooked).toBe(false);
  });

  it("does not claim a slot that becomes unavailable before selection locks it", async () => {
    h.state.slotChangeBeforeTransaction = { isBooked: true };

    const response = await request("/api/public/options/selection-token-a/select", {
      method: "POST",
      body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });

    expect(response.status).toBe(409);
    expect(h.state.client.status).toBe("OptionsSent");
    expect(h.state.options[0].status).toBe("pending");
    expect(h.state.slot.isBooked).toBe(true);
  });

  it("rejects a slot belonging to another tenant when creating or selecting an offer", async () => {
    h.state.options = [];
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.slot.tenantId = "tenant-b";

    const offer = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });
    expect(offer.status).toBe(403);
    expect(h.state.options).toHaveLength(0);

    h.state.client.status = "OptionsSent";
    h.state.options = [{
      id: "option-a", clientId: "client-a", clinicianId: "clinician-a", slotId: "slot-a",
      tenantId: "tenant-a", status: "pending", selectionToken: "selection-token-a",
    }];
    const selection = await request("/api/public/options/selection-token-a/select", {
      method: "POST",
      body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });
    expect(selection.status).toBe(409);
    expect(h.state.client.status).toBe("OptionsSent");
    expect(h.state.slot.isBooked).toBe(false);
  });

  it("does not let a foreign tenant's option token decline this client's current offer", async () => {
    h.state.options = [{
      id: "foreign-option", clientId: "client-a", clinicianId: "clinician-a", slotId: "slot-a",
      tenantId: "tenant-b", status: "pending", selectionToken: "foreign-option-token",
    }];
    h.state.client.needsAdminCall = false;

    const decline = await request("/api/public/options/foreign-option-token/select", {
      method: "POST",
      body: JSON.stringify({ decline: true }),
    });

    expect(decline.status).toBe(404);
    expect(h.state.options[0].status).toBe("pending");
    expect(h.state.client.needsAdminCall).toBe(false);
    expect(h.state.activities).toHaveLength(0);
  });

  it("requires an explicit tenant owner when creating an offer", async () => {
    h.state.options = [];
    h.state.client.status = "FormsCompleted";
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.slot.tenantId = null;

    const response = await request("/api/clients/client-a/allocate-options", {
      method: "POST",
      body: JSON.stringify({ selections: [{ clinicianId: "clinician-a", slotId: "slot-a" }] }),
    });

    expect(response.status).toBe(403);
    expect(h.state.options).toHaveLength(0);
    expect(h.state.client.status).toBe("FormsCompleted");
  });

  it("refuses to resend options whose slot has expired", async () => {
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.client.status = "OptionsSent";
    Object.assign(h.state.slot, { type: "SpecificDate", date: "2000-01-01" });

    const response = await request("/api/clients/client-a/resend-allocation-options", {
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/no longer available/i);
    expect(h.state.emails).toHaveLength(0);
  });

  it("does not include another tenant's pending options in a resend", async () => {
    h.state.tenant.multiClinicianAllocationEnabled = true;
    h.state.client.status = "OptionsSent";
    h.state.options = [{
      ...h.state.options[0], tenantId: "tenant-b", selectionToken: "foreign-token",
    }];

    const response = await request("/api/clients/client-a/resend-allocation-options", {
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/no active pending offer|no allocation options/i);
    expect(h.state.emails).toHaveLength(0);
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

  it.each(["OptionSelected", "RegistrationPending"])("returns %s to Forms Completed despite missing historic intake delivery", async (status) => {
    const completedAt = new Date("2026-08-01T12:00:00Z");
    resetState({
      tenant: { intakeFormTemplateId: "intake-a", intakeClientSummaryEnabled: true },
      client: {
        status, formsCompletedAt: completedAt, registrationToken: "old-registration-token",
        registrationTokenExpiresAt: new Date(Date.now() + 60_000),
        registrationEmailSentAt: new Date(), registrationEmailAttemptKey: "old-attempt",
        registrationEmailClaimId: "old-claim", registrationEmailPendingToken: "pending-token",
      },
    });
    h.state.slot.isBooked = true;
    h.state.options[0].status = "selected";
    h.state.submissions = [{
      id: "historic-intake", clientId: "client-a", formTemplateId: "intake-a", isDraft: false,
    }];
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Forms Completed" }),
    });
    expect(response.status).toBe(200);
    expect(h.state.client).toMatchObject({
      status: "Forms Completed", assignedSlotId: null, assignedClinicianId: null,
      assignedSlot: null, formsCompletedAt: completedAt, registrationToken: null,
      registrationTokenExpiresAt: null, registrationEmailSentAt: null,
      registrationEmailAttemptKey: null, registrationEmailClaimId: null,
      registrationEmailPendingToken: null,
    });
    expect(h.state.client.registrationTokenRevokedAt).toBeInstanceOf(Date);
    expect(h.state.slot.isBooked).toBe(false);
    expect(h.state.options[0].status).toBe("unavailable");
    expect(h.state.submissions[0].id).toBe("historic-intake");
    expect(h.state.deliveries).toEqual([]);
    expect(h.state.emails.filter(email => email.to === "client@example.test")).toEqual([]);
    const oldRegistration = await request("/api/public/register/client-a/old-registration-token");
    expect(oldRegistration.status).toBe(403);
    expect(oldRegistration.body.error).toBe("Invalid or expired token");
    const oldSelection = await request("/api/public/options/selection-token-a/select", {
      method: "POST", body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });
    expect(oldSelection.status).toBe(410);
    expect(h.state.slot.isBooked).toBe(false);
  });

  it("still blocks first-time intake completion when the designated intake was not delivered", async () => {
    resetState({
      tenant: { intakeFormTemplateId: "intake-a", intakeClientSummaryEnabled: true },
      client: { status: "Forms Sent" },
    });
    h.state.registrationTemplate = { id: "intake-a", tenantId: "tenant-a", title: "Intake" };
    h.state.submissions = [{
      id: "intake-submission", clientId: "client-a", formTemplateId: "intake-a", isDraft: false,
    }];
    const response = await request("/api/clients/client-a", {
      method: "PATCH", body: JSON.stringify({ status: "Forms Completed" }),
    });
    expect(response.status).toBe(400);
    expect(response.body.blocker.state).toBe("not_delivered");
    expect(h.state.client.status).toBe("Forms Sent");
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
      date: "2999-09-10",
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
    expect(h.state.client.status).toBe("OptionsSent");
    expect(h.state.slot.isBooked).toBe(false);
    expect(h.state.options[0].status).toBe("pending");
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

describe.each([false, true])("held booking payment HTTP fences with reconciliation=%s", reconciliation => {
  function heldPayment() {
    resetState({
      tenant: { id: CYA, paymentsEnabled: true, paymentReconciliationEnabled: reconciliation, flexibleBookingEnabled: true },
      client: {
        tenantId: CYA, status: "RegistrationPending", paymentType: "self_pay", paymentStatus: "setup_pending",
        registrationToken: "registration-token", registrationTokenExpiresAt: new Date(Date.now() + 60_000),
        registrationPaymentAttemptKey: ATTEMPT_KEY, stripePaymentLinkId: "plink_current",
        stripeCheckoutUrl: "https://pay.test/current",
      },
    });
    h.state.slot.tenantId = CYA;
    h.state.slot.isBooked = true;
    h.state.clinician.tenantId = CYA;
    h.state.reservations = [{
      id: "hold", tenantId: CYA, clientId: "client-a", slotId: "slot-a", clinicianId: "clinician-a",
      status: "active", deadline: new Date(Date.now() + 60_000), createdAt: new Date(),
      paymentAttemptKey: ATTEMPT_KEY, paymentLinkId: "plink_current",
    }];
    h.state.stripeLinkActive = false;
  }
  it.each(["public registration", "staff resend"])("never replaces an inactive reservation link through %s", async path => {
    heldPayment();
    const response = path === "public registration"
      ? await request("/api/public/register/client-a/registration-token", { method: "POST", body: JSON.stringify({ paymentType: "self_pay" }) })
      : await request("/api/clients/client-a/resend-payment-link", { method: "POST" });
    expect(response.status).toBe(409);
    expect(h.state.client.stripePaymentLinkId).toBe("plink_current");
    expect(h.state.client.registrationPaymentAttemptKey).toBe(ATTEMPT_KEY);
    expect(h.state.paymentLinks).toHaveLength(0);
    expect(h.state.emails).toHaveLength(0);
    expect(h.state.reservations[0].paymentLinkId).toBe("plink_current");
  });
  it("pins a resumed setup link to the existing hold and never creates a new attempt", async () => {
    heldPayment();
    Object.assign(h.state.client, { stripePaymentLinkId: null, stripeCheckoutUrl: null, registrationFormSubmissionId: "submission" });
    h.state.reservations[0].paymentLinkId = null;
    const response = await request("/api/clients/client-a/retry-payment-setup", { method: "POST" });
    expect(response.status).toBe(200);
    expect(h.state.paymentLinks).toHaveLength(1);
    expect(h.state.reservations[0]).toMatchObject({ paymentAttemptKey: ATTEMPT_KEY, paymentLinkId: "plink_1" });
    expect(h.state.paymentLinks[0]).toMatchObject({
      registrationAttemptKey: ATTEMPT_KEY, tenantOwnedOnly: true,
      idempotencyKey: `registration-payment-client-a-${ATTEMPT_KEY}`,
    });
  });
  it("pins initial registration before Stripe is called and reuses it on retry", async () => {
    heldPayment();
    h.state.stripeLinkActive = true;
    Object.assign(h.state.client, { status: "OptionSelected", paymentType: null, paymentStatus: "none", registrationPaymentAttemptKey: null, stripePaymentLinkId: null, stripeCheckoutUrl: null });
    Object.assign(h.state.reservations[0], { paymentAttemptKey: null, paymentLinkId: null });
    h.state.tenant.registrationFormTemplateId = "registration";
    h.state.registrationTemplate = {
      id: "registration", tenantId: CYA, title: "Registration", description: "Test",
      updatedAt: new Date("2026-09-06T12:00:00.000Z"),
      fields: [
        { id: "terms-copy", type: "info", content: "Registration terms" },
        { id: "agreement", type: "radio", label: "I agree to the terms and conditions", required: true, options: ["Yes"], isTermsAcceptance: true },
      ],
    };
    const { createPaymentLink } = await import("./stripe");
    vi.mocked(createPaymentLink).mockImplementationOnce(async input => {
      expect(h.state.reservations[0].paymentAttemptKey).toBe(input.registrationAttemptKey);
      expect(h.state.reservations[0].paymentLinkId).toBeNull();
      h.state.paymentLinks.push(input);
      return h.state.paymentResult;
    });
    const body = JSON.stringify({ paymentType: "self_pay", termsVersion: 4,
      registrationTemplateUpdatedAt: "2026-09-06T12:00:00.000Z", registrationResponses: { agreement: "Yes" } });
    const first = await request("/api/public/register/client-a/registration-token", { method: "POST", body });
    expect(first.status).toBe(200);
    expect(h.state.reservations[0]).toMatchObject({ paymentAttemptKey: h.state.client.registrationPaymentAttemptKey, paymentLinkId: "plink_1" });
    expect((await request("/api/public/register/client-a/registration-token", { method: "POST", body })).status).toBe(200);
    expect(h.state.paymentLinks).toHaveLength(1);
  });
  it("acknowledges duplicate earlier-link webhooks without releasing or confirming a replaced attempt", async () => {
    heldPayment();
    Object.assign(h.state.client, { registrationPaymentAttemptKey: "new-attempt", stripePaymentLinkId: "new-link" });
    const { constructWebhookEvent } = await import("./stripe");
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_old", type: "checkout.session.completed",
      data: { object: { id: "cs_old", status: "complete", payment_status: "paid", payment_link: "plink_current", payment_intent: "pi_old",
        metadata: { tenantId: CYA, clientId: "client-a", registrationAttemptKey: ATTEMPT_KEY } } },
    } as any);
    const send = () => request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "valid" }, body: JSON.stringify({ id: "evt_old" }),
    });
    expect((await Promise.all([send(), send()])).map(response => response.status)).toEqual([200, 200]);
    expect(h.state.reservations[0]).toMatchObject({ status: "payment_review", paymentAttemptKey: ATTEMPT_KEY, paymentLinkId: "plink_current" });
    expect(h.state.client.paymentStatus).toBe("setup_pending");
    expect(h.state.slot.isBooked).toBe(true);
    expect(h.state.bookingSnapshots).toHaveLength(0);
    expect(h.state.charges).toHaveLength(0);
    expect(h.state.deactivatedLinks).toHaveLength(0);
  });
  it("does not let a current-link webhook bypass review of an earlier attempt when the flag is off", async () => {
    heldPayment();
    Object.assign(h.state.client, { registrationPaymentAttemptKey: "new-attempt", stripePaymentLinkId: "new-link" });
    const { constructWebhookEvent } = await import("./stripe");
    vi.mocked(constructWebhookEvent).mockReturnValue({
      id: "evt_new", type: "checkout.session.completed",
      data: { object: { id: "cs_new", status: "complete", payment_status: "paid", payment_link: "new-link", payment_intent: "pi_new",
        metadata: { tenantId: CYA, clientId: "client-a", registrationAttemptKey: "new-attempt" } } },
    } as any);
    const response = await request("/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "valid" }, body: JSON.stringify({ id: "evt_new" }),
    });
    expect(response.status).toBe(503);
    expect(h.state.client.paymentStatus).toBe("setup_pending");
    expect(h.state.slot.isBooked).toBe(true);
    expect(h.state.bookingSnapshots).toHaveLength(0);
    expect(h.state.charges).toHaveLength(0);
    expect(h.state.deactivatedLinks).toHaveLength(0);
  });
});
