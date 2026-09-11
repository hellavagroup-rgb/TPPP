import express from "express";
import { createServer, type Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    slotClaimFails: false,
    stripeLinkActive: true,
    emailResult: { success: true, outcome: "accepted" } as any,
    paymentResult: { url: "https://pay.test/session", paymentLinkId: "plink_1" } as any,
  };

  const tableName = (table: any) => {
    const symbol = Object.getOwnPropertySymbols(table).find(s => s.description === "drizzle:Name");
    return symbol ? table[symbol] : "";
  };

  const rowsFor = (table: any) => {
    switch (tableName(table)) {
      case "clients": return state.client?.id ? [state.client] : [];
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
      default: return [];
    }
  };

  const chain = (run: () => any[]) => {
    let result: any[] | undefined;
    const execute = () => result ??= run();
    const builder: any = {
      where: () => builder,
      limit: (count: number) => Promise.resolve(execute().slice(0, count)),
      returning: () => Promise.resolve(execute()),
      then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject),
    };
    return builder;
  };

  const db: any = {
    select: () => ({
      from: (table: any) => chain(() => rowsFor(table)),
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
        }
        const result: any = {
          returning: () => Promise.resolve(inserted),
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
            if (patch.status !== "declined" || option.status === "pending") Object.assign(option, patch);
          }
          return state.options;
        }
        if (name !== "clients") return [];

        if (patch.registrationEmailClaimId && state.client.registrationEmailSendingAt
          && state.client.registrationEmailSendingAt > new Date(Date.now() - 5 * 60 * 1000)) return [];
        if (patch.status === "RegistrationPending" && state.client.status !== "OptionSelected") return [];
        if (patch.status === "BookingConfirmed" && !["OptionsSent", "RegistrationPending"].includes(state.client.status)) return [];
        if (patch.stripeCheckoutUrl && state.client.stripeCheckoutUrl) return [];
        Object.assign(state.client, patch);
        return [state.client];
      }),
    }),
    transaction: async (callback: any) => callback(db),
  };

  const storage: any = new Proxy({
    getClientById: vi.fn(async () => state.client?.id ? { ...state.client } : undefined),
    getTenantById: vi.fn(async () => state.tenant?.id ? { ...state.tenant } : undefined),
    getClientClinicianOptionByToken: vi.fn(async (token: string) =>
      state.options.find(option => option.selectionToken === token)),
    getClientClinicianOptions: vi.fn(async () => state.options.map(option => ({ ...option }))),
    getFormSubmissionsByClientId: vi.fn(async (clientId: string) =>
      state.submissions.filter(submission => submission.clientId === clientId).map(submission => ({ ...submission }))),
    getFormTemplateById: vi.fn(async (id: string) =>
      state.registrationTemplate?.id === id ? { ...state.registrationTemplate } : undefined),
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
vi.mock("./storage", () => ({ storage: h.storage }));
vi.mock("./auth", () => {
  const pass = (req: any, res: any, next: any) => {
    req.user = { id: "admin-1", name: "Admin", role: "admin", tenantId: req.tenant?.id };
    next();
  };
  return {
    setupAuth: vi.fn(),
    requireAuth: pass,
    requireAdmin: pass,
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
  getStripeInstance: vi.fn(() => ({
    paymentLinks: {
      retrieve: vi.fn(async () => ({ active: h.state.stripeLinkActive })),
    },
  })),
  createPaymentLink: vi.fn(async (input: any) => {
    h.state.paymentLinks.push(input);
    return h.state.paymentResult;
  }),
  chargeOffSession: vi.fn(),
  constructWebhookEvent: vi.fn(),
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
    bookingConfirmedEmailEnabled: true,
    ...overrides.tenant,
  };
  h.state.client = {
    id: "client-a",
    displayId: "A-001",
    tenantId: "tenant-a",
    email: "client@example.test",
    status: "OptionsSent",
    assignedClinicianId: null,
    assignedSlotId: null,
    agreedRatePence: 12000,
    registrationToken: null,
    registrationTokenExpiresAt: null,
    registrationTokenRevokedAt: null,
    registrationEmailSentAt: null,
    registrationEmailSendingAt: null,
    registrationEmailAttemptKey: null,
    registrationEmailClaimId: null,
    registrationPaymentAttemptKey: null,
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
    type: "SpecificDate", date: "2026-09-10", startTime: "10:00", endTime: "11:00",
  };
  h.state.clinician = { id: "clinician-a", tenantId: "tenant-a", userId: "user-a", zoomLink: null };
  h.state.activities = [];
  h.state.emails = [];
  h.state.paymentLinks = [];
  h.state.registrationTemplate = null;
  h.state.submissions = [];
  h.state.slotClaimFails = false;
  h.state.stripeLinkActive = true;
  h.state.emailResult = { success: true, outcome: "accepted" };
  h.state.paymentResult = { url: "https://pay.test/session", paymentLinkId: "plink_1" };
  vi.clearAllMocks();
}

beforeEach(async () => {
  resetState();
  process.env.APP_BASE_URL = "https://app.test";
  const app = express();
  app.use(express.json());
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
    expect(h.state.options).toHaveLength(0);
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
    expect(h.state.options).toHaveLength(1);
    expect(h.state.options[0].selectionToken).not.toMatch(/^stale-token-/);
    expect(h.state.emails).toHaveLength(1);
    expect(h.state.emails[0].html).toContain("Option 1:");
    expect(h.state.emails[0].html).not.toContain("Option 2:");
  });

  it("automatically moves option selection into registration exactly once", async () => {
    const first = await request("/api/public/options/selection-token-a/select", {
      method: "POST", body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });
    const retry = await request("/api/public/options/selection-token-a/select", {
      method: "POST", body: JSON.stringify({ clinicianOptionId: "option-a" }),
    });

    expect(first.status).toBe(200);
    expect(first.body.registrationUrl).toMatch(/^\/register\/client-a\//);
    expect(retry.body).toMatchObject({ registrationUrl: first.body.registrationUrl, idempotent: true });
    expect(h.state.client.status).toBe("OptionSelected");
    expect(h.state.activities.filter(a => a.action === "activity_appointment_option_selected")).toHaveLength(1);
    expect(h.state.emails).toHaveLength(0);
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
    expect(h.state.emails).toHaveLength(1);
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

    resetState({ client: {
      status: "Assigned", assignedClinicianId: "clinician-a", assignedSlotId: "slot-a",
      registrationEmailAttemptKey: ATTEMPT_KEY,
      registrationEmailSendingAt: new Date(Date.now() - 10 * 60 * 1000),
    } });
    const recovered = await request("/api/clients/client-a/send-registration", {
      method: "POST", body: JSON.stringify({ attemptKey: "different-attempt-654321" }),
    });
    expect(recovered.status).toBe(200);
    expect(h.state.emails[0].idempotencyKey).toBe(`registration-client-a-${ATTEMPT_KEY}`);
    expect(h.state.activities.filter(a => a.action === "activity_registration_sent")).toHaveLength(1);
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
    expect(h.state.client.status).toBe("OptionSelected");

    h.state.client.agreedRatePence = 12000;
    const stripe = await import("./stripe");
    vi.mocked(stripe.isStripeConfigured).mockReturnValue(false);
    const noStripe = await request("/api/public/register/client-a/registration-token", { method: "POST", body: payload });
    expect(noStripe.status).toBe(503);
    expect(h.state.client.status).toBe("OptionSelected");
    vi.mocked(stripe.isStripeConfigured).mockReturnValue(true);

    h.state.tenant.paymentsEnabled = false;
    const disabled = await request("/api/public/register/client-a/registration-token", { method: "POST", body: payload });
    expect(disabled.status).toBe(200);
    expect(h.state.client.status).toBe("BookingConfirmed");
    expect(h.state.submissions).toHaveLength(1);
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
