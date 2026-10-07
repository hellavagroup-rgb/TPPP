// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WriteuppAppointmentAction } from "./WriteuppAppointmentAction";
import type { HistoricRow } from "./HistoricReconciliation";

const caches: QueryClient[] = [];
afterEach(() => {
  cleanup();
  caches.splice(0).forEach(cache => cache.clear());
  vi.unstubAllGlobals();
});

const row = (overrides: Partial<HistoricRow> = {}): HistoricRow => ({
  id: "client-a", displayId: "WU1", status: "AwaitingConfirmation", portalSnapshot: false,
  portalConfirmedAt: null, bookingEmailAcceptedAt: null, portalBookingEvent: false, optionSelectionEvent: false,
  allocation: "duplicate", slot: null, intakeSubmitted: false, registrationSubmitted: false,
  consentEvidence: "not_recorded", paymentType: null, paymentStatus: null, chargeStatuses: [],
  writeuppArranged: false, externalReview: null, ...overrides,
});

function setup(options: {
  enabled?: boolean; inventory?: HistoricRow[]; onRecorded?: () => void;
  postResponse?: () => Promise<Response>;
} = {}) {
  const savedPosts: unknown[] = [];
  const rowData = options.inventory ?? [row()];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const pathname = new URL(String(input), window.location.origin).pathname;
    if (pathname === "/api/historic-reconciliation") {
      return new Response(JSON.stringify(rowData), { status: 200 });
    }
    if (pathname === "/api/historic-reconciliation/client-a/writeupp-arranged" && init?.method === "POST") {
      savedPosts.push(JSON.parse(String(init.body)));
      if (options.postResponse) return options.postResponse();
      return new Response(JSON.stringify({ arrangedInWriteupp: true }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  caches.push(client);
  render(<QueryClientProvider client={client}>
    <WriteuppAppointmentAction clientId="client-a" enabled={options.enabled ?? true} onRecorded={options.onRecorded} />
  </QueryClientProvider>);
  return { client, savedPosts };
}

describe("WriteUpp appointment arrangement action", () => {
  it("records the arrangement with one click and no form or extra confirmation", async () => {
    const onRecorded = vi.fn();
    const { savedPosts } = setup({ onRecorded });
    fireEvent.click(await screen.findByRole("button", { name: "Appointment arranged in WriteUpp" }));
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent", "Appointment arranged in WriteUpp. No further booking action needed.",
    );
    expect(savedPosts).toEqual([{ arrangedInWriteupp: true }]);
    expect(onRecorded).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("also accepts a client with an existing review without re-entering its details", async () => {
    const { savedPosts } = setup({ inventory: [row({ externalReview: {
      reviewedAt: "2026-09-01T10:00:00Z", externalReference: "diary-old",
      clinicianReference: "Dr Existing", appointmentDate: "2026-09-30", startTime: "10:00",
      familyMessageReview: "Previously reviewed.",
    } })] });
    fireEvent.click(await screen.findByRole("button", { name: "Appointment arranged in WriteUpp" }));
    await screen.findByRole("status");
    expect(savedPosts).toEqual([{ arrangedInWriteupp: true }]);
  });

  it("disables repeat clicks while saving and allows retry after a failure without claiming success", async () => {
    let finishRequest!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { finishRequest = resolve; });
    const onRecorded = vi.fn();
    const { savedPosts } = setup({ onRecorded, postResponse: () => pending });
    fireEvent.click(await screen.findByRole("button", { name: "Appointment arranged in WriteUpp" }));
    expect(await screen.findByRole("button", { name: "Recording…" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("status")).toBeNull();
    finishRequest(new Response(JSON.stringify({ error: "Could not save" }), { status: 409 }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("status")).toBeNull();
    expect(onRecorded).not.toHaveBeenCalled();
    expect(savedPosts).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Appointment arranged in WriteUpp" })).toHaveProperty("disabled", false);
  });

  it.each([
    { enabled: false, data: row() },
    { enabled: true, data: row({ portalSnapshot: true }) },
    { enabled: true, data: row({ status: "BookingConfirmed" }) },
  ])("does not offer the action for an ineligible client", async ({ enabled, data }) => {
    const { client } = setup({ enabled, inventory: [data] });
    if (enabled) await waitFor(() => expect(client.getQueryData(["/api/historic-reconciliation"])).toBeDefined());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a saved arrangement after reloading without requiring an external review", async () => {
    setup({ inventory: [row({ writeuppArranged: true, externalReview: null })] });
    expect((await screen.findByRole("status")).textContent).toContain("No further booking action needed");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
