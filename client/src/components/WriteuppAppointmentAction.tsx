import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useHistoricReconciliation, type HistoricRow } from "@/components/HistoricReconciliation";
import { invalidateOperationalData } from "@/lib/operationalRefresh";

export function WriteuppAppointmentAction({
  clientId, enabled, onRecorded,
}: {
  clientId: string;
  enabled: boolean;
  onRecorded?: () => void;
}) {
  const inventory = useHistoricReconciliation(enabled);
  const row = inventory.data?.find(item => item.id === clientId);
  const cache = useQueryClient();
  const arrangement = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/historic-reconciliation/${clientId}/writeupp-arranged`, {
        arrangedInWriteupp: true,
      });
    },
    onSuccess: () => {
      cache.setQueryData<HistoricRow[]>(["/api/historic-reconciliation"], rows =>
        rows?.map(item => item.id === clientId ? { ...item, writeuppArranged: true } : item));
      cache.invalidateQueries({ queryKey: ["/api/historic-reconciliation"] });
      invalidateOperationalData(cache);
      onRecorded?.();
    },
  });

  if (!enabled) return null;
  if (inventory.isError) return <p role="alert">WriteUpp arrangement status could not be loaded. Please try again.</p>;
  if (!row) return null;
  if (row.writeuppArranged || arrangement.isSuccess) {
    return <p className="text-sm text-teal-900" role="status">Appointment arranged in WriteUpp. No further booking action needed.</p>;
  }
  if (row.portalSnapshot || !["AwaitingConfirmation", "RegistrationPending"].includes(row.status)) return null;

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" disabled={arrangement.isPending} onClick={() => arrangement.mutate()}>
        {arrangement.isPending ? "Recording…" : "Appointment arranged in WriteUpp"}
      </Button>
      {arrangement.error && <p role="alert" className="text-destructive">
        Could not record the WriteUpp arrangement. Please try again.
      </p>}
    </div>
  );
}
