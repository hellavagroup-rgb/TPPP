import { useLocation } from "wouter";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, ArrowDownRight, Users, Clock, CalendarCheck, Percent, Filter } from "lucide-react";

// Mock Data for Analytics
const ENQUIRY_DATA = [
  { month: "Jan", enquiries: 12 },
  { month: "Feb", enquiries: 15 },
  { month: "Mar", enquiries: 18 },
  { month: "Apr", enquiries: 14 },
  { month: "May", enquiries: 22 },
  { month: "Jun", enquiries: 25 },
  { month: "Jul", enquiries: 28 },
  { month: "Aug", enquiries: 24 },
  { month: "Sep", enquiries: 30 },
  { month: "Oct", enquiries: 35 },
  { month: "Nov", enquiries: 32 },
  { month: "Dec", enquiries: 38 },
];

const REFERRAL_SOURCES = [
  { name: "GP Referral", value: 35, color: "#3b82f6" },
  { name: "Psychiatrist", value: 20, color: "#8b5cf6" },
  { name: "Self-Referral", value: 25, color: "#10b981" },
  { name: "School/Education", value: 10, color: "#f59e0b" },
  { name: "Other Health Pro", value: 10, color: "#64748b" },
];

const EFFICIENCY_TRENDS = [
  { month: "Jul", refToAlloc: 14, screenToAlloc: 5 },
  { month: "Aug", refToAlloc: 12, screenToAlloc: 4 },
  { month: "Sep", refToAlloc: 10, screenToAlloc: 3 },
  { month: "Oct", refToAlloc: 11, screenToAlloc: 4 },
  { month: "Nov", refToAlloc: 8, screenToAlloc: 2 },
  { month: "Dec", refToAlloc: 7, screenToAlloc: 2 },
];

const CONVERSION_DATA = [
  { stage: "Enquiries", count: 150 },
  { stage: "Screened", count: 120 },
  { stage: "Allocated", count: 95 },
  { stage: "First Session", count: 88 },
];

const SLOT_FILL_RATES = [
  { clinician: "Dr. Emily Chen", rate: 92 },
  { clinician: "Mark Wilson", rate: 78 },
  { clinician: "Sarah Johnson", rate: 85 },
  { clinician: "Practice Avg", rate: 85 },
];

export default function Analytics() {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
            <h1 className="text-3xl font-serif font-bold text-slate-900">Practice Analytics</h1>
            <p className="text-muted-foreground mt-1">Key performance indicators and operational trends.</p>
        </div>
        <div className="flex items-center gap-2">
            <Select defaultValue="6m">
                <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Period" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="1m">Last Month</SelectItem>
                    <SelectItem value="3m">Last 3 Months</SelectItem>
                    <SelectItem value="6m">Last 6 Months</SelectItem>
                    <SelectItem value="1y">Last Year</SelectItem>
                    <SelectItem value="all">All Time</SelectItem>
                </SelectContent>
            </Select>
            <Button variant="outline" size="icon">
                <Filter className="h-4 w-4" />
            </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Enquiries (MoM)</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+38</div>
            <p className="text-xs text-muted-foreground flex items-center pt-1">
              <span className="text-emerald-600 flex items-center mr-1"><ArrowUpRight className="h-3 w-3 mr-0.5" /> 18.2%</span>
              from last month
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Time to Alloc.</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">7.2 Days</div>
            <p className="text-xs text-muted-foreground flex items-center pt-1">
              <span className="text-emerald-600 flex items-center mr-1"><ArrowDownRight className="h-3 w-3 mr-0.5" /> 2.5 Days</span>
              improvement
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Slot Utilization</CardTitle>
            <CalendarCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">85%</div>
            <p className="text-xs text-muted-foreground flex items-center pt-1">
              <span className="text-emerald-600 flex items-center mr-1"><ArrowUpRight className="h-3 w-3 mr-0.5" /> 4%</span>
              from last month
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversion Rate</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">58.6%</div>
            <p className="text-xs text-muted-foreground flex items-center pt-1">
              <span className="text-emerald-600 flex items-center mr-1"><ArrowUpRight className="h-3 w-3 mr-0.5" /> 1.2%</span>
              Enquiry to Session
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        
        {/* Enquiry Volume Chart */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Enquiry Volume</CardTitle>
            <CardDescription>Number of new client enquiries received per month.</CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ENQUIRY_DATA}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis 
                            dataKey="month" 
                            stroke="#64748b" 
                            fontSize={12} 
                            tickLine={false} 
                            axisLine={false}
                        />
                        <YAxis 
                            stroke="#64748b" 
                            fontSize={12} 
                            tickLine={false} 
                            axisLine={false}
                            tickFormatter={(value) => `${value}`}
                        />
                        <Tooltip 
                            cursor={{ fill: '#f1f5f9' }}
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Bar dataKey="enquiries" fill="#0f172a" radius={[4, 4, 0, 0]} barSize={32} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Referral Sources Pie Chart */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Referral Sources</CardTitle>
            <CardDescription>Breakdown of where clients are coming from.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={REFERRAL_SOURCES}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                        >
                            {REFERRAL_SOURCES.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                        </Pie>
                        <Tooltip />
                    </PieChart>
                </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 justify-center text-xs text-muted-foreground mt-[-20px]">
                {REFERRAL_SOURCES.map((source) => (
                    <div key={source.name} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: source.color }} />
                        {source.name} ({source.value}%)
                    </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        
        {/* Efficiency Trends */}
        <Card>
            <CardHeader>
                <CardTitle>Time to Allocation Trends</CardTitle>
                <CardDescription>Tracking efficiency from referral and screening to final allocation.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={EFFICIENCY_TRENDS}>
                            <defs>
                                <linearGradient id="colorRef" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorScreen" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                            <XAxis dataKey="month" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} label={{ value: 'Days', angle: -90, position: 'insideLeft' }} />
                            <Tooltip />
                            <Area type="monotone" dataKey="refToAlloc" name="Ref. to Allocation" stroke="#3b82f6" fillOpacity={1} fill="url(#colorRef)" strokeWidth={2} />
                            <Area type="monotone" dataKey="screenToAlloc" name="Screen to Allocation" stroke="#10b981" fillOpacity={1} fill="url(#colorScreen)" strokeWidth={2} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>

        {/* Slot Utilization & Conversion Funnel */}
        <Card>
            <CardHeader>
                <CardTitle>Clinician Slot Utilization</CardTitle>
                <CardDescription>How quickly available slots are being filled.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-6 pt-2">
                    {SLOT_FILL_RATES.map((item) => (
                        <div key={item.clinician} className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">{item.clinician}</span>
                                <span className="text-muted-foreground">{item.rate}% Filled</span>
                            </div>
                            <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                <div 
                                    className={`h-full rounded-full ${item.rate > 90 ? 'bg-emerald-500' : item.rate > 80 ? 'bg-blue-500' : 'bg-amber-500'}`} 
                                    style={{ width: `${item.rate}%` }} 
                                />
                            </div>
                        </div>
                    ))}
                    
                    <div className="pt-6 border-t">
                        <h4 className="text-sm font-medium mb-4">Conversion Funnel (Last 30 Days)</h4>
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Enquiries ({CONVERSION_DATA[0].count})</span>
                                <span>First Session ({CONVERSION_DATA[3].count})</span>
                            </div>
                            <div className="flex items-center h-8 rounded-md bg-slate-100 overflow-hidden relative">
                                <div className="h-full bg-blue-200" style={{ width: '100%' }} title="Enquiries" />
                                <div className="absolute h-full bg-blue-300" style={{ width: '80%' }} title="Screened" />
                                <div className="absolute h-full bg-blue-400" style={{ width: '63%' }} title="Allocated" />
                                <div className="absolute h-full bg-blue-500" style={{ width: '58%' }} title="First Session" />
                            </div>
                            <p className="text-xs text-center text-muted-foreground mt-2">
                                58% of enquiries result in a booked initial session
                            </p>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
