// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WriteuppAppointmentAction } from "@/components/WriteuppAppointmentAction";
import type { HistoricRow } from "@/components/HistoricReconciliation";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const row = (overrides: Partial<HistoricRow> = {}): HistoricRow => ({
  id: "client-a", displayId: "WU1", status: "AwaitingConfirmation", portalSnapshot: false,
  portalConfirmedAt: null, bookingEmailAcceptedAt: null, portalBookingEvent: false, optionSelectionEvent: false,
  allocation: "duplicate", slot: null, intakeSubmitted: false, registrationSubmitted: false,
  consentEvidence: "not_recorded", paymentType: null, paymentStatus: null, chargeStatuses: [],
  writeuppArranged: false, externalReview: null,
  ...overrides,
});

function setup(options: {
  enabled?: boolean;
  inventory?: HistoricRow[];
  postResponse?: (init?: RequestInit) => Promise<Response>;
  onRecorded?: () => void;
} = {}) {
  const savedPosts: unknown[] = [];
  const rowData = options.inventory ?? [row()];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    if (url.pathname === "/api/historic-reconciliation" && (init?.method || "GET") === "GET") {
      return new Response(JSON.stringify(rowData), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/historic-reconciliation/client-a/external-review" && init?.method === "POST") {
      savedPosts.push(JSON.parse(String(init.body)));
      if (options.postResponse) return options.postResponse(init);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <WriteuppAppointmentAction clientId="client-a" enabled={options.enabled ?? true} onRecorded={options.onRecorded} />
    </QueryClientProvider>,
  );
  return { savedPosts, client };
}

describe("WriteUpp appointment arrangement action", () => {
  it("submits verified external details and the explicit arrangement assertion", async () => {
    const onRecorded = vi.fn();
    const { savedPosts } = setup({ onRecorded });
    fireEvent.click(await screen.findByRole("button", { name: "Appointment arranged in WriteUpp" }));

    fireEvent.change(screen.getByLabelText("External diary appointment reference"), { target: { value: "diary-42" } });
    fireEvent.change(screen.getByLabelText("Clinician in external diary"), { target: { value: "Dr Example" } });
    fireEvent.change(screen.getByLabelText("Appointment date"), { target: { value: "2026-09-30" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "10:00" } });
    const submit = screen.getByRole("button", { name: "Record WriteUpp arrangement" });
    expect(submit).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("checkbox", { name: "I verified this appointment in the external practice diary" }));
    expect(submit).toHaveProperty("disabled", false);
    fireEvent.click(submit);

    await waitFor(() => expect(onRecorded).toHaveBeenCalledOnce());
    expect(savedPosts).toEqual([{
      externalReference: "diary-42",
      clinicianReference: "Dr Example",
      appointmentDate: "2026-09-30",
      startTime: "10:00",
      familyMessageReview: "The original family message was not required for this staff-verified WriteUpp arrangement.",
      diaryVerified: true,
      arrangedInWriteupp: true,
    }]);
    expect(screen.queryByRole("button", { name: /portal booking|booking email|payment/i })).toBeNull();
  });

  it("prefills previously reviewed evidence but requires fresh diary verification", async () => {
    setup({ inventory: [row({
      externalReview: {
        reviewedAt: "2026-09-01T10:00:00Z", externalReference: "diary-old", clinicianReference: "Dr Existing",
        appointmentDate: "2026-10-01", startTime: "11:30", familyMessageReview: "Previously reviewed note",
      },
    })] });
    fireEvent.click(await screen.findByRole("button", { name: "Appointment arranged in WriteUpp" }));
    expect(screen.getByLabelText("External diary appointment reference")).toHaveProperty("value", "diary-old");
    expect(screen.getByLabelText("Clinician in external diary")).toHaveProperty("value", "Dr Existing");
    expect(screen.getByLabelText("Appointment date")).toHaveProperty("value", "2026-10-01");
    expect(screen.getByLabelText("Start time")).toHaveProperty("value", "11:30");
    expect(screen.getByRole("button", { name: "Record WriteUpp arrangement" })).toHaveProperty("disabled", true);
  });

  it("shows request errors and disables submit while a request is pending", async () => {
    let finishRequest!: (response: Response) => void;
    setup({
      postResponse: () => new Promise(resolve => { finishRequest = resolve; }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Appointment arranged in WriteUpp" }));
    fireEvent.change(screen.getByLabelText("External diary appointment reference"), { target: { value: "diary-42" } });
    fireEvent.change(screen.getByLabelText("Clinician in external diary"), { target: { value: "Dr Example" } });
    fireEvent.change(screen.getByLabelText("Appointment date"), { target: { value: "2026-09-30" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "10:00" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "I verified this appointment in the external practice diary" }));
    fireEvent.click(screen.getByRole("button", { name: "Record WriteUpp arrangement" }));
    expect(await screen.findByRole("button", { name: "Recording arrangement" })).toHaveProperty("disabled", true);
    finishRequest(new Response(JSON.stringify({ error: "Diary record could not be saved" }), {
      status: 409, headers: { "Content-Type": "application/json" },
    }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Diary record could not be saved");
    expect(screen.getByRole("button", { name: "Record WriteUpp arrangement" })).toHaveProperty("disabled", false);
  });

  it("does not offer the action when disabled, snapshotted, arranged, or outside eligible statuses", async () => {
    setup({ enabled: false });
    expect(screen.queryByRole("button", { name: "Appointment arranged in WriteUpp" })).toBeNull();
    cleanup();

    const snapshotted = setup({ inventory: [row({ portalSnapshot: true })] });
    await waitFor(() => expect(snapshotted.client.getQueryData(["/api/historic-reconciliation"])).toBeDefined());
    expect(screen.queryByRole("button", { name: "Appointment arranged in WriteUpp" })).toBeNull();
    cleanup();

    setup({ inventory: [row({ writeuppArranged: true })] });
    expect((await screen.findByRole("status")).textContent).toContain("Booked in WriteUpp");
    expect(screen.queryByRole("button", { name: "Appointment arranged in WriteUpp" })).toBeNull();
    cleanup();

    const confirmed = setup({ inventory: [row({ status: "BookingConfirmed" })] });
    await waitFor(() => expect(confirmed.client.getQueryData(["/api/historic-reconciliation"])).toBeDefined());
    expect(screen.queryByRole("button", { name: "Appointment arranged in WriteUpp" })).toBeNull();
  });
});