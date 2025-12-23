import { useData, Client, ClientStatus } from "@/lib/mockData";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { 
  MoreHorizontal, 
  Search, 
  Filter, 
  UserPlus, 
  Mail, 
  UserCheck,
  Clock,
  Shield,
  CalendarCheck,
  AlertTriangle
} from "lucide-react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, isSameDay } from "date-fns";

export default function Clients() {
  const { clients, clinicians, updateClientStatus, assignClinician } = useData();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const { toast } = useToast();

  const filteredClients = clients.filter(client => {
    // Search now works on ID instead of Name
    const matchesSearch = client.displayId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "All" || client.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: ClientStatus) => {
    switch(status) {
      case "New": return "bg-blue-100 text-blue-700 hover:bg-blue-200";
      case "Forms Sent": return "bg-amber-100 text-amber-700 hover:bg-amber-200";
      case "Forms Completed": return "bg-emerald-100 text-emerald-700 hover:bg-emerald-200";
      case "Assigned": return "bg-indigo-100 text-indigo-700 hover:bg-indigo-200";
      case "Scheduled": return "bg-green-100 text-green-700 hover:bg-green-200";
      case "Waitlist": return "bg-slate-100 text-slate-700 hover:bg-slate-200";
      default: return "bg-slate-100 text-slate-700";
    }
  };

  const handleAssign = (clinicianId: string, slotId: string) => {
    if (selectedClient) {
      assignClinician(selectedClient.id, clinicianId, slotId);
      toast({
        title: "Client Assigned",
        description: `${selectedClient.displayId} has been allocated a slot.`,
      });
      setSelectedClient(null);
    }
  };

  const hasVacationConflict = (clinician: typeof clinicians[0]) => {
    // Basic check: does clinician have ANY vacation in the future?
    // In a real app, this would check specifically against the slot date.
    // For now, we flag if they have an upcoming vacation to warn the admin.
    return clinician.availability.some(s => s.type === "Vacation" && new Date(s.date!) >= new Date());
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Client Allocation</h2>
          <p className="text-muted-foreground mt-1">Anonymized client management.</p>
        </div>
        <Button className="gap-2">
          <UserPlus className="h-4 w-4" />
          New Referral
        </Button>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row gap-4 items-center bg-card p-4 rounded-lg shadow-sm border border-border">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search by Client ID (W...)" 
            className="pl-9 font-mono"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Statuses</SelectItem>
              <SelectItem value="New">New</SelectItem>
              <SelectItem value="Forms Sent">Forms Sent</SelectItem>
              <SelectItem value="Forms Completed">Forms Completed</SelectItem>
              <SelectItem value="Assigned">Assigned</SelectItem>
              <SelectItem value="Waitlist">Waitlist</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Client List */}
      <div className="grid gap-4">
        {filteredClients.map((client) => (
          <Card key={client.id} className="overflow-hidden border-none shadow-sm hover:shadow-md transition-all group">
            <CardContent className="p-0">
              <div className="flex flex-col md:flex-row items-center p-4 gap-4">
                
                {/* Status Indicator Strip */}
                <div className={`w-full md:w-1 h-1 md:h-12 rounded-full ${getStatusColor(client.status).split(" ")[0].replace("bg-", "bg-opacity-100 bg-")}`}></div>

                <div className="flex-1 min-w-0 grid gap-1">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-semibold text-lg leading-none font-mono tracking-tight">{client.displayId}</h3>
                    <Badge variant="secondary" className={getStatusColor(client.status)}>
                      {client.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Clock className="h-3 w-3" /> Intake: {client.intakeDate}
                  </p>
                </div>

                {/* Presenting Issues */}
                <div className="hidden md:flex gap-2">
                    {client.presentingIssues.map(issue => (
                        <Badge key={issue} variant="outline" className="text-xs font-normal">
                            {issue}
                        </Badge>
                    ))}
                </div>

                {/* Assigned Clinician (if any) */}
                {client.assignedClinicianId && (
                   <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 px-3 py-1.5 rounded-full">
                      <UserCheck className="h-4 w-4" />
                      {clinicians.find(c => c.id === client.assignedClinicianId)?.name.split(",")[0]}
                      {client.assignedSlot && (
                          <span className="text-xs font-mono border-l border-foreground/10 pl-2 ml-1">
                              {client.assignedSlot}
                          </span>
                      )}
                   </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 ml-auto">
                    {client.status === "New" && (
                        <Button size="sm" variant="outline" className="gap-2" onClick={() => updateClientStatus(client.id, "Forms Sent")}>
                            <Mail className="h-4 w-4" /> Send Forms
                        </Button>
                    )}
                    
                    {client.status === "Forms Completed" && (
                         <Dialog>
                            <DialogTrigger asChild>
                                <Button size="sm" className="gap-2 bg-primary hover:bg-primary/90" onClick={() => setSelectedClient(client)}>
                                    <UserCheck className="h-4 w-4" /> Allocate
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
                                <DialogHeader>
                                    <DialogTitle>Allocate Clinician Slot</DialogTitle>
                                    <DialogDescription>
                                        Assign {client.displayId} to an available time slot.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-6 py-4">
                                    <div className="p-3 bg-muted/30 rounded border border-border">
                                        <p className="text-xs text-muted-foreground font-medium mb-1">CLIENT NEEDS</p>
                                        <div className="flex gap-2">
                                            {client.presentingIssues.map(i => <Badge key={i} variant="secondary">{i}</Badge>)}
                                        </div>
                                        <p className="text-sm mt-2 italic">"{client.notes}"</p>
                                    </div>
                                    
                                    <div className="space-y-4">
                                        <p className="text-sm font-medium text-muted-foreground">AVAILABLE SLOTS</p>
                                        {clinicians.map(clinician => (
                                            <div key={clinician.id} className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <div className="h-6 w-6 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold">
                                                            {clinician.avatar}
                                                        </div>
                                                        <p className="font-medium text-sm">{clinician.name}</p>
                                                    </div>
                                                    {hasVacationConflict(clinician) && (
                                                        <div className="flex items-center text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                                                            <AlertTriangle className="h-3 w-3 mr-1" />
                                                            Upcoming Vacation
                                                        </div>
                                                    )}
                                                </div>
                                                
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-8">
                                                    {clinician.availability.filter(s => s.type !== "Vacation").map(slot => (
                                                        <Button 
                                                            key={slot.id}
                                                            variant={slot.isBooked ? "ghost" : "outline"}
                                                            disabled={slot.isBooked}
                                                            className={`justify-start h-auto py-2 px-3 text-xs ${
                                                                slot.isBooked ? "opacity-50 line-through decoration-destructive" : "hover:border-primary hover:bg-primary/5"
                                                            }`}
                                                            onClick={() => handleAssign(clinician.id, slot.id)}
                                                        >
                                                            <CalendarCheck className="h-3 w-3 mr-2" />
                                                            <div className="text-left">
                                                                <div className="font-medium">{slot.day || format(parseISO(slot.date!), "EEE")}</div>
                                                                <div className="text-[10px] text-muted-foreground">{slot.startTime} - {slot.endTime}</div>
                                                            </div>
                                                        </Button>
                                                    ))}
                                                    {clinician.availability.filter(s => s.type !== "Vacation").length === 0 && (
                                                        <div className="col-span-3 text-xs text-muted-foreground italic p-2">
                                                            No availability set.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </DialogContent>
                         </Dialog>
                    )}

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                        <DropdownMenuItem>View Details</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive">Archive</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {filteredClients.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
                <p>No clients found matching your search.</p>
            </div>
        )}
      </div>
    </div>
  );
}
