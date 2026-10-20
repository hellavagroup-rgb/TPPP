// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Availability from "./availability";
import { canEditSlotLocation } from "@/lib/slotLocationPermissions";

const h = vi.hoisted(() => ({ role: "clinician", toast: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "user-a", role: h.role } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/operationalRefresh", () => ({
  useOperationalRefresh: () => ({ refresh: vi.fn(), lastUpdated: null }),
  invalidateOperationalData: (cache: QueryClient) => cache.invalidateQueries({ queryKey: ["/api/clinicians"] }),
}));

const caches: QueryClient[] = [];
beforeEach(() => { h.role = "clinician"; h.toast.mockClear(); window.history.replaceState({}, "", "/availability"); });
afterEach(() => { cleanup(); caches.splice(0).forEach(cache => cache.clear()); vi.unstubAllGlobals(); });

function setup({ role = "clinician", failed = false, deleteFailed = false, booked = false, retired = false, future = false } = {}) {
  h.role = role;
  let locationType = "online";
  const writes: any[] = [];
  const deletions: string[] = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (init?.method === "DELETE") {
      deletions.push(path);
      return new Response(JSON.stringify(deleteFailed ? { error: "The slot is now booked. Refresh availability." } : { retired: true }), { status: deleteFailed ? 409 : 200 });
    }
    if (path.endsWith("/writeupp-retirement")) return new Response(JSON.stringify({ eligible: false }));
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      writes.push({ path, body });
      if (!failed) locationType = body.locationType;
      return new Response(JSON.stringify(failed ? { error: "This slot is linked to a booking or reservation and cannot change format. Refresh availability." } : { locationType }), { status: failed ? 409 : 200 });
    }
    const data = path === "/api/clinicians" ? [
      { id: "own", userId: "user-a", name: "Own Clinician", avatar: "O", isActive: true, availability: [
        { id: "own-slot", type: "Recurring", day: "Monday", startTime: "09:00", endTime: "10:00", isBooked: booked, retiredAt: retired ? new Date().toISOString() : null, startDate: future ? "2099-01-01" : null, locationType },
      ] },
      { id: "colleague", userId: "user-b", name: "Other Clinician", avatar: "C", isActive: true, availability: [
        { id: "other-slot", type: "Recurring", day: "Monday", startTime: "11:00", endTime: "12:00", isBooked: false, retiredAt: null, locationType: "online" },
      ] },
    ] : path === "/api/tenant/features" ? {} :
      path === "/api/clinicians/me/slot-clients" ? (booked ? { "own-slot": { displayId: "TEST-1", status: "Assigned" } } : {}) :
      booked && path === "/api/clients"
        ? [{ id: "client", displayId: "TEST-1", status: "Assigned", assignedSlotId: "own-slot", assignedClinicianId: "own" }] : [];
    return new Response(JSON.stringify(data), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const cache = new QueryClient({ defaultOptions: { queries: {
    retry: false, queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json(),
  }, mutations: { retry: false } } });
  caches.push(cache);
  render(<QueryClientProvider client={cache}><Availability /></QueryClientProvider>);
  return { writes, deletions, fetchMock };
}

it("shows a clinician's own retire icon without hovering and completes deletion through the real dialog", async () => {
  const { deletions, fetchMock } = setup();
  const button = await screen.findByTestId("button-delete-slot-own-slot");
  expect(button.getAttribute("aria-label")).toBe("Retire availability slot");
  expect(button.parentElement?.className).not.toContain("opacity-0");
  expect(button.parentElement?.className).not.toContain("group-hover");
  expect(screen.queryByTestId("button-delete-slot-other-slot")).toBeNull();
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("button", { name: "Retire slot", exact: true }));
  await waitFor(() => expect(deletions).toEqual(["/api/timeslots/own/own-slot"]));
  await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Slot retired" })));
  expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith("/writeupp-retirement"))).toBe(false);
});

it("shows a stale-booking rejection after clicking the visible clinician retire icon", async () => {
  const { deletions } = setup({ deleteFailed: true });
  fireEvent.click(await screen.findByTestId("button-delete-slot-own-slot"));
  fireEvent.click(await screen.findByRole("button", { name: "Retire slot", exact: true }));
  await screen.findByRole("alert");
  expect(screen.getByText("The slot is now booked. Refresh availability.")).toBeTruthy();
  expect(deletions).toHaveLength(1);
  expect(h.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Slot retired" }));
});

it("also shows the retire icon for a clinician's own future availability", async () => {
  setup({ future: true });
  expect(await screen.findByTestId("button-delete-slot-own-slot")).toBeTruthy();
});

it("does not offer a clinician a retire action for a booked slot", async () => {
  setup({ booked: true });
  await screen.findByTestId("button-toggle-location-own-slot");
  expect(screen.queryByTestId("button-delete-slot-own-slot")).toBeNull();
});

it("does not offer retirement of an already retired slot", async () => {
  setup({ retired: true });
  await screen.findByText("Own Clinician");
  expect(screen.queryByTestId("button-delete-slot-own-slot")).toBeNull();
});

it("preserves the administrator's booked-slot review and practice-wide free-slot controls", async () => {
  setup({ role: "admin", booked: true });
  expect(await screen.findByTestId("button-delete-slot-own-slot")).toBeTruthy();
  expect(await screen.findByTestId("button-delete-slot-other-slot")).toBeTruthy();
});

it("lets a clinician switch their own free slot in both directions and refreshes the displayed label", async () => {
  const { writes } = setup();
  const own = await screen.findByTestId("button-toggle-location-own-slot");
  expect((own as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(own);
  await waitFor(() => expect(own.textContent).toBe("In-Person"));
  await waitFor(() => expect((own as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(own);
  await waitFor(() => expect(own.textContent).toBe("Online"));
  expect(writes).toEqual([
    { path: "/api/timeslots/own-slot/location-type", body: { locationType: "in_person" } },
    { path: "/api/timeslots/own-slot/location-type", body: { locationType: "online" } },
  ]);
});

it("disables another clinician's format button", async () => {
  const { writes } = setup();
  const other = await screen.findByTestId("button-toggle-location-other-slot");
  expect((other as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(other);
  expect(writes).toEqual([]);
});

it("preserves administrator access to other clinicians' free slots", async () => {
  const { writes } = setup({ role: "admin" });
  fireEvent.click(await screen.findByTestId("button-toggle-location-other-slot"));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].path).toBe("/api/timeslots/other-slot/location-type");
});

it("shows the server's stale-booking rejection without presenting a successful format change", async () => {
  setup({ failed: true });
  fireEvent.click(await screen.findByTestId("button-toggle-location-own-slot"));
  await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({
    title: "Format not changed", description: expect.stringContaining("linked to a booking"), variant: "destructive",
  })));
  expect(screen.getByTestId("button-toggle-location-own-slot").textContent).toBe("Online");
});

it.each(["admin", "clinician"])("disables booked and retired slots for %s and requires authentication", role => {
  const clinician = { userId: "user-a" };
  expect(canEditSlotLocation({ id: "user-a", role }, clinician, { isBooked: true, retiredAt: null })).toBe(false);
  expect(canEditSlotLocation({ id: "user-a", role }, clinician, { isBooked: false, retiredAt: new Date() })).toBe(false);
  expect(canEditSlotLocation(null, clinician, { isBooked: false, retiredAt: null })).toBe(false);
});
