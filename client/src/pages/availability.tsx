import { useData } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Filter, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Availability() {
  const { clinicians } = useData();
  const [selectedClinicianId, setSelectedClinicianId] = useState<string>("all");

  const filteredClinicians = selectedClinicianId === "all" 
    ? clinicians 
    : clinicians.filter(c => c.id === selectedClinicianId);

  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const hours = Array.from({ length: 13 }, (_, i) => i + 7); // 7am to 7pm (19:00)

  // Helper to parse "HH:MM" to decimal hours for calculations if needed
  const parseTime = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return h + m / 60;
  };

  // Helper to check if a slot overlaps with a specific hour block
  const isSlotInHour = (slotStart: string, slotEnd: string, currentHour: number) => {
    const start = parseTime(slotStart);
    const end = parseTime(slotEnd);
    // Slot covers this hour if it starts before (hour+1) and ends after hour
    return start < currentHour + 1 && end > currentHour;
  };

  // Get distinct color for each clinician to make the calendar readable
  const getClinicianColor = (index: number) => {
    const colors = [
      "bg-teal-100 text-teal-800 border-teal-200 hover:bg-teal-200",
      "bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-200",
      "bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-200",
      "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200",
      "bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-200",
    ];
    return colors[index % colors.length];
  };

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 flex-shrink-0">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Master Schedule</h2>
          <p className="text-muted-foreground mt-1">Weekly view of all clinician availability (7am - 7pm).</p>
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

      <Card className="flex-1 border-none shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1 relative">
            {/* Header Row: Days */}
            <div className="grid grid-cols-[60px_repeat(7,1fr)] min-w-[1000px] sticky top-0 z-20 bg-card border-b border-border shadow-sm">
                <div className="p-4 border-r border-border bg-muted/10"></div>
                {days.map(day => (
                    <div key={day} className="p-3 text-center font-semibold text-sm text-foreground bg-muted/10 border-r border-border last:border-r-0">
                        {day}
                    </div>
                ))}
            </div>

            {/* Grid Body */}
            <div className="min-w-[1000px]">
                {hours.map(hour => (
                    <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border/50 last:border-b-0">
                        {/* Time Label */}
                        <div className="p-2 text-xs text-muted-foreground text-right pr-3 border-r border-border sticky left-0 bg-card z-10 flex items-center justify-end font-mono">
                            {hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                        </div>

                        {/* Day Cells */}
                        {days.map(day => (
                            <div key={`${day}-${hour}`} className="p-1 border-r border-border/50 last:border-r-0 relative min-h-[80px] hover:bg-muted/5 transition-colors">
                                {filteredClinicians.map((clinician, cIndex) => {
                                    // Find slots for this clinician on this day overlapping this hour
                                    const overlaps = clinician.availability.filter(slot => 
                                        slot.day === day && isSlotInHour(slot.startTime, slot.endTime, hour)
                                    );

                                    if (overlaps.length === 0) return null;

                                    return overlaps.map(slot => (
                                        <div 
                                            key={`${clinician.id}-${slot.id}-${hour}`}
                                            className={cn(
                                                "mb-1 p-1.5 rounded text-[10px] border shadow-sm flex items-center gap-1.5 transition-all cursor-pointer group",
                                                slot.isBooked 
                                                    ? "bg-slate-100 text-slate-400 border-slate-200 line-through decoration-slate-400 opacity-60"
                                                    : getClinicianColor(cIndex)
                                            )}
                                        >
                                            <div className={cn(
                                                "h-5 w-5 rounded-full flex items-center justify-center font-bold text-[8px] flex-shrink-0 bg-white/50",
                                                slot.isBooked ? "text-slate-400" : ""
                                            )}>
                                                {clinician.avatar}
                                            </div>
                                            <div className="overflow-hidden">
                                                <p className="font-semibold truncate leading-tight">{clinician.name.split(" ")[1] || clinician.name}</p>
                                                <p className="opacity-80 truncate leading-tight">
                                                    {slot.startTime} - {slot.endTime}
                                                </p>
                                            </div>
                                        </div>
                                    ));
                                })}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
      </Card>
    </div>
  );
}
