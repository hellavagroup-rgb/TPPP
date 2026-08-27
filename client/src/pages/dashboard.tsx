import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Users, 
  FileText, 
  AlertCircle, 
  Loader2,
  Mail,
  CheckCircle2,
  Calendar,
  Clock,
  CalendarPlus,
  CalendarX,
  ClipboardCheck,
  ListChecks,
  ListTodo,
  UserPlus,
  MapPin
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import type { Client, Clinician, TimeSlot } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ClinicianWithAvailability = Clinician & { name: string; availability?: TimeSlot[] };

interface RecentActivityItem {
  id: string;
  eventType: "client" | "form" | "availability" | "task" | "team" | "settings";
  title: string;
  description?: string;
  actorName?: string;
  timestamp: string | Date;
}

type ActivityCategory = "all" | "clients" | "tasks" | "availability";

function formatTimeAgo(date: string | Date): string {
  const dateValue = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - dateValue.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return dateValue.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function getActivityAppearance(eventType: RecentActivityItem["eventType"], title: string) {
  if (eventType === "availability") {
    return title.includes("removed")
      ? { Icon: CalendarX, surface: "bg-rose-50 border-rose-100", icon: "bg-rose-100 text-rose-700" }
      : title.includes("location")
        ? { Icon: MapPin, surface: "bg-sky-50 border-sky-100", icon: "bg-sky-100 text-sky-700" }
        : { Icon: CalendarPlus, surface: "bg-emerald-50 border-emerald-100", icon: "bg-emerald-100 text-emerald-700" };
  }
  if (eventType === "form") return { Icon: ClipboardCheck, surface: "bg-teal-50 border-teal-100", icon: "bg-teal-100 text-teal-700" };
  if (eventType === "task") {
    return title.includes("completed")
      ? { Icon: ListChecks, surface: "bg-violet-50 border-violet-100", icon: "bg-violet-100 text-violet-700" }
      : { Icon: ListTodo, surface: "bg-slate-50 border-slate-100", icon: "bg-slate-100 text-slate-700" };
  }
  return { Icon: UserPlus, surface: "bg-indigo-50 border-indigo-100", icon: "bg-indigo-100 text-indigo-700" };
}

function ActivityList({
  activities,
  isLoading,
  isError,
  emptyMessage,
  category,
}: {
  activities: RecentActivityItem[];
  isLoading: boolean;
  isError: boolean;
  emptyMessage: string;
  category: ActivityCategory;
}) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-muted-foreground text-center py-8">This activity view could not be loaded. Please refresh and try again.</p>;
  }

  if (activities.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">{emptyMessage}</p>;
  }

  return (
    <div className="max-h-[420px] overflow-y-auto pr-1 space-y-3" data-testid={`activity-list-${category}`}>
      {activities.map((activity) => {
        const { Icon, surface, icon } = getActivityAppearance(activity.eventType, activity.title);
        return (
          <div key={activity.id} className={`flex items-start justify-between gap-3 p-3 rounded-lg border ${surface}`}>
            <div className="flex items-start gap-2 min-w-0">
              <div className={`p-1.5 rounded-full shrink-0 ${icon}`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm">{activity.title}</p>
                {activity.description && <p className="text-xs text-muted-foreground mt-0.5">{activity.description}</p>}
                {activity.actorName && <p className="text-xs text-muted-foreground mt-1">By {activity.actorName}</p>}
              </div>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{formatTimeAgo(activity.timestamp)}</span>
          </div>
        );
      })}
    </div>
  );
}

function isSlotActive(slot: TimeSlot) {
  if (!slot.endDate) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(slot.endDate);
  endDate.setHours(0, 0, 0, 0);
  return endDate >= today;
}

function hasRemainingOccurrence(slot: TimeSlot): boolean {
  const frequency = (slot as any).frequency || "weekly";
  if (frequency !== "fortnightly") return true;
  if (!slot.startDate) return true;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(slot.startDate);
  startDate.setHours(0, 0, 0, 0);
  const endDate = slot.endDate ? new Date(slot.endDate) : null;
  if (endDate) endDate.setHours(23, 59, 59, 999);

  const dayIndex: Record<string, number> = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 0 };
  const slotDayNum = dayIndex[slot.day || ""] ?? 0;

  let checkDate = new Date(startDate);
  const diff = (slotDayNum - checkDate.getDay() + 7) % 7;
  checkDate.setDate(checkDate.getDate() + diff);

  while (checkDate <= (endDate || new Date(today.getFullYear() + 1, 0, 1))) {
    if (checkDate >= today) return true;
    checkDate.setDate(checkDate.getDate() + 14);
  }
  return false;
}

function getSlotCounts(availability?: TimeSlot[]) {
  if (!availability) return { available: 0, pending: 0 };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let available = 0;
  let pending = 0;
  
  availability.filter(s => !s.isBooked && s.type !== "Vacation" && isSlotActive(s) && hasRemainingOccurrence(s)).forEach(slot => {
    if (slot.type === "Recurring") {
      if (slot.startDate) {
        const startDate = new Date(slot.startDate);
        startDate.setHours(0, 0, 0, 0);
        if (startDate > today) {
          pending++;
        } else {
          available++;
        }
      } else {
        available++;
      }
    } else if (slot.type === "SpecificDate" && slot.date) {
      const slotDate = new Date(slot.date);
      slotDate.setHours(0, 0, 0, 0);
      if (slotDate <= today) {
        available++;
      } else {
        pending++;
      }
    }
  });
  
  return { available, pending };
}

export default function Dashboard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [sendingReminders, setSendingReminders] = useState(false);

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: clinicians = [] } = useQuery<ClinicianWithAvailability[]>({
    queryKey: ["/api/clinicians"],
  });

  const { data: allActivity = [], isLoading: isAllActivityLoading, isError: isAllActivityError } = useQuery<RecentActivityItem[]>({
    queryKey: ["/api/activity/recent?category=all"],
    enabled: user?.role === "admin",
    refetchInterval: 60_000,
  });
  const { data: clientActivity = [], isLoading: isClientActivityLoading, isError: isClientActivityError } = useQuery<RecentActivityItem[]>({
    queryKey: ["/api/activity/recent?category=clients"],
    enabled: user?.role === "admin",
    refetchInterval: 60_000,
  });
  const { data: taskActivity = [], isLoading: isTaskActivityLoading, isError: isTaskActivityError } = useQuery<RecentActivityItem[]>({
    queryKey: ["/api/activity/recent?category=tasks"],
    enabled: user?.role === "admin",
    refetchInterval: 60_000,
  });
  const { data: availabilityActivity = [], isLoading: isAvailabilityActivityLoading, isError: isAvailabilityActivityError } = useQuery<RecentActivityItem[]>({
    queryKey: ["/api/activity/recent?category=availability"],
    enabled: user?.role === "admin",
    refetchInterval: 60_000,
  });

  // Get linked clinician data for admins who are also clinicians
  const linkedClinician = user?.linkedClinicianId 
    ? clinicians.find(c => c.id === user.linkedClinicianId) 
    : null;
  const linkedClinicianSlots = linkedClinician 
    ? getSlotCounts(linkedClinician.availability) 
    : null;

  const sendRemindersMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/email/availability-reminders");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Reminders Sent",
        description: data.message,
      });
      setSendingReminders(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to send reminders. Please try again.",
        variant: "destructive",
      });
      setSendingReminders(false);
    },
  });

  const handleSendReminders = () => {
    setSendingReminders(true);
    sendRemindersMutation.mutate();
  };

  const stats = [
    {
      title: "Pending Intake",
      value: clients.filter(c => c.status === "New").length,
      change: "New clients awaiting forms",
      icon: AlertCircle,
      color: "text-amber-600",
      bg: "bg-amber-100"
    },
    {
      title: "Screen Booked/Sent",
      value: clients.filter(c => c.status === "Forms Sent").length,
      change: "Forms sent to client",
      icon: FileText,
      color: "text-blue-600",
      bg: "bg-blue-100"
    },
    {
      title: "Forms Completed",
      value: clients.filter(c => c.status === "Forms Completed").length,
      change: "Ready for allocation",
      icon: CheckCircle2,
      color: "text-teal-600",
      bg: "bg-teal-100"
    },
    {
      title: "Allocated",
      value: clients.filter(c => c.status === "Assigned").length,
      change: "Assigned to clinician",
      icon: Users,
      color: "text-indigo-600",
      bg: "bg-indigo-100"
    },
    {
      title: "Awaiting Confirmation",
      value: clients.filter(c => c.status === "AwaitingConfirmation").length,
      change: "Email sent to client",
      icon: Mail,
      color: "text-purple-600",
      bg: "bg-purple-100"
    },
    {
      title: "Waitlist",
      value: clients.filter(c => c.status === "Waitlist").length,
      change: "Awaiting clinician match",
      icon: AlertCircle,
      color: "text-slate-600",
      bg: "bg-slate-100"
    },
    {
      title: "Available Slots",
      value: clinicians.reduce((sum, c) => sum + getSlotCounts(c.availability).available, 0),
      change: `${clinicians.reduce((sum, c) => sum + getSlotCounts(c.availability).pending, 0)} pending`,
      icon: Calendar,
      color: "text-green-600",
      bg: "bg-green-100"
    }
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-serif font-bold text-foreground">Clinician Allocation Dashboard</h2>
        <p className="text-muted-foreground mt-1">Manage client intake and clinician availability.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {stats.map((stat) => (
          <Card key={stat.title} className="border-none shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between space-y-0 pb-2">
                <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                <div className={`p-2 rounded-full ${stat.bg}`}>
                  <stat.icon className={`h-4 w-4 ${stat.color}`} />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.change}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* My Availability section for admins linked to a clinician profile */}
      {linkedClinician && (
        <Card className="border-l-4 border-l-primary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              My Availability
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  Your clinician profile: <span className="font-medium text-foreground">{linkedClinician.name}</span>
                </p>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4 text-emerald-600" />
                    <span className="font-medium text-emerald-600">{linkedClinicianSlots?.available || 0}</span>
                    <span className="text-muted-foreground">available slots</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4 text-amber-600" />
                    <span className="font-medium text-amber-600">{linkedClinicianSlots?.pending || 0}</span>
                    <span className="text-muted-foreground">pending</span>
                  </div>
                </div>
              </div>
              <Link href={`/availability?clinicianId=${linkedClinician.id}`}>
                <Button>
                  <Calendar className="h-4 w-4 mr-2" />
                  Manage My Availability
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Recent Activity
              </CardTitle>
              <p className="text-sm text-muted-foreground">Browse practice changes by category. Each view keeps its own recent activity.</p>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="clients" className="w-full">
                <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto gap-1">
                  <TabsTrigger value="clients">Clients &amp; Forms</TabsTrigger>
                  <TabsTrigger value="tasks">Tasks</TabsTrigger>
                  <TabsTrigger value="availability">Availability</TabsTrigger>
                  <TabsTrigger value="all">All Activity</TabsTrigger>
                </TabsList>
                <TabsContent value="clients">
                  <ActivityList
                    activities={clientActivity}
                    isLoading={isClientActivityLoading}
                    isError={isClientActivityError}
                    emptyMessage="No client or form activity yet."
                    category="clients"
                  />
                </TabsContent>
                <TabsContent value="tasks">
                  <ActivityList
                    activities={taskActivity}
                    isLoading={isTaskActivityLoading}
                    isError={isTaskActivityError}
                    emptyMessage="No task activity yet."
                    category="tasks"
                  />
                </TabsContent>
                <TabsContent value="availability">
                  <ActivityList
                    activities={availabilityActivity}
                    isLoading={isAvailabilityActivityLoading}
                    isError={isAvailabilityActivityError}
                    emptyMessage="No availability activity yet."
                    category="availability"
                  />
                </TabsContent>
                <TabsContent value="all">
                  <ActivityList
                    activities={allActivity}
                    isLoading={isAllActivityLoading}
                    isError={isAllActivityError}
                    emptyMessage="No recent activity."
                    category="all"
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Clinician Capacity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {clinicians.map((clinician) => {
              const counts = getSlotCounts(clinician.availability);
              return (
                <div key={clinician.id} className="space-y-3 pb-3 border-b border-border/40 last:border-0">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-xs font-medium">
                        {clinician.avatar}
                      </div>
                      <div>
                        <span className="font-medium block">{clinician.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {counts.available + counts.pending} open slots
                        </span>
                      </div>
                    </div>
                    <div className="text-right space-y-0.5">
                      <div className="flex items-center gap-2 justify-end">
                        <span className={`font-bold ${counts.available > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                          {counts.available}
                        </span>
                        <span className="text-[10px] text-muted-foreground">available</span>
                      </div>
                      <div className="flex items-center gap-2 justify-end">
                        <span className="font-bold text-slate-500">
                          {counts.pending}
                        </span>
                        <span className="text-[10px] text-muted-foreground">pending</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            
            <Button 
              variant="outline" 
              className="w-full"
              onClick={handleSendReminders}
              disabled={sendingReminders}
            >
              {sendingReminders ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Send Availability Reminders
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
