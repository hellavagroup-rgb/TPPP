import { useData, TimeSlot, SlotType } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { Filter, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format, addWeeks, subWeeks, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function Availability() {
  const { clinicians, updateClinicianAvailability } = useData();
  const [selectedClinicianId, setSelectedClinicianId] = useState<string>("all");
  const [currentDate, setCurrentDate] = useState(new Date());
  const { toast } = useToast();

  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newSlotType, setNewSlotType] = useState<SlotType>("SpecificDate");
  const [newDate, setNewDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [newStartTime, setNewStartTime] = useState("09:00");
  const [newEndTime, setNewEndTime] = useState("17:00");
  
  // Dialog: Which clinician is being added? (Admin control)
  const [dialogClinicianId, setDialogClinicianId] = useState<string>("");

  const filteredClinicians = selectedClinicianId === "all" 
    ? clinicians 
    : clinicians.filter(c => c.id === selectedClinicianId);

  const startOfCurrentWeek = startOfWeek(currentDate, { weekStartsOn: 1 }); // Monday start
  const endOfCurrentWeek = endOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: startOfCurrentWeek, end: endOfCurrentWeek });
  const hours = Array.from({ length: 13 }, (_, i) => i + 7); // 7am to 7pm

  // Update dialog clinician selection when main filter changes
  useEffect(() => {
    if (isDialogOpen) {
        if (selectedClinicianId !== "all") {
            setDialogClinicianId(selectedClinicianId);
        } else if (clinicians.length > 0 && !dialogClinicianId) {
            setDialogClinicianId(clinicians[0].id);
        }
    }
  }, [isDialogOpen, selectedClinicianId, clinicians]);

  // Helper to parse "HH:MM" to decimal hours for calculations
  const parseTime = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return h + m / 60;
  };

  // Helper to check if a slot overlaps with a specific hour block
  const isSlotInHour = (slotStart: string, slotEnd: string, currentHour: number) => {
    const start = parseTime(slotStart);
    const end = parseTime(slotEnd);
    return start < currentHour + 1 && end > currentHour;
  };

  // Check if a slot should be displayed on a specific date
  const isSlotActiveOnDate = (slot: TimeSlot, date: Date) => {
    if (slot.type === "Recurring") {
      return slot.day === format(date, "EEEE");
    }
    if (slot.type === "SpecificDate" || slot.type === "Vacation") {
      return slot.date === format(date, "yyyy-MM-dd");
    }
    return false;
  };

  const handleNextWeek = () => setCurrentDate(addWeeks(currentDate, 1));
  const handlePrevWeek = () => setCurrentDate(subWeeks(currentDate, 1));

  const handleAddAvailability = () => {
    const clinician = clinicians.find(c => c.id === dialogClinicianId);

    if (clinician) {
      const newSlot: TimeSlot = {
        id: `ts-${Date.now()}`,
        type: newSlotType,
        day: format(parseISO(newDate), "EEEE"),
        date: newDate,
        startTime: newSlotType === "Vacation" ? "00:00" : newStartTime,
        endTime: newSlotType === "Vacation" ? "23:59" : newEndTime,
        isBooked: false
      };
      
      updateClinicianAvailability(dialogClinicianId, [...clinician.availability, newSlot]);
      
      toast({
        title: newSlotType === "Vacation" ? "Vacation Added" : "Availability Added",
        description: `Schedule updated for ${clinician.name}`,
      });
      setIsDialogOpen(false);
    }
  };

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
        
        <div className="flex items-center gap-2">
            <div className="flex items-center bg-card rounded-md border shadow-sm">
                <Button variant="ghost" size="icon" onClick={handlePrevWeek}>
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="px-4 font-medium min-w-[140px] text-center">
                    {format(startOfCurrentWeek, "MMM d")} - {format(endOfCurrentWeek, "MMM d")}
                </div>
                <Button variant="ghost" size="icon" onClick={handleNextWeek}>
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>

            <div className="flex items-center gap-2 bg-card p-1 rounded-lg border border-border shadow-sm ml-2">
                <Filter className="h-4 w-4 text-muted-foreground ml-2" />
                <Select value={selectedClinicianId} onValueChange={setSelectedClinicianId}>
                    <SelectTrigger className="w-[180px] border-none shadow-none focus:ring-0">
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

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                    <Button className="ml-2 gap-2">
                        <Plus className="h-4 w-4" /> Add Availability
                    </Button>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Manage Availability</DialogTitle>
                        <DialogDescription>Add a specific shift or mark time off/vacation.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Clinician</Label>
                            <Select value={dialogClinicianId} onValueChange={setDialogClinicianId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select Clinician" />
                                </SelectTrigger>
                                <SelectContent>
                                    {clinicians.map(c => (
                                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label>Type</Label>
                            <Select value={newSlotType} onValueChange={(v) => setNewSlotType(v as SlotType)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="SpecificDate">Extra Shift / Specific Date</SelectItem>
                                    <SelectItem value="Vacation">Vacation / Time Off</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label>Date</Label>
                            <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                        </div>
                        {newSlotType !== "Vacation" && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label>Start Time</Label>
                                    <Input type="time" value={newStartTime} onChange={(e) => setNewStartTime(e.target.value)} />
                                </div>
                                <div className="grid gap-2">
                                    <Label>End Time</Label>
                                    <Input type="time" value={newEndTime} onChange={(e) => setNewEndTime(e.target.value)} />
                                </div>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button onClick={handleAddAvailability} disabled={!dialogClinicianId}>Save to Schedule</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
      </div>

      <Card className="flex-1 border-none shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1 relative">
            {/* Header Row: Days */}
            <div className="grid grid-cols-[60px_repeat(7,1fr)] min-w-[1000px] sticky top-0 z-20 bg-card border-b border-border shadow-sm">
                <div className="p-4 border-r border-border bg-muted/10"></div>
                {weekDays.map(day => (
                    <div key={day.toString()} className="p-3 text-center font-semibold text-sm text-foreground bg-muted/10 border-r border-border last:border-r-0">
                        <div>{format(day, "EEEE")}</div>
                        <div className="text-xs text-muted-foreground font-normal">{format(day, "MMM d")}</div>
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
                        {weekDays.map(day => (
                            <div key={`${day}-${hour}`} className="p-1 border-r border-border/50 last:border-r-0 relative min-h-[80px] hover:bg-muted/5 transition-colors">
                                {filteredClinicians.map((clinician, cIndex) => {
                                    const activeSlots = clinician.availability.filter(slot => 
                                        isSlotActiveOnDate(slot, day) && 
                                        (slot.type === "Vacation" || isSlotInHour(slot.startTime, slot.endTime, hour))
                                    );

                                    if (activeSlots.length === 0) return null;

                                    return activeSlots.map(slot => (
                                        <div 
                                            key={`${clinician.id}-${slot.id}-${hour}`}
                                            className={cn(
                                                "mb-1 p-1.5 rounded text-[10px] border shadow-sm flex items-center gap-1.5 transition-all cursor-pointer group",
                                                slot.type === "Vacation" 
                                                    ? "bg-slate-100 text-slate-500 border-slate-200 border-dashed h-full items-start"
                                                    : slot.isBooked 
                                                        ? "bg-slate-100 text-slate-400 border-slate-200 line-through decoration-slate-400 opacity-60"
                                                        : getClinicianColor(cIndex)
                                            )}
                                        >
                                            <div className={cn(
                                                "h-5 w-5 rounded-full flex items-center justify-center font-bold text-[8px] flex-shrink-0 bg-white/50",
                                                slot.type === "Vacation" || slot.isBooked ? "text-slate-400" : ""
                                            )}>
                                                {clinician.avatar}
                                            </div>
                                            <div className="overflow-hidden w-full">
                                                <p className="font-semibold truncate leading-tight">{clinician.name.split(" ")[1] || clinician.name}</p>
                                                <p className="opacity-80 truncate leading-tight">
                                                    {slot.type === "Vacation" ? "NOT AVAILABLE" : `${slot.startTime} - ${slot.endTime}`}
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
