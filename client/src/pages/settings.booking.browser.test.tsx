// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Settings from "./settings";
import { CYA_PSYCHOLOGY_TENANT_ID } from "@shared/practicePolicies";

const fixtures = vi.hoisted(() => ({
  tenant: {} as Record<string, unknown>,
  bookingSettings: { enabled: false, durationHours: 12 },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "booking-admin", name: "Booking Admin", role: "admin" },
    isLoading: false,
    refreshUser: vi.fn(),
  }),
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Settings />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe("signed-in booking settings", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function mockSettings(tenant: Record<string, unknown>, settings = { enabled: false, durationHours: 12 }) {
    fixtures.tenant = tenant;
    fixtures.bookingSettings = settings;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/tenant") return json(fixtures.tenant);
      if (path === "/api/tenant/booking-settings") {
        if (init?.method === "PATCH") return json({ enabled: true, durationHours: 12 });
        return json(fixtures.bookingSettings);
      }
      return json({ error: `Unexpected test API request: ${path}` }, 404);
    }));
  }

  it("explains all missing prerequisites and prevents enabling new flexible bookings without reconciliation", async () => {
    mockSettings({
      id: CYA_PSYCHOLOGY_TENANT_ID,
      multiClinicianAllocationEnabled: false,
      registrationFormEnabled: false,
      registrationFormId: null,
      paymentReconciliationEnabled: false,
    });
    const user = userEvent.setup();
    renderSettings();
    await user.click(await screen.findByRole("tab", { name: "Booking" }));

    const bookingCard = await screen.findByTestId("flexible-booking-settings");
    await screen.findByText(/existing reservations stay protected/i);
    expect(within(bookingCard).getByText(/turn on multi-clinician allocation and registration/i)).toBeTruthy();
    expect(within(bookingCard).getByText(/select a registration form in Settings/i)).toBeTruthy();
    expect(within(bookingCard).getByText(/ask a super administrator to enable payment reconciliation/i)).toBeTruthy();
    expect(within(bookingCard).getByText(/New flexible bookings are unavailable without reconciliation/i)).toBeTruthy();
    expect(within(bookingCard).getByText(/existing reservations stay protected/i)).toBeTruthy();
    expect(within(bookingCard).getByRole("switch", { name: "Allow flexible clinician booking" }))
      .toHaveProperty("disabled", true);
    expect(within(bookingCard).getByRole("button", { name: "Save reservation duration" }))
      .toHaveProperty("disabled", false);
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("keeps an already-enabled workflow switch available so admins can turn it off when reconciliation is disabled", async () => {
    mockSettings({
      id: CYA_PSYCHOLOGY_TENANT_ID,
      multiClinicianAllocationEnabled: true,
      registrationFormEnabled: true,
      registrationFormId: "registration-form",
      paymentReconciliationEnabled: false,
    }, { enabled: true, durationHours: 12 });
    const user = userEvent.setup();
    renderSettings();
    await user.click(await screen.findByRole("tab", { name: "Booking" }));

    const bookingCard = await screen.findByTestId("flexible-booking-settings");
    await screen.findByText(/existing reservations stay protected/i);
    const workflowSwitch = within(bookingCard).getByRole("switch", { name: "Allow flexible clinician booking" });
    expect(workflowSwitch).toHaveProperty("disabled", false);
    expect(workflowSwitch.getAttribute("aria-checked")).toBe("true");
    expect(within(bookingCard).getByText(/existing reservations stay protected/i)).toBeTruthy();
  });
});
