import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Client, ClientStatus, FormTemplate } from "@/lib/mockData";
import { formatDateUK } from "@/lib/dateUtils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FormPreviewDialog } from "@/components/forms/FormPreview";
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
    DialogFooter,
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
  AlertTriangle,
  Eye,
  CheckCircle2,
  XCircle,
  Briefcase
} from "lucide-react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, isSameDay } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import type { Client as ClientType, Clinician, FormTemplate as FormTemplateType } from "@shared/schema";

export default function Clients() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const [selectedClient, setSelectedClient] = useState<ClientType | null>(null);

  // Fetch data from API
  const { data: clients = [] } = useQuery<ClientType[]>({
    queryKey: ["/api/clients"],
  });

  const { data: clinicians = [] } = useQuery<(Clinician & { name: string; availability: any[] })[]>({
    queryKey: ["/api/clinicians"],
  });

  const { data: forms = [] } = useQuery<FormTemplateType[]>({
    queryKey: ["/api/forms"],
  });

  // Mutations
  const createClientMutation = useMutation({
    mutationFn: async (clientData: any) => {
      const response = await apiRequest("POST", "/api/clients", clientData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client Created", description: "New referral added successfully." });
      setIsNewClientOpen(false);
      setNewClientData({
        wNumber: "",
        email: "",
        phone: "",
        insurer: "Private",
        referralSource: "Web Form",
        referralSourceDetails: "",
        presentingIssue: "",
        notes: ""
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create client.", variant: "destructive" });
    },
  });

  const updateClientMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const response = await apiRequest("PATCH", `/api/clients/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    },
  });

  const assignClientMutation = useMutation({
    mutationFn: async ({ clientId, clinicianId, slotId }: { clientId: string; clinicianId: string; slotId: string }) => {
      const response = await apiRequest("POST", `/api/clients/${clientId}/assign`, { clinicianId, slotId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client Assigned", description: "Client has been allocated a slot." });
      setSelectedClient(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to assign client.", variant: "destructive" });
    },
  });

  // Send Forms State
  const [isSendFormsOpen, setIsSendFormsOpen] = useState(false);
  const [clientToSendForms, setClientToSendForms] = useState<ClientType | null>(null);
  const [selectedFormIds, setSelectedForms] = useState<string[]>([]);
  const [previewForm, setPreviewForm] = useState<FormTemplateType | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [showAllClinicians, setShowAllClinicians] = useState(false);

  // New Client Form State
  const [isNewClientOpen, setIsNewClientOpen] = useState(false);
  const [newClientData, setNewClientData] = useState({
    wNumber: "",
    email: "",
    phone: "",
    insurer: "Private",
    referralSource: "Web Form",
    referralSourceDetails: "",
    presentingIssue: "",
    notes: ""
  });

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
      assignClientMutation.mutate({ 
        clientId: selectedClient.id, 
        clinicianId, 
        slotId 
      });
    }
  };

  const hasVacationConflict = (clinician: typeof clinicians[0]) => {
    return clinician.availability.some(s => s.type === "Vacation" && new Date(s.date!) >= new Date());
  };

  const handleOpenSendForms = (client: ClientType) => {
      setClientToSendForms(client);
      setSelectedForms([]); // Reset selection
      setIsSendFormsOpen(true);
  };

  const handleSendForms = async () => {
      if (clientToSendForms && selectedFormIds.length > 0) {
          try {
            // Send form via email API
            for (const formId of selectedFormIds) {
              await apiRequest("POST", "/api/email/send-form", {
                clientId: clientToSendForms.id,
                formId
              });
            }
            queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
            
            // Generate unique link for the form
            const uniqueLink = `${window.location.origin}/fill/${clientToSendForms.id}/${selectedFormIds[0]}`;
            console.log("Client Form Link:", uniqueLink);
            
            setIsSendFormsOpen(false);
            setClientToSendForms(null);
            toast({
                title: "Forms Sent",
                description: `${selectedFormIds.length} form(s) sent to ${clientToSendForms.email}.`,
            });
            
            setTimeout(() => {
               toast({
                   title: "Client Email Simulation",
                   description: "Click here to simulate the client view.",
                   action: <Button size="sm" variant="outline" onClick={() => window.open(uniqueLink, '_blank')}>Open Link</Button>,
                   duration: 10000
               });
            }, 1000);
          } catch (error) {
            toast({
              title: "Error",
              description: "Failed to send forms.",
              variant: "destructive"
            });
          }
      } else {
           toast({
              title: "Selection Required",
              description: "Please select at least one form to send.",
              variant: "destructive"
          });
      }
  };

  const handlePreviewForm = (formId: string) => {
      const form = forms.find(f => f.id === formId);
      if (form) {
          setPreviewForm(form);
          setIsPreviewOpen(true);
      }
  };

  const handleCreateClient = () => {
    if (!newClientData.wNumber) {
        toast({
            title: "Validation Error",
            description: "W-Number is required.",
            variant: "destructive"
        });
        return;
    }

    const clientData = {
        displayId: newClientData.wNumber.toUpperCase().startsWith("W") ? newClientData.wNumber.toUpperCase() : `W${newClientData.wNumber.toUpperCase()}`,
        email: newClientData.email,
        phone: newClientData.phone,
        insurer: newClientData.insurer,
        referralSource: newClientData.referralSource === "Other" && newClientData.referralSourceDetails
            ? `Other: ${newClientData.referralSourceDetails}`
            : newClientData.referralSource,
        status: "New",
        intakeDate: new Date(),
        presentingIssues: newClientData.presentingIssue ? [newClientData.presentingIssue] : [],
        notes: newClientData.notes || null
    };

    createClientMutation.mutate(clientData);
  };

  // Helper to determine if a clinician matches the client's needs
  const isClinicianMatch = (clinician: typeof clinicians[0], client: ClientType) => {
      // 1. Check Capacity (Load vs New Client Cap)
      const hasSpace = (clinician.maxNewClients || 999) > (clinician.currentLoad % 5); // Mock logic for "new client" load
      
      // 2. Check Insurer
      const clientInsurer = client.insurer || "Private";
      const acceptsInsurer = clientInsurer === "Private" || clinician.insurers?.includes(clientInsurer);
      
      return hasSpace && acceptsInsurer;
  };

  const getCliniciansForAllocation = (client: ClientType) => {
      if (showAllClinicians) return clinicians;
      // Filter by match logic
      return clinicians.filter(c => isClinicianMatch(c, client));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Client Allocation</h2>
          <p className="text-muted-foreground mt-1">Anonymized client management.</p>
        </div>
        
        <Dialog open={isNewClientOpen} onOpenChange={setIsNewClientOpen}>
            <DialogTrigger asChild>
                <Button className="gap-2">
                    <UserPlus className="h-4 w-4" />
                    New Referral
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Add New Referral</DialogTitle>
                    <DialogDescription>
                        Enter client details from WriteUpp. The ID will be used for anonymization.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>WriteUpp ID (W-Number)</Label>
                        <div className="relative">
                            <Shield className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="W..." 
                                className="pl-9 font-mono" 
                                value={newClientData.wNumber}
                                onChange={e => setNewClientData({...newClientData, wNumber: e.target.value})}
                            />
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label>Email</Label>
                            <Input 
                                type="email" 
                                placeholder="client@example.com"
                                value={newClientData.email}
                                onChange={e => setNewClientData({...newClientData, email: e.target.value})}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>Phone (Optional)</Label>
                            <Input 
                                placeholder="555-0123"
                                value={newClientData.phone}
                                onChange={e => setNewClientData({...newClientData, phone: e.target.value})}
                            />
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label>Insurer</Label>
                        <Select 
                            value={newClientData.insurer} 
                            onValueChange={v => setNewClientData({...newClientData, insurer: v})}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Private">Private / Self-Pay</SelectItem>
                                <SelectItem value="Bupa">Bupa</SelectItem>
                                <SelectItem value="Axa">Axa</SelectItem>
                                <SelectItem value="Aviva">Aviva</SelectItem>
                                <SelectItem value="Cigna">Cigna</SelectItem>
                                <SelectItem value="Vitality">Vitality</SelectItem>
                                <SelectItem value="WPA">WPA</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid gap-2">
                        <Label>Referral Source</Label>
                        <Select 
                            value={newClientData.referralSource} 
                            onValueChange={v => setNewClientData({...newClientData, referralSource: v})}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Web Form">Web Form</SelectItem>
                                <SelectItem value="Direct Email">Direct Email</SelectItem>
                                <SelectItem value="Psychiatrist Referral">Psychiatrist Referral</SelectItem>
                                <SelectItem value="Other">Other</SelectItem>
                            </SelectContent>
                        </Select>
                        {newClientData.referralSource === "Other" && (
                            <Input 
                                placeholder="Please specify..."
                                className="mt-1"
                                value={newClientData.referralSourceDetails}
                                onChange={e => setNewClientData({...newClientData, referralSourceDetails: e.target.value})}
                            />
                        )}
                    </div>

                    <div className="grid gap-2">
                        <Label>Primary Issue</Label>
                        <Input 
                            placeholder="e.g. Anxiety, Trauma, etc."
                            value={newClientData.presentingIssue}
                            onChange={e => setNewClientData({...newClientData, presentingIssue: e.target.value})}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label>Notes</Label>
                        <Textarea 
                            placeholder="Any additional intake notes..."
                            value={newClientData.notes}
                            onChange={e => setNewClientData({...newClientData, notes: e.target.value})}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleCreateClient}>Create Referral</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
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
                    <Clock className="h-3 w-3" /> Intake: {formatDateUK(client.intakeDate)}
                    {client.referralSource && (
                        <>
                            <span className="text-border mx-1">|</span>
                            <span>{client.referralSource}</span>
                        </>
                    )}
                  </p>
                </div>

                {/* Presenting Issues */}
                <div className="hidden md:flex gap-2">
                    {(client.presentingIssues || []).map(issue => (
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
                        <Button size="sm" variant="outline" className="gap-2" onClick={() => handleOpenSendForms(client)}>
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
                                    <div className="p-3 bg-muted/30 rounded border border-border space-y-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs text-muted-foreground font-medium">CLIENT PROFILE</p>
                                            <Badge variant={(client.insurer || "Private") === "Private" ? "outline" : "default"} className="text-[10px]">
                                                {client.insurer || "Private"}
                                            </Badge>
                                        </div>
                                        <div className="flex gap-2">
                                            {(client.presentingIssues || []).map(i => <Badge key={i} variant="secondary">{i}</Badge>)}
                                        </div>
                                        <p className="text-sm italic">"{client.notes}"</p>
                                    </div>
                                    
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm font-medium text-muted-foreground">AVAILABLE SLOTS</p>
                                            <div className="flex items-center gap-2">
                                                <Label htmlFor="override-mode" className="text-xs text-muted-foreground cursor-pointer">Admin Override</Label>
                                                <Switch id="override-mode" checked={showAllClinicians} onCheckedChange={setShowAllClinicians} />
                                            </div>
                                        </div>
                                        
                                        {getCliniciansForAllocation(client).length === 0 && (
                                            <div className="text-center py-8 text-muted-foreground border rounded-md bg-slate-50">
                                                <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
                                                <p>No matching clinicians found.</p>
                                                <p className="text-xs mt-1">Try enabling "Admin Override" to see all schedules.</p>
                                            </div>
                                        )}

                                        {getCliniciansForAllocation(client).map(clinician => {
                                            const isMatch = isClinicianMatch(clinician, client);
                                            return (
                                            <div key={clinician.id} className={!isMatch ? "opacity-75" : ""}>
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <div className="h-6 w-6 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold">
                                                            {clinician.avatar}
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-sm">
                                                                {clinician.name}
                                                                {!isMatch && <span className="text-xs text-muted-foreground ml-2 font-normal italic">(Override)</span>}
                                                            </p>
                                                            {clinician.insurers && clinician.insurers.length > 0 && (
                                                                <div className="flex flex-wrap gap-1 mt-0.5">
                                                                    {clinician.insurers.map(ins => (
                                                                        <span 
                                                                            key={ins} 
                                                                            className={`text-[9px] px-1.5 py-0.5 rounded ${
                                                                                ins === (client.insurer || "Private") 
                                                                                    ? "bg-green-100 text-green-700 font-medium" 
                                                                                    : "bg-muted text-muted-foreground"
                                                                            }`}
                                                                        >
                                                                            {ins}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {(clinician.maxNewClients || 0) <= (clinician.currentLoad % 5) && (
                                                            <div className="flex items-center text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded" title="Capacity Limit Reached">
                                                                <Briefcase className="h-3 w-3 mr-1" />
                                                                Cap Reached
                                                            </div>
                                                        )}
                                                        {hasVacationConflict(clinician) && (
                                                            <div className="flex items-center text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                                                                <AlertTriangle className="h-3 w-3 mr-1" />
                                                                Vacation
                                                            </div>
                                                        )}
                                                    </div>
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
                                                        <div className="col-span-3 text-xs text-muted-foreground italic p-2 border border-dashed rounded bg-slate-50/50 text-center">
                                                            No availability set.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )})}
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
                        <DropdownMenuItem onClick={() => {
                            toast({
                                title: "Client Details",
                                description: `${client.displayId} - Email: ${client.email}${client.phone ? `, Phone: ${client.phone}` : ""}`,
                            });
                        }}>View Details</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => {
                            toast({
                                title: "Archive",
                                description: "Archive functionality coming soon.",
                            });
                        }}>Archive</DropdownMenuItem>
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

      <Dialog open={isSendFormsOpen} onOpenChange={setIsSendFormsOpen}>
        <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
                <DialogTitle>Send Forms to {clientToSendForms?.displayId}</DialogTitle>
                <DialogDescription>
                    Select the intake forms to send to the client. They will receive a secure link via email.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
                {forms.map(form => (
                    <div key={form.id} className="flex items-start space-x-3 p-3 rounded border hover:bg-muted/50 transition-colors">
                        <Checkbox 
                            id={`form-${form.id}`} 
                            checked={selectedFormIds.includes(form.id)}
                            onCheckedChange={(checked) => {
                                if (checked) {
                                    setSelectedForms([...selectedFormIds, form.id]);
                                } else {
                                    setSelectedForms(selectedFormIds.filter((id: string) => id !== form.id));
                                }
                            }}
                        />
                        <div className="grid gap-1.5 leading-none flex-1">
                            <Label 
                                htmlFor={`form-${form.id}`}
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                            >
                                {form.title}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                {form.description}
                            </p>
                        </div>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => handlePreviewForm(form.id)}>
                            <Eye className="h-3 w-3 mr-1" /> Preview
                        </Button>
                    </div>
                ))}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsSendFormsOpen(false)}>Cancel</Button>
                <Button onClick={handleSendForms} disabled={selectedFormIds.length === 0}>
                    <Mail className="h-4 w-4 mr-2" /> Send {selectedFormIds.length > 0 ? `(${selectedFormIds.length})` : ""}
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      {previewForm && (
        <FormPreviewDialog 
            form={previewForm} 
            open={isPreviewOpen} 
            onOpenChange={setIsPreviewOpen} 
        />
      )}
    </div>
  );
}
