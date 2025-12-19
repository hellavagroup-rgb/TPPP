import { useData } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Calendar, Clock, Filter, AlertCircle, CheckCircle2 } from "lucide-react";

export default function Availability() {
  const { clinicians } = useData();
  const [selectedClinicianId, setSelectedClinicianId] = useState<string>("all");

  const filteredClinicians = selectedClinicianId === "all" 
    ? clinicians 
    : clinicians.filter(c => c.id === selectedClinicianId);

  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  // Helper to check if a clinician has a slot on a specific day
  const getSlotsForDay = (clinician: typeof clinicians[0], day: string) => {
    return clinician.availability.filter(s => s.day === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Availability Overview</h2>
          <p className="text-muted-foreground mt-1">Admin view of all clinician schedules.</p>
        </div>
        
        <div className="flex items-center gap-2 bg-card p-1 rounded-lg border border-border shadow-sm">
            <Filter className="h-4 w-4 text-muted-foreground ml-2" />
            <Select value={selectedClinicianId} onValueChange={setSelectedClinicianId}>
                <SelectTrigger className="w-[200px] border-none shadow-none focus:ring-0">
                    <SelectValue placeholder="Filter Clinician" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Clinicians</SelectItem>
                    {clinicians.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
      </div>

      <div className="grid gap-6">
        {filteredClinicians.map(clinician => (
            <Card key={clinician.id} className="border-none shadow-sm overflow-hidden">
                <CardHeader className="bg-muted/20 pb-4">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center font-bold">
                                {clinician.avatar}
                            </div>
                            <div>
                                <CardTitle className="text-lg">{clinician.name}</CardTitle>
                                <CardDescription>{clinician.specialties.join(", ")}</CardDescription>
                            </div>
                        </div>
                        <div className="text-right">
                             <Badge variant={clinician.currentLoad >= clinician.capacity ? "destructive" : "outline"} className="mb-1">
                                {clinician.currentLoad >= clinician.capacity ? "Full Capacity" : "Open for Referrals"}
                             </Badge>
                             <p className="text-xs text-muted-foreground">Updated: {clinician.lastUpdatedAvailability}</p>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 divide-x divide-border border-t border-border">
                        {days.map(day => {
                            const daySlots = getSlotsForDay(clinician, day);
                            return (
                                <div key={day} className="min-h-[120px] p-3 flex flex-col gap-2">
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{day.slice(0, 3)}</p>
                                    
                                    {daySlots.length > 0 ? (
                                        daySlots.map(slot => (
                                            <div 
                                                key={slot.id} 
                                                className={`text-xs p-2 rounded border ${
                                                    slot.isBooked 
                                                    ? "bg-muted text-muted-foreground border-transparent line-through decoration-destructive/50" 
                                                    : "bg-primary/5 text-primary border-primary/20"
                                                }`}
                                            >
                                                <div className="flex items-center gap-1 font-medium">
                                                    <Clock className="h-3 w-3" />
                                                    {slot.startTime} - {slot.endTime}
                                                </div>
                                                {slot.isBooked && <span className="text-[10px] text-destructive block mt-1">Booked</span>}
                                            </div>
                                        ))
                                    ) : (
                                        <div className="flex-1 flex items-center justify-center">
                                            <span className="text-[10px] text-muted-foreground/30 italic">-</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>
        ))}

        {filteredClinicians.length === 0 && (
            <div className="p-12 text-center border border-dashed border-border rounded-lg text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                No clinicians found.
            </div>
        )}
      </div>
    </div>
  );
}
