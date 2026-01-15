import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Users, Clock, CalendarCheck, FileText } from "lucide-react";
import type { Client, Clinician, TimeSlot } from "@shared/schema";

type ClinicianWithAvailability = Clinician & { name?: string; availability?: TimeSlot[] };

function getSlotCounts(availability?: TimeSlot[]) {
  if (!availability) return { available: 0, pending: 0 };
  const available = availability.filter(s => s.type === "Recurring" && !s.isBooked).length;
  const pending = availability.filter(s => s.type === "SpecificDate" && !s.isBooked).length;
  return { available, pending };
}

export default function Analytics() {
  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: clinicians = [] } = useQuery<ClinicianWithAvailability[]>({
    queryKey: ["/api/clinicians"],
  });

  const totalClients = clients.length;
  const newClients = clients.filter(c => c.status === "New").length;
  const scheduledClients = clients.filter(c => c.status === "Scheduled").length;
  const activeClinicians = clinicians.filter(c => (c.maxNewClients ?? 0) > 0).length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-slate-900">Practice Analytics</h1>
          <p className="text-muted-foreground mt-1">Key performance indicators based on your actual data.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalClients}</div>
            <p className="text-xs text-muted-foreground pt-1">
              All clients in the system
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Enquiries</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{newClients}</div>
            <p className="text-xs text-muted-foreground pt-1">
              Awaiting initial contact
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Scheduled Sessions</CardTitle>
            <CalendarCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{scheduledClients}</div>
            <p className="text-xs text-muted-foreground pt-1">
              Clients with upcoming appointments
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Available Clinicians</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeClinicians}</div>
            <p className="text-xs text-muted-foreground pt-1">
              Accepting new clients
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Client Status Breakdown</CardTitle>
          <CardDescription>Distribution of clients across workflow stages.</CardDescription>
        </CardHeader>
        <CardContent>
          {totalClients === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium text-slate-900">No client data yet</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                Analytics will populate as you add clients to the system. Start by creating your first client record.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {["New", "Forms Sent", "Forms Completed", "Assigned", "Scheduled", "Waitlist"].map(status => {
                const count = clients.filter(c => c.status === status).length;
                const percentage = totalClients > 0 ? Math.round((count / totalClients) * 100) : 0;
                return (
                  <div key={status} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{status}</span>
                      <span className="text-muted-foreground">{count} ({percentage}%)</span>
                    </div>
                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full bg-primary" 
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
                              <div 
                                className="h-full bg-emerald-500" 
                                style={{ width: `${availableWidth}%` }} 
                              />
                              <div 
                                className="h-full bg-slate-400" 
                                style={{ width: `${pendingWidth}%` }} 
                              />
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
