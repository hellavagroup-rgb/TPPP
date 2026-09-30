import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export type HistoricRow = {
  id: string; displayId: string; status: string; portalSnapshot: boolean; portalConfirmedAt: string | null;
  bookingEmailAcceptedAt: string | null; portalBookingEvent: boolean; optionSelectionEvent: boolean;
  allocation: "missing" | "invalid" | "duplicate" | "reserved";
  slot: { type: string; day: string | null; date: string | null; startTime: string; endTime: string } | null;
  intakeSubmitted: boolean; registrationSubmitted: boolean;
  consentEvidence: "recorded" | "legacy_terms_only" | "not_recorded";
  paymentType: string | null; paymentStatus: string | null; chargeStatuses: string[];
  externalReview: { reviewedAt: string; externalReference: unknown; appointmentDate: unknown; startTime: unknown; familyMessageReview: unknown } | null;
};

export function useHistoricReconciliation(enabled: boolean) {
  return useQuery<HistoricRow[]>({
    queryKey: ["/api/historic-reconciliation"],
    enabled,
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/historic-reconciliation");
      if (!response.ok) throw new Error("Could not load reconciliation evidence");
      return response.json();
    },
  });
}

export function HistoricReconciliation({ rows, error }: { rows: HistoricRow[]; error: boolean }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<HistoricRow | null>(null);
  const [externalReference, setExternalReference] = useState("");
  const [clinicianReference, setClinicianReference] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [familyMessageReview, setFamilyMessageReview] = useState("");
  const [diaryVerified, setDiaryVerified] = useState(false);
  const cache = useQueryClient();
  const review = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/historic-reconciliation/${selected!.id}/external-review`, {
        externalReference, clinicianReference, appointmentDate, startTime, familyMessageReview, diaryVerified,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Review could not be recorded");
      }
    },
    onSuccess: () => {
      cache.invalidateQueries({ queryKey: ["/api/historic-reconciliation"] });
      setSelected(null);
    },
  });
  return (
    <section className="rounded-lg border p-4 bg-card" data-testid="historic-reconciliation">
      <Button variant="outline" onClick={() => setOpen(v => !v)}>Historic booking reconciliation (read-only inventory)</Button>
      {open && <div className="mt-4 space-y-3">
        <p className="text-sm text-muted-foreground">Compare the external diary and the family's actual message with each portal record before any correction. “Setup pending” is not payment proof. Recording an external review does not confirm a portal booking, charge a card, send an email, or alter a slot.</p>
        {error && <p role="alert">Evidence could not be loaded. Do not reconcile from this screen.</p>}
        {!error && rows.map(row => <div key={row.id} className="border rounded p-3 text-sm space-y-1" data-testid={`historic-row-${row.displayId}`}>
          <div className="font-semibold">{row.displayId} · {row.externalReview ? "Historically booked outside portal (staff reviewed)" : row.portalSnapshot ? "Portal booking confirmed" : row.status === "RegistrationPending" ? "Registration/payment pending in portal" : "Awaiting confirmation in portal"}</div>
          <p>Portal status: {row.status} · Allocation: {row.allocation}{row.slot ? ` (${row.slot.date || row.slot.day} ${row.slot.startTime}–${row.slot.endTime})` : ""}</p>
          {row.allocation === "duplicate" && <p className="text-destructive">Duplicate slot claim: resolve before confirming or recording a review.</p>}
          <p>Intake: {row.intakeSubmitted ? "submitted" : "not recorded"} · Registration: {row.registrationSubmitted ? "submitted" : "not recorded"} · Consent: {row.consentEvidence.replaceAll("_", " ")}</p>
          <p>Payment: {row.paymentType || "type missing"} / {row.paymentStatus || "status missing"} · Portal charges: {row.chargeStatuses.length ? row.chargeStatuses.join(", ") : "none recorded (check provider independently)"}</p>
          <p>Portal snapshot: {row.portalSnapshot ? `yes (${row.portalConfirmedAt})` : "none"} · Booking confirmation email accepted: {row.bookingEmailAcceptedAt || "not recorded"} · Booking event: {row.portalBookingEvent ? "recorded" : "none"} · Option selection: {row.optionSelectionEvent ? "recorded (not a confirmed appointment)" : "none"}</p>
          {row.externalReview ? <p>External diary review: {String(row.externalReview.externalReference)} · {String(row.externalReview.appointmentDate)} {String(row.externalReview.startTime)} · Family message review: {String(row.externalReview.familyMessageReview)}</p>
            : !row.portalSnapshot && <Button variant="outline" size="sm" disabled={row.allocation === "duplicate" || row.allocation === "invalid"} onClick={() => {
              setSelected(row); review.reset(); setExternalReference(""); setClinicianReference(""); setAppointmentDate(""); setStartTime(""); setFamilyMessageReview(""); setDiaryVerified(false);
            }}>Record verified external appointment</Button>}
        </div>)}
      </div>}
      <Dialog open={!!selected} onOpenChange={value => { if (!value) setSelected(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Review external booking · {selected?.displayId}</DialogTitle>
            <DialogDescription>Check the practice diary and family's actual message. This records staff verification only; portal status, consent and payment remain unchanged.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="external-reference">External diary appointment reference</Label><Input id="external-reference" value={externalReference} onChange={e => setExternalReference(e.target.value)} /></div>
            <div><Label htmlFor="clinician-reference">Clinician in external diary</Label><Input id="clinician-reference" value={clinicianReference} onChange={e => setClinicianReference(e.target.value)} /></div>
            <div><Label htmlFor="external-date">Appointment date</Label><Input id="external-date" type="date" value={appointmentDate} onChange={e => setAppointmentDate(e.target.value)} /></div>
            <div><Label htmlFor="external-time">Start time</Label><Input id="external-time" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} /></div>
            <div><Label htmlFor="family-message">Family's actual message: quote or state that it is unavailable and what staff checked</Label><Textarea id="family-message" value={familyMessageReview} onChange={e => setFamilyMessageReview(e.target.value)} /></div>
            <label className="flex gap-2 text-sm"><Checkbox checked={diaryVerified} onCheckedChange={v => setDiaryVerified(v === true)} /> I verified this appointment in the external practice diary</label>
            {review.error && <p role="alert" className="text-destructive">{review.error.message}</p>}
            <Button disabled={review.isPending || !diaryVerified || !externalReference || !clinicianReference || !appointmentDate || !startTime || !familyMessageReview} onClick={() => review.mutate()}>Record audited review (no booking change)</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}