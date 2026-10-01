import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";

export function CompactClientCard({
  clientId, displayId, clientName, status, selectedDetails, onOpen,
}: {
  clientId: string;
  displayId: string;
  clientName?: string | null;
  status: string;
  selectedDetails?: string | null;
  onOpen: () => void;
}) {
  return (
    <Card className="overflow-hidden border-indigo-200/80 bg-white shadow-sm transition-shadow hover:shadow-md" data-testid={`kanban-card-${clientId}`}>
      <CardContent className="p-0">
        <button type="button" onClick={onOpen} aria-haspopup="dialog"
          aria-label={`Open ${displayId}${clientName ? `, ${clientName}` : ""} details`}
          data-testid={`compact-client-card-${clientId}`}
          className="group flex w-full items-center gap-3 p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
          <span className="min-w-0 flex-1">
            <span className="block break-all font-mono text-sm font-semibold tracking-tight text-indigo-900">{displayId}</span>
            {clientName && <span className="block truncate text-sm font-medium text-slate-800">{clientName}</span>}
            <span className="block truncate text-xs text-slate-500">{status}</span>
            {selectedDetails && <span className="mt-1 block truncate text-[11px] text-indigo-700">{selectedDetails}</span>}
          </span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
        </button>
      </CardContent>
    </Card>
  );
}

export function ClientDetailPanel({
  enabled = true, open, onOpenChange, displayId, clientName, status, children,
}: {
  enabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayId: string;
  clientName?: string | null;
  status: string;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto border-l-indigo-200 bg-[#fbfcff] p-0 sm:max-w-xl">
        <div className="border-b border-indigo-100 bg-white px-6 pb-5 pt-8">
          <SheetHeader>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">Client record</p>
            <SheetTitle className="font-mono text-xl text-slate-900">{displayId}{clientName ? ` · ${clientName}` : ""}</SheetTitle>
            <SheetDescription>{status} · Details and staff actions</SheetDescription>
          </SheetHeader>
        </div>
        <div className="space-y-4 p-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}