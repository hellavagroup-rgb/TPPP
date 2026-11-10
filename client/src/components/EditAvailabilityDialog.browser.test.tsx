// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditAvailabilityDialog } from "./EditAvailabilityDialog";
import type { TimeSlot } from "@shared/schema";
const slot = { id: "slot", type: "Recurring", day: "Monday", frequency: "weekly", startDate: null, endDate: null,
  startTime: "10:00", endTime: "11:00", locationType: "online" } as TimeSlot;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("clearly edits the whole series and sends only editable fields", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const onSaved = vi.fn();
  render(<EditAvailabilityDialog slot={slot} onClose={vi.fn()} onSaved={onSaved} />);
  expect(screen.getByText(/whole recurring series, not just the date/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Day"), { target: { value: "Friday" } });
  fireEvent.click(screen.getByRole("button", { name: "Save series changes" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(fetchMock.mock.calls[0][0]).toBe("/api/timeslots/slot/schedule");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    type: "Recurring", day: "Friday", frequency: "weekly", startDate: null, endDate: null,
    startTime: "10:00", endTime: "11:00", locationType: "online",
  });
});
it("keeps stale-booking errors visible without closing the editor", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "This slot is now reserved." }), { status: 409 })));
  const onSaved = vi.fn();
  render(<EditAvailabilityDialog slot={slot} onClose={vi.fn()} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("button", { name: "Save series changes" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "This slot is now reserved.");
  expect(onSaved).not.toHaveBeenCalled();
});
it("distinguishes a single date and validates times before sending", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(<EditAvailabilityDialog slot={{ ...slot, type: "SpecificDate", date: "2099-01-05" }} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.getByText(/only to this one date/)).toBeTruthy();
  expect(screen.queryByLabelText("Day")).toBeNull();
  fireEvent.change(screen.getByLabelText("End time"), { target: { value: "09:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save date changes" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "End time must be after start time.");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("shows CY&A-specific availability labels and explanatory help while retaining stored values", () => {
  render(<EditAvailabilityDialog slot={slot} cyaAvailabilityLabels onClose={vi.fn()} onSaved={vi.fn()} />);
  const formatSelect = screen.getByLabelText("Session format") as HTMLSelectElement;
  expect(Array.from(formatSelect.options).map(option => [option.value, option.textContent])).toEqual([
    ["online", "Online only"],
    ["in_person", "At the practice — in person or online"],
  ]);
  expect(screen.getByText(/At the practice availability can be delivered in person or online/)).toBeTruthy();
});

it("keeps the standard format labels for other practices", () => {
  render(<EditAvailabilityDialog slot={slot} onClose={vi.fn()} onSaved={vi.fn()} />);
  const formatSelect = screen.getByLabelText("Session format") as HTMLSelectElement;
  expect(Array.from(formatSelect.options).map(option => option.textContent)).toEqual(["Online", "In person"]);
  expect(screen.queryByText(/At the practice availability/)).toBeNull();
});
