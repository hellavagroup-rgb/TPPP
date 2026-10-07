import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, ChevronRight, Clock3 } from "lucide-react";

export type ClientNextStepView = {
  kind: "action" | "waiting";
  title: string;
  detail: string;
  actionLabel?: string;
};

export function hasRecordedAppointmentSelection(input: {
  visibilityEnabled: boolean;
  allocationVisibility?: { appointment?: unknown } | null;
  assignedClinicianId?: string | null;
  assignedSlotId?: string | null;
}): boolean {
  if (input.visibilityEnabled) return !!input.allocationVisibility?.appointment;
  return !!input.assignedClinicianId && !!input.assignedSlotId;
}

export function CompactClientCard({
  clientId, displayId, clientName, description, status, selectedDetails, nextStep, onOpen, onNextAction,
}: {
  clientId: string;
  displayId: string;
  clientName?: string | null;
  description?: string | null;
  status: string;
  selectedDetails?: string | null;
  nextStep?: ClientNextStepView | null;
  onOpen: () => void;
  onNextAction?: () => void;
}) {
  return (
    <Card className="overflow-hidden border-indigo-200/80 bg-white shadow-sm transition-shadow hover:shadow-md" data-testid={`kanban-card-${clientId}`}>
      <CardContent className="p-0">
        <button type="button" onClick={onOpen} aria-haspopup="dialog"
          aria-label={`Open ${displayId}${clientName ? `, ${clientName}` : ""} details`}
          data-testid={`compact-client-card-${clientId}`}
          className="group block w-full p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
          <span className="flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <span className="block break-all font-mono text-sm font-semibold tracking-tight text-indigo-900">{displayId}</span>
              {clientName && <span className="block truncate text-sm font-medium text-slate-800">{clientName}</span>}
              {description && <span className="mt-1 block text-xs leading-relaxed text-slate-600 line-clamp-2" data-testid={`client-description-${clientId}`}>{description}</span>}
              <span className="mt-1.5 block text-[11px] font-medium text-slate-500">{status}</span>
              {selectedDetails && <span className="mt-1 block truncate text-[11px] text-indigo-700">{selectedDetails}</span>}
            </span>
            <ChevronRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
          </span>
          {nextStep && !onNextAction && (
            <span className={`mt-3 block rounded-md border px-2.5 py-2 ${nextStep.kind === "waiting" ? "border-amber-200 bg-amber-50/80" : "border-indigo-200 bg-indigo-50/70"}`}
              data-testid={`next-step-${clientId}`}>
              <span className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${nextStep.kind === "waiting" ? "text-amber-800" : "text-indigo-800"}`}>
                {nextStep.kind === "waiting" ? <Clock3 className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
                {nextStep.kind === "waiting" ? "Waiting for" : "Next action"}
              </span>
              <span className="mt-0.5 block text-xs font-semibold text-slate-800">{nextStep.title}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-slate-600">{nextStep.detail}</span>
            </span>
          )}
        </button>
        {nextStep && onNextAction && (
          <div className="mx-3 mb-3 rounded-md border border-indigo-200 bg-indigo-50/70 p-2.5" data-testid={`next-step-${clientId}`}>
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-800">
              <ArrowRight className="h-3 w-3" aria-hidden="true" /> Staff action
            </p>
            <p className="mt-0.5 text-xs font-semibold text-slate-800">{nextStep.title}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{nextStep.detail}</p>
            <Button size="sm" className="mt-2 h-auto w-full whitespace-normal text-xs" onClick={onNextAction}>
              {nextStep.actionLabel || nextStep.title}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ClientDetailPanel({
  enabled = true, open, onOpenChange, displayId, clientName, status, guidance, onGuidanceAction, children,
}: {
  enabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayId: string;
  clientName?: string | null;
  status: string;
  guidance?: ClientNextStepView | null;
  onGuidanceAction?: () => void;
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
        <div className="space-y-4 p-5">
          {guidance && (
            <section className={`rounded-lg border p-4 ${guidance.kind === "waiting" ? "border-amber-200 bg-amber-50" : "border-indigo-200 bg-indigo-50"}`}
              data-testid="client-next-guidance">
              <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${guidance.kind === "waiting" ? "text-amber-800" : "text-indigo-800"}`}>
                {guidance.kind === "waiting" ? "Waiting for" : "Recommended next step"}
              </p>
              <h3 className="mt-1 text-sm font-semibold text-slate-900">{guidance.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-700">{guidance.detail}</p>
              {guidance.kind === "action" && onGuidanceAction && (
                <Button size="sm" className="mt-3 h-8 gap-1.5" onClick={onGuidanceAction}>
                  {guidance.actionLabel || "Continue"} <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              )}
            </section>
          )}
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}