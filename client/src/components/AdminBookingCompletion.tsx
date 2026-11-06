import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ChecklistField = "writeuppAppointmentConfirmed" | "writeuppDataTransferred";
export function AdminBookingCompletion({ client, busy, enabled, onChecklistChange, onComplete }: {
  client: {
    id: string; displayId: string; completedAt?: string | Date | null;
    writeuppAppointmentConfirmed?: boolean | null; writeuppDataTransferred?: boolean | null;
    paymentType?: string | null; paymentStatus?: string | null;
    registrationFormSubmissionId?: string | null; bookingSnapshot?: unknown;
  };
  busy: boolean;
  enabled: boolean;
  onChecklistChange: (field: ChecklistField, checked: boolean) => void;
  onComplete: (reason: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [reason, setReason] = useState("");
  const ready = !!client.writeuppAppointmentConfirmed && !!client.writeuppDataTransferred;
  const missing = [
    !client.registrationFormSubmissionId ? "No portal registration submission" : null,
    !client.paymentType ? "Payment type not recorded in this portal"
      : client.paymentType === "self_pay" && client.paymentStatus !== "active" ? "Self-pay card setup not verified in this portal" : null,
  ].filter(Boolean);
  return <section className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3" aria-label="Historic booking administration">
    <div>
      <h3 className="text-sm font-semibold">Booking administration · historic / externally confirmed</h3>
      <p className="mt-1 text-xs text-muted-foreground">Administrative completion does not verify payment, registration or consent, and does not mean therapy has ended.</p>
    </div>
    {missing.length > 0 && <div className="text-xs text-amber-900">
      <p className="font-medium">Existing portal evidence remains incomplete:</p>
      <ul className="list-disc pl-5">{missing.map(item => <li key={item}>{item}</li>)}</ul>
      <p className="mt-1">Review the existing WriteUpp and payment records. Missing portal evidence is not a reason to request another payment.</p>
    </div>}
    {!client.completedAt && <>
      <div className="flex flex-wrap gap-4 text-xs">
        <label className="flex items-center gap-2"><Checkbox disabled={busy} checked={!!client.writeuppAppointmentConfirmed}
          onCheckedChange={value => onChecklistChange("writeuppAppointmentConfirmed", value === true)} />Appointment confirmed in WriteUpp</label>
        <label className="flex items-center gap-2"><Checkbox disabled={busy} checked={!!client.writeuppDataTransferred}
          onCheckedChange={value => onChecklistChange("writeuppDataTransferred", value === true)} />Data transferred to WriteUpp</label>
      </div>
      <Button size="sm" variant="outline" disabled={!ready || busy || !enabled} onClick={() => { setReason(""); setReviewed(false); setOpen(true); }}>Mark booking admin complete</Button>
      {!enabled && <p className="text-xs text-amber-900">Booking completion is not enabled for this practice.</p>}
      {!ready && <p className="text-xs text-amber-900">Save both WriteUpp checklist items first.</p>}
    </>}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Complete booking administration · {client.displayId}</DialogTitle>
          <DialogDescription>This records a staff review only. It will not create booking, registration, consent or payment evidence, send emails, charge a card or change an appointment.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Label htmlFor={`admin-review-${client.id}`}>Review note</Label>
          <Textarea id={`admin-review-${client.id}`} value={reason} maxLength={2000} onChange={event => setReason(event.target.value)}
            placeholder="Record what you checked in the existing practice records." />
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={reviewed} disabled={busy} onCheckedChange={value => setReviewed(value === true)} />
            I have reviewed the existing booking administration in WriteUpp and any relevant payment records. Missing portal evidence remains unverified.</label>
        </div>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={busy || !enabled || !reviewed || reason.trim().length < 10 || !ready} onClick={async () => {
            try { await onComplete(reason.trim()); setOpen(false); } catch { /* Parent reports the failure; keep the review open. */ }
          }}>{busy ? "Saving…" : "Confirm admin completion"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
