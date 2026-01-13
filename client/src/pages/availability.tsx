import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Plus, Trash2, Pencil, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format, addDays, startOfDay, startOfMonth, endOfMonth, addMonths, parseISO, isWithinInterval, isBefore, isAfter, differenceInDays, getDaysInMonth } from "date-fns";
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
import type { Clinician, TimeSlot, Client } from "@shared/schema";

type SlotType = "Recurring" | "SpecificDate" | "Vacation";

interface ClinicianWithSlots extends Clinician {
  name: string;
  email?: string;
  avatar: string;
  slots: TimeSlot[];
}

interface SlotForDate {
  slot: TimeSlot;
  isActive: boolean;
  isFuture: boolean;
  validFrom?: string;
  validUntil?: string;
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
  const [, setLocation] = useLocation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const daysInMonth = getDaysInMonth(currentMonth);

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

  const [isAllocating, setIsAllocating] = useState(false);
  const [allocatingClientId, setAllocatingClientId] = useState<string | null>(null);
  const [allocatingClient, setAllocatingClient] = useState<Client | null>(null);

  const { data: clinicians = [] } = useQuery<(Clinician & { name: string })[]>({
    queryKey: ["/api/clinicians"],
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: user?.role === "admin",
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
            avatar: clinician.name?.substring(0, 2).toUpperCase() || "??",
            slots,
          };
        } catch {
          return { ...clinician, avatar: clinician.name?.substring(0, 2).toUpperCase() || "??", slots: [] };
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

  const assignClientMutation = useMutation({
    mutationFn: async ({ clientId, clinicianId, slotId }: { clientId: string; clinicianId: string; slotId: string }) => {
      const response = await apiRequest("POST", `/api/clients/${clientId}/assign`, {
        clinicianId,
        slotId,
        allocationMethod: "manual"
      });
      return response.json();
    },
    onSuccess: () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("allocate");
      window.history.replaceState({}, "", url.pathname);
      
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clinicians/with-slots"] });
      toast({ title: "Client Allocated", description: "Client has been assigned to the selected slot." });
      setIsAllocating(false);
      setAllocatingClientId(null);
      setAllocatingClient(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to allocate client.", variant: "destructive" });
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clientId = params.get("allocate");
    if (clientId && clients.length > 0 && !isAllocating) {
      const client = clients.find(c => c.id === clientId);
      if (client && client.status !== "Assigned" && client.status !== "Scheduled") {
        setIsAllocating(true);
        setAllocatingClientId(clientId);
        setAllocatingClient(client);
      }
    }
  }, [clients, isAllocating]);

  useEffect(() => {
    if (user?.role === "clinician") {
      const myClinician = clinicians.find(c => c.userId === user.id);
      if (myClinician) {
        setDialogClinicianId(myClinician.id);
      }
    }
  }, [user, clinicians]);

  useEffect(() => {
    if (isDialogOpen && user?.role !== "clinician") {
      if (clinicians.length > 0 && !dialogClinicianId) {
        setDialogClinicianId(clinicians[0].id);
      }
    }
  }, [isDialogOpen, clinicians, user, dialogClinicianId]);

  const allCliniciansData = cliniciansWithSlots.data || [];

  const visibleDates = Array.from({ length: daysInMonth }, (_, i) => addDays(currentMonth, i));

  const handleScrollLeft = () => {
    const prevMonth = addMonths(currentMonth, -1);
    const thisMonth = startOfMonth(new Date());
    if (isBefore(prevMonth, thisMonth)) {
      setCurrentMonth(thisMonth);
    } else {
      setCurrentMonth(prevMonth);
    }
  };

  const handleScrollRight = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  const getSlotsForDate = (clinician: ClinicianWithSlots, date: Date): SlotForDate[] => {
    const today = startOfDay(new Date());
    const dayName = format(date, "EEEE");
    const dateStr = format(date, "yyyy-MM-dd");
    const results: SlotForDate[] = [];

    clinician.slots.forEach(slot => {
      if (slot.type === "Recurring") {
        if (slot.day !== dayName) return;
        
        const slotStart = slot.startDate ? parseISO(slot.startDate) : null;
        const slotEnd = slot.endDate ? parseISO(slot.endDate) : null;
        
        if (slotStart && slotEnd) {
          slotStart.setHours(0, 0, 0, 0);
          slotEnd.setHours(23, 59, 59, 999);
          
          const isWithinRange = isWithinInterval(date, { start: slotStart, end: slotEnd });
          const isFutureSlot = isBefore(date, slotStart);
          
          if (isWithinRange) {
            results.push({
              slot,
              isActive: true,
              isFuture: false,
            });
          } else if (isFutureSlot && isBefore(today, slotEnd)) {
            results.push({
              slot,
              isActive: false,
              isFuture: true,
              validFrom: format(slotStart, "dd/MM/yyyy"),
              validUntil: format(slotEnd, "dd/MM/yyyy"),
            });
          }
        } else {
          results.push({
            slot,
            isActive: true,
            isFuture: false,
          });
        }
      } else if (slot.type === "SpecificDate" || slot.type === "Vacation") {
        if (slot.date === dateStr) {
          results.push({
            slot,
            isActive: true,
            isFuture: false,
          });
        }
      }
    });

    return results;
  };

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
      const dayCount = differenceInDays(rangeEnd, start) + 1;
      
      for (let i = 0; i < dayCount; i++) {
        const day = addDays(start, i);
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
      }
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

  const handleSlotClick = (slot: TimeSlot, clinicianId: string) => {
    if (!isAllocating || !allocatingClientId) return;
    if (slot.isBooked || slot.type === "Vacation") return;
    
    assignClientMutation.mutate({
      clientId: allocatingClientId,
      clinicianId,
      slotId: slot.id,
    });
  };

  const cancelAllocation = () => {
    setIsAllocating(false);
    setAllocatingClientId(null);
    setAllocatingClient(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("allocate");
    window.history.replaceState({}, "", url.pathname);
  };

  const getClinicianColor = (index: number) => {
    const colors = [
      "bg-teal-100 text-teal-800 border-teal-300",
      "bg-indigo-100 text-indigo-800 border-indigo-300",
      "bg-rose-100 text-rose-800 border-rose-300",
      "bg-amber-100 text-amber-800 border-amber-300",
      "bg-purple-100 text-purple-800 border-purple-300",
      "bg-emerald-100 text-emerald-800 border-emerald-300",
      "bg-blue-100 text-blue-800 border-blue-300",
      "bg-pink-100 text-pink-800 border-pink-300",
    ];
    return colors[index % colors.length];
  };

  return (
    <div className="space-y-4 h-[calc(100vh-8rem)] flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 flex-shrink-0">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">
            {user?.role === "clinician" ? "My Availability" : "Clinician Availability"}
          </h2>
          <p className="text-muted-foreground mt-1">
            {isAllocating 
              ? `Select a slot to allocate ${allocatingClient?.displayId || "client"}`
              : user?.role === "clinician"
                ? "Manage your availability and view booked sessions."
                : "View and manage clinician schedules. Scroll left/right to see more dates."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isAllocating && (
            <div className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-2 rounded-lg border border-primary/20">
              <UserPlus className="h-4 w-4" />
              <span className="text-sm font-medium">Allocating: {allocatingClient?.displayId}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={cancelAllocation}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> Add Availability
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{isEditMode ? "Edit Availability" : "Add Availability"}</DialogTitle>
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

      <Card className="flex-1 border shadow-sm overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-3 border-b bg-muted/30">
          <Button variant="outline" size="sm" onClick={handleScrollLeft} disabled={isBefore(currentMonth, startOfMonth(new Date()))}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous
          </Button>
          <div className="text-sm font-medium text-muted-foreground">
            {format(currentMonth, "MMMM yyyy")}
          </div>
          <Button variant="outline" size="sm" onClick={handleScrollRight}>
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto" ref={scrollContainerRef}>
          <div className="min-w-[1200px]">
            <div className="grid sticky top-0 z-20 bg-card border-b" style={{ gridTemplateColumns: `200px repeat(${daysInMonth}, minmax(80px, 1fr))` }}>
              <div className="p-3 font-semibold text-sm bg-muted/20 border-r sticky left-0 z-30 bg-card">
                Clinician
              </div>
              {visibleDates.map(date => (
                <div key={date.toString()} className="p-2 text-center border-r bg-muted/20">
                  <div className="font-semibold text-sm">{format(date, "EEE")}</div>
                  <div className="text-xs text-muted-foreground">{format(date, "d MMM")}</div>
                </div>
              ))}
            </div>

            {allCliniciansData.map((clinician, clinicianIndex) => (
              <div 
                key={clinician.id} 
                className="grid border-b last:border-b-0"
                style={{ gridTemplateColumns: `200px repeat(${daysInMonth}, minmax(80px, 1fr))` }}
              >
                <div className="p-3 border-r sticky left-0 bg-card z-10 flex items-start gap-2">
                  <div className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
                    getClinicianColor(clinicianIndex)
                  )}>
                    {clinician.avatar}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{clinician.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{clinician.location || "No location"}</div>
                  </div>
                </div>

                {visibleDates.map(date => {
                  const slotsForDate = getSlotsForDate(clinician, date);
                  
                  return (
                    <div key={`${clinician.id}-${date.toString()}`} className="p-1 border-r min-h-[80px] bg-card">
                      {slotsForDate.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-xs text-muted-foreground/50">
                          -
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {slotsForDate.map(({ slot, isActive, isFuture, validFrom, validUntil }) => (
                            <div
                              key={slot.id}
                              onClick={() => isActive && !slot.isBooked && slot.type !== "Vacation" && handleSlotClick(slot, clinician.id)}
                              className={cn(
                                "p-1.5 rounded text-[10px] border transition-all group relative",
                                slot.type === "Vacation"
                                  ? "bg-slate-100 text-slate-500 border-slate-200 border-dashed"
                                  : isFuture
                                    ? "bg-gray-50 text-gray-400 border-gray-200 opacity-60"
                                    : slot.isBooked
                                      ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                                      : isAllocating
                                        ? "cursor-pointer hover:ring-2 hover:ring-primary hover:ring-offset-1 " + getClinicianColor(clinicianIndex)
                                        : getClinicianColor(clinicianIndex)
                              )}
                            >
                              {slot.type === "Vacation" ? (
                                <div className="font-medium">OFF</div>
                              ) : (
                                <>
                                  <div className="font-semibold">{slot.startTime} - {slot.endTime}</div>
                                  {isFuture && (
                                    <div className="text-[9px] leading-tight mt-0.5 italic">
                                      Available {validFrom} - {validUntil}
                                    </div>
                                  )}
                                  {slot.isBooked && (
                                    <Badge variant="secondary" className="text-[8px] px-1 py-0 mt-0.5">
                                      Booked
                                    </Badge>
                                  )}
                                </>
                              )}
                              
                              {!isAllocating && isActive && !isFuture && (
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute right-0.5 top-0.5 flex gap-0.5">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 bg-white/80 hover:bg-white p-0"
                                    onClick={(e) => { e.stopPropagation(); handleEditSlot(slot, clinician.id); }}
                                  >
                                    <Pencil className="h-2.5 w-2.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 bg-white/80 hover:bg-white text-destructive p-0"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteClick(slot, clinician.id); }}
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
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
