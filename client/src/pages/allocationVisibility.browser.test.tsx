// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AllocationCardDetails, type AllocationVisibilityData } from "@/components/AllocationVisibility";

afterEach(cleanup);

const data: AllocationVisibilityData = {
  appointment: { clinicianName: "Dr Chen", type: "Recurring", day: "Tuesday", date: null,
    startTime: "10:00", endTime: "11:00", locationType: "online", retired: false },
  options: [
    { status: "selected", clinicianName: "Dr Chen", createdAt: "2026-09-01",
      sentAt: "2026-09-02", slot: { type: "Recurring", day: "Tuesday", date: null,
        startTime: "10:00", endTime: "11:00", locationType: "online", retired: false } },
    { status: "declined", clinicianName: "Dr Jones", createdAt: "2026-09-01",
      sentAt: null, slot: null },
    { status: "unavailable", clinicianName: "Dr Smith", createdAt: "2026-08-20",
      sentAt: null, slot: null },
  ],
};

describe("tenant-gated allocation cards", () => {
  it.each(["Assigned", "OptionSelected", "RegistrationPending", "AwaitingConfirmation", "BookingConfirmed"])(
    "shows appointment, offer states and notes in %s", status => {
      render(<AllocationCardDetails enabled status={status} data={data} clientId="one" notes="Important intake note" />);
      expect(screen.getByTestId("selected-appointment-one").textContent).toContain("Tuesday 10:00–11:00");
      expect(screen.getByTestId("selected-appointment-one").textContent).toContain("Dr Chen");
      expect(screen.getByTestId("notes-one").textContent).toContain("Important intake note");
      if (screen.getByRole("button", { name: "Offered options (3)" }).getAttribute("aria-expanded") === "false") {
        fireEvent.click(screen.getByRole("button", { name: "Offered options (3)" }));
      }
      const history = screen.getByTestId("offer-history-one");
      expect(history.textContent).toContain("Selected");
      expect(history.textContent).toContain("Declined");
      expect(history.textContent).toContain("Unavailable");
      expect(history.textContent).toContain("Sent 02/09/2026");
      expect(history.textContent).toContain("send time unavailable");
    },
  );

  it("shows notes and offer history but not a made-up selection for OptionsSent", () => {
    render(<AllocationCardDetails enabled status="OptionsSent" data={data} clientId="one" notes="Follow up" />);
    expect(screen.queryByTestId("selected-appointment-one")).toBeNull();
    expect(screen.getByTestId("notes-one").textContent).toContain("Follow up");
    expect(screen.getByTestId("offer-history-one")).toBeTruthy();
    expect(screen.getByTestId("offer-history-one").textContent).toContain("Tuesday 10:00–11:00");
  });

  it("adds no new card content for Tenant 1", () => {
    render(<AllocationCardDetails enabled={false} status="BookingConfirmed" data={data}
      clientId="one" notes="Existing note" />);
    expect(screen.queryByTestId("selected-appointment-one")).toBeNull();
    expect(screen.queryByTestId("offer-history-one")).toBeNull();
    expect(screen.queryByTestId("notes-one")).toBeNull();
  });

  it("marks missing or retired details honestly", () => {
    render(<AllocationCardDetails enabled status="BookingConfirmed" data={{
      appointment: null,
      options: [{ ...data.options[0], slot: { ...data.options[0].slot!, retired: true } }],
    }} clientId="one" notes={null} />);
    expect(screen.getByTestId("selected-appointment-one").textContent).toContain("Appointment details unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Offered options (1)" }));
    expect(screen.getByTestId("offer-history-one").textContent).toContain("Slot retired");
  });

  it.each(["Assigned", "OptionSelected"])("preserves historic text with a blank projection in %s", status => {
    render(<AllocationCardDetails enabled status={status} data={null} clientId="old"
      historicSlot="Thursday 14:00 (historic)" notes="Authorised staff note" />);
    expect(screen.getByTestId("selected-appointment-old").textContent).toContain("Appointment details unavailable");
    expect(screen.getByTestId("historic-slot-old").textContent).toContain("Recorded appointment text (not verified): Thursday 14:00 (historic)");
    expect(screen.getByTestId("notes-old").textContent).toContain("Authorised staff note");
    expect(screen.getByTestId("offer-history-old").textContent).toContain("No recorded options");
  });

  it("preserves known partial fields and labels historic text separately", () => {
    render(<AllocationCardDetails enabled status="Assigned" data={{
      appointment: { ...data.appointment!, startTime: null, endTime: null },
      legacyAssignedSlot: "Friday 15:00", options: [],
    }} clientId="partial" notes={null} />);
    const text = screen.getByTestId("selected-appointment-partial").textContent;
    expect(text).toContain("Dr Chen");
    expect(text).toContain("Tuesday · Time unavailable");
    expect(text).toContain("Online");
    expect(text).toContain("Recorded appointment text (not verified): Friday 15:00");
    expect(text).not.toContain("undefined");
    expect(screen.queryByTestId("notes-partial")).toBeNull();
  });

  it("does not show stale historic text when complete verified details exist", () => {
    render(<AllocationCardDetails enabled status="Assigned" data={data} clientId="one"
      historicSlot="Friday 15:00" notes={null} />);
    expect(screen.queryByTestId("historic-slot-one")).toBeNull();
  });

  it("keeps notes and the correct details visible as a card moves through Matched statuses", () => {
    const view = render(<AllocationCardDetails enabled status="Assigned" data={null}
      clientId="moving" notes="Keep this note" />);
    expect(screen.getByTestId("selected-appointment-moving").textContent).toContain("Appointment details unavailable");
    view.rerender(<AllocationCardDetails enabled status="OptionsSent" data={data}
      clientId="moving" notes="Keep this note" />);
    expect(screen.queryByTestId("selected-appointment-moving")).toBeNull();
    expect(screen.getByTestId("offer-history-moving").textContent).toContain("Tuesday 10:00");
    expect(screen.getByTestId("notes-moving").textContent).toContain("Keep this note");
    view.rerender(<AllocationCardDetails enabled status="OptionSelected" data={data}
      clientId="moving" notes="Keep this note" />);
    expect(screen.getByTestId("selected-appointment-moving").textContent).toContain("Tuesday 10:00");
    expect(screen.getByTestId("notes-moving").textContent).toContain("Keep this note");
  });

  it.each(["Assigned", "OptionsSent", "OptionSelected"])("does not add details to disabled Tenant 1 in %s", status => {
    const { container } = render(<AllocationCardDetails enabled={false} status={status}
      data={data} clientId="one" historicSlot="Monday 09:00" notes="Existing note" />);
    expect(container.textContent).toBe("");
  });
});