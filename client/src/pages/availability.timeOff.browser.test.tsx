// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays, format, startOfWeek } from "date-fns";
import Availability from "./availability";

const h = vi.hoisted(() => ({ toast: vi.fn(), role: "clinician" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "user-a", role: h.role } }) }));
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
  h.role = "clinician";
  vi.unstubAllGlobals();
});

function setup({ enabled = true, conflict = false, existing = false, beforeWrite = async () => {} } = {}) {
  window.history.replaceState({}, "", "/availability");
  const date = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  let blocks = existing ? [{ id: "own-block", clinicianId: "own", date, startTime: "09:00", endTime: "11:00" }] : [];
  let colleagueBlocks = existing ? [{ id: "colleague-block", clinicianId: "colleague", date, startTime: "10:00", endTime: "11:00" }] : [];
  const writes: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (init?.method === "POST" || init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      writes.push({ path, body });
      await beforeWrite();
      if (conflict) return new Response(JSON.stringify({ error: "Resolve the existing appointment before saving." }), { status: 409 });
      if (path.startsWith("/api/timeslots/")) return new Response(JSON.stringify(body), { status: 201 });
      const colleague = path.endsWith("/colleague-block");
      const block = { id: colleague ? "colleague-block" : "own-block", clinicianId: colleague ? "colleague" : "own", ...body };
      if (colleague) colleagueBlocks = [block];
      else blocks = [block];
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
        availabilityTimeOffBlocks: colleagueBlocks },
    ] : path === "/api/tenant/features" ? { timeOffBlocksEnabled: enabled } : path === "/api/clients" ? [] : {};
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
  await screen.findByRole("option", { name: "Time Off / Vacation" });
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Vacation" } });
  fireEvent.click(await screen.findByRole("switch", { name: "All day" }));
}

it("keeps hourly block creation hidden for practices that have not enabled it", async () => {
  setup({ enabled: false });
  await screen.findByText("Own Clinician");
  fireEvent.click(screen.getByTestId("button-add-availability"));
  expect(screen.queryByRole("option", { name: "Block Hours on a Date" })).toBeNull();
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Vacation" } });
  expect(screen.queryByRole("switch", { name: "All day" })).toBeNull();
  expect(screen.getAllByLabelText("Selected calendar date")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Save Time Off" })).toBeTruthy();
});

it("offers only availability and time off, defaulting time off to an all-day date range", async () => {
  const { writes, date } = setup();
  await screen.findByText("Own Clinician");
  fireEvent.click(screen.getByTestId("button-add-availability"));
  expect(screen.getAllByRole("combobox")[0].querySelectorAll("option")).toHaveLength(2);
  expect(screen.queryByRole("option", { name: "Block Hours on a Date" })).toBeNull();
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Vacation" } });
  const allDay = await screen.findByRole("switch", { name: "All day" });
  expect(allDay.getAttribute("aria-checked")).toBe("true");
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  const dates = screen.getAllByLabelText("Selected calendar date");
  fireEvent.change(dates[0], { target: { value: date } });
  fireEvent.change(dates[1], { target: { value: format(addDays(new Date(`${date}T12:00:00`), 1), "yyyy-MM-dd") } });
  fireEvent.click(screen.getByRole("button", { name: "Save Time Off" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].path).toBe("/api/timeslots/own");
  expect(writes[0].body).toEqual([
    expect.objectContaining({ type: "Vacation", date }),
    expect.objectContaining({ type: "Vacation", date: format(addDays(new Date(`${date}T12:00:00`), 1), "yyyy-MM-dd") }),
  ]);
});

it("returns to all-day time off when switching type or reopening the dialog", async () => {
  setup();
  await chooseBlock();
  expect(screen.getByRole("switch", { name: "All day" }).getAttribute("aria-checked")).toBe("false");
  expect((screen.getAllByRole("combobox")[0] as HTMLSelectElement).value).toBe("Vacation");
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Recurring" } });
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Vacation" } });
  expect(screen.getByRole("switch", { name: "All day" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("switch", { name: "All day" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByTestId("button-add-availability"));
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Vacation" } });
  expect(screen.getByRole("switch", { name: "All day" }).getAttribute("aria-checked")).toBe("true");
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

it("normalizes earlier availability minute choices when switching to hourly time off", async () => {
  setup();
  await screen.findByText("Own Clinician");
  fireEvent.click(screen.getByTestId("button-add-availability"));
  const recurringTimes = screen.getAllByRole("combobox");
  fireEvent.change(recurringTimes[2], { target: { value: "09:30" } });
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Vacation" } });
  fireEvent.click(await screen.findByRole("switch", { name: "All day" }));
  const hourlyTimes = screen.getAllByRole("combobox").slice(1) as HTMLSelectElement[];
  expect(hourlyTimes[0].value).toBe("09:00");
  expect(hourlyTimes[1].value).toBe("10:00");
  expect(hourlyTimes.every(select => [...select.options].every(option => option.value.endsWith(":00")))).toBe(true);
  expect(screen.getAllByLabelText("Selected calendar date")).toHaveLength(1);
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

it("prefills an own block, saves revised date/hours, and refreshes the calendar without a delete", async () => {
  const { writes, date } = setup({ existing: true });
  fireEvent.click(await screen.findByTestId("button-edit-time-off-own-block"));
  expect(screen.queryByTestId("button-edit-time-off-colleague-block")).toBeNull();
  expect((screen.getByLabelText("Selected calendar date") as HTMLInputElement).value).toBe(date);
  expect((screen.getByLabelText("Start time") as HTMLSelectElement).value).toBe("09:00");
  expect((screen.getByLabelText("End time") as HTMLSelectElement).value).toBe("11:00");
  const nextDate = format(addDays(new Date(`${date}T12:00:00`), 1), "yyyy-MM-dd");
  fireEvent.change(screen.getByLabelText("Selected calendar date"), { target: { value: nextDate } });
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "12:00" } });
  fireEvent.change(screen.getByLabelText("End time"), { target: { value: "14:00" } });
  fireEvent.click(screen.getByTestId("button-save-time-off-edit"));
  await waitFor(() => expect(writes).toEqual([{
    path: "/api/time-off-blocks/own-block", body: { date: nextDate, startTime: "12:00", endTime: "14:00" },
  }]));
  await waitFor(() => expect(screen.queryByTestId("button-save-time-off-edit")).toBeNull());
  await waitFor(() => expect(screen.getByTestId("time-off-block-own-block").textContent).toContain("12:00–14:00"));
});

it("keeps failed edit values and the original calendar block, then allows cancellation", async () => {
  const { writes } = setup({ existing: true, conflict: true });
  fireEvent.click(await screen.findByTestId("button-edit-time-off-own-block"));
  fireEvent.change(screen.getByLabelText("End time"), { target: { value: "13:00" } });
  fireEvent.click(screen.getByTestId("button-save-time-off-edit"));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Resolve the existing appointment"));
  expect((screen.getByLabelText("End time") as HTMLSelectElement).value).toBe("13:00");
  expect(screen.getByTestId("time-off-block-own-block").textContent).toContain("09:00–11:00");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByTestId("button-save-time-off-edit")).toBeNull());
  expect(writes).toHaveLength(1);
});

it("cancels without writing and blocks reversed ranges", async () => {
  const { writes } = setup({ existing: true });
  fireEvent.click(await screen.findByTestId("button-edit-time-off-own-block"));
  fireEvent.change(screen.getByLabelText("End time"), { target: { value: "08:00" } });
  expect((screen.getByTestId("button-save-time-off-edit") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(writes).toEqual([]);
});

it("lets admins edit a colleague's block", async () => {
  h.role = "admin";
  const { writes, date } = setup({ existing: true });
  fireEvent.click(await screen.findByTestId("button-edit-time-off-colleague-block"));
  expect((screen.getByLabelText("Start time") as HTMLSelectElement).value).toBe("10:00");
  fireEvent.change(screen.getByLabelText("End time"), { target: { value: "12:00" } });
  fireEvent.click(screen.getByTestId("button-save-time-off-edit"));
  await waitFor(() => expect(writes).toEqual([{
    path: "/api/time-off-blocks/colleague-block", body: { date, startTime: "10:00", endTime: "12:00" },
  }]));
  await waitFor(() => expect(screen.queryByTestId("button-save-time-off-edit")).toBeNull());
  await waitFor(() => expect(screen.getByTestId("time-off-block-colleague-block").textContent).toContain("10:00–12:00"));
  expect(screen.getByTestId("time-off-block-own-block").textContent).toContain("09:00–11:00");
});

it("prevents duplicate submissions and closing while an edit is saving", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const { writes } = setup({ existing: true, beforeWrite: () => pending });
  fireEvent.click(await screen.findByTestId("button-edit-time-off-own-block"));
  fireEvent.click(screen.getByTestId("button-save-time-off-edit"));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect((screen.getByTestId("button-save-time-off-edit") as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId("button-save-time-off-edit"));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(writes).toHaveLength(1);
  finish();
  await waitFor(() => expect(screen.queryByTestId("button-save-time-off-edit")).toBeNull());
});

it("does not offer edits for disabled practices", async () => {
  setup({ existing: true, enabled: false });
  await screen.findByTestId("time-off-block-own-block");
  expect(screen.queryByTestId("button-edit-time-off-own-block")).toBeNull();
});
