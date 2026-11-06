// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminBookingCompletion } from "./AdminBookingCompletion";
afterEach(cleanup);
const client = { id: "old", displayId: "OLD-101", completedAt: null,
  writeuppAppointmentConfirmed: true, writeuppDataTransferred: true, paymentType: null };

it("retains the review note and acknowledgment when saving fails", async () => {
  const submit = vi.fn().mockRejectedValue(new Error("Save failed"));
  render(<AdminBookingCompletion client={client} enabled busy={false} onComplete={submit} onChecklistChange={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Mark booking admin complete" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("Review note"), "Reviewed the existing practice records.");
  await user.click(within(dialog).getByRole("checkbox"));
  await user.click(within(dialog).getByRole("button", { name: "Confirm admin completion" }));
  expect(submit).toHaveBeenCalledWith("Reviewed the existing practice records.");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(within(dialog).getByLabelText("Review note")).toHaveProperty("value", "Reviewed the existing practice records.");
  expect(within(dialog).getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
});

it("requires enabled completion and both saved checklist items", () => {
  const view = render(<AdminBookingCompletion client={client} enabled={false} busy={false} onComplete={vi.fn()} onChecklistChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Mark booking admin complete" })).toHaveProperty("disabled", true);
  view.rerender(<AdminBookingCompletion client={{ ...client, writeuppDataTransferred: false }} enabled busy={false} onComplete={vi.fn()} onChecklistChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Mark booking admin complete" })).toHaveProperty("disabled", true);
});

it("keeps missing evidence visible after administrative completion with no further completion controls", () => {
  render(<AdminBookingCompletion client={{ ...client, completedAt: "2026-01-14" }} enabled busy={false} onComplete={vi.fn()} onChecklistChange={vi.fn()} />);
  expect(screen.getByText("No portal registration submission")).toBeTruthy();
  expect(screen.getByText("Payment type not recorded in this portal")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Mark booking admin complete" })).toBeNull();
});
