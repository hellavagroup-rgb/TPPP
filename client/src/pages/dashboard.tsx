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
  Clock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import type { Client, Task, Clinician, TimeSlot, AuditLog } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Plus } from "lucide-react";

type ClinicianWithAvailability = Clinician & { name: string; availability?: TimeSlot[] };

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

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

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
  });

  const { data: clinicians = [] } = useQuery<ClinicianWithAvailability[]>({
    queryKey: ["/api/clinicians"],
  });

  const { data: recentActivity = [] } = useQuery<AuditLog[]>({
    queryKey: ["/api/activity/recent"],
    enabled: user?.role === "admin",
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
      change: "Total across all clinicians",
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
            </CardHeader>
            <CardContent>
              {tasks.length === 0 && recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No recent activity</p>
              ) : (
                <div className="space-y-3">
                  {recentActivity.slice(0, 5).map((log) => {
                    const parts = (log.ipAddress || "").split("|");
                    const clinicianName = parts[0] || "Unknown";
                    const slotInfo = parts[1] || "";
                    const slotDetails = parts[2] || "";
                    const timeAgo = log.timestamp ? formatTimeAgo(new Date(log.timestamp)) : "";
                    return (
                      <div key={log.id} className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-100">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-full bg-green-100">
                            <Plus className="h-3 w-3 text-green-600" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{clinicianName} added {slotInfo}</p>
                            {slotDetails && <p className="text-xs text-muted-foreground">{slotDetails}</p>}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo}</span>
                      </div>
                    );
                  })}
                  {tasks.slice(0, 5).map((task) => (
                    <div key={task.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">{task.title}</p>
                        <p className="text-xs text-muted-foreground">{task.assignee}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded ${
                        task.status === "Completed" ? "bg-emerald-100 text-emerald-700" :
                        task.status === "In Progress" ? "bg-blue-100 text-blue-700" :
                        "bg-amber-100 text-amber-700"
                      }`}>
                        {task.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
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
            {clinicians.slice(0, 5).map((clinician) => {
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
