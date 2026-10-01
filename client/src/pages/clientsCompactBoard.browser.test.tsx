// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { CompactClientCard, ClientDetailPanel, hasRecordedAppointmentSelection } from "@/components/CompactClientCard";
import { ConfirmPortalReconcile } from "@/components/ConfirmPortalReconcile";
import { classifyBookingProgress, getWriteUppArrangedIds } from "@/lib/clientBoardClassification";
import { mergePaymentInspection, paymentInspectionOutcome } from "@/lib/paymentInspectionState";
import { getClientNextStep, getCompactClientDescription } from "@/lib/clientNextStep";

afterEach(cleanup);

function TwoClientBoard() {
  const [selected, setSelected] = useState<string | null>(null);
  return <div>
    {["c-1", "c-2"].map((id, index) => <div key={id}>
      <CompactClientCard clientId={id} displayId={id} clientName={`Client ${index + 1}`} status="Matched"
        onOpen={() => setSelected(id)} />
      <ClientDetailPanel open={selected === id} onOpenChange={open => !open && setSelected(null)}
        displayId={id} status="Matched">
        <p data-testid={`detail-${id}`}>Private details for {id}</p>
        <button type="button">Client-specific action {id}</button>
      </ClientDetailPanel>
    </div>)}
  </div>;
}

describe("compact multi-clinician client board", () => {
  it("uses keyboard-operable button cards and opens only the selected client's details/actions", async () => {
    const user = userEvent.setup();
    render(<TwoClientBoard />);
    expect(screen.getByRole("button", { name: /Open c-1, Client 1 details/ })).toBeTruthy();
    expect(screen.queryByTestId("detail-c-1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Client-specific action c-1" })).toBeNull();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("detail-c-1")).toBeTruthy();
    await user.keyboard("{Escape}");
    fireEvent.click(screen.getByTestId("compact-client-card-c-2"));
    expect(screen.getByTestId("detail-c-2")).toBeTruthy();
    expect(screen.queryByTestId("detail-c-1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Client-specific action c-1" })).toBeNull();
    expect(screen.getByRole("button", { name: "Client-specific action c-2" })).toBeTruthy();
  });

  it("keeps the legacy Tenant 1 detail rendering unchanged when the panel is disabled", () => {
    render(<ClientDetailPanel enabled={false} open={false} onOpenChange={() => {}} displayId="T1-4" status="Assigned">
      <p data-testid="legacy-card">Existing Tenant 1 controls</p>
    </ClientDetailPanel>);
    expect(screen.getByTestId("legacy-card").textContent).toBe("Existing Tenant 1 controls");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a brief real admin note on the compact card when no parsed name is available", () => {
    const description = getCompactClientDescription('"Needs a late afternoon appointment; prefers phone."', null);
    render(<CompactClientCard clientId="note-1" displayId="WU4087139" status="Assigned"
      description={description} onOpen={() => {}} />);
    expect(screen.getByTestId("client-description-note-1").textContent)
      .toBe("Needs a late afternoon appointment; prefers phone.");
  });

  it("makes the card next action explicit for an Assigned record with no selected appointment", () => {
    const step = getClientNextStep({ status: "Assigned", hasSelectedAppointment: false, isAdmin: true });
    render(<CompactClientCard clientId="assigned-1" displayId="WU4087139" status="Assigned"
      nextStep={step} onOpen={() => {}} />);
    expect(screen.getByTestId("next-step-assigned-1").textContent).toContain("Next action");
    expect(screen.getByTestId("next-step-assigned-1").textContent).toContain("Review appointment choices");
    expect(step.action).toBe("offer_new_choices");
  });

  it("recognizes recorded clinician and slot evidence when allocation details are not exposed", () => {
    const hasSelectedAppointment = hasRecordedAppointmentSelection({
      visibilityEnabled: false,
      assignedClinicianId: "clinician-1",
      assignedSlotId: "slot-1",
    });
    const step = getClientNextStep({ status: "Assigned", hasSelectedAppointment, isAdmin: true });
    expect(step.title).toBe("Review the allocation");
    expect(step.action).toBe("review_allocation");
  });

  it("respects an explicit empty visibility projection instead of falling back to legacy ids", () => {
    expect(hasRecordedAppointmentSelection({
      visibilityEnabled: true,
      allocationVisibility: null,
      assignedClinicianId: "clinician-1",
      assignedSlotId: "legacy-slot",
    })).toBe(false);
  });

  it("identifies the family as the wait owner when valid appointment choices remain pending", () => {
    const step = getClientNextStep({
      status: "OptionsSent",
      offerState: "pending",
      offerDeliveryRecorded: true,
      offerEligibility: { pendingCount: 2, availableCount: 1, unavailableCount: 0 },
    });
    render(<CompactClientCard clientId="wait-1" displayId="WU4087139" status="Options sent"
      nextStep={step} onOpen={() => {}} />);
    expect(screen.getByTestId("next-step-wait-1").textContent).toContain("Waiting for");
    expect(screen.getByTestId("next-step-wait-1").textContent).toContain("Waiting for the family to choose");
  });

  it("does not claim the family is waiting until current offer delivery is recorded", () => {
    const step = getClientNextStep({
      status: "OptionsSent",
      offerState: "pending",
      offerDeliveryRecorded: false,
      offerEligibility: { pendingCount: 2, availableCount: 1, unavailableCount: 0 },
    });
    expect(step.kind).toBe("action");
    expect(step.title).toBe("Review offer delivery");
    expect(step.action).toBe("review_offer");
  });

  it("keeps RegistrationPending copy neutral for insurer or disabled-payment workflows", () => {
    const step = getClientNextStep({
      status: "RegistrationPending",
      registrationProgress: "completed",
      paymentProgress: "not_required",
      hasSelectedAppointment: true,
      registrationEnabled: true,
    });
    render(<CompactClientCard clientId="reg-1" displayId="WU4087139" status="Booking in progress"
      nextStep={step} onOpen={() => {}} />);
    expect(screen.getByTestId("compact-client-card-reg-1").textContent).toContain("Booking in progress");
    expect(screen.getByTestId("compact-client-card-reg-1").textContent).not.toContain("Payment pending");
  });

  it("does not require WriteUpp checklist steps when that feature is disabled", () => {
    const step = getClientNextStep({
      status: "BookingConfirmed",
      writeuppChecklistEnabled: false,
      writeuppAppointmentConfirmed: false,
      writeuppDataTransferred: false,
      completedBookingsEnabled: false,
    });
    expect(step.kind).toBe("waiting");
    expect(step.title).toBe("Booking verified");
    expect(step.action).toBeUndefined();
  });

  it("does not ask staff to repeat an already recorded WriteUpp arrangement", () => {
    const step = getClientNextStep({
      status: "RegistrationPending",
      externallyArranged: true,
      registrationProgress: "sent",
      paymentProgress: "awaiting_client",
    });
    expect(step.title).toBe("No further booking action");
    expect(step.action).toBeUndefined();
  });

  it("puts detail guidance first and exposes its eligible action callback", async () => {
    const user = userEvent.setup();
    const onGuidanceAction = vi.fn();
    render(<ClientDetailPanel open onOpenChange={() => {}} displayId="WU4087139" status="Assigned"
      guidance={{ kind: "action", title: "Offer fresh choices", detail: "No selected appointment is recorded." }}
      onGuidanceAction={onGuidanceAction}>
      <p data-testid="detail-body">Allocation details</p>
    </ClientDetailPanel>);
    const guidance = screen.getByTestId("client-next-guidance");
    expect(guidance.compareDocumentPosition(screen.getByTestId("detail-body")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    expect(onGuidanceAction).toHaveBeenCalledTimes(1);
  });

  it("groups only explicit writeuppArranged records outside active Booking progress", () => {
    const result = classifyBookingProgress([
      { id: "reviewed", status: "AwaitingConfirmation", writeuppArranged: false },
      { id: "arranged", status: "RegistrationPending", writeuppArranged: true },
      { id: "unset", status: "AwaitingConfirmation" },
      { id: "portal", status: "BookingConfirmed", writeuppArranged: true },
    ]);
    expect(result.active.map(client => client.id)).toEqual(["reviewed", "unset"]);
    expect(result.arranged.map(client => client.id)).toEqual(["arranged"]);
    expect(result.confirmed.map(client => client.id)).toEqual(["portal"]);
    const allGroups = [...result.active, ...result.arranged, ...result.confirmed].map(client => client.id);
    expect(allGroups).toHaveLength(4);
    expect(new Set(allGroups).size).toBe(4);
  });

  it("ignores cached arrangement evidence when the feature is disabled or the inventory failed", () => {
    const cached = [{ id: "client-a", writeuppArranged: true }];
    expect(getWriteUppArrangedIds(cached, {
      compactEnabled: false, historicEnabled: true, loading: false, error: false,
    }).size).toBe(0);
    expect(getWriteUppArrangedIds(cached, {
      compactEnabled: true, historicEnabled: true, loading: false, error: true,
    }).size).toBe(0);
    expect(getWriteUppArrangedIds(cached, {
      compactEnabled: true, historicEnabled: true, loading: true, error: false,
    }).size).toBe(0);
  });

  it("retains prior payment inspection results when another client is checked", () => {
    const first = mergePaymentInspection({}, "client-a", { state: "paid_unrecorded", detail: "Verified", reconciled: true });
    const second = mergePaymentInspection(first, "client-b", { state: "awaiting", detail: "Not paid" });
    expect(second["client-a"].reconciled).toBe(true);
    expect(second["client-a"].state).toBe("paid_unrecorded");
    expect(second["client-b"].state).toBe("awaiting");
  });

  it.each(["open", "awaiting"])("does not report a %s HTTP-200 reconcile response as success", state => {
    expect(paymentInspectionOutcome({ state, detail: "Still pending" }, true).reconciled).toBe(false);
    expect(paymentInspectionOutcome({ state: "recorded", detail: "Confirmed" }, true).reconciled).toBe(true);
  });

  it("requires explicit confirmation before portal reconciliation", () => {
    const reconcile = vi.fn();
    render(<ConfirmPortalReconcile onConfirm={reconcile} />);
    fireEvent.click(screen.getByRole("button", { name: "Reconcile verified payment" }));
    expect(reconcile).not.toHaveBeenCalled();
    expect(screen.getByText(/confirms the selected appointment in the portal and sends the booking confirmation email/i)).toBeTruthy();
    expect(screen.getByText(/does not arrange or book an appointment in WriteUpp/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm portal booking" }));
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});