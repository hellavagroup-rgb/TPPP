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

    rerender(<AllocationOfferActions {...common} state="closed" />);
    expect(screen.queryByRole("button", { name: "Resend Options Email" })).toBeNull();
    expect(screen.getByRole("button", { name: "Offer New Choices" })).toBeTruthy();
  });

  it("disables resend while a resend request is pending", () => {
    render(<AllocationOfferActions state="pending" clientId="client" resendPending
      onContactFamily={vi.fn()} onOfferNewChoices={vi.fn()} onResend={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Resend Options Email" })).toHaveProperty("disabled", true);
  });
});