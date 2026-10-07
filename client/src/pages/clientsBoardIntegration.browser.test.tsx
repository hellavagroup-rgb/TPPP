// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Clients from "./clients";

const uiSignals = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: uiSignals.toast }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "admin-test", name: "Board Admin", role: "admin" },
    isLoading: false,
  }),
}));

vi.mock("@/lib/operationalRefresh", () => ({
  invalidateOperationalData: vi.fn(async (client: QueryClient) => {
    await client.invalidateQueries({ queryKey: ["/api/clients"] });
  }),
  useOperationalRefresh: () => ({ refresh: vi.fn(), lastUpdated: null }),
}));

type ClientFixture = Record<string, any> & {
  id: string;
  displayId: string;
  status: string;
};

type HistoricFixture = {
  id: string;
  displayId: string;
  status: string;
  portalSnapshot: boolean;
  portalConfirmedAt: string | null;
  bookingEmailAcceptedAt: string | null;
  portalBookingEvent: boolean;
  optionSelectionEvent: boolean;
  allocation: "missing" | "invalid" | "duplicate" | "reserved";
  slot: null;
  intakeSubmitted: boolean;
  registrationSubmitted: boolean;
  consentEvidence: "not_recorded";
  paymentType: string | null;
  paymentStatus: string | null;
  chargeStatuses: string[];
  writeuppArranged: boolean;
  externalReview: Record<string, unknown> | null;
};

const apiFixtures: {
  tenant: Record<string, unknown>;
  clients: ClientFixture[];
  historicRows: HistoricFixture[];
} = { tenant: {}, clients: [], historicRows: [] };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function makeTenant(flags: Record<string, unknown> = {}) {
  return {
    id: "tenant-1",
    name: "Tenant 1",
    formsEnabled: false,
    intakeFormId: null,
    registrationFormId: null,
    registrationFormEnabled: false,
    nonEngagementEnabled: false,
    multiClinicianAllocationEnabled: true,
    ...flags,
  };
}

function makeClient(id: string, displayId: string, status: string): ClientFixture {
  return {
    id,
    tenantId: "tenant-1",
    displayId,
    status,
    intakeDate: "2026-01-10T12:00:00.000Z",
    insurer: "Private",
    isArchived: false,
    completedAt: null,
    notes: null,
  };
}

function makeHistoricRow(
  client: ClientFixture,
  flags: Partial<HistoricFixture> = {},
): HistoricFixture {
  return {
    id: client.id,
    displayId: client.displayId,
    status: client.status,
    portalSnapshot: false,
    portalConfirmedAt: null,
    bookingEmailAcceptedAt: null,
    portalBookingEvent: false,
    optionSelectionEvent: false,
    allocation: "missing",
    slot: null,
    intakeSubmitted: false,
    registrationSubmitted: false,
    consentEvidence: "not_recorded",
    paymentType: null,
    paymentStatus: null,
    chargeStatuses: [],
    writeuppArranged: false,
    externalReview: null,
    ...flags,
  };
}

function paymentReviewFixture() {
  const client = makeClient("payment-review", "PAY-101", "BookingConfirmed");
  Object.assign(client, {
    confirmedAt: "2026-01-12T10:00:00Z",
    bookingSnapshot: { id: "booking-review", clinicianName: "Fixture clinician" },
    writeuppAppointmentConfirmed: true, writeuppDataTransferred: true,
    paymentType: "self_pay", paymentStatus: "setup_pending",
    stripePaymentLinkId: "plink_fixture", registrationPaymentAttemptKey: "attempt-fixture",
    notes: "Payment completed outside the current portal workflow.",
  });
  return client;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: async ({ queryKey }) => {
          const response = await fetch(queryKey.join("/"));
          if (!response.ok) throw new Error(await response.text());
          return response.json();
        },
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        gcTime: 0,
      },
      mutations: { retry: false },
    },
  });
}

function renderBoard(options: { historicCache?: HistoricFixture[] } = {}) {
  const client = makeQueryClient();
  if (options.historicCache) {
    client.setQueryData(["/api/historic-reconciliation"], options.historicCache);
  }
  const view = render(
    <QueryClientProvider client={client}>
      <Clients />
    </QueryClientProvider>,
  );
  return { ...view, queryClient: client };
}

describe("Clients page compact board integration", () => {
  const queryClients: QueryClient[] = [];

  beforeEach(() => {
    uiSignals.toast.mockClear();
    apiFixtures.tenant = makeTenant();
    apiFixtures.clients = [];
    apiFixtures.historicRows = [];

    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    Element.prototype.scrollIntoView = vi.fn();

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      switch (url.pathname) {
        case "/api/tenant":
          return json(apiFixtures.tenant);
        case "/api/clients":
          return json(apiFixtures.clients);
        case "/api/clinicians":
        case "/api/forms":
        case "/api/non-engagement-categories":
        case "/api/insurers":
        case "/api/stripe/webhook-failures":
          return json([]);
        case "/api/stripe/status":
          return json({ connected: false, configured: false });
        case "/api/historic-reconciliation":
          return json(apiFixtures.historicRows);
        default:
          return json({ error: `Unexpected test API request: ${url.pathname}` }, 404);
      }
    }));
  });

  afterEach(() => {
    cleanup();
    queryClients.splice(0).forEach(client => client.clear());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([404, 500, 200])("shows the correct original enquiry state for HTTP %s", async (status) => {
    apiFixtures.clients = [makeClient("enquiry-client", "ENQ-101", "New")];
    const ordinaryFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const pathname = new URL(String(input), window.location.origin).pathname;
      if (pathname === "/api/clients/enquiry-client/intake-message") {
        return json(status === 200
          ? { id: "enquiry-1", fromAddress: "sender@example.com", body: "Original fixture enquiry" }
          : { error: status === 404 ? "No linked intake message" : "Failed to fetch intake message" }, status);
      }
      return ordinaryFetch(input, init);
    });
    const view = renderBoard();
    queryClients.push(view.queryClient);
    const user = userEvent.setup();
    const card = await screen.findByTestId("kanban-card-enquiry-client");
    await user.click(within(card).getByRole("button", { expanded: false }));
    await user.click(await screen.findByRole("menuitem", { name: "View Original Enquiry" }));
    const dialog = await screen.findByRole("dialog");
    if (status === 404) {
      await within(dialog).findByText(/No original enquiry is linked to this client/);
      expect(within(dialog).queryByText("Failed to load original enquiry.")).toBeNull();
    } else if (status === 500) {
      await within(dialog).findByText("Failed to load original enquiry.");
      expect(within(dialog).queryByText(/No original enquiry is linked/)).toBeNull();
    } else {
      await within(dialog).findByText("Original fixture enquiry");
      expect(within(dialog).queryByText(/No original enquiry is linked/)).toBeNull();
    }
  });

  it("keeps legacy confirmation pending state per client, shows failures and moves successful confirmations", async () => {
    apiFixtures.tenant = makeTenant({ multiClinicianAllocationEnabled: false });
    const first = makeClient("legacy-first", "LEG-101", "AwaitingConfirmation");
    const second = makeClient("legacy-second", "LEG-102", "AwaitingConfirmation");
    apiFixtures.clients = [first, second];
    const pending = new Map<string, (response: Response) => void>();
    const submitted: { id: string; body: unknown }[] = [];
    const ordinaryFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const pathname = new URL(String(input), window.location.origin).pathname;
      if (init?.method === "PATCH" && pathname.startsWith("/api/clients/legacy-")) {
        const id = pathname.split("/").at(-1)!;
        submitted.push({ id, body: JSON.parse(String(init.body)) });
        return new Promise<Response>(resolve => pending.set(id, resolve));
      }
      return ordinaryFetch(input, init);
    });
    const view = renderBoard();
    queryClients.push(view.queryClient);
    const user = userEvent.setup();
    const firstCard = await screen.findByTestId("kanban-card-legacy-first");
    const secondCard = await screen.findByTestId("kanban-card-legacy-second");
    await user.click(within(firstCard).getByRole("button", { name: "Mark as Confirmed" }));
    await waitFor(() => expect(pending.has(first.id)).toBe(true));
    expect((within(firstCard).getByRole("button", { name: "Confirming…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(secondCard).getByRole("button", { name: "Mark as Confirmed" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(within(secondCard).getByRole("button", { name: "Mark as Confirmed" }));
    await waitFor(() => expect(pending.has(second.id)).toBe(true));
    expect((within(firstCard).getByRole("button", { name: "Confirming…" }) as HTMLButtonElement).disabled).toBe(true);
    pending.get(first.id)!(json({ error: "The appointment could not be confirmed. Please try again." }, 500));
    await waitFor(() => expect(uiSignals.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Client not confirmed", variant: "destructive",
      description: "The appointment could not be confirmed. Please try again.",
    })));
    expect((within(firstCard).getByRole("button", { name: "Mark as Confirmed" }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(secondCard).getByRole("button", { name: "Confirming…" }) as HTMLButtonElement).disabled).toBe(true);
    second.status = "Scheduled";
    pending.get(second.id)!(json(second));
    await waitFor(() => expect(within(screen.getByTestId("kanban-card-legacy-second"))
      .queryByRole("button", { name: "Mark as Confirmed" })).toBeNull());
    expect(submitted).toEqual([
      { id: first.id, body: { status: "Scheduled" } },
      { id: second.id, body: { status: "Scheduled" } },
    ]);
    expect(uiSignals.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Client confirmed" }));
  });

  it.each([
    ["paid_unrecorded", "Payment found — portal recording needs review"],
    ["uncertain", "Unable to verify payment"],
    ["request-error", "Unable to verify payment"],
  ])("opens payment review and checks %s read-only without completing or charging the client", async (state, label) => {
    apiFixtures.tenant = makeTenant({
      completedBookingsEnabled: true, writeuppChecklistEnabled: true, paymentReconciliationEnabled: true,
    });
    const client = paymentReviewFixture();
    apiFixtures.clients = [client];
    const before = structuredClone(client);
    const ordinaryFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === `/api/clients/${client.id}/payment-reconciliation`) {
        if (state === "request-error") return json({ error: "Stripe verification is unavailable. Review existing payment records." }, 502);
        return json({ state, detail: "Read-only provider inspection result." });
      }
      return ordinaryFetch(input, init);
    });
    const view = renderBoard();
    queryClients.push(view.queryClient);
    const user = userEvent.setup();
    const card = await screen.findByTestId("kanban-card-payment-review");
    expect(card.textContent).toContain("Staff action");
    expect(card.textContent).not.toContain("Waiting for booking requirements");
    await user.click(within(card).getByRole("button", { name: "Review payment record" }));
    const review = await screen.findByTestId("payment-review-payment-review");
    expect(review.textContent).toContain("This warning does not prove the client is unpaid");
    expect(review.textContent).toContain("not therapy");
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("payment-reconciliation"))).toHaveLength(0);
    await user.click(within(review).getByRole("button", { name: "Check Stripe payment (read-only)" }));
    await waitFor(() => expect(within(review).getByTestId("payment-review-result-payment-review").textContent).toContain(label));
    const inspections = vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("payment-reconciliation"));
    expect(inspections).toHaveLength(1);
    expect(inspections[0][1]?.method).toBe("GET");
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => ["POST", "PATCH", "DELETE", "PUT"].includes(init?.method || "GET"))).toBe(false);
    expect(within(review).queryByRole("button", { name: /Reconcile|Send|Complete/i })).toBeNull();
    expect(apiFixtures.clients[0]).toEqual(before);
  });

  it("refreshes an already verified portal payment without recording or completing anything", async () => {
    apiFixtures.tenant = makeTenant({
      completedBookingsEnabled: true, writeuppChecklistEnabled: true, paymentReconciliationEnabled: true,
    });
    const client = paymentReviewFixture();
    apiFixtures.clients = [client];
    const ordinaryFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).includes("payment-reconciliation")) {
        return json({ state: "recorded", detail: "The existing payment is already recorded." });
      }
      return ordinaryFetch(input, init);
    });
    const view = renderBoard();
    queryClients.push(view.queryClient);
    const user = userEvent.setup();
    const card = await screen.findByTestId("kanban-card-payment-review");
    await user.click(within(card).getByRole("button", { name: "Review payment record" }));
    const review = await screen.findByTestId("payment-review-payment-review");
    // Simulate a separate authorised process having verified the payment while
    // this browser still has its earlier, pending query result.
    client.paymentStatus = "active";
    const serverBeforeReview = structuredClone(client);
    await user.click(within(review).getByRole("button", { name: "Check Stripe payment (read-only)" }));
    await waitFor(() => expect(screen.getByTestId("next-step-payment-review").textContent).toContain("Complete the booking"));
    expect(screen.queryByTestId("payment-review-payment-review")).toBeNull();
    expect(apiFixtures.clients[0]).toEqual(serverBeforeReview);
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => ["POST", "PATCH", "DELETE", "PUT"].includes(init?.method || "GET"))).toBe(false);
  });

  it.each(["missing-reference", "verification-disabled"])("explains %s without offering an invalid Stripe check", async (scenario) => {
    apiFixtures.tenant = makeTenant({
      completedBookingsEnabled: true, writeuppChecklistEnabled: true,
      paymentReconciliationEnabled: scenario !== "verification-disabled",
    });
    const client = paymentReviewFixture();
    if (scenario === "missing-reference") client.registrationPaymentAttemptKey = null;
    apiFixtures.clients = [client];
    const view = renderBoard();
    queryClients.push(view.queryClient);
    const user = userEvent.setup();
    const card = await screen.findByTestId("kanban-card-payment-review");
    await user.click(within(card).getByRole("button", { name: "Review payment record" }));
    const review = await screen.findByTestId("payment-review-payment-review");
    expect(review.textContent).toContain(scenario === "missing-reference"
      ? "no complete current portal payment reference" : "Stripe verification is not enabled");
    expect(within(review).queryByRole("button", { name: /Check Stripe/i })).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("payment-reconciliation"))).toBe(false);
    expect(client.paymentStatus).toBe("setup_pending");
  });

  it("renders one BookingConfirmed card and counts it once, with one detail sheet", async () => {
    const confirmed = makeClient("confirmed-1", "CNF-101", "BookingConfirmed");
    apiFixtures.tenant = makeTenant({ registrationFormEnabled: true });
    apiFixtures.clients = [confirmed];
    apiFixtures.historicRows = [
      makeHistoricRow(confirmed, {
        portalSnapshot: true,
        portalConfirmedAt: "2026-01-12T10:00:00.000Z",
        allocation: "reserved",
      }),
    ];

    const user = userEvent.setup();
    const view = renderBoard();
    queryClients.push(view.queryClient);

    expect(await screen.findByRole("heading", { name: "Booking progress" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Confirmed in portal (1)" })).toBeTruthy();
    expect(screen.getAllByTestId("compact-client-card-confirmed-1")).toHaveLength(1);
    expect(screen.getAllByTestId("kanban-card-confirmed-1")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByTestId("compact-client-card-confirmed-1"));
    const detail = await screen.findByRole("dialog");
    expect(within(detail).getByRole("heading", { name: "CNF-101" })).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getAllByTestId("client-details-confirmed-1")).toHaveLength(1);
  });

  it("does not claim the family is choosing when current offer delivery is unrecorded", async () => {
    const client = makeClient("unsent-offer", "MAT-UNSENT", "OptionsSent");
    client.notes = "Assessment enquiry; appointment options prepared.";
    client.allocationOfferState = { state: "pending", deliveryAcceptedAt: null };
    client.allocationOfferEligibility = { pendingCount: 1, availableCount: 1, unavailableCount: 0 };
    client.allocationVisibility = {
      appointment: null,
      options: [{ status: "pending", clinicianName: "Clinician A", createdAt: "2026-01-09",
        sentAt: "2026-01-09T12:00:00Z", slot: null }],
    };
    apiFixtures.tenant = makeTenant({ allocationVisibilityEnabled: true });
    apiFixtures.clients = [client];
    apiFixtures.historicRows = [];
    const view = renderBoard();
    queryClients.push(view.queryClient);
    const tile = await screen.findByTestId("compact-client-card-unsent-offer");
    expect(tile.textContent).toContain("Next action");
    expect(tile.textContent).not.toContain("Waiting for");
  });

  it("shows context and a real next action for a historic Matched record without a selected appointment", async () => {
    const matched = makeClient("legacy-matched", "MAT-LEGACY", "Assigned");
    matched.notes = "Parent seeking an educational assessment; appointment choices discussed.";
    matched.allocationVisibility = {
      appointment: null,
      options: [
        { status: "unavailable", clinicianName: "Clinician A", createdAt: "2026-01-09",
          sentAt: null, slot: { type: "Recurring", day: "Tuesday", date: null,
            startTime: "17:00", endTime: "18:00", locationType: "in_person", retired: true } },
        { status: "pending", clinicianName: "Clinician A", createdAt: "2026-01-09",
          sentAt: null, slot: { type: "Recurring", day: "Monday", date: null,
            startTime: "19:00", endTime: "20:00", locationType: "in_person", retired: false } },
      ],
    };
    apiFixtures.tenant = makeTenant({ allocationVisibilityEnabled: true, registrationFormEnabled: true });
    apiFixtures.clients = [matched];
    apiFixtures.historicRows = [];
    const user = userEvent.setup();
    const view = renderBoard();
    queryClients.push(view.queryClient);
    const tile = await screen.findByTestId("compact-client-card-legacy-matched");
    expect(tile.textContent).toContain("Parent seeking an educational assessment");
    expect(tile.textContent).toMatch(/Next action/i);
    expect(tile.textContent).not.toMatch(/waiting for.*(selection|choose)/i);
    await user.click(tile);
    const detail = await screen.findByRole("dialog");
    expect(within(detail).getByTestId("selected-appointment-legacy-matched").textContent)
      .toContain("No selected appointment recorded");
    expect(within(detail).getAllByRole("button", { name: /Offer fresh choices/i }).length).toBeGreaterThan(0);
    expect(within(detail).queryByRole("button", { name: "Email Sent" })).toBeNull();
    expect(within(detail).queryByRole("button", { name: /Resend options/i })).toBeNull();
  });

  it("opens the correct Matched and AwaitingConfirmation details with their real actions inside the panels", async () => {
    const matched = makeClient("matched-1", "MAT-201", "Assigned");
    matched.assignedClinicianId = "clinician-1";
    matched.assignedSlotId = "slot-1";
    const awaiting = makeClient("awaiting-1", "AWT-301", "AwaitingConfirmation");
    apiFixtures.tenant = makeTenant({ registrationFormEnabled: true });
    apiFixtures.clients = [matched, awaiting];
    apiFixtures.historicRows = [
      makeHistoricRow(awaiting, {
        externalReview: {
          reviewedAt: "2026-01-11T12:00:00.000Z",
          externalReference: "EXT-301",
          clinicianReference: "Clinician A",
          appointmentDate: "2026-02-01",
          startTime: "09:00",
          familyMessageReview: "Client confirmed the date by phone.",
        },
      }),
    ];

    const user = userEvent.setup();
    const view = renderBoard();
    queryClients.push(view.queryClient);

    expect(await screen.findByTestId("compact-client-card-matched-1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Email Sent" })).toBeNull();
    await user.click(screen.getByTestId("compact-client-card-matched-1"));
    let detail = await screen.findByRole("dialog");
    expect(detail.textContent).toContain("MAT-201");
    expect(within(detail).queryByRole("button", { name: "Email Sent" })).toBeNull();
    expect(within(detail).getAllByRole("button", { name: /Offer fresh choices/i }).length).toBeGreaterThan(0);
    expect(within(detail).queryByText("AWT-301")).toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: /Appointment arranged in WriteUpp/i })).toBeNull();
    await user.click(screen.getByTestId("compact-client-card-awaiting-1"));
    detail = await screen.findByRole("dialog");
    expect(detail.textContent).toContain("AWT-301");
    const arrangeButton = await within(detail).findByRole("button", { name: "Appointment arranged in WriteUpp" });
    expect(within(detail).queryByText("MAT-201")).toBeNull();

    const ordinaryFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const pathname = new URL(String(input), window.location.origin).pathname;
      if (pathname === "/api/historic-reconciliation/awaiting-1/writeupp-arranged" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ arrangedInWriteupp: true });
        apiFixtures.historicRows = apiFixtures.historicRows.map(row =>
          row.id === "awaiting-1" ? { ...row, writeuppArranged: true } : row);
        return json({ arrangedInWriteupp: true });
      }
      return ordinaryFetch(input, init);
    });
    await user.click(arrangeButton);
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByText(
      "Appointment arranged in WriteUpp. No further booking action needed.",
    )).toBeTruthy());
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByLabelText("External diary appointment reference")).toBeNull();
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Appointment arranged in WriteUpp" })).toBeNull();
    expect(within(screen.getByRole("dialog")).queryByText("Portal booking tools")).toBeNull();
  });

  it("separates explicitly arranged WriteUpp clients from reviewed-but-not-arranged clients", async () => {
    const arranged = makeClient("arranged-1", "WUP-401", "AwaitingConfirmation");
    const reviewed = makeClient("reviewed-1", "REV-402", "AwaitingConfirmation");
    apiFixtures.tenant = makeTenant({ registrationFormEnabled: true });
    apiFixtures.clients = [arranged, reviewed];
    apiFixtures.historicRows = [
      makeHistoricRow(arranged, {
        writeuppArranged: true,
        externalReview: {
          reviewedAt: "2026-01-11T12:00:00.000Z",
          externalReference: "EXT-401",
          clinicianReference: "Clinician A",
          appointmentDate: "2026-02-02",
          startTime: "10:00",
          familyMessageReview: "Appointment verified in diary.",
        },
      }),
      makeHistoricRow(reviewed, {
        externalReview: {
          reviewedAt: "2026-01-11T12:00:00.000Z",
          externalReference: "EXT-402",
          clinicianReference: "Clinician B",
          appointmentDate: "2026-02-03",
          startTime: "11:00",
          familyMessageReview: "Reviewed, but no arrangement recorded.",
        },
      }),
    ];

    const user = userEvent.setup();
    const view = renderBoard();
    queryClients.push(view.queryClient);

    expect(await screen.findByRole("heading", { name: "Awaiting portal confirmation (1)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Booked in WriteUpp · external appointment (1)" })).toBeTruthy();
    expect(screen.getByTestId("compact-client-card-arranged-1")).toBeTruthy();
    expect(screen.getByTestId("compact-client-card-reviewed-1")).toBeTruthy();

    await user.click(screen.getByTestId("compact-client-card-arranged-1"));
    const arrangedPanel = await screen.findByRole("dialog");
    expect(arrangedPanel.textContent).toContain("WUP-401");
    expect(within(arrangedPanel).getByText(/Appointment arranged in WriteUpp. No further booking action needed/)).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByTestId("compact-client-card-reviewed-1"));
    const reviewedPanel = await screen.findByRole("dialog");
    expect(reviewedPanel.textContent).toContain("REV-402");
    expect(await within(reviewedPanel).findByRole("button", { name: "Appointment arranged in WriteUpp" })).toBeTruthy();
  });

  it("keeps a pending Tenant 1 client inline when cached historic arrangement evidence is feature-disabled", async () => {
    const pending = makeClient("legacy-pending", "T1-501", "AwaitingConfirmation");
    const cachedHistoricEvidence = [
      makeHistoricRow(pending, {
        writeuppArranged: true,
        externalReview: {
          reviewedAt: "2026-01-11T12:00:00.000Z",
          externalReference: "CACHED-501",
          clinicianReference: "Clinician C",
          appointmentDate: "2026-02-04",
          startTime: "12:00",
          familyMessageReview: "Historic arrangement evidence.",
        },
      }),
    ];
    apiFixtures.tenant = makeTenant({
      multiClinicianAllocationEnabled: false,
      registrationFormEnabled: false,
    });
    apiFixtures.clients = [pending];
    apiFixtures.historicRows = [];

    const view = renderBoard({ historicCache: cachedHistoricEvidence });
    queryClients.push(view.queryClient);

    const inlineClient = await screen.findByTestId("kanban-card-legacy-pending");
    expect(inlineClient.textContent).toContain("T1-501");
    expect(screen.queryByTestId("compact-client-card-legacy-pending")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Awaiting Confirmation" })).toBeTruthy();
  });
});