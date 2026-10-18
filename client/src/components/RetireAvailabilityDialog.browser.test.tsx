// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RetireAvailabilityDialog } from "./RetireAvailabilityDialog";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const caches: QueryClient[] = [];
afterEach(() => { cleanup(); caches.splice(0).forEach(cache => cache.clear()); vi.unstubAllGlobals(); });

function setup({ eligible = true, booked = true, failed = false, checkFails = false } = {}) {
  const writes: { method: string; path: string; body: any }[] = [];
  const onClose = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === "GET") return new Response(JSON.stringify(checkFails ? { error: "unavailable" } :
      { eligible, clientId: "client-a", clientDisplayId: "WU1", reason: "Active reservation has no recorded WriteUpp arrangement." }),
      { status: checkFails ? 500 : 200 });
    writes.push({ method: init?.method || "", path, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(failed ? { error: "The slot's client has changed. Refresh and review the slot again." } :
      { retired: true }), { status: failed ? 409 : 200 });
  }));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  caches.push(cache);
  render(<QueryClientProvider client={cache}><RetireAvailabilityDialog open
    target={{ clinicianId: "clinician-a", slot: { id: "slot-a", isBooked: booked } as any }} onClose={onClose} /></QueryClientProvider>);
  return { writes, onClose };
}

it("previews without mutation, explains preservation, then explicitly posts the displayed client", async () => {
  const { writes, onClose } = setup();
  const button = await screen.findByRole("button", { name: "Retire occupied WriteUpp slot" });
  expect(screen.getByText(/WU1's appointment is recorded/).textContent).toContain("No emails will be sent");
  expect(writes).toEqual([]);
  fireEvent.click(button);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(writes).toEqual([{ method: "POST", path: "/api/timeslots/clinician-a/slot-a/writeupp-retirement",
    body: { retireOccupiedSlot: true, clientId: "client-a" } }]);
});

it("leaves an ordinary booked reservation protected", async () => {
  const { writes } = setup({ eligible: false });
  await screen.findByText("Active reservation has no recorded WriteUpp arrangement.");
  const button = screen.getByRole("button", { name: "Retire slot" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(writes).toEqual([]);
});

it("keeps normal retirement working for an unoccupied slot", async () => {
  const { writes, onClose } = setup({ eligible: false, booked: false });
  const button = screen.getByRole("button", { name: "Retire slot" }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(writes).toEqual([{ method: "DELETE", path: "/api/timeslots/clinician-a/slot-a", body: null }]);
});

it("keeps the dialog open and shows the server's safety rejection", async () => {
  const { onClose } = setup({ failed: true });
  fireEvent.click(await screen.findByRole("button", { name: "Retire occupied WriteUpp slot" }));
  await screen.findByText("The slot's client has changed. Refresh and review the slot again.");
  expect(onClose).not.toHaveBeenCalled();
});

it("fails closed when eligibility cannot be checked", async () => {
  const { writes } = setup({ checkFails: true });
  await screen.findByRole("button", { name: "Retry check" });
  expect((screen.getByRole("button", { name: "Retire slot" }) as HTMLButtonElement).disabled).toBe(true);
  expect(writes).toEqual([]);
});
