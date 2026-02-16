import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, UserCheck, UserX, TrendingUp, CalendarDays, FileText } from "lucide-react";
import type { Client, Clinician, TimeSlot } from "@shared/schema";

type ClinicianWithAvailability = Clinician & { name?: string; availability?: TimeSlot[] };

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function isSlotActive(slot: TimeSlot) {
  if (!slot.endDate) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(slot.endDate);
  endDate.setHours(0, 0, 0, 0);
  return endDate >= today;
}

function getSlotCounts(availability?: TimeSlot[]) {
  if (!availability) return { available: 0, pending: 0 };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let available = 0;
  let pending = 0;
  availability.filter(s => !s.isBooked && s.type !== "Vacation" && isSlotActive(s)).forEach(slot => {
    if (slot.type === "Recurring") {
      if (slot.startDate) {
        const startDate = new Date(slot.startDate);
        startDate.setHours(0, 0, 0, 0);
        if (startDate > today) { pending++; } else { available++; }
      } else { available++; }
    } else if (slot.type === "SpecificDate" && slot.date) {
      const slotDate = new Date(slot.date);
      slotDate.setHours(0, 0, 0, 0);
      if (slotDate <= today) { available++; } else { pending++; }
    }
  });
  return { available, pending };
}

export default function Analytics() {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<string>(String(now.getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState<string>("all");

  const { data: allClients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients", "includeArchived"],
    queryFn: async () => {
      const res = await fetch("/api/clients?includeArchived=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch clients");
      return res.json();
    },
  });

  const { data: clinicians = [] } = useQuery<ClinicianWithAvailability[]>({
    queryKey: ["/api/clinicians"],
  });

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    allClients.forEach(c => {
      if (c.createdAt) years.add(new Date(c.createdAt).getFullYear());
    });
    years.add(now.getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [allClients]);

  const metrics = useMemo(() => {
    const year = parseInt(selectedYear);
    const month = selectedMonth === "all" ? null : parseInt(selectedMonth);

    const inPeriod = (dateStr: string | Date | null | undefined) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      if (d.getFullYear() !== year) return false;
      if (month !== null && d.getMonth() !== month) return false;
      return true;
    };

    const newClients = allClients.filter(c => inPeriod(c.createdAt));
    const totalNew = newClients.length;

    const allocated = newClients.filter(c =>
      c.status === "Assigned" ||
      c.status === "AwaitingConfirmation" ||
      c.status === "Scheduled" ||
      c.allocatedAt
    );
    const totalAllocated = allocated.length;

    const archived = newClients.filter(c => c.isArchived);
    const totalArchived = archived.length;

    const allocatedPct = totalNew > 0 ? Math.round((totalAllocated / totalNew) * 100) : 0;
    const archivedPct = totalNew > 0 ? Math.round((totalArchived / totalNew) * 100) : 0;

    const statusBreakdown: Record<string, number> = {};
    newClients.forEach(c => {
      if (c.isArchived) {
        statusBreakdown["Archived/Didn't Engage"] = (statusBreakdown["Archived/Didn't Engage"] || 0) + 1;
      } else {
        const label = c.status === "Assigned" ? "Allocated"
          : c.status === "AwaitingConfirmation" ? "Awaiting Confirmation"
          : c.status === "Scheduled" ? "Confirmed"
          : c.status;
        statusBreakdown[label] = (statusBreakdown[label] || 0) + 1;
      }
    });

    return { totalNew, totalAllocated, totalArchived, allocatedPct, archivedPct, statusBreakdown };
  }, [allClients, selectedYear, selectedMonth]);

  const periodLabel = selectedMonth === "all"
    ? selectedYear
    : `${MONTH_NAMES[parseInt(selectedMonth)]} ${selectedYear}`;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-slate-900">Practice Analytics</h1>
          <p className="text-muted-foreground mt-1">Key performance indicators for {periodLabel}.</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-[160px]" data-testid="select-month">
              <SelectValue placeholder="Select month" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Full Year</SelectItem>
              {MONTH_NAMES.map((name, i) => (
                <SelectItem key={i} value={String(i)}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-[120px]" data-testid="select-year">
              <SelectValue placeholder="Select year" />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Clients</CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-new-clients">{metrics.totalNew}</div>
            <p className="text-xs text-muted-foreground pt-1">
              Enquiries received in {periodLabel}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Allocated</CardTitle>
            <UserCheck className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-allocated">{metrics.totalAllocated}</div>
            <div className="flex items-center gap-1 pt-1">
              <span className={`text-sm font-semibold ${metrics.allocatedPct >= 50 ? "text-emerald-600" : "text-amber-600"}`}>
                {metrics.allocatedPct}%
              </span>
              <span className="text-xs text-muted-foreground">of {periodLabel} clients allocated</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Didn't Engage</CardTitle>
            <UserX className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-didnt-engage">{metrics.totalArchived}</div>
            <div className="flex items-center gap-1 pt-1">
              <span className={`text-sm font-semibold ${metrics.archivedPct <= 20 ? "text-emerald-600" : "text-red-600"}`}>
                {metrics.archivedPct}%
              </span>
              <span className="text-xs text-muted-foreground">of {periodLabel} clients didn't engage</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Client Status Breakdown</CardTitle>
          <CardDescription>Distribution of clients who came in during {periodLabel}.</CardDescription>
        </CardHeader>
        <CardContent>
          {metrics.totalNew === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarDays className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium text-slate-900">No clients in this period</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                Try selecting a different month or year to view analytics.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(metrics.statusBreakdown)
                .sort(([, a], [, b]) => b - a)
                .map(([status, count]) => {
                  const percentage = Math.round((count / metrics.totalNew) * 100);
                  const colorClass = status === "Archived/Didn't Engage" ? "bg-red-400"
                    : status === "Confirmed" ? "bg-emerald-500"
                    : status === "Allocated" ? "bg-blue-500"
                    : status === "Awaiting Confirmation" ? "bg-cyan-500"
                    : status === "Forms Completed" ? "bg-violet-500"
                    : status === "Forms Sent" ? "bg-amber-500"
                    : status === "New" ? "bg-slate-400"
                    : "bg-primary";
                  return (
                    <div key={status} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{status}</span>
                        <span className="text-muted-foreground">{count} ({percentage}%)</span>
                      </div>
                      <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${colorClass}`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clinician Availability</CardTitle>
          <CardDescription>Available and pending slots for each clinician.</CardDescription>
        </CardHeader>
        <CardContent>
          {clinicians.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium text-slate-900">No clinicians available</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Clinician data will appear here once profiles are set up.
              </p>
            </div>
          ) : (
            (() => {
              const cliniciansWithCounts = clinicians.map(c => ({
                ...c,
                counts: getSlotCounts(c.availability),
                total: getSlotCounts(c.availability).available + getSlotCounts(c.availability).pending
              }));
              const sortedClinicians = [...cliniciansWithCounts].sort((a, b) => b.total - a.total);
              const maxSlots = Math.max(...sortedClinicians.map(c => c.total), 1);

              return (
                <div className="space-y-4">
                  {sortedClinicians.slice(0, 10).map((clinician) => {
                    const barWidth = (clinician.total / maxSlots) * 100;
                    const availableWidth = clinician.total > 0 ? (clinician.counts.available / clinician.total) * barWidth : 0;
                    const pendingWidth = clinician.total > 0 ? (clinician.counts.pending / clinician.total) * barWidth : 0;
                    return (
                      <div key={clinician.id} className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{clinician.name || clinician.avatar}</span>
                          <span className="text-muted-foreground">
                            {clinician.counts.available} available, {clinician.counts.pending} pending
                          </span>
                        </div>
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden flex">
                          {clinician.total > 0 ? (
                            <>
                              <div className="h-full bg-emerald-500" style={{ width: `${availableWidth}%` }} />
                              <div className="h-full bg-slate-400" style={{ width: `${pendingWidth}%` }} />
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {clinicians.length > 10 && (
                    <p className="text-xs text-muted-foreground text-center pt-2">
                      Showing 10 of {clinicians.length} clinicians
                    </p>
                  )}
                </div>
              );
            })()
          )}
        </CardContent>
      </Card>
    </div>
  );
}
