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
  CheckCircle2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Client, Task, Clinician, TimeSlot } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

type ClinicianWithAvailability = Clinician & { name: string; availability?: TimeSlot[] };

function getSlotCounts(availability?: TimeSlot[]) {
  if (!availability) return { available: 0, pending: 0 };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let available = 0;
  let pending = 0;
  
  availability.filter(s => !s.isBooked && s.type !== "Vacation").forEach(slot => {
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
      title: "Allocated - Awaiting Confirmation",
      value: clients.filter(c => c.status === "Assigned").length,
      change: "Pending admin confirmation",
      icon: Users,
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
    }
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-serif font-bold text-foreground">Clinician Allocation Dashboard</h2>
        <p className="text-muted-foreground mt-1">Manage client intake and clinician availability.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Recent Tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No tasks yet</p>
              ) : (
                <div className="space-y-3">
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
