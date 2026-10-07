import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { managerErrorMessage } from "@/lib/managerConfirmation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ClientChoice = { id: string; displayId: string; status: string; isArchived?: boolean; completedAt?: unknown };

export function ManagerConfirmationDialog({ open, onOpenChange, clients, initialClientId, onConfirmed }: {
  open: boolean; onOpenChange: (open: boolean) => void; clients: ClientChoice[]; initialClientId: string | null;
  onConfirmed?: (clientId: string) => void;
}) {
  const [clientId, setClientId] = useState("");
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [savedReference, setSavedReference] = useState("");
  const [alreadyConfirmed, setAlreadyConfirmed] = useState(false);
  const cache = useQueryClient();
  const choices = clients.filter(client => !client.isArchived && !client.completedAt
    && !["Scheduled", "BookingConfirmed"].includes(client.status));
  const selected = choices.find(client => client.id === clientId);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Choose an active, unconfirmed client.");
      const response = await apiRequest("POST", `/api/clients/${selected.id}/manager-confirm`, { pin, reason: reason.trim() });
      return response.json();
    },
    onSuccess: (result) => {
      setSavedReference(selected?.displayId || clientId);
      setAlreadyConfirmed(result?.alreadyConfirmed === true);
      setPin("");
      onConfirmed?.(selected?.id || clientId);
      cache.invalidateQueries({ queryKey: ["/api/clients"] });
      cache.invalidateQueries({ queryKey: ["/api/historic-reconciliation"] });
      cache.invalidateQueries({ queryKey: ["/api/timeslots"] });
    },
    onError: () => setPin(""),
  });
  useEffect(() => {
    if (open) {
      setClientId(initialClientId || "");
      setPin("");
      setReason("");
      setSavedReference("");
      setAlreadyConfirmed(false);
      mutation.reset();
    } else {
      setPin("");
      setReason("");
    }
  }, [open, initialClientId]);

  return <Dialog open={open} onOpenChange={next => { if (!mutation.isPending) onOpenChange(next); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Manager confirmation</DialogTitle>
        <DialogDescription>
          Move this client to Confirmed using your manager authority. This does not verify payment,
          registration or consent, create an appointment, or send a booking email.
        </DialogDescription>
      </DialogHeader>
      {savedReference ? <div className="space-y-4">
        <p role="status">{alreadyConfirmed
          ? `${savedReference} is already Confirmed. No additional override was made.`
          : `${savedReference} moved to Confirmed. Your manager override has been recorded.`}</p>
        <Button onClick={() => onOpenChange(false)}>Done</Button>
      </div> : <div className="space-y-4">
        <div>
          <Label htmlFor="manager-confirm-client">Client</Label>
          <Select value={clientId} onValueChange={setClientId} disabled={mutation.isPending}>
            <SelectTrigger id="manager-confirm-client"><SelectValue placeholder="Choose client" /></SelectTrigger>
            <SelectContent>{choices.map(client => <SelectItem key={client.id} value={client.id}>
              {client.displayId} · {client.status}
            </SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="manager-confirm-reason">Reason for manager confirmation</Label>
          <Textarea id="manager-confirm-reason" value={reason} maxLength={1000}
            onChange={event => setReason(event.target.value)} disabled={mutation.isPending}
            placeholder="Explain why this client can be confirmed despite missing portal evidence." />
        </div>
        <div>
          <Label htmlFor="manager-confirm-pin">Manager PIN</Label>
          <Input id="manager-confirm-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={12}
            value={pin} onChange={event => setPin(event.target.value)} disabled={mutation.isPending} />
        </div>
        {mutation.error && <p role="alert" className="text-sm text-destructive">{managerErrorMessage(mutation.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button disabled={!selected || !/^\d{6,12}$/.test(pin) || reason.trim().length < 10 || mutation.isPending}
            onClick={() => mutation.mutate()}>{mutation.isPending ? "Confirming…" : "Move to Confirmed"}</Button>
        </div>
      </div>}
    </DialogContent>
  </Dialog>;
}

export function ManagerConfirmedBadge({ at, reason }: { at?: string | Date | null; reason?: string | null }) {
  if (!at) return null;
  return <details className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
    <summary className="cursor-pointer font-medium">Manager confirmed · manual override</summary>
    <p className="mt-1">{reason}</p>
    <p>Confirmed {new Date(at).toLocaleString("en-GB")}. Payment and registration evidence were not changed.</p>
  </details>;
}
