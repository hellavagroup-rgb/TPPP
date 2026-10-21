// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { format, startOfWeek } from "date-fns";
import Availability from "./availability";

const h = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "user-a", role: "clinician" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/lib/operationalRefresh", () => ({
  useOperationalRefresh: () => ({ refresh: vi.fn(), lastUpdated: null }),
  invalidateOperationalData: (cache: QueryClient) => cache.invalidateQueries({ queryKey: ["/api/clinicians"] }),
}));
// Keep the actual page state/mutations, replacing only calendar/select widgets.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => <select value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
vi.mock("@/components/ui/date-picker", () => ({
  DatePicker: ({ value, onChange }: any) => <input aria-label="Selected calendar date" type="date" value={value} onChange={event => onChange(event.target.value)} />,
}));

const caches: QueryClient[] = [];
afterEach(() => {
  cleanup();
  caches.splice(0).forEach(cache => cache.clear());
  h.toast.mockClear();
  vi.unstubAllGlobals();
});

function setup({ enabled = true, conflict = false, existing = false } = {}) {
  window.history.replaceState({}, "", "/availability");
  const date = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  let blocks = existing ? [{ id: "own-block", clinicianId: "own", date, startTime: "09:00", endTime: "11:00" }] : [];
  const writes: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      writes.push({ path, body });
      if (conflict) return new Response(JSON.stringify({ error: "Resolve the existing appointment before saving." }), { status: 409 });
      const block = { id: "own-block", clinicianId: "own", ...body };
      blocks = [block];
      return new Response(JSON.stringify(block), { status: 201 });
    }
    if (init?.method === "DELETE") {
      writes.push({ path });
      blocks = [];
      return new Response(JSON.stringify({ success: true }));
    }
    const data = path === "/api/clinicians" ? [
      { id: "own", userId: "user-a", name: "Own Clinician", isActive: true, availability: [], availabilityTimeOffBlocks: blocks },
      { id: "colleague", userId: "user-b", name: "Colleague", isActive: true, availability: [],
        availabilityTimeOffBlocks: existing ? [{ id: "colleague-block", clinicianId: "colleague", date, startTime: "10:00", endTime: "11:00" }] : [] },
    ] : path === "/api/tenant/features" ? { timeOffBlocksEnabled: enabled } : {};
    return new Response(JSON.stringify(data));
  }));
  const cache = new QueryClient({ defaultOptions: { queries: {
    retry: false, queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json(),
  }, mutations: { retry: false } } });
  caches.push(cache);
  render(<QueryClientProvider client={cache}><Availability /></QueryClientProvider>);
  return { writes, date };
}

async function chooseBlock() {
  await screen.findByText("Own Clinician");
  fireEvent.click(screen.getByTestId("button-add-availability"));
  await screen.findByRole("option", { name: "Block Hours on a Date" });
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "TimeOffBlock" } });
}

it("keeps hourly block creation hidden for practices that have not enabled it", async () => {
  setup({ enabled: false });
  await screen.findByText("Own Clinician");
  fireEvent.click(screen.getByTestId("button-add-availability"));
  expect(screen.queryByRole("option", { name: "Block Hours on a Date" })).toBeNull();
});

it("saves a clinician's multi-hour block through the real page mutation", async () => {
  const { writes, date } = setup();
  await chooseBlock();
  fireEvent.change(screen.getByLabelText("Selected calendar date"), { target: { value: date } });
  fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "11:00" } });
  fireEvent.click(screen.getByTestId("button-save-availability"));
  await waitFor(() => expect(writes).toEqual([{
    path: "/api/clinicians/own/time-off-blocks",
    body: { date, startTime: "09:00", endTime: "11:00" },
  }]));
  await screen.findByTestId("time-off-block-own-block");
});

it("keeps the form open and displays a booking conflict rather than claiming success", async () => {
  setup({ conflict: true });
  await chooseBlock();
  fireEvent.click(screen.getByTestId("button-save-availability"));
  await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({
    title: "Time off not saved", description: "Resolve the existing appointment before saving.", variant: "destructive",
  })));
  expect(screen.getByTestId("button-save-availability")).toBeTruthy();
  expect(screen.queryByTestId("time-off-block-own-block")).toBeNull();
});

it("removes an own block after confirmation but offers no delete control for a colleague", async () => {
  const { writes } = setup({ existing: true });
  fireEvent.click(await screen.findByTestId("button-delete-time-off-own-block"));
  expect(screen.queryByTestId("button-delete-time-off-colleague-block")).toBeNull();
  fireEvent.click(screen.getByTestId("button-confirm-delete-time-off"));
  await waitFor(() => expect(writes).toEqual([{ path: "/api/time-off-blocks/own-block" }]));
  await waitFor(() => expect(screen.queryByTestId("time-off-block-own-block")).toBeNull());
  expect(screen.getByTestId("time-off-block-colleague-block")).toBeTruthy();
});
