import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Plus, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format, addDays, startOfDay, startOfWeek, parseISO, isWithinInterval, isBefore, differenceInWeeks } from "date-fns";
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

type SlotType = "Recurring" | "Vacation";

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

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function splitIntoHourlySlots(startTime: string, endTime: string): { start: string; end: string }[] {
  const slots: { start: string; end: string }[] = [];
  const [startHour, startMin] = startTime.split(":").map(Number);
  const [endHour, endMin] = endTime.split(":").map(Number);
  
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  
  for (let mins = startMinutes; mins + 60 <= endMinutes; mins += 60) {
    const slotStartHour = Math.floor(mins / 60);
    const slotStartMin = mins % 60;
    const slotEndHour = Math.floor((mins + 60) / 60);
    const slotEndMin = (mins + 60) % 60;
    
    slots.push({
      start: `${String(slotStartHour).padStart(2, "0")}:${String(slotStartMin).padStart(2, "0")}`,
      end: `${String(slotEndHour).padStart(2, "0")}:${String(slotEndMin).padStart(2, "0")}`,
    });
  }
  
  return slots;
}

function addOneHour(time: string): string {
  const [hour, min] = time.split(":").map(Number);
  const newHour = hour + 1;
  if (newHour > 20) return "20:00";
  return `${String(newHour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

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
  
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const DAYS_TO_SHOW = 6;

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingSlot, setDeletingSlot] = useState<{ slot: TimeSlot; clinicianId: string } | null>(null);

  const [newSlotType, setNewSlotType] = useState<SlotType>("Recurring");
  const [newDate, setNewDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [hasEndDate, setHasEndDate] = useState(false);
  const [frequency, setFrequency] = useState<"weekly" | "fortnightly">("weekly");
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [newStartTime, setNewStartTime] = useState("09:00");
  const [newEndTime, setNewEndTime] = useState("10:00");
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

  const addSlotsMutation = useMutation({
    mutationFn: async ({ clinicianId, newSlots }: { clinicianId: string; newSlots: Partial<TimeSlot>[] }) => {
      const response = await apiRequest("POST", `/api/timeslots/${clinicianId}`, newSlots);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinicians/with-slots"] });
    },
  });

  const deleteSlotMutation = useMutation({
    mutationFn: async ({ clinicianId, slotId }: { clinicianId: string; slotId: string }) => {
      const response = await apiRequest("DELETE", `/api/timeslots/${clinicianId}/${slotId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinicians/with-slots"] });
      toast({ title: "Slot Deleted", description: "Time slot has been permanently removed." });
      setIsDeleteOpen(false);
      setDeletingSlot(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete slot.", variant: "destructive" });
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
    const params = new URLSearchParams(window.location.search);
    const clinicianId = params.get("clinicianId");
    if (clinicianId && clinicians.length > 0) {
      const clinician = clinicians.find(c => c.id === clinicianId);
      if (clinician) {
        setDialogClinicianId(clinicianId);
        setIsDialogOpen(true);
      }
    }
  }, [clinicians]);

  useEffect(() => {
    if (isDialogOpen && user?.role !== "clinician") {
      if (clinicians.length > 0 && !dialogClinicianId) {
        setDialogClinicianId(clinicians[0].id);
      }
    }
  }, [isDialogOpen, clinicians, user, dialogClinicianId]);

  const allCliniciansData = [...(cliniciansWithSlots.data || [])].sort((a, b) => {
    const slotsA = a.slots?.filter(s => s.type !== "Vacation").length || 0;
    const slotsB = b.slots?.filter(s => s.type !== "Vacation").length || 0;
    
    if (slotsB !== slotsA) {
      return slotsB - slotsA;
    }
    
    const tierOrder: Record<string, number> = { "High": 0, "Mid": 1, "Low": 2 };
    const tierA = tierOrder[a.tier || "Mid"] ?? 1;
    const tierB = tierOrder[b.tier || "Mid"] ?? 1;
    return tierA - tierB;
  });

  const visibleDates = Array.from({ length: DAYS_TO_SHOW }, (_, i) => addDays(weekStart, i));

  const handleScrollLeft = () => {
    const prevWeek = addDays(weekStart, -7);
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    if (isBefore(prevWeek, currentWeekStart)) {
      setWeekStart(currentWeekStart);
    } else {
      setWeekStart(prevWeek);
    }
  };

  const handleScrollRight = () => {
    setWeekStart(addDays(weekStart, 7));
  };

  const getSlotsForDate = (clinician: ClinicianWithSlots, date: Date): SlotForDate[] => {
    const dayName = format(date, "EEEE");
    const dateStr = format(date, "yyyy-MM-dd");
    const results: SlotForDate[] = [];

    clinician.slots.forEach(slot => {
      if (slot.type === "Recurring") {
        if (slot.day !== dayName) return;
        
        const slotStart = slot.startDate ? parseISO(slot.startDate) : null;
        const slotEnd = slot.endDate ? parseISO(slot.endDate) : null;
        const slotFrequency = (slot as any).frequency || "weekly";
        const slotIsOngoing = (slot as any).isOngoing || false;
        
        if (slotFrequency === "fortnightly" && slotStart) {
          const weeksDiff = differenceInWeeks(startOfWeek(date, { weekStartsOn: 1 }), startOfWeek(slotStart, { weekStartsOn: 1 }));
          if (weeksDiff < 0 || weeksDiff % 2 !== 0) return;
        }
        
        if (slotIsOngoing || !slotEnd) {
          if (slotStart) {
            const startCmp = new Date(slotStart);
            startCmp.setHours(0, 0, 0, 0);
            const isAfterStart = !isBefore(date, startCmp);
            const isFutureSlot = isBefore(date, startCmp);
            
            if (isAfterStart) {
              results.push({ slot, isActive: true, isFuture: false });
            } else if (isFutureSlot) {
              results.push({
                slot,
                isActive: false,
                isFuture: true,
                validFrom: format(startCmp, "dd/MM/yyyy"),
              });
            }
          } else {
            results.push({ slot, isActive: true, isFuture: false });
          }
          return;
        }
        
        if (slotStart && slotEnd) {
          const startCmp = new Date(slotStart);
          startCmp.setHours(0, 0, 0, 0);
          const endCmp = new Date(slotEnd);
          endCmp.setHours(23, 59, 59, 999);
          
          const isWithinRange = isWithinInterval(date, { start: startCmp, end: endCmp });
          const isFutureSlot = isBefore(date, startCmp);
          
          if (isWithinRange) {
            results.push({ slot, isActive: true, isFuture: false });
          } else if (isFutureSlot && isBefore(startOfDay(new Date()), endCmp)) {
            results.push({
              slot,
              isActive: false,
              isFuture: true,
              validFrom: format(startCmp, "dd/MM/yyyy"),
              validUntil: format(endCmp, "dd/MM/yyyy"),
            });
          }
        }
      } else if (slot.type === "Vacation") {
        if (slot.date === dateStr) {
          results.push({ slot, isActive: true, isFuture: false });
        }
      }
    });

    return results;
  };

  const resetForm = () => {
    setNewSlotType("Recurring");
    setNewDate(format(new Date(), "yyyy-MM-dd"));
    setEndDate(format(new Date(), "yyyy-MM-dd"));
    setHasEndDate(false);
    setFrequency("weekly");
    setSelectedDays([]);
    setNewStartTime("09:00");
    setNewEndTime("10:00");
  };

  const handleAddAvailability = () => {
    const clinician = allCliniciansData.find(c => c.id === dialogClinicianId);
    if (!clinician) return;

    if (newSlotType === "Recurring" && selectedDays.length === 0) {
      toast({ title: "Validation Error", description: "Select at least one day of the week.", variant: "destructive" });
      return;
    }

    if (newSlotType !== "Vacation") {
      const previewSlots = splitIntoHourlySlots(newStartTime, newEndTime);
      if (previewSlots.length === 0) {
        toast({ 
          title: "Validation Error", 
          description: "Time range must be at least 1 hour. Each booking requires a full 1-hour slot.", 
          variant: "destructive" 
        });
        return;
      }
    }

    const newSlots: Partial<TimeSlot>[] = [];
    const start = parseISO(newDate);

    if (newSlotType === "Recurring") {
      const hourlySlots = splitIntoHourlySlots(newStartTime, newEndTime);
      
      selectedDays.forEach((day) => {
        hourlySlots.forEach((timeSlot) => {
          newSlots.push({
            clinicianId: dialogClinicianId,
            type: "Recurring",
            day: day,
            date: null,
            startDate: newDate,
            endDate: hasEndDate ? endDate : null,
            startTime: timeSlot.start,
            endTime: timeSlot.end,
            isBooked: false,
            batchId: null,
            frequency: frequency,
            isOngoing: !hasEndDate,
          } as any);
        });
      });
    } else {
      newSlots.push({
        clinicianId: dialogClinicianId,
        type: "Vacation",
        day: format(start, "EEEE"),
        date: newDate,
        startDate: null,
        endDate: null,
        startTime: "00:00",
        endTime: "23:59",
        isBooked: false,
        batchId: null,
      } as any);
    }

    addSlotsMutation.mutate({ clinicianId: dialogClinicianId, newSlots }, {
      onSuccess: () => {
        toast({
          title: "Availability Added",
          description: `Added ${newSlots.length} time slot${newSlots.length > 1 ? "s" : ""}`,
        });
        setIsDialogOpen(false);
        resetForm();
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to add availability.", variant: "destructive" });
      },
    });
  };

  const handleDeleteClick = (slot: TimeSlot, clinicianId: string) => {
    setDeletingSlot({ slot, clinicianId });
    setIsDeleteOpen(true);
  };

  const handleConfirmDelete = () => {
    if (!deletingSlot) return;
    deleteSlotMutation.mutate({ 
      clinicianId: deletingSlot.clinicianId, 
      slotId: deletingSlot.slot.id 
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
              <Button className="gap-2" data-testid="button-add-availability">
                <Plus className="h-4 w-4" /> Add Availability
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Availability</DialogTitle>
                <DialogDescription>Add availability or time off for a clinician.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                {user?.role !== "clinician" && (
                  <div className="grid gap-2">
                    <Label>Clinician</Label>
                    <Select value={dialogClinicianId} onValueChange={setDialogClinicianId}>
                      <SelectTrigger data-testid="select-clinician">
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
                    <SelectTrigger data-testid="select-slot-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Recurring">Availability</SelectItem>
                      <SelectItem value="Vacation">Time Off / Vacation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {newSlotType === "Recurring" && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label>Start Date</Label>
                        <DatePicker value={newDate} onChange={setNewDate} placeholder="Select date" />
                      </div>
                      {hasEndDate && (
                        <div className="grid gap-2">
                          <Label>End Date</Label>
                          <DatePicker value={endDate} onChange={setEndDate} placeholder="Select date" />
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="hasEndDate"
                        checked={hasEndDate}
                        onChange={(e) => setHasEndDate(e.target.checked)}
                        className="h-4 w-4"
                        data-testid="checkbox-has-end-date"
                      />
                      <label htmlFor="hasEndDate" className="text-sm cursor-pointer">
                        Add an end date
                      </label>
                    </div>

                    <div className="grid gap-2">
                      <Label>Frequency</Label>
                      <Select value={frequency} onValueChange={(val) => setFrequency(val as "weekly" | "fortnightly")}>
                        <SelectTrigger data-testid="select-frequency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="fortnightly">Fortnightly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Repeat On</Label>
                      <div className="flex flex-wrap gap-2">
                        {WEEKDAYS.map(day => (
                          <div
                            key={day}
                            data-testid={`day-${day.toLowerCase()}`}
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
                  </>
                )}

                {newSlotType === "Vacation" && (
                  <div className="grid gap-2">
                    <Label>Date</Label>
                    <DatePicker value={newDate} onChange={setNewDate} placeholder="Select date" />
                  </div>
                )}

                {newSlotType !== "Vacation" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label>Start Time</Label>
                      <Select value={newStartTime} onValueChange={(val) => {
                        setNewStartTime(val);
                        setNewEndTime(addOneHour(val));
                      }}>
                        <SelectTrigger data-testid="select-start-time">
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
                        <SelectTrigger data-testid="select-end-time">
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

                {newSlotType !== "Vacation" && (
                  <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                    {(() => {
                      const preview = splitIntoHourlySlots(newStartTime, newEndTime);
                      if (preview.length === 0) return "Time range must be at least 1 hour.";
                      return `This will create ${preview.length} x 1-hour slot${preview.length > 1 ? "s" : ""}: ${preview.map(s => `${s.start}-${s.end}`).join(", ")}`;
                    })()}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button 
                  onClick={handleAddAvailability} 
                  disabled={!dialogClinicianId || addSlotsMutation.isPending}
                  data-testid="button-save-availability"
                >
                  {addSlotsMutation.isPending ? "Saving..." : "Save to Schedule"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="flex-1 border shadow-sm overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-3 border-b bg-muted/30">
          <Button variant="outline" size="sm" onClick={handleScrollLeft} disabled={isBefore(weekStart, startOfWeek(new Date(), { weekStartsOn: 1 })) || weekStart.getTime() === startOfWeek(new Date(), { weekStartsOn: 1 }).getTime()}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous
          </Button>
          <div className="text-sm font-medium text-muted-foreground">
            {format(weekStart, "d MMM")} - {format(addDays(weekStart, 5), "d MMM yyyy")}
          </div>
          <Button variant="outline" size="sm" onClick={handleScrollRight}>
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        <div className="flex-1 overflow-x-auto overflow-y-auto" ref={scrollContainerRef}>
          <table className="border-collapse w-full">
            <thead className="sticky top-0 z-20">
              <tr className="bg-muted/30">
                <th className="p-3 font-semibold text-sm text-left border-b border-r bg-muted/30 sticky left-0 z-30 min-w-[200px] w-[200px]">
                  Clinician
                </th>
                {visibleDates.map(date => (
                  <th key={date.toString()} className="p-2 text-center border-b border-r bg-muted/30 min-w-[120px]">
                    <div className="font-semibold text-sm">{format(date, "EEE")}</div>
                    <div className="text-xs text-muted-foreground font-normal">{format(date, "d MMM")}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allCliniciansData.map((clinician, clinicianIndex) => (
                <tr key={clinician.id} className="border-b last:border-b-0">
                  <td className="p-3 border-r sticky left-0 bg-card z-10 min-w-[200px] w-[200px] align-top">
                    <div className="flex items-start gap-2">
                      <div className={cn(
                        "h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
                        getClinicianColor(clinicianIndex)
                      )}>
                        {clinician.avatar}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{clinician.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{clinician.tier || "Mid"} · {clinician.location || "No location"}</div>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {clinician.worksWithCouples && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">Couples</span>
                          )}
                          {clinician.allocateForBupa && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Bupa</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>

                  {visibleDates.map(date => {
                    const slotsForDate = getSlotsForDate(clinician, date);
                    
                    return (
                      <td key={`${clinician.id}-${date.toString()}`} className="p-1 border-r min-h-[80px] bg-card align-top">
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
                                    ? "bg-gray-100 text-gray-600 border-gray-300"
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
                                  <div className="font-semibold">{slot.startTime} - {slot.endTime} <span className="font-normal text-[9px] opacity-70">{(slot as any).frequency === "fortnightly" ? "F" : "W"}</span></div>
                                  {isFuture && (
                                    <div className="text-[9px] leading-tight mt-0.5 italic">
                                      Available from {validFrom}{validUntil ? ` to ${validUntil}` : ""}
                                    </div>
                                  )}
                                  {slot.isBooked && (
                                    <Badge variant="secondary" className="text-[8px] px-1 py-0 mt-0.5">
                                      Booked
                                    </Badge>
                                  )}
                                </>
                              )}
                              
                              {!isAllocating && (isActive || isFuture) && (
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute right-0.5 top-0.5 flex gap-0.5">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 bg-white/80 hover:bg-white text-destructive p-0"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteClick(slot, clinician.id); }}
                                    data-testid={`button-delete-slot-${slot.id}`}
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Availability Slot</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingSlot?.slot.isBooked 
                ? "This slot is currently booked. Deleting it will permanently remove it and clear the booking from any associated client. This cannot be undone."
                : "Are you sure you want to delete this time slot? This will permanently remove it from all future weeks. This action cannot be undone."
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteSlotMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
