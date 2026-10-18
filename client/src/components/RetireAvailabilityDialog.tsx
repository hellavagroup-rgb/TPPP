import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TimeSlot } from "@shared/schema";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { invalidateOperationalData } from "@/lib/operationalRefresh";

export function RetireAvailabilityDialog({ open, target, onClose }: {
  open: boolean; target: { slot: TimeSlot; clinicianId: string } | null; onClose: () => void;
}) {
  const cache = useQueryClient();
  const { toast } = useToast();
  const base = target ? `/api/timeslots/${target.clinicianId}/${target.slot.id}` : "";
  const check = useQuery<{ eligible: boolean; clientId?: string; clientDisplayId?: string; reason?: string }>({
    queryKey: [base + "/writeupp-retirement"],
    queryFn: async () => (await apiRequest("GET", base + "/writeupp-retirement")).json(),
    enabled: open && !!target, staleTime: 0, retry: false,
  });
  const external = check.data?.eligible === true;
  const retirement = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("Select a slot first.");
      const response = await fetch(external ? base + "/writeupp-retirement" : base, {
        method: external ? "POST" : "DELETE", credentials: "include",
        headers: { "Content-Type": "application/json" },
        ...(external ? { body: JSON.stringify({ retireOccupiedSlot: true, clientId: check.data?.clientId }) } : {}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not retire this slot.");
      return body;
    },
    onSuccess: () => {
      invalidateOperationalData(cache);
      cache.invalidateQueries({ queryKey: ["/api/historic-reconciliation"] });
      toast({ title: "Slot retired", description: external
        ? "Removed from portal availability. The client's appointment links and history are unchanged."
        : "Removed from portal availability. Historical records were preserved." });
      onClose();
    },
    onError: () => { check.refetch(); },
  });
  return <AlertDialog open={open} onOpenChange={value => { if (!value && !retirement.isPending) onClose(); }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{external ? "Retire occupied WriteUpp slot" : "Retire availability slot"}</AlertDialogTitle>
        <AlertDialogDescription>
          {external
            ? `${check.data?.clientDisplayId}'s appointment is recorded as arranged in WriteUpp. Remove this slot from portal availability, including future weeks for a recurring slot? The client's appointment links, history, therapy status and payments will stay unchanged. No emails will be sent, and this time will not become available for another client.`
            : target?.slot.isBooked
              ? "This slot is booked. Active client reservations cannot normally be removed. Checking for an eligible appointment already arranged in WriteUpp does not change the client."
              : "Remove this slot from portal availability, including future weeks for a recurring slot? Historical records will be preserved rather than permanently deleted."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {check.isFetching && <p role="status">Checking slot ownership…</p>}
      {check.isError && <div role="alert">Could not check slot ownership. <Button variant="link" onClick={() => check.refetch()}>Retry check</Button></div>}
      {!check.isFetching && !external && target?.slot.isBooked && check.data?.reason &&
        <p role="status">{check.data.reason}</p>}
      {retirement.isError && <p role="alert" className="text-destructive">{retirement.error.message}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={retirement.isPending}>Cancel</AlertDialogCancel>
        <AlertDialogAction disabled={check.isFetching || check.isError || retirement.isPending ||
          (!external && !!target?.slot.isBooked)} onClick={event => { event.preventDefault(); retirement.mutate(); }}>
          {retirement.isPending ? "Retiring…" : external ? "Retire occupied WriteUpp slot" : "Retire slot"}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
