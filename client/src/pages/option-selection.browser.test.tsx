// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { useQueryMock, useMutationMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  useMutationMock: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
}));
vi.mock("wouter", () => ({
  useRoute: () => [true, { selectionToken: "token" }],
  useLocation: () => ["/", vi.fn()],
}));

import OptionSelection from "./option-selection";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderOptions(options: unknown[], regularSessionCopy = false) {
  useQueryMock.mockReturnValue({
    data: {
      options,
      clientStatus: "OptionsSent",
      tenantName: "Test Practice",
      primaryColor: null,
      regularSessionCopy,
    },
    isLoading: false,
    isError: false,
  });
  useMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
  return render(<OptionSelection />);
}

describe("public allocation option details", () => {
  const recurring = {
    id: "weekly", status: "pending", clinicianName: "Dr Eve", available: true,
    slot: { type: "Recurring", day: "Wednesday", date: null, startTime: "15:00", endTime: "16:00",
      locationType: "online", frequency: "weekly", startDate: "2020-10-07", endDate: null },
  };

  it("uses the Tenant 2 wording for recurring slots without showing a historical window date", () => {
    renderOptions([recurring], true);
    expect(screen.getByText("Regular session slot")).toBeTruthy();
    expect(screen.getByText("Weekly · Wednesday · 3:00 PM–4:00 PM")).toBeTruthy();
    expect(screen.getByText("First session date: to be agreed.")).toBeTruthy();
    expect(screen.getByText(/After you choose a slot and complete registration/)).toBeTruthy();
    expect(screen.queryByText(/Availability window|7 Oct 2020|within.*weeks/)).toBeNull();
    expect(screen.getByRole("button", { name: "Select this option" }).hasAttribute("disabled")).toBe(false);
  });

  it("retains real future constraints and fortnightly frequency for Tenant 2", () => {
    renderOptions([{ ...recurring, slot: { ...recurring.slot, frequency: "fortnightly", startDate: "2099-10-07" } }], true);
    expect(screen.getByText("Fortnightly · Wednesday · 3:00 PM–4:00 PM")).toBeTruthy();
    expect(screen.getByText("Available from 7 Oct 2099 (earliest possible start; first session date to be agreed).")).toBeTruthy();
  });

  it("keeps exact one-off dates for Tenant 2 without the recurring-first-session disclaimer", () => {
    renderOptions([{ ...recurring, slot: { ...recurring.slot, type: "SpecificDate", date: "2099-10-07" } }], true);
    expect(screen.getByText("One-off appointment: 7 Oct 2099")).toBeTruthy();
    expect(screen.queryByText("First session date: to be agreed.")).toBeNull();
    expect(screen.queryByText("Regular session slot")).toBeNull();
  });

  it("shows recurrence and the availability window without inventing a first appointment", () => {
    renderOptions([{
      id: "weekly", status: "pending", clinicianName: "Dr Eve", available: true,
      slot: {
        type: "Recurring", day: "Monday", date: null, startTime: "09:00", endTime: "10:00",
        locationType: "online", frequency: "weekly", startDate: "2026-06-01", endDate: "2026-11-30",
      },
    }]);

    expect(screen.getByText(/Weekly · Monday · 9:00 AM–10:00 AM/)).toBeTruthy();
    expect(screen.getByText("Availability window: 1 Jun 2026 – 30 Nov 2026")).toBeTruthy();
    expect(screen.getByText("First appointment date to be confirmed.")).toBeTruthy();
    expect(screen.getByText(/First appointment date to be confirmed/).textContent).not.toContain("8 Jun");
  });

  it("labels one-off appointments with the exact date and disables unavailable offers", () => {
    renderOptions([{
      id: "oneoff", status: "pending", clinicianName: "Dr Frank", available: false,
      slot: {
        type: "SpecificDate", day: null, date: "2026-08-16", startTime: "14:00", endTime: "15:00",
        locationType: "in_person",
      },
    }]);

    expect(screen.getByText("One-off appointment: 16 Aug 2026")).toBeTruthy();
    expect(screen.getByText("2:00 PM–3:00 PM")).toBeTruthy();
    expect(screen.getByText(/This option is no longer available/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select this option" }).hasAttribute("disabled")).toBe(true);
  });
});