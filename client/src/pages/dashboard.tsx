import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Users, 
  FileText, 
  Calendar, 
  AlertCircle, 
  Loader2,
  Mail
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Client, Task, Clinician } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

export default function Dashboard() {
  const { toast } = useToast();
  const [sendingReminders, setSendingReminders] = useState(false);

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
  });

  const { data: clinicians = [] } = useQuery<(Clinician & { name: string })[]>({
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
      title: "Active Clients",
      value: clients.filter(c => c.status !== "New" && c.status !== "Waitlist").length,
      change: `${clients.length} total`,
      icon: Users,
      color: "text-primary",
      bg: "bg-primary/10"
    },
    {
      title: "Pending Intake",
      value: clients.filter(c => c.status === "Forms Sent").length,
      change: "Awaiting forms",
      icon: FileText,
      color: "text-amber-600",
      bg: "bg-amber-100"
    },
    {
      title: "Waitlist",
      value: clients.filter(c => c.status === "Waitlist").length,
      change: "Awaiting allocation",
      icon: Calendar,
      color: "text-slate-600",
      bg: "bg-slate-100"
    },
    {
      title: "Tasks Due",
      value: tasks.filter(t => t.status !== "Completed").length,
      change: `${tasks.length} total tasks`,
      icon: AlertCircle,
      color: "text-destructive",
      bg: "bg-destructive/10"
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
            {clinicians.slice(0, 5).map((clinician) => (
              <div key={clinician.id} className="space-y-3 pb-3 border-b border-border/40 last:border-0">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-xs font-medium">
                      {clinician.avatar}
                    </div>
                    <div>
                      <span className="font-medium block">{clinician.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {clinician.currentLoad}/{clinician.capacity} clients
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`block font-bold ${
                      (clinician.currentLoad ?? 0) >= (clinician.capacity ?? 0) ? "text-destructive" : "text-emerald-600"
                    }`}>
                      {(clinician.capacity ?? 0) - (clinician.currentLoad ?? 0)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">slots open</span>
                  </div>
                </div>
              </div>
            ))}
            
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
