import { useData } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  Users, 
  FileText, 
  Calendar, 
  AlertCircle, 
  CheckCircle2,
  Clock,
  ArrowRight,
  Bell
} from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { clients, tasks, clinicians, notifications, markNotificationRead } = useData();

  const unreadCount = notifications.filter(n => !n.read).length;

  const stats = [
    {
      title: "Active Clients",
      value: clients.filter(c => c.status !== "New" && c.status !== "Waitlist").length,
      change: "+2 this week",
      icon: Users,
      color: "text-primary",
      bg: "bg-primary/10"
    },
    {
      title: "Pending Intake",
      value: clients.filter(c => c.status === "Forms Sent").length,
      change: "4 awaiting forms",
      icon: FileText,
      color: "text-amber-600",
      bg: "bg-amber-100"
    },
    {
      title: "Waitlist",
      value: clients.filter(c => c.status === "Waitlist").length,
      change: "Avg wait: 12 days",
      icon: Calendar,
      color: "text-slate-600",
      bg: "bg-slate-100"
    },
    {
      title: "Tasks Due",
      value: tasks.filter(t => t.status !== "Completed").length,
      change: "3 high priority",
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

      {/* Stats Grid */}
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
        {/* Notifications & Tasks */}
        <div className="col-span-2 space-y-6">
            {/* Notifications */}
            {notifications.length > 0 && (
                <Card className="border-none shadow-sm bg-blue-50/50">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base font-medium flex items-center gap-2">
                                <Bell className="h-4 w-4 text-blue-600" />
                                Recent Updates
                                {unreadCount > 0 && (
                                    <Badge className="bg-blue-600 hover:bg-blue-700 h-5 px-1.5">{unreadCount} new</Badge>
                                )}
                            </CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="pb-2">
                        <div className="space-y-1">
                            {notifications.slice(0, 3).map(notif => (
                                <div 
                                    key={notif.id} 
                                    className={`flex items-start gap-3 p-3 rounded-md transition-colors ${notif.read ? 'opacity-70' : 'bg-white shadow-sm border border-blue-100'}`}
                                    onMouseEnter={() => !notif.read && markNotificationRead(notif.id)}
                                >
                                    <div className={`mt-1.5 h-2 w-2 rounded-full ${notif.read ? 'bg-slate-300' : 'bg-blue-500'}`} />
                                    <div className="flex-1">
                                        <p className="text-sm text-foreground">{notif.message}</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">{notif.timestamp}</p>
                                    </div>
                                    {notif.link && (
                                        <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
                                            <Link href={notif.link}>View</Link>
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Task Tracker */}
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="font-serif">Task Tracker</CardTitle>
                <CardDescription>Current operational tasks and next steps</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {tasks.filter(t => t.status !== "Completed").slice(0, 5).map((task) => (
                    <div key={task.id} className="flex items-start gap-4 p-4 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors">
                      <div className={`mt-1 p-1.5 rounded-full flex-shrink-0 ${
                        task.priority === 'High' ? 'bg-destructive/10 text-destructive' :
                        task.priority === 'Medium' ? 'bg-amber-100 text-amber-600' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {task.priority === 'High' ? <AlertCircle className="h-4 w-4" /> :
                         <Clock className="h-4 w-4" />}
                      </div>
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm">{task.title}</p>
                          <Badge variant="outline" className="text-xs">{task.status}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{task.description}</p>
                        <div className="flex items-center gap-2 pt-1">
                            <div className="h-4 w-4 rounded-full bg-secondary flex items-center justify-center text-[8px] font-bold text-secondary-foreground">
                                {task.assignee.charAt(0)}
                            </div>
                            <span className="text-xs text-muted-foreground">Due: {task.dueDate}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  <Button variant="ghost" className="w-full text-muted-foreground hover:text-primary" asChild>
                    <Link href="/tasks">View All Tasks <ArrowRight className="ml-2 h-4 w-4" /></Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
        </div>

        {/* Clinician Availability (Updated Focus) */}
        <div className="col-span-1">
            <Card className="border-none shadow-sm h-full">
              <CardHeader>
                <CardTitle className="font-serif">Clinician Status</CardTitle>
                <CardDescription>Allocation capacity & updates</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {clinicians.map((clinician) => (
                  <div key={clinician.id} className="space-y-3 pb-3 border-b border-border/40 last:border-0">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-xs font-medium">
                            {clinician.avatar}
                        </div>
                        <div>
                            <span className="font-medium block">{clinician.name}</span>
                            <span className="text-[10px] text-muted-foreground">Updated: {clinician.lastUpdatedAvailability}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`block font-bold ${
                            clinician.currentLoad >= clinician.capacity ? "text-destructive" : "text-emerald-600"
                        }`}>
                            {clinician.capacity - clinician.currentLoad}
                        </span>
                        <span className="text-[10px] text-muted-foreground">slots open</span>
                      </div>
                    </div>
                    {/* Check for stale availability */}
                    {parseInt(clinician.lastUpdatedAvailability?.split(' ')[1] || '0') < 10 && (
                        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 p-2 rounded">
                            <AlertCircle className="h-3 w-3" />
                            <span>Availability update needed</span>
                        </div>
                    )}
                  </div>
                ))}
                
                <Button variant="outline" className="w-full">Send Availability Reminders</Button>
              </CardContent>
            </Card>
        </div>
      </div>
    </div>
  );
}
