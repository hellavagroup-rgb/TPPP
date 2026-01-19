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
  Briefcase,
  Edit,
  Phone,
  FileText,
  Download,
  Loader2
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, isSameDay } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import type { Client as ClientType, Clinician, FormTemplate as FormTemplateType, TimeSlot } from "@shared/schema";

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

export default function Clients() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
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
    mutationFn: async ({ clientId, clinicianId, slotId, allocationMethod = "form" }: { clientId: string; clinicianId: string; slotId: string; allocationMethod?: "form" | "manual" }) => {
      const response = await apiRequest("POST", `/api/clients/${clientId}/assign`, { clinicianId, slotId, allocationMethod });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client Assigned", description: "Client has been allocated a slot." });
      setSelectedClient(null);
      setIsManualAllocateOpen(false);
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

  // Manual Allocation State (for phone intake flow)
  const [isManualAllocateOpen, setIsManualAllocateOpen] = useState(false);
  const [manualAllocateClient, setManualAllocateClient] = useState<ClientType | null>(null);

  // Archive Client State
  const [isArchiveDialogOpen, setIsArchiveDialogOpen] = useState(false);
  const [clientToArchive, setClientToArchive] = useState<ClientType | null>(null);

  const archiveClientMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const response = await apiRequest("POST", `/api/clients/${clientId}/archive`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client Archived", description: "This client record has been permanently archived." });
      setIsArchiveDialogOpen(false);
      setClientToArchive(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to archive client.", variant: "destructive" });
    },
  });

  const handleOpenArchiveDialog = (client: ClientType) => {
    setClientToArchive(client);
    setIsArchiveDialogOpen(true);
  };

  const handleConfirmArchive = () => {
    if (clientToArchive) {
      archiveClientMutation.mutate(clientToArchive.id);
    }
  };

  // Edit Client State
  const [isEditClientOpen, setIsEditClientOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientType | null>(null);
  const [editClientData, setEditClientData] = useState({
    email: "",
    phone: "",
    insurer: "",
    referralSource: "",
    presentingIssues: [] as string[],
    notes: "",
    status: "New" as ClientType["status"]
  });

  // Edit Status State
  const [isEditStatusOpen, setIsEditStatusOpen] = useState(false);
  const [editStatusClient, setEditStatusClient] = useState<ClientType | null>(null);
  const [editStatusData, setEditStatusData] = useState({
    status: "Assigned" as ClientType["status"],
    clinicianId: null as string | null,
    slotId: null as string | null
  });

  const reassignClientMutation = useMutation({
    mutationFn: async ({ clientId, clinicianId, slotId, status }: { clientId: string; clinicianId: string | null; slotId: string | null; status: string }) => {
      const response = await apiRequest("POST", `/api/clients/${clientId}/reassign`, { clinicianId, slotId, status });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clinicians"] });
      toast({ title: "Allocation Updated", description: "Client allocation has been updated." });
      setIsEditStatusOpen(false);
      setEditStatusClient(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update allocation.", variant: "destructive" });
    },
  });

  const handleOpenEditStatus = (client: ClientType) => {
    setEditStatusClient(client);
    setEditStatusData({
      status: client.status,
      clinicianId: client.assignedClinicianId || null,
      slotId: null
    });
    setIsEditStatusOpen(true);
  };

  const handleSaveEditStatus = () => {
    if (!editStatusClient) return;
    reassignClientMutation.mutate({
      clientId: editStatusClient.id,
      clinicianId: editStatusData.clinicianId,
      slotId: editStatusData.slotId,
      status: editStatusData.status
    });
  };

  // View Responses State
  const [isViewResponsesOpen, setIsViewResponsesOpen] = useState(false);
  const [viewResponsesClient, setViewResponsesClient] = useState<ClientType | null>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  const handleOpenViewResponses = async (client: ClientType) => {
    setViewResponsesClient(client);
    setIsViewResponsesOpen(true);
    setLoadingSubmissions(true);
    try {
      const response = await apiRequest("GET", `/api/clients/${client.id}/submissions`);
      if (!response.ok) {
        throw new Error("Failed to fetch submissions");
      }
      const data = await response.json();
      setSubmissions(data);
    } catch (error) {
      toast({ title: "Error", description: "Failed to load form responses.", variant: "destructive" });
      setSubmissions([]);
    } finally {
      setLoadingSubmissions(false);
    }
  };

  const generatePDF = (submission: any) => {
    const formTitle = submission.formTitle;
    const responses = submission.responses || {};
    const fields = submission.formFields || [];
    
    // Build a printable HTML document
    let content = `
      <html>
      <head>
        <title>${formTitle} - ${viewResponsesClient?.displayId}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
          h1 { color: #1f2937; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
          h2 { color: #374151; margin-top: 30px; }
          .field { margin-bottom: 15px; page-break-inside: avoid; }
          .label { font-weight: bold; color: #4b5563; }
          .value { margin-top: 5px; padding: 10px; background: #f9fafb; border-radius: 4px; }
          .meta { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <h1>${formTitle}</h1>
        <p class="meta">Client ID: ${viewResponsesClient?.displayId} | Submitted: ${submission.submittedAt ? formatDateUK(submission.submittedAt) : 'N/A'}</p>
    `;

    // Group responses by field
    fields.forEach((field: any) => {
      const value = responses[field.id];
      if (value !== undefined && value !== null && value !== '') {
        let displayValue = value;
        if (Array.isArray(value)) {
          displayValue = value.join(', ');
        } else if (typeof value === 'boolean') {
          displayValue = value ? 'Yes' : 'No';
        }
        content += `
          <div class="field">
            <div class="label">${field.label}</div>
            <div class="value">${displayValue}</div>
          </div>
        `;
      }
    });

    content += '</body></html>';

    // Open print dialog
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(content);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 250);
    }
  };

  const filteredClients = clients.filter(client => {
    // Search now works on ID instead of Name
    const matchesSearch = client.displayId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "All" || client.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  // Display labels for statuses (shows "Allocated"/"Confirmed" but stores "Assigned"/"Scheduled")
  const getStatusDisplayLabel = (status: string) => {
    switch(status) {
      case "Assigned": return "Allocated";
      case "Scheduled": return "Confirmed";
      default: return status;
    }
  };

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

  const handleAssign = (clinicianId: string, slotId: string, allocationMethod: "form" | "manual" = "form") => {
    const clientToAssign = allocationMethod === "manual" ? manualAllocateClient : selectedClient;
    if (clientToAssign) {
      assignClientMutation.mutate({ 
        clientId: clientToAssign.id, 
        clinicianId, 
        slotId,
        allocationMethod
      });
    }
  };

  const handleOpenManualAllocate = (client: ClientType) => {
    setLocation(`/availability?allocate=${client.id}`);
  };

  const handleOpenEditClient = (client: ClientType) => {
    setEditingClient(client);
    setEditClientData({
      email: client.email,
      phone: client.phone || "",
      insurer: client.insurer || "Private",
      referralSource: client.referralSource || "",
      presentingIssues: client.presentingIssues || [],
      notes: client.notes || "",
      status: client.status
    });
    setIsEditClientOpen(true);
  };

  const handleSaveEditClient = () => {
    if (!editingClient) return;
    updateClientMutation.mutate({
      id: editingClient.id,
      updates: {
        email: editClientData.email,
        phone: editClientData.phone || null,
        insurer: editClientData.insurer,
        referralSource: editClientData.referralSource,
        presentingIssues: editClientData.presentingIssues,
        notes: editClientData.notes || null,
        status: editClientData.status
      }
    }, {
      onSuccess: () => {
        toast({ title: "Client Updated", description: "Changes saved successfully." });
        setIsEditClientOpen(false);
        setEditingClient(null);
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update client.", variant: "destructive" });
      }
    });
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

  // Helper to check if a clinician slot overlaps with client availability
  // Client picks hourly blocks (e.g., "09:00" = available 9am-10am)
  // Slot matches if its start time falls within that hour
  const doesSlotMatchClientAvailability = (slot: any, clientAvailability: Record<string, string[]> | null) => {
    if (!clientAvailability || Object.keys(clientAvailability).length === 0) {
      return null; // No availability data - can't determine match
    }

    // Get the day of the slot - use slot.day for recurring, or derive from date for specific-date slots
    let slotDay = slot.day;
    if (!slotDay && slot.date) {
      // Derive day from date for specific-date slots
      const dayIndex = parseISO(slot.date).getDay();
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      slotDay = dayNames[dayIndex];
    }
    
    if (!slotDay) return null; // Can't determine day
    
    const clientDaySlots = clientAvailability[slotDay];
    
    if (!clientDaySlots || clientDaySlots.length === 0) {
      return false; // Client not available on this day
    }

    // Parse slot start time (e.g., "09:15" -> 9)
    const [slotHour] = slot.startTime.split(":").map(Number);
    
    // Check if any client hour block contains this slot
    // Client hour "09:00" means available 9:00-9:59
    return clientDaySlots.some(clientHour => {
      const [clientHourNum] = clientHour.split(":").map(Number);
      return slotHour === clientHourNum;
    });
  };

  // State to store client availability for allocation
  const [clientAvailabilityForAllocation, setClientAvailabilityForAllocation] = useState<Record<string, string[]> | null>(null);

  // Fetch client availability when allocation dialog opens
  const fetchClientAvailability = async (clientId: string) => {
    try {
      const response = await apiRequest("GET", `/api/clients/${clientId}/submissions`);
      if (response.ok) {
        const submissions = await response.json();
        const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        
        // Find availability field in any submission
        // Availability data format: { Monday: ["09:00", "10:00"], Tuesday: ["14:00"] }
        for (const submission of submissions) {
          const responses = submission.responses || {};
          for (const [fieldId, value] of Object.entries(responses)) {
            // Check if this looks like availability data
            if (value && typeof value === 'object' && !Array.isArray(value)) {
              const keys = Object.keys(value as object);
              // Must have at least one day key AND values must be arrays of time strings
              const hasDayKeys = keys.some(k => dayNames.includes(k));
              if (hasDayKeys) {
                const valObj = value as Record<string, any>;
                // Validate that values are arrays of time strings (e.g., "09:00")
                const isValidFormat = keys.every(k => {
                  if (!dayNames.includes(k)) return true; // ignore non-day keys
                  const arr = valObj[k];
                  return Array.isArray(arr) && arr.every((t: any) => 
                    typeof t === 'string' && /^\d{2}:\d{2}$/.test(t)
                  );
                });
                if (isValidFormat) {
                  setClientAvailabilityForAllocation(valObj as Record<string, string[]>);
                  return;
                }
              }
            }
          }
        }
      }
      setClientAvailabilityForAllocation(null);
    } catch {
      setClientAvailabilityForAllocation(null);
    }
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
              <SelectItem value="Assigned">Allocated</SelectItem>
              <SelectItem value="Scheduled">Confirmed</SelectItem>
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
                      {getStatusDisplayLabel(client.status)}
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
                                <Button size="sm" className="gap-2 bg-primary hover:bg-primary/90" onClick={() => { setSelectedClient(client); fetchClientAvailability(client.id); }}>
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
                                        {clientAvailabilityForAllocation && Object.keys(clientAvailabilityForAllocation).length > 0 && (
                                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                                <p className="text-xs font-medium text-blue-800 mb-2">Client's Stated Availability:</p>
                                                <div className="flex flex-wrap gap-1">
                                                    {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => {
                                                        const slots = clientAvailabilityForAllocation[day];
                                                        if (!slots || slots.length === 0) return null;
                                                        const hourLabels = slots.map(s => {
                                                            const h = parseInt(s.split(":")[0]);
                                                            return h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
                                                        }).join(", ");
                                                        return (
                                                            <span key={day} className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px]">
                                                                {day.slice(0, 3)}: {hourLabels}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                                <p className="text-[10px] text-blue-600 mt-2">Slots with green "Match" badges align with client availability</p>
                                            </div>
                                        )}

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
                                                    {clinician.availability.filter(s => s.type !== "Vacation").map(slot => {
                                                        const availMatch = doesSlotMatchClientAvailability(slot, clientAvailabilityForAllocation);
                                                        const isMatch = availMatch === true;
                                                        const noMatch = availMatch === false;
                                                        return (
                                                        <Button 
                                                            key={slot.id}
                                                            variant={slot.isBooked ? "ghost" : "outline"}
                                                            disabled={slot.isBooked}
                                                            className={`justify-start h-auto py-2 px-3 text-xs relative ${
                                                                slot.isBooked 
                                                                    ? "opacity-50 line-through decoration-destructive" 
                                                                    : isMatch 
                                                                        ? "border-emerald-400 bg-emerald-50 hover:border-emerald-500 hover:bg-emerald-100 ring-1 ring-emerald-200" 
                                                                        : noMatch 
                                                                            ? "opacity-60 border-slate-200" 
                                                                            : "hover:border-primary hover:bg-primary/5"
                                                            }`}
                                                            onClick={() => handleAssign(clinician.id, slot.id)}
                                                        >
                                                            {isMatch && <span className="absolute -top-1 -right-1 bg-emerald-500 text-white text-[8px] px-1 rounded">Match</span>}
                                                            <CalendarCheck className={`h-3 w-3 mr-2 ${isMatch ? "text-emerald-600" : ""}`} />
                                                            <div className="text-left">
                                                                <div className={`font-medium ${isMatch ? "text-emerald-700" : ""}`}>{slot.day || format(parseISO(slot.date!), "EEE")}</div>
                                                                <div className={`text-[10px] ${isMatch ? "text-emerald-600" : "text-muted-foreground"}`}>{slot.startTime} - {slot.endTime}</div>
                                                            </div>
                                                        </Button>
                                                    )})}
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
                        <DropdownMenuItem onClick={() => handleOpenEditClient(client)}>
                            <Edit className="h-4 w-4 mr-2" /> Edit Details
                        </DropdownMenuItem>
                        {client.status !== "Assigned" && client.status !== "Scheduled" && (
                          <DropdownMenuItem onClick={() => handleOpenManualAllocate(client)}>
                            <CalendarCheck className="h-4 w-4 mr-2" /> Allocate to Clinician
                          </DropdownMenuItem>
                        )}
                        {(client.status === "Assigned" || client.status === "Scheduled") && (
                          <DropdownMenuItem onClick={() => handleOpenEditStatus(client)}>
                            <CalendarCheck className="h-4 w-4 mr-2" /> Edit Status
                          </DropdownMenuItem>
                        )}
                        {client.status !== "New" && (
                          <DropdownMenuItem onClick={() => handleOpenSendForms(client)}>
                            <Mail className="h-4 w-4 mr-2" /> Resend Forms
                          </DropdownMenuItem>
                        )}
                        {client.status !== "New" && client.status !== "Forms Sent" && (
                          <DropdownMenuItem onClick={() => handleOpenViewResponses(client)}>
                            <Eye className="h-4 w-4 mr-2" /> View Responses
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => handleOpenArchiveDialog(client)}>
                            Archive
                        </DropdownMenuItem>
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

      {/* Edit Client Dialog */}
      <Dialog open={isEditClientOpen} onOpenChange={setIsEditClientOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Client: {editingClient?.displayId}</DialogTitle>
            <DialogDescription>
              Update client information. Changes will be saved immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input 
                  type="email"
                  value={editClientData.email}
                  onChange={e => setEditClientData({...editClientData, email: e.target.value})}
                />
              </div>
              <div className="grid gap-2">
                <Label>Phone</Label>
                <Input 
                  value={editClientData.phone}
                  onChange={e => setEditClientData({...editClientData, phone: e.target.value})}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Insurer</Label>
                <Select 
                  value={editClientData.insurer} 
                  onValueChange={v => setEditClientData({...editClientData, insurer: v})}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                <Label>Status</Label>
                <Select 
                  value={editClientData.status} 
                  onValueChange={(v: ClientType["status"]) => setEditClientData({...editClientData, status: v})}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="New">New</SelectItem>
                    <SelectItem value="Forms Sent">Forms Sent</SelectItem>
                    <SelectItem value="Forms Completed">Forms Completed</SelectItem>
                    <SelectItem value="Assigned">Allocated</SelectItem>
                    <SelectItem value="Scheduled">Confirmed</SelectItem>
                    <SelectItem value="Waitlist">Waitlist</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Referral Source</Label>
              <Input 
                value={editClientData.referralSource}
                onChange={e => setEditClientData({...editClientData, referralSource: e.target.value})}
              />
            </div>

            <div className="grid gap-2">
              <Label>Presenting Issues (comma separated)</Label>
              <Input 
                value={editClientData.presentingIssues.join(", ")}
                onChange={e => setEditClientData({
                  ...editClientData, 
                  presentingIssues: e.target.value.split(",").map(s => s.trim()).filter(Boolean)
                })}
              />
            </div>

            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea 
                value={editClientData.notes}
                onChange={e => setEditClientData({...editClientData, notes: e.target.value})}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditClientOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEditClient}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Status Dialog */}
      <Dialog open={isEditStatusOpen} onOpenChange={setIsEditStatusOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5" />
              Edit Status
            </DialogTitle>
            <DialogDescription>
              Change the status or reassign {editStatusClient?.displayId} to a different time slot.
            </DialogDescription>
          </DialogHeader>
          
          {editStatusClient && (
            <div className="grid gap-6 py-4">
              <div className="p-3 bg-muted/30 rounded border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground font-medium">CURRENT ALLOCATION</p>
                </div>
                <div className="text-sm">
                  <span className="font-medium">Clinician:</span>{" "}
                  {clinicians.find(c => c.id === editStatusClient.assignedClinicianId)?.name?.split(",")[0] || "None"}
                </div>
                <div className="text-sm">
                  <span className="font-medium">Slot:</span>{" "}
                  {editStatusClient.assignedSlot || "None"}
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Status</Label>
                <Select 
                  value={editStatusData.status} 
                  onValueChange={(v) => setEditStatusData({...editStatusData, status: v as ClientType["status"]})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="New">New</SelectItem>
                    <SelectItem value="Forms Sent">Forms Sent</SelectItem>
                    <SelectItem value="Forms Completed">Forms Completed</SelectItem>
                    <SelectItem value="Assigned">Allocated</SelectItem>
                    <SelectItem value="Scheduled">Confirmed</SelectItem>
                    <SelectItem value="Waitlist">Waitlist</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Changing to New, Forms Sent, Forms Completed, or Waitlist will release the current time slot.
                </p>
              </div>

              {(editStatusData.status === "Assigned" || editStatusData.status === "Scheduled") && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Reassign to Different Slot (optional)</Label>
                  </div>

                  {clinicians.map(clinician => {
                    const availableSlots = clinician.availability.filter(s => s.type !== "Vacation" && !s.isBooked);
                    if (availableSlots.length === 0) return null;
                    
                    return (
                      <div key={clinician.id} className="p-4 border rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-medium">{clinician.name.split(",")[0]}</span>
                          <span className="text-xs text-muted-foreground">
                            {getSlotCounts(clinician.availability).available} available, {getSlotCounts(clinician.availability).pending} pending
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {availableSlots.map(slot => (
                            <Button
                              key={slot.id}
                              variant={editStatusData.slotId === slot.id && editStatusData.clinicianId === clinician.id ? "default" : "outline"}
                              size="sm"
                              className="justify-start h-auto py-2 px-3 text-xs"
                              onClick={() => setEditStatusData({
                                ...editStatusData,
                                clinicianId: clinician.id,
                                slotId: slot.id
                              })}
                            >
                              <CalendarCheck className="h-3 w-3 mr-2" />
                              <div className="text-left">
                                <div className="font-medium">{slot.day || (slot.date && format(parseISO(slot.date), "EEE"))}</div>
                                <div className="text-[10px] text-muted-foreground">{slot.startTime} - {slot.endTime}</div>
                              </div>
                            </Button>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {editStatusData.slotId && (
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => setEditStatusData({...editStatusData, clinicianId: editStatusClient.assignedClinicianId, slotId: null})}
                    >
                      Clear selection (keep current slot)
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditStatusOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleSaveEditStatus}
              disabled={reassignClientMutation.isPending}
            >
              {reassignClientMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Allocation Dialog (Phone Intake Flow) */}
      <Dialog open={isManualAllocateOpen} onOpenChange={setIsManualAllocateOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Manual Allocation (Phone Intake)
            </DialogTitle>
            <DialogDescription>
              Assign {manualAllocateClient?.displayId} to an available time slot after phone intake.
              This bypasses the standard form submission workflow.
            </DialogDescription>
          </DialogHeader>
          
          {manualAllocateClient && (
            <div className="grid gap-6 py-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
                <p className="text-sm text-amber-800 font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Manual allocation - Forms not completed
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  This client has not completed intake forms. Ensure all necessary information has been gathered during the phone call.
                </p>
              </div>

              <div className="p-3 bg-muted/30 rounded border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground font-medium">CLIENT PROFILE</p>
                  <Badge variant={(manualAllocateClient.insurer || "Private") === "Private" ? "outline" : "default"} className="text-[10px]">
                    {manualAllocateClient.insurer || "Private"}
                  </Badge>
                </div>
                <div className="flex gap-2">
                  {(manualAllocateClient.presentingIssues || []).map(i => <Badge key={i} variant="secondary">{i}</Badge>)}
                  {(manualAllocateClient.presentingIssues || []).length === 0 && (
                    <span className="text-xs text-muted-foreground italic">No presenting issues recorded</span>
                  )}
                </div>
                {manualAllocateClient.notes && (
                  <p className="text-sm italic">"{manualAllocateClient.notes}"</p>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">AVAILABLE SLOTS</p>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="override-mode-manual" className="text-xs text-muted-foreground cursor-pointer">Admin Override</Label>
                    <Switch id="override-mode-manual" checked={showAllClinicians} onCheckedChange={setShowAllClinicians} />
                  </div>
                </div>

                {getCliniciansForAllocation(manualAllocateClient).length === 0 && (
                  <div className="text-center py-8 text-muted-foreground border rounded-md bg-slate-50">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
                    <p>No matching clinicians found.</p>
                    <p className="text-xs mt-1">Try enabling "Admin Override" to see all schedules.</p>
                  </div>
                )}

                {getCliniciansForAllocation(manualAllocateClient).map(clinician => {
                  const isMatch = isClinicianMatch(clinician, manualAllocateClient);
                  return (
                    <div key={clinician.id} className={`p-4 border rounded-lg ${isMatch ? "border-green-300 bg-green-50/30" : "border-border"}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{clinician.name.split(",")[0]}</span>
                          {isMatch && <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Match</Badge>}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Briefcase className="h-3 w-3" />
                            {getSlotCounts(clinician.availability).available} avail, {getSlotCounts(clinician.availability).pending} pending
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {clinician.availability.filter(s => s.type !== "Vacation").map(slot => (
                          <Button
                            key={slot.id}
                            variant="outline"
                            size="sm"
                            disabled={slot.isBooked}
                            className={`justify-start h-auto py-2 px-3 text-xs ${
                              slot.isBooked ? "opacity-50 line-through decoration-destructive" : "hover:border-primary hover:bg-primary/5"
                            }`}
                            onClick={() => handleAssign(clinician.id, slot.id, "manual")}
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
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Archive Confirmation Dialog */}
      <Dialog open={isArchiveDialogOpen} onOpenChange={setIsArchiveDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Archive Client
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to archive client <strong>{clientToArchive?.displayId}</strong>?
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
              <p className="text-sm font-medium text-destructive mb-2">Warning: This action cannot be undone</p>
              <p className="text-sm text-muted-foreground">
                Once archived, this client record will be permanently removed from the active client list
                and cannot be retrieved. All associated data will remain in the system for audit purposes
                but will no longer be accessible through the interface.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsArchiveDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleConfirmArchive}
              disabled={archiveClientMutation.isPending}
            >
              {archiveClientMutation.isPending ? "Archiving..." : "Yes, Archive Client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Responses Dialog */}
      <Dialog open={isViewResponsesOpen} onOpenChange={setIsViewResponsesOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Form Responses - {viewResponsesClient?.displayId}
            </DialogTitle>
            <DialogDescription>
              Review submitted form responses for this client.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto py-4">
            {loadingSubmissions ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : submissions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No form submissions found for this client.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {submissions.map((submission, index) => (
                  <div key={submission.id || index} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-semibold text-lg">{submission.formTitle}</h3>
                        <p className="text-sm text-muted-foreground">
                          Submitted: {submission.submittedAt ? formatDateUK(submission.submittedAt) : 'N/A'}
                        </p>
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => generatePDF(submission)}
                        data-testid={`button-download-pdf-${submission.id}`}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download PDF
                      </Button>
                    </div>
                    
                    <div className="space-y-3">
                      {(submission.formFields || []).map((field: any) => {
                        const value = submission.responses?.[field.id];
                        if (value === undefined || value === null || value === '') return null;
                        
                        let displayValue = value;
                        if (Array.isArray(value)) {
                          displayValue = value.join(', ');
                        } else if (typeof value === 'boolean') {
                          displayValue = value ? 'Yes' : 'No';
                        }
                        
                        return (
                          <div key={field.id} className="grid grid-cols-3 gap-2 py-2 border-b last:border-b-0">
                            <div className="font-medium text-sm text-muted-foreground col-span-1">
                              {field.label}
                            </div>
                            <div className="text-sm col-span-2">
                              {displayValue}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsViewResponsesOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
