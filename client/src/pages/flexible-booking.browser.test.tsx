// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FlexibleBooking from "./flexible-booking";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const booking = {
  tenantName: "Cedar House Psychology",
  primaryColor: "#527467",
  status: "active",
  clinicians: [{
    id: "clinician-1",
    name: "Dr Amara Patel",
    bio: "Works with families navigating early parenthood.",
    sessionRatePence: 14500,
    slots: [{
      id: "slot-1", type: "Recurring", day: "Tuesday", date: null, startDate: "2026-06-02",
      endDate: "2026-12-15", startTime: "10:00", endTime: "11:00", frequency: "Weekly", locationType: "online",
    }],
  }],
};

function mount() {
  window.history.replaceState({}, "", "/book/invite-123");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><FlexibleBooking /></QueryClientProvider>);
}

describe("public flexible booking", () => {
  it("explains clinician and slot selection and submits both identifiers through the public endpoint", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(booking), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    mount();

    expect(await screen.findByText("Dr Amara Patel")).toBeTruthy();
    expect(screen.getByText(/First session date: to be agreed/)).toBeTruthy();
    expect(screen.getByText(/Availability window:/)).toBeTruthy();
    expect(screen.getByText(/Choose your preferred clinician and an available slot/)).toBeTruthy();
    expect(screen.getByText(/This is not yet a confirmed booking/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Choose this slot/ }));
    expect(screen.getByText("Slot selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue with this clinician and slot" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/public/booking/invite-123");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ clinicianId: "clinician-1", slotId: "slot-1" });
    expect(await screen.findByText("Your clinician and slot selection has been recorded")).toBeTruthy();
  });

  it("gives a composed empty state when no clinicians have live choices", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...booking, clinicians: [] }), { status: 200 })));
    mount();
    expect(await screen.findByText("No current choices to show")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh choices" })).toBeTruthy();
  });

  it("shows confirmed next steps when the invitation has already been selected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...booking, status: "confirmed", clinicians: [],
    }), { status: 200 })));
    mount();
    expect(await screen.findByText("Your clinician and slot are confirmed")).toBeTruthy();
    expect(screen.getByText(/practice will contact you with the next steps/i)).toBeTruthy();
    expect(screen.queryByText("No current choices to show")).toBeNull();
  });
  it("resumes registration when a family reloads a selected invitation, even without an email", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...booking, status: "selected", clinicians: [], registrationUrl: "/register/client-1/registration-token",
    }), { status: 200 })));
    mount();
    expect(await screen.findByText("Your session is reserved")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Continue to registration" }).getAttribute("href"))
      .toBe("/register/client-1/registration-token");
    expect(screen.getByText(/temporary reservation, not a confirmed booking/i)).toBeTruthy();
    expect(screen.queryByText("No current choices to show")).toBeNull();
  });
  it("does not offer registration when the server rejects an expired selected invitation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "This reservation has expired or was cancelled.",
    }), { status: 410 })));
    mount();
    expect(await screen.findByText("These choices are unavailable")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Continue to registration" })).toBeNull();
  });
  it("does not resume registration for an expired response even if it contains an old URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...booking, status: "expired", clinicians: [], registrationUrl: "/register/client-1/old-token",
    }), { status: 200 })));
    mount();
    expect(await screen.findByText("These choices are no longer available")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Continue to registration" })).toBeNull();
  });
});
