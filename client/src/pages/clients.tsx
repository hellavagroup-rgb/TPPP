import { useData, Client, ClientStatus } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  MoreHorizontal, 
  Search, 
  Filter, 
  UserPlus, 
  Mail, 
  UserCheck,
  Calendar,
  Clock,
  Check
} from "lucide-react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export default function Clients() {
  const { clients, clinicians, updateClientStatus, assignClinician } = useData();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const { toast } = useToast();

  const filteredClients = clients.filter(client => {
    const matchesSearch = client.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          client.email.toLowerCase().includes(searchTerm.toLowerCase());
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

  const handleAssign = (clinicianId: string) => {
    if (selectedClient) {
      assignClinician(selectedClient.id, clinicianId);
      toast({
        title: "Client Assigned",
        description: `${selectedClient.name} has been assigned to a clinician.`,
      });
      setSelectedClient(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Client Management</h2>
          <p className="text-muted-foreground mt-1">Track referrals and manage intake workflow.</p>
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
            placeholder="Search by name or email..." 
            className="pl-9"
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
                    <h3 className="font-semibold text-lg leading-none">{client.name}</h3>
                    <Badge variant="secondary" className={getStatusColor(client.status)}>
                      {client.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Mail className="h-3 w-3" /> {client.email}
                    <span className="text-border">|</span>
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
                                    <UserCheck className="h-4 w-4" /> Assign
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[500px]">
                                <DialogHeader>
                                    <DialogTitle>Assign Clinician</DialogTitle>
                                    <DialogDescription>
                                        Select a clinician for {client.name}. Consider specialty match and current capacity.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <p className="text-sm font-medium">Presenting Issues: <span className="text-muted-foreground font-normal">{client.presentingIssues.join(", ")}</span></p>
                                    
                                    <div className="space-y-2">
                                        {clinicians.map(clinician => (
                                            <div 
                                                key={clinician.id} 
                                                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                                                    clinician.currentLoad >= clinician.capacity 
                                                    ? "opacity-60 bg-muted border-transparent" 
                                                    : "hover:border-primary hover:bg-primary/5 bg-card border-border"
                                                }`}
                                                onClick={() => clinician.currentLoad < clinician.capacity && handleAssign(clinician.id)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold">
                                                        {clinician.avatar}
                                                    </div>
                                                    <div>
                                                        <p className="font-medium">{clinician.name}</p>
                                                        <p className="text-xs text-muted-foreground">{clinician.specialties.join(", ")}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="flex items-center gap-1 justify-end">
                                                        <span className={`text-sm font-bold ${
                                                            clinician.currentLoad >= clinician.capacity ? "text-destructive" : "text-emerald-600"
                                                        }`}>
                                                            {clinician.currentLoad}/{clinician.capacity}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">{clinician.availability.join(", ")}</p>
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
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem>View Profile</DropdownMenuItem>
                        <DropdownMenuItem>Edit Details</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive">Archive Client</DropdownMenuItem>
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
