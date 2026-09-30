import { Button } from "@/components/ui/button";
import { Mail, RefreshCw, UserRound } from "lucide-react";
import type { AllocationOfferEligibility } from "@shared/allocationOfferSummary";

export type AllocationOfferState = "pending" | "declined" | "closed" | null;

interface AllocationOfferActionsProps {
  state: AllocationOfferState;
  onContactFamily: () => void;
  onOfferNewChoices: () => void;
  onResend: () => void;
  resendPending?: boolean;
  clientId: string;
  eligibility?: AllocationOfferEligibility | null;
}

export function AllocationOfferActions({
  state,
  onContactFamily,
  onOfferNewChoices,
  onResend,
  resendPending = false,
  clientId,
  eligibility,
}: AllocationOfferActionsProps) {
  if (state === "pending") {
    const unavailableCount = eligibility?.unavailableCount ?? 0;
    if (unavailableCount > 0) {
      const pendingCount = eligibility?.pendingCount ?? 0;
      const availableCount = eligibility?.availableCount ?? 0;
      const warning = availableCount === 0
        ? `All ${pendingCount} appointment choices are unavailable (${unavailableCount} unavailable). Offer New Choices to send the client current options.`
        : `${unavailableCount} of ${pendingCount} appointment choices are unavailable; ${availableCount} remain available. Offer New Choices to send the client current options.`;

      return (
        <div className="mt-2 space-y-2" data-testid={`allocation-offer-actions-${clientId}`}>
          <p className="text-[10px] text-orange-600 flex items-center gap-1">
            <Mail className="h-3 w-3" /> Options sent to client
          </p>
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2" role="status">
            {warning}
          </p>
          <Button
            size="sm"
            className="w-full gap-1 text-xs"
            onClick={onOfferNewChoices}
            data-testid={`button-offer-new-choices-${clientId}`}
          >
            <RefreshCw className="h-3 w-3" /> Offer New Choices
          </Button>
        </div>
      );
    }

    return (
      <div data-testid={`allocation-offer-actions-${clientId}`}>
        <p className="text-[10px] text-orange-600 mt-2 flex items-center gap-1">
          <Mail className="h-3 w-3" /> Options sent to client
        </p>
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-1 text-[10px] mt-2 border-orange-300 text-orange-700 hover:bg-orange-50 h-auto py-2"
          disabled={resendPending}
          onClick={onResend}
          data-testid={`button-resend-allocation-options-${clientId}`}
        >
          {resendPending ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
          Resend Options Email
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2" data-testid={`allocation-offer-actions-${clientId}`}>
      {state === "declined" ? (
        <>
          <p className="text-xs text-amber-700" role="status">
            The client declined all appointment options. Contact the family to discuss what could work.
          </p>
          <Button size="sm" variant="outline" className="w-full gap-1 text-xs" onClick={onContactFamily}>
            <UserRound className="h-3 w-3" /> Contact family
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground" role="status">
          There are no active appointment options to resend.
        </p>
      )}
      <Button
        size="sm"
        className="w-full gap-1 text-xs"
        onClick={onOfferNewChoices}
        data-testid={`button-offer-new-choices-${clientId}`}
      >
        <RefreshCw className="h-3 w-3" /> Offer New Choices
      </Button>
    </div>
  );
}