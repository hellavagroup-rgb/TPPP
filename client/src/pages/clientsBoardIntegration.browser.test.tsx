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
  managerEnabled: boolean;
} = { tenant: {}, clients: [], historicRows: [], managerEnabled: false };

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
    apiFixtures.managerEnabled = false;

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
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      switch (url.pathname) {
        case "/api/tenant":
          return json(apiFixtures.tenant);
        case "/api/manager-confirmation/settings":
          return json({
            configured: apiFixtures.managerEnabled, canConfigure: true,
            canOverride: apiFixtures.managerEnabled, managerUserIds: [], updatedAt: null,
          });
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

  it("shows manager confirmation only after the server grants this admin permission", async () => {
    apiFixtures.managerEnabled = true;
    apiFixtures.clients = [makeClient("manager-client", "MGR-101", "RegistrationPending")];
    const view = renderBoard();
    queryClients.push(view.queryClient);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Manager confirm" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Manager confirmation" })).toBeTruthy();
    expect(within(dialog).getByLabelText("Manager PIN")).toHaveProperty("type", "password");
    expect(within(dialog).getByRole("button", { name: "Move to Confirmed" })).toHaveProperty("disabled", true);
  });

  it.each([false, true])("lets staff select a pending slot with multi-clinician workflow=%s", async multiClinician => {
    apiFixtures.tenant = makeTenant({ multiClinicianAllocationEnabled: multiClinician });
    apiFixtures.clients = [makeClient("pending-book", "PENDING-BOOK", "Forms Completed")];
    const originalFetch = fetch;
    const writes: Array<{ path: string; body: any }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/clinicians") return json([{
        id: "pending-clinician", name: "Fixture Clinician", specialties: [], insurers: [],
        capacity: 10, currentLoad: 0, maxNewClients: 3, isActive: true,
        availability: [{ id: "pending-slot", tenantId: "tenant-1", clinicianId: "pending-clinician",
          type: "Recurring", day: "Monday", startTime: "10:00", endTime: "11:00",
          startDate: "2999-01-01", isBooked: false, locationType: "online" }],
      }]);
      if (path === "/api/clients/pending-book/submissions") return json([]);
      if (init?.method === "POST") {
        writes.push({ path, body: JSON.parse(init.body) });
        return json({ success: true });
      }
      return originalFetch(input, init);
    }));
    const view = renderBoard();
    queryClients.push(view.queryClient);
    const user = userEvent.setup();
    const card = await screen.findByTestId("kanban-card-pending-book");
    const menu = within(card).getAllByRole("button").find(button => button.getAttribute("aria-haspopup") === "menu");
    await user.click(menu!);
    await user.click(await screen.findByRole("menuitem", { name: "Allocate to Clinician" }));
    const dialog = await screen.findByRole("dialog");
    const slot = await within(dialog).findByRole("button", { name: /Monday/ });
    await waitFor(() => expect(slot).toHaveProperty("disabled", false));
    expect(slot.textContent).toContain("Pending · available from 01/01/2999");
    await user.click(slot);
    if (multiClinician) await user.click(within(dialog).getByRole("button", { name: "Send Options (1)" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    if (multiClinician) {
      expect(writes[0].path).toBe("/api/clients/pending-book/allocate-options");
      expect(writes[0].body.selections).toEqual([{ clinicianId: "pending-clinician", slotId: "pending-slot" }]);
    } else {
      expect(writes[0].body).toMatchObject({ clinicianId: "pending-clinician", slotId: "pending-slot" });
    }
  });

  it("does not show the manager override to an ordinary admin", async () => {
    apiFixtures.clients = [makeClient("ordinary-client", "ADM-101", "RegistrationPending")];
    const view = renderBoard();
    queryClients.push(view.queryClient);
    await screen.findByTestId("compact-client-card-ordinary-client");
    expect(screen.queryByRole("button", { name: "Manager confirm" })).toBeNull();
  });

  async function openConfirmedEdit(clientId: string, user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByTestId(`compact-client-card-${clientId}`));
    const card = await screen.findByTestId(`client-details-${clientId}`);
    const menu = within(card).getAllByRole("button").find(button => button.getAttribute("aria-haspopup") === "menu");
    expect(menu).toBeTruthy();
    await user.click(menu!);
    await user.click(await screen.findByRole("menuitem", { name: "Edit Status" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Status" });
    await user.click(within(dialog).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /^Confirmed$/ }));
    return dialog;
  }

  it.each(["", "MGR-EDIT", "MGR-"])("keeps the board populated after manager confirmation with search '%s'", async search => {
    apiFixtures.managerEnabled = true;
    const client = makeClient("manager-edit", "MGR-EDIT", "AwaitingConfirmation");
    Object.assign(client, { assignedClinicianId: "clinician-original", assignedSlotId: "slot-original", assignedSlot: "Tuesday 13:00" });
    apiFixtures.clients = [client, makeClient("remaining-client", "MGR-NEXT", "New")];
    const originalFetch = fetch;
    const writes: Array<{ path: string; body: any }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/clinicians") return json([{
        id: "clinician-new", name: "Fixture Clinician", specialties: [], insurers: [],
        capacity: 10, currentLoad: 0, isActive: true,
        availability: [{ id: "slot-new", tenantId: "tenant-1", clinicianId: "clinician-new",
          type: "Recurring", day: "Monday", startTime: "10:00", endTime: "11:00",
          isBooked: false, locationType: "online" }],
      }]);
      if (init?.method === "POST") {
        writes.push({ path, body: JSON.parse(init.body) });
        if (path.endsWith("/manager-confirm")) {
          Object.assign(client, { status: "Scheduled", managerConfirmedAt: "2026-10-07T12:00:00Z" });
          return json({ confirmed: true, alreadyConfirmed: false });
        }
      }
      return originalFetch(input, init);
    }));
    const view = renderBoard();
    queryClients.push(view.queryClient);
    const user = userEvent.setup();
    if (search) await user.type(screen.getByPlaceholderText("Search by Client ID (W...)"), search);
    const edit = await openConfirmedEdit(client.id, user);
    await user.click(within(edit).getByRole("button", { name: /Monday/ }));
    expect(within(edit).getByRole("button", { name: "Continue with manager PIN" })).toHaveProperty("disabled", true);
    expect(within(edit).getByRole("alert").textContent).toContain("Clear the new slot selection");
    expect(writes).toEqual([]);
    await user.click(within(edit).getByRole("button", { name: "Clear selection (keep current slot)" }));
    await user.click(within(edit).getByRole("button", { name: "Continue with manager PIN" }));
    const pinDialog = await screen.findByRole("dialog", { name: "Manager confirmation" });
    expect(within(pinDialog).getByRole("combobox").textContent).toContain("MGR-EDIT");
    expect(writes).toEqual([]);
    await user.type(within(pinDialog).getByLabelText("Manager PIN"), "864209");
    await user.type(within(pinDialog).getByLabelText("Reason for manager confirmation"), "Already arranged in the practice diary.");
    await user.click(within(pinDialog).getByRole("button", { name: "Move to Confirmed" }));
    await screen.findByText("MGR-EDIT moved to Confirmed. Your manager override has been recorded.");
    expect(writes).toEqual([{ path: "/api/clients/manager-edit/manager-confirm",
      body: { pin: "864209", reason: "Already arranged in the practice diary." } }]);
    expect(client.assignedClinicianId).toBe("clinician-original");
    expect(client.assignedSlotId).toBe("slot-original");
    await user.click(within(pinDialog).getByRole("button", { name: "Done" }));
    await screen.findByTestId("kanban-card-remaining-client");
    expect(screen.queryByTestId("compact-client-card-manager-edit")).toBeNull();
    expect(screen.getByPlaceholderText("Search by Client ID (W...)")).toHaveProperty("value",
      search === "MGR-EDIT" ? "" : search);
  });

  it.each([false, true])("keeps normal checks for unapproved admins when manager setup is configured=%s", async configured => {
    const client = makeClient("ordinary-edit", "ADMIN-EDIT", "AwaitingConfirmation");
    apiFixtures.clients = [client];
    const originalFetch = fetch;
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/manager-confirmation/settings") return json({
        configured, canConfigure: !configured, canOverride: false, managerUserIds: [], updatedAt: null,
      });
      if (init?.method === "POST") {
        paths.push(path);
        return json({ error: "Payment is not independently verified." }, 403);
      }
      return originalFetch(input, init);
    }));
    const view = renderBoard();
    queryClients.push(view.queryClient);
    const user = userEvent.setup();
    const edit = await openConfirmedEdit(client.id, user);
    expect(within(edit).getByText(configured
      ? /Normal booking checks apply. Only selected managers/
      : /Manager PIN confirmation has not been set up/)).toBeTruthy();
    await user.click(within(edit).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(paths).toEqual(["/api/clients/ordinary-edit/reassign"]));
    expect(screen.queryByRole("dialog", { name: "Manager confirmation" })).toBeNull();
    expect(client.status).toBe("AwaitingConfirmation");
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
    await user.click(screen.getByLabelText("Show Confirmed"));
    const card = await screen.findByTestId("client-record-payment-review");
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
    await user.click(screen.getByLabelText("Show Confirmed"));
    const card = await screen.findByTestId("client-record-payment-review");
    await user.click(within(card).getByRole("button", { name: "Review payment record" }));
    const review = await screen.findByTestId("payment-review-payment-review");
    // Simulate a separate authorised process having verified the payment while
    // this browser still has its earlier, pending query result.
    client.paymentStatus = "active";
    const serverBeforeReview = structuredClone(client);
    await user.click(within(review).getByRole("button", { name: "Check Stripe payment (read-only)" }));
    await waitFor(() => expect(within(screen.getByTestId("client-record-payment-review"))
      .getByRole("button", { name: "Move to Completed" })).toHaveProperty("disabled", false));
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
    await user.click(screen.getByLabelText("Show Confirmed"));
    const card = await screen.findByTestId("client-record-payment-review");
    await user.click(within(card).getByRole("button", { name: "Review payment record" }));
    const review = await screen.findByTestId("payment-review-payment-review");
    expect(review.textContent).toContain(scenario === "missing-reference"
      ? "no complete current portal payment reference" : "Stripe verification is not enabled");
    expect(within(review).queryByRole("button", { name: /Check Stripe/i })).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("payment-reconciliation"))).toBe(false);
    expect(client.paymentStatus).toBe("setup_pending");
  });

  it("retains completion from the Confirmed view without putting confirmed clients back on Kanban", async () => {
    const client = paymentReviewFixture();
    client.paymentStatus = "active";
    apiFixtures.tenant = makeTenant({ completedBookingsEnabled: true });
    apiFixtures.clients = [client];
    const ordinaryFetch = fetch;
    const writes: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/clients/payment-review/complete" && init?.method === "POST") {
        writes.push(path);
        client.completedAt = "2026-10-07T12:00:00Z";
        return json({ completed: true });
      }
      return ordinaryFetch(input, init);
    }));
    const view = renderBoard();
    queryClients.push(view.queryClient);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Show Confirmed"));
    await user.click(await screen.findByRole("button", { name: "Move to Completed" }));
    await waitFor(() => expect(screen.queryByTestId("client-record-payment-review")).toBeNull());
    expect(writes).toEqual(["/api/clients/payment-review/complete"]);
    await user.click(screen.getByLabelText("Show Completed"));
    expect((await screen.findByTestId("client-record-payment-review")).textContent).toContain("Completed");
  });

  it("keeps payment-type recovery available in Confirmed without treating missing payment evidence as complete", async () => {
    const client = paymentReviewFixture();
    client.paymentType = null;
    apiFixtures.tenant = makeTenant({ completedBookingsEnabled: true });
    apiFixtures.clients = [client];
    const view = renderBoard();
    queryClients.push(view.queryClient);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Show Confirmed"));
    expect(await screen.findByRole("button", { name: "Completion blocked" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Review payment type" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(client.paymentType).toBeNull();
    expect(client.paymentStatus).toBe("setup_pending");
  });

  it("keeps a portal-confirmed client off the active Kanban and accessible once in Confirmed", async () => {
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
    expect(screen.queryByRole("heading", { name: /Confirmed in portal/ })).toBeNull();
    expect(screen.queryByTestId("compact-client-card-confirmed-1")).toBeNull();
    expect(screen.queryByTestId("kanban-card-confirmed-1")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByLabelText("Show Confirmed"));
    expect(await screen.findByTestId("client-record-confirmed-1")).toBeTruthy();
    expect(screen.getAllByText("CNF-101")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Move to Completed" })).toBeTruthy();
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
    await waitFor(() => expect(screen.queryByTestId("compact-client-card-awaiting-1")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("External diary appointment reference")).toBeNull();
    await user.click(screen.getByLabelText("Show Confirmed"));
    const saved = await screen.findByTestId("client-record-awaiting-1");
    expect(saved.textContent).toContain("Confirmed · WriteUpp");
    expect(saved.textContent).toContain("No further booking action needed");
    expect(apiFixtures.clients.find(client => client.id === "awaiting-1")?.status).toBe("AwaitingConfirmation");
  });

  it("moves explicit arrangements to Confirmed while keeping reviewed-but-not-arranged clients active", async () => {
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
    expect(screen.queryByRole("heading", { name: /Booked in WriteUpp/ })).toBeNull();
    expect(screen.queryByTestId("compact-client-card-arranged-1")).toBeNull();
    expect(screen.getByTestId("compact-client-card-reviewed-1")).toBeTruthy();

    await user.click(screen.getByLabelText("Show Confirmed"));
    const arrangedRecord = await screen.findByTestId("client-record-arranged-1");
    expect(arrangedRecord.textContent).toContain("WUP-401");
    expect(arrangedRecord.textContent).toContain("Confirmed · WriteUpp");
    expect(screen.queryByTestId("client-record-reviewed-1")).toBeNull();
    await user.click(screen.getByLabelText("Show Confirmed"));
    await user.click(screen.getByTestId("compact-client-card-reviewed-1"));
    const reviewedPanel = await screen.findByRole("dialog");
    expect(reviewedPanel.textContent).toContain("REV-402");
    expect(await within(reviewedPanel).findByRole("button", { name: "Appointment arranged in WriteUpp" })).toBeTruthy();
  });

  it("keeps verified arrangements in Confirmed even when compact and registration controls are disabled", async () => {
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

    await screen.findByRole("heading", { name: "Awaiting Confirmation" });
    expect(screen.queryByTestId("kanban-card-legacy-pending")).toBeNull();
    expect(screen.queryByTestId("compact-client-card-legacy-pending")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Awaiting Confirmation" })).toBeTruthy();
    await userEvent.setup().click(screen.getByLabelText("Show Confirmed"));
    expect((await screen.findByTestId("client-record-legacy-pending")).textContent).toContain("Confirmed · WriteUpp");
  });
});