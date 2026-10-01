import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useHistoricReconciliation } from "@/components/HistoricReconciliation";

const defaultFamilyMessageReview =
  "The original family message was not required for this staff-verified WriteUpp arrangement.";

export function WriteuppAppointmentAction({
  clientId, enabled, onRecorded,
}: {
  clientId: string;
  enabled: boolean;
  onRecorded?: () => void;
}) {
  const inventory = useHistoricReconciliation(enabled);
  const row = inventory.data?.find(item => item.id === clientId);
  const [open, setOpen] = useState(false);
  const [externalReference, setExternalReference] = useState("");
  const [clinicianReference, setClinicianReference] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [familyMessageReview, setFamilyMessageReview] = useState("");
  const [diaryVerified, setDiaryVerified] = useState(false);
  const cache = useQueryClient();

  const arrangement = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/historic-reconciliation/${clientId}/external-review`, {
        externalReference: externalReference.trim(),
        clinicianReference: clinicianReference.trim(),
        appointmentDate,
        startTime,
        familyMessageReview: familyMessageReview.trim() || defaultFamilyMessageReview,
        diaryVerified,
        arrangedInWriteupp: true,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "WriteUpp arrangement could not be recorded");
      }
    },
    onSuccess: () => {
      cache.invalidateQueries({ queryKey: ["/api/historic-reconciliation"] });
      cache.invalidateQueries({ queryKey: ["/api/clients"] });
      setOpen(false);
      onRecorded?.();
    },
  });

  if (!enabled) return null;
  if (inventory.isError) return <p role="alert">Arrangement evidence could not be loaded. Do not record an arrangement from this screen.</p>;
  if (!row) return null;
  if (row.writeuppArranged) {
    return <p className="text-sm text-muted-foreground" role="status">Booked in WriteUpp · staff verified</p>;
  }
  if (row.portalSnapshot || !["AwaitingConfirmation", "RegistrationPending"].includes(row.status)) return null;

  const beginArrangement = () => {
    arrangement.reset();
    setExternalReference(String(row.externalReview?.externalReference ?? ""));
    setClinicianReference(String(row.externalReview?.clinicianReference ?? ""));
    setAppointmentDate(String(row.externalReview?.appointmentDate ?? ""));
    setStartTime(String(row.externalReview?.startTime ?? ""));
    setFamilyMessageReview("");
    setDiaryVerified(false);
    setOpen(true);
  };
  const formValid = externalReference.trim().length >= 3
    && clinicianReference.trim().length >= 2
    && /^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)
    && diaryVerified;

  return (
    <>
      <Button variant="outline" size="sm" onClick={beginArrangement}>Appointment arranged in WriteUpp</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record WriteUpp arrangement · {row.displayId}</DialogTitle>
            <DialogDescription>
              Verify the appointment in the external practice diary. This records the external arrangement only; it does not create or change a portal booking, status, payment, consent, snapshot, or booking email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor={`writeupp-reference-${clientId}`}>External diary appointment reference</Label>
              <Input id={`writeupp-reference-${clientId}`} value={externalReference}
                onChange={event => setExternalReference(event.target.value)} />
            </div>
            <div>
              <Label htmlFor={`writeupp-clinician-${clientId}`}>Clinician in external diary</Label>
              <Input id={`writeupp-clinician-${clientId}`} value={clinicianReference}
                onChange={event => setClinicianReference(event.target.value)} />
            </div>
            <div>
              <Label htmlFor={`writeupp-date-${clientId}`}>Appointment date</Label>
              <Input id={`writeupp-date-${clientId}`} type="date" value={appointmentDate}
                onChange={event => setAppointmentDate(event.target.value)} />
            </div>
            <div>
              <Label htmlFor={`writeupp-time-${clientId}`}>Start time</Label>
              <Input id={`writeupp-time-${clientId}`} type="time" value={startTime}
                onChange={event => setStartTime(event.target.value)} />
            </div>
            <div>
              <Label htmlFor={`writeupp-family-message-${clientId}`}>Original family message note (optional)</Label>
              <Textarea id={`writeupp-family-message-${clientId}`} value={familyMessageReview}
                onChange={event => setFamilyMessageReview(event.target.value)} />
            </div>
            <label className="flex gap-2 text-sm">
              <Checkbox checked={diaryVerified} onCheckedChange={value => setDiaryVerified(value === true)} />
              I verified this appointment in the external practice diary
            </label>
            {arrangement.error && <p role="alert" className="text-destructive">{arrangement.error.message}</p>}
            <Button disabled={!formValid || arrangement.isPending} onClick={() => arrangement.mutate()}>
              {arrangement.isPending ? "Recording arrangement" : "Record WriteUpp arrangement"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}