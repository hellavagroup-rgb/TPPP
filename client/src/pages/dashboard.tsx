import { useData, ClientStatus } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  Users, 
  FileText, 
  Calendar, 
  AlertCircle, 
  ArrowRight,
  UserPlus,
  CheckCircle2
} from "lucide-react";
import { Link } from "wouter";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";

export default function Dashboard() {
  const { clients, tasks, clinicians } = useData();

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

  const chartData = [
    { name: "Mon", clients: 4 },
    { name: "Tue", clients: 6 },
    { name: "Wed", clients: 8 },
    { name: "Thu", clients: 5 },
    { name: "Fri", clients: 7 },
    { name: "Sat", clients: 2 },
    { name: "Sun", clients: 1 },
  ];

  const recentActivity = [
    { id: 1, text: "New referral received: Alice Thompson", time: "2 hours ago", type: "new" },
    { id: 2, text: "Intake forms completed by Maria Garcia", time: "4 hours ago", type: "success" },
    { id: 3, text: "Dr. Chen assigned to Sam Smith", time: "Yesterday", type: "info" },
    { id: 4, text: "Waitlist notification sent to Linda Brown", time: "Yesterday", type: "warning" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-serif font-bold text-foreground">Practice Overview</h2>
        <p className="text-muted-foreground mt-1">Welcome back, here's what's happening today.</p>
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Main Chart */}
        <Card className="col-span-4 border-none shadow-sm">
          <CardHeader>
            <CardTitle className="font-serif">Intake Activity</CardTitle>
            <CardDescription>New client inquiries over the last 7 days</CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis 
                    dataKey="name" 
                    stroke="#888888" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false} 
                  />
                  <YAxis 
                    stroke="#888888" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false} 
                    tickFormatter={(value) => `${value}`} 
                  />
                  <Tooltip 
                    cursor={{fill: 'transparent'}}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Bar 
                    dataKey="clients" 
                    fill="hsl(var(--primary))" 
                    radius={[4, 4, 0, 0]} 
                    barSize={40}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Clinician Capacity */}
        <Card className="col-span-3 border-none shadow-sm">
          <CardHeader>
            <CardTitle className="font-serif">Clinician Capacity</CardTitle>
            <CardDescription>Current caseload vs maximum</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {clinicians.map((clinician) => (
              <div key={clinician.id} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-xs font-medium">
                        {clinician.avatar}
                    </div>
                    <span className="font-medium">{clinician.name}</span>
                  </div>
                  <span className="text-muted-foreground">{clinician.currentLoad}/{clinician.capacity}</span>
                </div>
                <Progress 
                    value={(clinician.currentLoad / clinician.capacity) * 100} 
                    className="h-2"
                    indicatorClassName={
                        (clinician.currentLoad / clinician.capacity) > 0.9 
                        ? "bg-destructive" 
                        : (clinician.currentLoad / clinician.capacity) > 0.7 
                        ? "bg-amber-500" 
                        : "bg-primary"
                    }
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Recent Activity */}
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="font-serif">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-start gap-4 pb-4 border-b border-border last:border-0 last:pb-0">
                  <div className={`mt-1 p-1.5 rounded-full ${
                    activity.type === 'new' ? 'bg-blue-100 text-blue-600' :
                    activity.type === 'success' ? 'bg-green-100 text-green-600' :
                    activity.type === 'warning' ? 'bg-amber-100 text-amber-600' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {activity.type === 'new' ? <UserPlus className="h-3 w-3" /> :
                     activity.type === 'success' ? <CheckCircle2 className="h-3 w-3" /> :
                     activity.type === 'warning' ? <AlertCircle className="h-3 w-3" /> :
                     <FileText className="h-3 w-3" />}
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{activity.text}</p>
                    <p className="text-xs text-muted-foreground">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        
        {/* Quick Actions */}
        <Card className="border-none shadow-sm bg-secondary/30">
          <CardHeader>
            <CardTitle className="font-serif">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
             <Button className="w-full justify-between" variant="outline">
                <span>Process New Referrals</span>
                <ArrowRight className="h-4 w-4" />
             </Button>
             <Button className="w-full justify-between" variant="outline">
                <span>Assign Clients</span>
                <ArrowRight className="h-4 w-4" />
             </Button>
             <Button className="w-full justify-between" variant="outline">
                <span>Send Payment Reminders</span>
                <ArrowRight className="h-4 w-4" />
             </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
