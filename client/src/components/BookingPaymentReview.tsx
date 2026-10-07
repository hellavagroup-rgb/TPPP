import { Button } from "@/components/ui/button";
import type { PaymentInspectionResult } from "@/lib/paymentInspectionState";

const inspectionLabels: Record<string, string> = {
  paid_unrecorded: "Payment found — portal recording needs review",
  recorded: "Payment recorded",
  open: "Checkout is still open",
  awaiting: "Payment has not been verified",
  uncertain: "Unable to verify payment",
};

export function BookingPaymentReview({
  clientId, displayId, paymentStatus, canInspect, unavailableReason, checking, inspection, onInspect,
}: {
  clientId: string;
  displayId: string;
  paymentStatus: string | null;
  canInspect: boolean;
  unavailableReason: string;
  checking: boolean;
  inspection?: PaymentInspectionResult;
  onInspect: () => void;
}) {
  return (
    <section id={`payment-review-${clientId}`} data-testid={`payment-review-${clientId}`}
      aria-labelledby={`payment-review-title-${clientId}`}
      className="rounded-md border border-indigo-200 bg-white p-4">
      <h3 id={`payment-review-title-${clientId}`} className="text-sm font-semibold text-slate-900">Review payment record</h3>
      <p className="mt-1 text-xs text-slate-600">{displayId} · Booking confirmed; payment setup needs staff review.</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <dt className="text-slate-600">Portal payment setup</dt>
        <dd className="font-medium text-slate-900">
          {paymentStatus === "setup_pending" ? "Setup pending — not verified" : "No verified active setup"}
        </dd>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-slate-700">
        A note saying payment is completed does not verify the portal payment record. This warning does not prove the client is unpaid.
      </p>
      <ol className="mt-3 list-decimal space-y-2 pl-4 text-xs leading-relaxed text-slate-700">
        <li>Check the payment already made in Stripe or the practice’s payment records. Do not send another payment request.</li>
        <li>If payment was handled outside this portal, ask an administrator to review the existing evidence and the appropriate recording process.</li>
        <li>Move to Completed only after the payment record is verified and the other booking checks pass. This finishes booking administration, not therapy.</li>
      </ol>
      {canInspect ? (
        <Button size="sm" variant="outline" className="mt-3" disabled={checking} onClick={onInspect}>
          {checking ? "Checking Stripe…" : "Check Stripe payment (read-only)"}
        </Button>
      ) : (
        <p className="mt-3 rounded bg-slate-50 p-2 text-xs text-slate-600">{unavailableReason}</p>
      )}
      {inspection && (
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs" role="status"
          data-testid={`payment-review-result-${clientId}`}>
          <p className="font-semibold">{inspectionLabels[inspection.state] || "Unable to verify payment"}</p>
          <p className="mt-1">{inspection.detail}</p>
          {inspection.blocker && <p className="mt-1 text-amber-800">{inspection.blocker}</p>}
          <p className="mt-2 text-slate-600">This read-only check does not record or reconcile payment, change booking status, or contact the client.</p>
        </div>
      )}
    </section>
  );
}
