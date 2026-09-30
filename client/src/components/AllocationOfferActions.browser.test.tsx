// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AllocationCardDetails } from "@/components/AllocationVisibility";
import { AllocationOfferActions } from "@/components/AllocationOfferActions";

afterEach(cleanup);

describe("allocation offer actions", () => {
  it("shows declined status, contact flow and new choices when allocation visibility is off", () => {
    const onContactFamily = vi.fn();
    const onOfferNewChoices = vi.fn();
    render(
      <>
        <AllocationCardDetails enabled={false} status="OptionsSent" data={null} clientId="declined" notes={null} />
        <AllocationOfferActions state="declined" clientId="declined"
          onContactFamily={onContactFamily} onOfferNewChoices={onOfferNewChoices} onResend={vi.fn()} />
      </>,
    );

    expect(screen.getByRole("status").textContent).toContain("declined all appointment options");
    fireEvent.click(screen.getByRole("button", { name: "Contact family" }));
    fireEvent.click(screen.getByRole("button", { name: "Offer New Choices" }));
    expect(onContactFamily).toHaveBeenCalledOnce();
    expect(onOfferNewChoices).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Resend Options Email" })).toBeNull();
  });

  it("only offers resend for an active pending offer", () => {
    const onResend = vi.fn();
    const common = { clientId: "client", onContactFamily: vi.fn(), onOfferNewChoices: vi.fn(), onResend };
    const { rerender } = render(<AllocationOfferActions {...common} state="pending" />);
    fireEvent.click(screen.getByRole("button", { name: "Resend Options Email" }));
    expect(onResend).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Offer New Choices" })).toBeNull();

    rerender(<AllocationOfferActions {...common} state="closed"
      eligibility={{ pendingCount: 2, availableCount: 0, unavailableCount: 2 }} />);
    expect(screen.queryByRole("button", { name: "Resend Options Email" })).toBeNull();
    expect(screen.getByRole("button", { name: "Offer New Choices" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).not.toContain("unavailable");
  });

  it("disables resend while a resend request is pending", () => {
    render(<AllocationOfferActions state="pending" clientId="client" resendPending
      onContactFamily={vi.fn()} onOfferNewChoices={vi.fn()} onResend={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Resend Options Email" })).toHaveProperty("disabled", true);
  });

  it("offers new choices instead of resend when all pending choices are unavailable", () => {
    const onOfferNewChoices = vi.fn();
    render(<AllocationOfferActions state="pending" clientId="all-unavailable"
      eligibility={{ pendingCount: 3, availableCount: 0, unavailableCount: 3 }}
      onContactFamily={vi.fn()} onOfferNewChoices={onOfferNewChoices} onResend={vi.fn()} />);

    expect(screen.getByText("Options sent to client")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("All 3 appointment choices are unavailable (3 unavailable)");
    expect(screen.queryByRole("button", { name: "Resend Options Email" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Offer New Choices" }));
    expect(onOfferNewChoices).toHaveBeenCalledOnce();
  });

  it("reports unavailable and remaining choices when eligibility is mixed", () => {
    render(<AllocationOfferActions state="pending" clientId="mixed"
      eligibility={{ pendingCount: 4, availableCount: 2, unavailableCount: 2 }}
      onContactFamily={vi.fn()} onOfferNewChoices={vi.fn()} onResend={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toContain("2 of 4 appointment choices are unavailable; 2 remain available");
    expect(screen.queryByRole("button", { name: "Resend Options Email" })).toBeNull();
    expect(screen.getByRole("button", { name: "Offer New Choices" })).toBeTruthy();
  });

  it("keeps resend available when all pending choices remain eligible", () => {
    render(<AllocationOfferActions state="pending" clientId="valid"
      eligibility={{ pendingCount: 3, availableCount: 3, unavailableCount: 0 }}
      onContactFamily={vi.fn()} onOfferNewChoices={vi.fn()} onResend={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Resend Options Email" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Offer New Choices" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});