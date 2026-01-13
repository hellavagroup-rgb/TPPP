import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Filter, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus, Briefcase, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format, addWeeks, subWeeks, startOfWeek, endOfWeek, eachDayOfInterval, parseISO, isWithinInterval } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Clinician, TimeSlot } from "@shared/schema";

type SlotType = "Recurring" | "SpecificDate" | "Vacation";

interface ClinicianWithSlots extends Clinician {
  name: string;
  avatar: string;
  slots: TimeSlot[];
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const TIME_OPTIONS = Array.from({ length: 13 * 4 + 1 }, (_, i) => {
  const hour = Math.floor(i / 4) + 7;
  const minute = (i % 4) * 15;
  const date = new Date();
  date.setHours(hour, minute);
  return format(date, "HH:mm");
});

export default function Availability() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedClinicianId, setSelectedClinicianId] = useState<string>("all");
  const [currentDate, setCurrentDate] = useState(new Date());

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingSlot, setEditingSlot] = useState<TimeSlot | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingSlot, setDeletingSlot] = useState<{ slot: TimeSlot; clinicianId: string } | null>(null);

  const [newSlotType, setNewSlotType] = useState<SlotType>("SpecificDate");
  const [newDate, setNewDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [newStartTime, setNewStartTime] = useState("09:00");
  const [newEndTime, setNewEndTime] = useState("17:00");
  const [dialogClinicianId, setDialogClinicianId] = useState<string>("");

  const { data: clinicians = [] } = useQuery<(Clinician & { name: string })[]>({
    queryKey: ["/api/clinicians"],
  });

  const cliniciansWithSlots = useQuery<ClinicianWithSlots[]>({
    queryKey: ["/api/clinicians/with-slots"],
    queryFn: async () => {
      const slotsPromises = clinicians.map(async (clinician) => {
        try {
          const response = await fetch(`/api/timeslots/${clinician.id}`, { credentials: "include" });
          const slots = response.ok ? await response.json() : [];
          return {
            ...clinician,
            avatar: clinician.name?.charAt(0) || "?",
            slots,
          };
        } catch {
          return { ...clinician, avatar: clinician.name?.charAt(0) || "?", slots: [] };
        }
      });
      return Promise.all(slotsPromises);
    },
    enabled: clinicians.length > 0,
  });

  const updateSlotsMutation = useMutation({
    mutationFn: async ({ clinicianId, slots }: { clinicianId: string; slots: TimeSlot[] }) => {
      const response = await apiRequest("PUT", `/api/timeslots/${clinicianId}`, slots);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinicians/with-slots"] });
    },
  });

  useEffect(() => {
    if (user?.role === "clinician") {
      const myClinician = clinicians.find(c => c.userId === user.id);
      if (myClinician) {
        setSelectedClinicianId(myClinician.id);
        setDialogClinicianId(myClinician.id);
      }
    }
  }, [user, clinicians]);

  useEffect(() => {
    if (isDialogOpen && user?.role !== "clinician") {
      if (selectedClinicianId !== "all") {
        setDialogClinicianId(selectedClinicianId);
      } else if (clinicians.length > 0 && !dialogClinicianId) {
        setDialogClinicianId(clinicians[0].id);
      }
    }
  }, [isDialogOpen, selectedClinicianId, clinicians, user, dialogClinicianId]);

  const allCliniciansData = cliniciansWithSlots.data || [];
  const filteredClinicians = selectedClinicianId === "all"
    ? allCliniciansData
    : allCliniciansData.filter(c => c.id === selectedClinicianId);

  const startOfCurrentWeek = startOfWeek(currentDate, { weekStartsOn: 1 });
  const endOfCurrentWeek = endOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: startOfCurrentWeek, end: endOfCurrentWeek });
  const hours = Array.from({ length: 13 }, (_, i) => i + 7);

  const parseTime = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return h + m / 60;
  };

  const isSlotInHour = (slotStart: string, slotEnd: string, currentHour: number) => {
    const start = parseTime(slotStart);
    const end = parseTime(slotEnd);
    return start < currentHour + 1 && end > currentHour;
  };

  const isSlotActiveOnDate = (slot: TimeSlot, date: Date) => {
    if (slot.type === "Recurring") {
      if (slot.day !== format(date, "EEEE")) return false;
      if (slot.startDate && slot.endDate) {
        const start = parseISO(slot.startDate);
        const end = parseISO(slot.endDate);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        if (!isWithinInterval(date, { start, end })) return false;
      }
      return true;
    }
    if (slot.type === "SpecificDate" || slot.type === "Vacation") {
      return slot.date === format(date, "yyyy-MM-dd");
    }
    return false;
  };

  const handleNextWeek = () => setCurrentDate(addWeeks(currentDate, 1));
  const handlePrevWeek = () => setCurrentDate(subWeeks(currentDate, 1));

  const resetForm = () => {
    setNewSlotType("SpecificDate");
    setNewDate(format(new Date(), "yyyy-MM-dd"));
    setEndDate(format(new Date(), "yyyy-MM-dd"));
    setSelectedDays([]);
    setNewStartTime("09:00");
    setNewEndTime("17:00");
    setIsEditMode(false);
    setEditingSlot(null);
  };

  const handleAddAvailability = () => {
    const clinician = allCliniciansData.find(c => c.id === dialogClinicianId);
    if (!clinician) return;

    if (newSlotType === "Recurring" && selectedDays.length === 0) {
      toast({ title: "Validation Error", description: "Select at least one day of the week.", variant: "destructive" });
      return;
    }

    const newSlots: TimeSlot[] = [];
    const start = parseISO(newDate);
    const end = parseISO(endDate);

    if (newSlotType === "Recurring") {
      selectedDays.forEach(day => {
        newSlots.push({
          id: `ts-${Date.now()}-${day}`,
          clinicianId: dialogClinicianId,
          type: "Recurring",
          day: day,
          date: null,
          startDate: newDate,
          endDate: endDate,
          startTime: newStartTime,
          endTime: newEndTime,
          isBooked: false,
        } as TimeSlot);
      });
    } else {
      const rangeEnd = end < start ? start : end;
      const daysInRange = eachDayOfInterval({ start, end: rangeEnd });

      daysInRange.forEach(day => {
        newSlots.push({
          id: `ts-${Date.now()}-${day.getTime()}`,
          clinicianId: dialogClinicianId,
          type: newSlotType,
          day: format(day, "EEEE"),
          date: format(day, "yyyy-MM-dd"),
          startDate: null,
          endDate: null,
          startTime: newSlotType === "Vacation" ? "00:00" : newStartTime,
          endTime: newSlotType === "Vacation" ? "23:59" : newEndTime,
          isBooked: false,
        } as TimeSlot);
      });
    }

    const updatedSlots = [...clinician.slots, ...newSlots];
    updateSlotsMutation.mutate({ clinicianId: dialogClinicianId, slots: updatedSlots }, {
      onSuccess: () => {
        toast({
          title: "Availability Updated",
          description: newSlotType === "Recurring"
            ? `Added recurring schedule for ${selectedDays.length} days/week`
            : `Schedule updated (${newSlots.length} days)`,
        });
        setIsDialogOpen(false);
        resetForm();
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update availability.", variant: "destructive" });
      },
    });
  };

  const handleEditSlot = (slot: TimeSlot, clinicianId: string) => {
    setIsEditMode(true);
    setEditingSlot(slot);
    setDialogClinicianId(clinicianId);
    setNewSlotType(slot.type as SlotType);
    setNewDate(slot.date || slot.startDate || format(new Date(), "yyyy-MM-dd"));
    setEndDate(slot.endDate || slot.date || format(new Date(), "yyyy-MM-dd"));
    setNewStartTime(slot.startTime);
    setNewEndTime(slot.endTime);
    if (slot.type === "Recurring" && slot.day) {
      setSelectedDays([slot.day]);
    } else {
      setSelectedDays([]);
    }
    setIsDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editingSlot) return;
    const clinician = allCliniciansData.find(c => c.id === dialogClinicianId);
    if (!clinician) return;

    const updatedSlot: TimeSlot = {
      ...editingSlot,
      type: newSlotType,
      day: newSlotType === "Recurring" ? selectedDays[0] : format(parseISO(newDate), "EEEE"),
      date: newSlotType !== "Recurring" ? newDate : null,
      startDate: newSlotType === "Recurring" ? newDate : null,
      endDate: newSlotType === "Recurring" ? endDate : null,
      startTime: newSlotType === "Vacation" ? "00:00" : newStartTime,
      endTime: newSlotType === "Vacation" ? "23:59" : newEndTime,
    };

    const updatedSlots = clinician.slots.map(s => s.id === editingSlot.id ? updatedSlot : s);
    updateSlotsMutation.mutate({ clinicianId: dialogClinicianId, slots: updatedSlots }, {
      onSuccess: () => {
        toast({ title: "Availability Updated", description: "Time slot has been updated." });
        setIsDialogOpen(false);
        resetForm();
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update slot.", variant: "destructive" });
      },
    });
  };

  const handleDeleteClick = (slot: TimeSlot, clinicianId: string) => {
    setDeletingSlot({ slot, clinicianId });
    setIsDeleteOpen(true);
  };

  const handleConfirmDelete = () => {
    if (!deletingSlot) return;
    const clinician = allCliniciansData.find(c => c.id === deletingSlot.clinicianId);
    if (!clinician) return;

    const updatedSlots = clinician.slots.filter(s => s.id !== deletingSlot.slot.id);
    updateSlotsMutation.mutate({ clinicianId: deletingSlot.clinicianId, slots: updatedSlots }, {
      onSuccess: () => {
        toast({ title: "Slot Deleted", description: "Time slot has been removed." });
        setIsDeleteOpen(false);
        setDeletingSlot(null);
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to delete slot.", variant: "destructive" });
      },
    });
  };

  const toggleDaySelection = (day: string) => {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
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
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 flex-shrink-0">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">
            {user?.role === "clinician" ? "My Availability" : "Master Schedule"}
          </h2>
          <p className="text-muted-foreground mt-1">
            {user?.role === "clinician"
              ? "Manage your weekly shifts and view booked sessions."
              : "Weekly view of all clinician availability (7am - 7pm)."}
          </p>
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

          {user?.role !== "clinician" && (
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
          )}

          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="ml-2 gap-2">
                <Plus className="h-4 w-4" /> Add Availability
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{isEditMode ? "Edit Availability" : "Manage Availability"}</DialogTitle>
                <DialogDescription>{isEditMode ? "Update this time slot." : "Add a specific shift, recurring bank, or vacation."}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                {user?.role !== "clinician" && !isEditMode && (
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
                )}

                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={newSlotType} onValueChange={(v) => setNewSlotType(v as SlotType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SpecificDate">One-Off / Specific Date</SelectItem>
                      <SelectItem value="Recurring">Recurring Schedule (Bank)</SelectItem>
                      <SelectItem value="Vacation">Time Off / Vacation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>{newSlotType === "Recurring" ? "Valid From" : "Start Date"}</Label>
                    <DatePicker value={newDate} onChange={setNewDate} placeholder="Select date" />
                  </div>
                  <div className="grid gap-2">
                    <Label>{newSlotType === "Recurring" ? "Valid Until" : "End Date"}</Label>
                    <DatePicker value={endDate} onChange={setEndDate} placeholder="Select date" />
                  </div>
                </div>

                {newSlotType === "Recurring" && (
                  <div className="space-y-2">
                    <Label>Repeat On</Label>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAYS.map(day => (
                        <div
                          key={day}
                          className={cn(
                            "cursor-pointer text-xs px-2.5 py-1.5 rounded-full border transition-colors",
                            selectedDays.includes(day)
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-muted-foreground border-input hover:border-primary"
                          )}
                          onClick={() => toggleDaySelection(day)}
                        >
                          {day.substring(0, 3)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {newSlotType !== "Vacation" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label>Start Time</Label>
                      <Select value={newStartTime} onValueChange={setNewStartTime}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-[200px]">
                          {TIME_OPTIONS.map(time => (
                            <SelectItem key={`start-${time}`} value={time}>{time}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>End Time</Label>
                      <Select value={newEndTime} onValueChange={setNewEndTime}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-[200px]">
                          {TIME_OPTIONS.map(time => (
                            <SelectItem key={`end-${time}`} value={time}>{time}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={isEditMode ? handleSaveEdit : handleAddAvailability} disabled={!dialogClinicianId || updateSlotsMutation.isPending}>
                  {updateSlotsMutation.isPending ? "Saving..." : isEditMode ? "Save Changes" : "Save to Schedule"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="flex-1 border-none shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1 relative">
          <div className="grid grid-cols-[60px_repeat(7,1fr)] min-w-[1000px] sticky top-0 z-20 bg-card border-b border-border shadow-sm">
            <div className="p-4 border-r border-border bg-muted/10"></div>
            {weekDays.map(day => (
              <div key={day.toString()} className="p-3 text-center font-semibold text-sm text-foreground bg-muted/10 border-r border-border last:border-r-0">
                <div>{format(day, "EEEE")}</div>
                <div className="text-xs text-muted-foreground font-normal">{format(day, "d MMM")}</div>
              </div>
            ))}
          </div>

          <div className="min-w-[1000px]">
            {hours.map(hour => (
              <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border/50 last:border-b-0">
                <div className="p-2 text-xs text-muted-foreground text-right pr-3 border-r border-border sticky left-0 bg-card z-10 flex items-center justify-end font-mono">
                  {hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                </div>

                {weekDays.map(day => (
                  <div key={`${day}-${hour}`} className="p-1 border-r border-border/50 last:border-r-0 relative min-h-[80px] hover:bg-muted/5 transition-colors">
                    {filteredClinicians.map((clinician, cIndex) => {
                      const activeSlots = clinician.slots.filter(slot =>
                        isSlotActiveOnDate(slot, day) &&
                        (slot.type === "Vacation" || isSlotInHour(slot.startTime, slot.endTime, hour))
                      );

                      if (activeSlots.length === 0) return null;

                      return activeSlots.map(slot => (
                        <div
                          key={`${clinician.id}-${slot.id}-${hour}`}
                          className={cn(
                            "mb-1 p-1.5 rounded text-[10px] border shadow-sm flex items-center gap-1.5 transition-all cursor-pointer group relative",
                            slot.type === "Vacation"
                              ? "bg-slate-100 text-slate-500 border-slate-200 border-dashed h-full items-start"
                              : slot.isBooked
                                ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                                : getClinicianColor(cIndex)
                          )}
                        >
                          <div className={cn(
                            "h-5 w-5 rounded-full flex items-center justify-center font-bold text-[8px] flex-shrink-0 bg-white/50",
                            slot.type === "Vacation" ? "text-slate-400" : ""
                          )}>
                            {clinician.avatar}
                          </div>
                          <div className="overflow-hidden flex-1">
                            <p className="font-semibold truncate leading-tight">{clinician.name?.split(" ")[1] || clinician.name}</p>
                            <div className="opacity-80 truncate leading-tight flex items-center gap-1">
                              {slot.type === "Vacation" ? "NOT AVAILABLE" : `${slot.startTime} - ${slot.endTime}`}
                            </div>
                            {slot.isBooked && (
                              <div className="flex items-center gap-1 mt-0.5 font-bold">
                                <Briefcase className="h-3 w-3" />
                                <span>Client Booked</span>
                              </div>
                            )}
                          </div>
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 absolute right-1 top-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 bg-white/80 hover:bg-white"
                              onClick={(e) => { e.stopPropagation(); handleEditSlot(slot, clinician.id); }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 bg-white/80 hover:bg-white text-destructive hover:text-destructive"
                              onClick={(e) => { e.stopPropagation(); handleDeleteClick(slot, clinician.id); }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
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

      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Availability Slot</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this time slot? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {updateSlotsMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
