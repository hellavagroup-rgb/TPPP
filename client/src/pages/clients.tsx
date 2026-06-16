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
  Loader2,
  RotateCcw,
  Users,
  Trash2,
  CreditCard,
  ExternalLink,
  History,
  AlertCircle,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, isSameDay } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import type { Client as ClientType, Clinician, FormTemplate as FormTemplateType, TimeSlot } from "@shared/schema";
import { useInsurers, useAddInsurer } from "@/hooks/use-insurers";
import { useAuth } from "@/lib/auth";

type ClinicianWithAvailability = Clinician & { name: string; availability: TimeSlot[] };

function isSlotPending(slot: TimeSlot): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (slot.startDate) {
    const startDate = new Date(slot.startDate);
    startDate.setHours(0, 0, 0, 0);
    return startDate > today;
  }
  return false;
}

function getSlotPendingDate(slot: TimeSlot): string | null {
  if (slot.startDate) {
    return format(parseISO(slot.startDate), "dd/MM/yyyy");
  }
  return null;
}

function isSlotActiveGlobal(slot: TimeSlot) {
  if (!slot.endDate) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(slot.endDate);
  endDate.setHours(0, 0, 0, 0);
  return endDate >= today;
}

function getSlotCounts(availability?: TimeSlot[]) {
  if (!availability) return { available: 0, pending: 0 };
  
  let available = 0;
  let pending = 0;
  
  availability.filter(s => !s.isBooked && s.type !== "Vacation" && isSlotActiveGlobal(s)).forEach(slot => {
    if (isSlotPending(slot)) {
      pending += 1;
    } else {
      available += 1;
    }
  });
  
  return { available, pending };
}

export default function Clients() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClient, setSelectedClient] = useState<ClientType | null>(null);

  // Custom insurer management
  const { data: insurerList = [] } = useInsurers();
  const addInsurerMutation = useAddInsurer();
  const [showAddInsurerDialog, setShowAddInsurerDialog] = useState(false);
  const [newInsurerName, setNewInsurerName] = useState("");
  const [addInsurerTarget, setAddInsurerTarget] = useState<"new" | "edit">("new");

  // View toggle states - defined early for query dependency
  const [showConfirmedState, setShowConfirmedState] = useState(false);
  const [showArchivedState, setShowArchivedState] = useState(false);

  // Fetch data from API - include archived when that toggle is enabled
  const { data: clients = [] } = useQuery<ClientType[]>({
    queryKey: ["/api/clients", showArchivedState],
    queryFn: async () => {
      const res = await fetch(`/api/clients?includeArchived=${showArchivedState}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch clients");
      return res.json();
    },
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
    mutationFn: async ({ clientId, clinicianId, slotId, allocationMethod = "form", allocationReason }: { clientId: string; clinicianId: string; slotId: string; allocationMethod?: "form" | "manual"; allocationReason?: string }) => {
      const response = await apiRequest("POST", `/api/clients/${clientId}/assign`, { clinicianId, slotId, allocationMethod, allocationReason });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client Assigned", description: "Client has been allocated a slot." });
      setSelectedClient(null);
      setIsManualAllocateOpen(false);
      setIsAllocateDialogOpen(false);
      setAllocationReason("");
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

  // Fill by Phone State
  const [isPhoneFillOpen, setIsPhoneFillOpen] = useState(false);
  const [phoneFillClient, setPhoneFillClient] = useState<ClientType | null>(null);
  const [phoneFillFormId, setPhoneFillFormId] = useState<string>("");

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
  const [isAllocateDialogOpen, setIsAllocateDialogOpen] = useState(false);
  const [isManualAllocation, setIsManualAllocation] = useState(false); // Track if current allocation is manual
  const [allocationReason, setAllocationReason] = useState(""); // Reason for allocation decision

  const [archiveReason, setArchiveReason] = useState("");
  const [archiveCategory, setArchiveCategory] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [isAddingCategory, setIsAddingCategory] = useState(false);

  const { data: nonEngagementCategories = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/non-engagement-categories"],
  });

  const addCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await apiRequest("POST", "/api/non-engagement-categories", { name });
      return response.json();
    },
    onSuccess: (data: { name: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/non-engagement-categories"] });
      setArchiveCategory(data.name);
      setNewCategoryName("");
      setIsAddingCategory(false);
    },
    onError: (error: any) => {
      const msg = error?.message?.includes("already exists") ? "This category already exists" : "Failed to add category";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const archiveClientMutation = useMutation({
    mutationFn: async ({ clientId, reason, category }: { clientId: string; reason: string; category: string }) => {
      const response = await apiRequest("POST", `/api/clients/${clientId}/archive`, { reason, category });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client Archived", description: "This client has been moved to Archive/Didn't Engage." });
      setIsArchiveDialogOpen(false);
      setClientToArchive(null);
      setArchiveReason("");
      setArchiveCategory("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to archive/didn't engage client.", variant: "destructive" });
    },
  });

  const handleOpenArchiveDialog = (client: ClientType) => {
    setClientToArchive(client);
    setArchiveReason("");
    setArchiveCategory("");
    setIsAddingCategory(false);
    setNewCategoryName("");
    setIsArchiveDialogOpen(true);
  };

  const restoreClientMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const response = await apiRequest("POST", `/api/clients/${clientId}/restore`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client Restored", description: "This client has been restored to the active list." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to restore client.", variant: "destructive" });
    },
  });

  const handleConfirmArchive = () => {
    if (clientToArchive) {
      const cat = archiveCategory === "__none__" ? "" : archiveCategory;
      archiveClientMutation.mutate({ clientId: clientToArchive.id, reason: archiveReason, category: cat });
    }
  };

  // Permanent Delete State
  const [isPermanentDeleteOpen, setIsPermanentDeleteOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState<ClientType | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const permanentDeleteMutation = useMutation({
    mutationFn: async ({ clientId, password }: { clientId: string; password: string }) => {
      const response = await apiRequest("POST", `/api/clients/${clientId}/delete-permanently`, { password });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client Permanently Deleted", description: "The client record has been permanently removed." });
      setIsPermanentDeleteOpen(false);
      setClientToDelete(null);
      setDeletePassword("");
      setDeleteError("");
    },
    onError: (error: any) => {
      const message = error?.message || "";
      if (message.includes("Incorrect password")) {
        setDeleteError("Incorrect password. Please try again.");
      } else if (message.includes("Only archived")) {
        setDeleteError("Only archived clients can be permanently deleted.");
      } else {
        setDeleteError("Failed to delete client. Please try again.");
      }
    },
  });

  const handleOpenPermanentDelete = (client: ClientType) => {
    setClientToDelete(client);
    setDeletePassword("");
    setDeleteError("");
    setIsPermanentDeleteOpen(true);
  };

  const handleConfirmPermanentDelete = () => {
    if (clientToDelete && deletePassword) {
      permanentDeleteMutation.mutate({ clientId: clientToDelete.id, password: deletePassword });
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

  const escapeHtml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  };

  const generatePDF = (submission: any) => {
    const formTitle = submission.formTitle;
    const responses = submission.responses || {};
    const fields = submission.formFields || [];
    
    // Build a printable HTML document
    let content = `
      <html>
      <head>
        <title>${escapeHtml(String(formTitle))} - ${escapeHtml(String(viewResponsesClient?.displayId ?? ''))}</title>
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
        <h1>${escapeHtml(String(formTitle))}</h1>
        <p class="meta">Client ID: ${escapeHtml(String(viewResponsesClient?.displayId ?? ''))} | Submitted: ${escapeHtml(submission.submittedAt ? formatDateUK(submission.submittedAt) : 'N/A')}</p>
    `;

    // Group responses by field
    fields.forEach((field: any) => {
      const value = responses[field.id];
      if (value !== undefined && value !== null && value !== '') {
        let displayValue: string;
        if (Array.isArray(value)) {
          displayValue = escapeHtml(value.join(', '));
        } else if (typeof value === 'boolean') {
          displayValue = value ? 'Yes' : 'No';
        } else if (typeof value === 'object' && value !== null) {
          // Handle availability picker or other object values
          const entries = Object.entries(value as Record<string, string[]>);
          if (entries.length > 0 && Array.isArray(entries[0][1])) {
            // This is an availability picker value - day names and times come from our own schema, still escape for safety
            const availabilityLines = entries
              .filter(([_, times]) => times.length > 0)
              .map(([day, times]) => `<strong>${escapeHtml(day)}:</strong> ${escapeHtml((times as string[]).sort().join(', '))}`)
              .join('<br>');
            displayValue = availabilityLines || 'No times selected';
          } else {
            // Generic object - stringify and escape it
            displayValue = escapeHtml(JSON.stringify(value));
          }
        } else {
          displayValue = escapeHtml(String(value));
        }
        content += `
          <div class="field">
            <div class="label">${escapeHtml(String(field.label))}</div>
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

  // ============ PAYMENT STATE ============
  const { data: stripeStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/stripe/status"],
  });
  const stripeEnabled = stripeStatus?.configured ?? false;

  // Payment Link Dialog
  const [isPaymentLinkOpen, setIsPaymentLinkOpen] = useState(false);
  const [paymentLinkClient, setPaymentLinkClient] = useState<ClientType | null>(null);
  const [agreedRatePounds, setAgreedRatePounds] = useState("");
  const [generatedPaymentUrl, setGeneratedPaymentUrl] = useState("");
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);

  // Charge Session Dialog
  const [isChargeOpen, setIsChargeOpen] = useState(false);
  const [chargeClient, setChargeClient] = useState<ClientType | null>(null);
  const [chargeAmountPounds, setChargeAmountPounds] = useState("");
  const [chargeNotes, setChargeNotes] = useState("");

  // Payment History Dialog
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyClient, setHistoryClient] = useState<ClientType | null>(null);
  const [charges, setCharges] = useState<any[]>([]);
  const [loadingCharges, setLoadingCharges] = useState(false);

  const handleOpenPaymentLink = (client: ClientType) => {
    setPaymentLinkClient(client);
    const assignedClinician = clinicians.find(c => c.id === client.assignedClinicianId);
    setAgreedRatePounds(
      client.agreedRatePence
        ? String((client.agreedRatePence / 100).toFixed(2))
        : assignedClinician?.sessionRatePence
        ? String((assignedClinician.sessionRatePence / 100).toFixed(2))
        : ""
    );
    setGeneratedPaymentUrl(client.stripeCheckoutUrl || "");
    setIsPaymentLinkOpen(true);
  };

  const handleGeneratePaymentLink = async () => {
    if (!paymentLinkClient) return;
    setIsGeneratingLink(true);
    try {
      // Save agreed rate first if changed
      const ratePence = Math.round(parseFloat(agreedRatePounds) * 100);
      if (ratePence > 0) {
        await fetch(`/api/clients/${paymentLinkClient.id}/agreed-rate`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ agreedRatePence: ratePence }),
        });
      }
      // Create checkout session
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clientId: paymentLinkClient.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate link");
      setGeneratedPaymentUrl(data.url);
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Payment link created", description: "Copy the link and send it to the client." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to create payment link", variant: "destructive" });
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const handleOpenCharge = (client: ClientType) => {
    setChargeClient(client);
    const assignedClinician = clinicians.find(c => c.id === client.assignedClinicianId);
    setChargeAmountPounds(
      client.agreedRatePence
        ? String((client.agreedRatePence / 100).toFixed(2))
        : assignedClinician?.sessionRatePence
        ? String((assignedClinician.sessionRatePence / 100).toFixed(2))
        : ""
    );
    setChargeNotes("");
    setIsChargeOpen(true);
  };

  const chargeMutation = useMutation({
    mutationFn: async ({ clientId, amountPence, notes }: { clientId: string; amountPence: number; notes: string }) => {
      const res = await apiRequest("POST", "/api/stripe/charge", { clientId, amountPence, notes });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Charge failed");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Session charged", description: "The payment has been processed." });
      setIsChargeOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    },
    onError: (err: any) => {
      toast({ title: "Payment failed", description: err.message || "Failed to charge session", variant: "destructive" });
    },
  });

  const handleOpenHistory = async (client: ClientType) => {
    setHistoryClient(client);
    setIsHistoryOpen(true);
    setLoadingCharges(true);
    try {
      const res = await apiRequest("GET", `/api/stripe/charges/${client.id}`);
      const data = await res.json();
      setCharges(data);
    } catch {
      setCharges([]);
    } finally {
      setLoadingCharges(false);
    }
  };

  const paymentStatusBadge = (client: ClientType) => {
    const ps = client.paymentStatus;
    if (!stripeEnabled) return null;
    if (ps === "active") return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
        <CreditCard className="h-2.5 w-2.5" /> Card saved
      </span>
    );
    if (ps === "setup_pending") return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
        <CreditCard className="h-2.5 w-2.5" /> Awaiting payment
      </span>
    );
    return null;
  };

  // Unified filtering based on toggle states and search term
  const filteredClients = clients.filter(client => {
    const matchesSearch = searchTerm === "" || client.displayId.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (showArchivedState) {
      // Show only archived clients
      return matchesSearch && client.isArchived;
    }
    if (showConfirmedState) {
      // Show only Scheduled (Confirmed) clients that are not archived
      return matchesSearch && client.status === "Scheduled" && !client.isArchived;
    }
    // Kanban view: show non-archived clients (all statuses for Kanban columns)
    return matchesSearch && !client.isArchived;
  });

  // Display labels for statuses (UI labels differ from database values)
  const getStatusDisplayLabel = (status: string) => {
    switch(status) {
      case "New": return "Pending Intake";
      case "Forms Sent": return "Screen Booked/Sent";
      case "Assigned": return "Allocated";
      case "AwaitingConfirmation": return "Awaiting Confirmation";
      case "Scheduled": return "Confirmed";
      default: return status;
    }
  };

  const getStatusColor = (status: ClientStatus | "AwaitingConfirmation") => {
    switch(status) {
      case "New": return "bg-blue-100 text-blue-700 hover:bg-blue-200";
      case "Forms Sent": return "bg-amber-100 text-amber-700 hover:bg-amber-200";
      case "Forms Completed": return "bg-emerald-100 text-emerald-700 hover:bg-emerald-200";
      case "Assigned": return "bg-indigo-100 text-indigo-700 hover:bg-indigo-200";
      case "AwaitingConfirmation": return "bg-purple-100 text-purple-700 hover:bg-purple-200";
      case "Scheduled": return "bg-green-100 text-green-700 hover:bg-green-200";
      case "Waitlist": return "bg-slate-100 text-slate-700 hover:bg-slate-200";
      default: return "bg-slate-100 text-slate-700";
    }
  };

  const handleAssign = (clinicianId: string, slotId: string, allocationMethod: "form" | "manual" = "form") => {
    // For unified dialog, always use selectedClient
    // For legacy manual dialog (isManualAllocateOpen), use manualAllocateClient
    const clientToAssign = isManualAllocateOpen ? manualAllocateClient : selectedClient;
    if (clientToAssign) {
      assignClientMutation.mutate({ 
        clientId: clientToAssign.id, 
        clinicianId, 
        slotId,
        allocationMethod,
        allocationReason: allocationReason.trim() || undefined
      });
    }
  };

  const handleOpenManualAllocate = (client: ClientType) => {
    // Open the same allocation dialog as the "Allocate" button, but mark as manual
    setSelectedClient(client);
    setIsManualAllocation(true);
    fetchClientAvailability(client.id);
    setIsAllocateDialogOpen(true);
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

  // Helper to check if a slot is still active (end date is today or in the future)
  const isSlotActive = (slot: any) => {
    if (!slot.endDate) return true; // No end date means always active
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(slot.endDate);
    endDate.setHours(0, 0, 0, 0);
    return endDate >= today;
  };

  const getActiveSlots = (availability: any[]) => {
    return availability.filter(s => s.type !== "Vacation" && isSlotActive(s));
  };

  const handleOpenSendForms = (client: ClientType) => {
      setClientToSendForms(client);
      setSelectedForms([]); // Reset selection
      setIsSendFormsOpen(true);
  };

  const handleOpenPhoneFill = (client: ClientType) => {
    setPhoneFillClient(client);
    setPhoneFillFormId(forms.length === 1 ? forms[0].id : "");
    setIsPhoneFillOpen(true);
  };

  const handleStartPhoneFill = () => {
    if (phoneFillClient && phoneFillFormId) {
      const url = `${window.location.origin}/fill/${phoneFillClient.id}/${phoneFillFormId}`;
      window.open(url, '_blank');
      setIsPhoneFillOpen(false);
      setPhoneFillClient(null);
      setPhoneFillFormId("");
      toast({
        title: "Phone Fill Started",
        description: `Form opened in a new tab for ${phoneFillClient.displayId}. Fill it in while on the phone with the client.`,
      });
    }
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
      // 1. Check Capacity - clinician must have capacity for new clients
      const hasSpace = (clinician.maxNewClients ?? 0) > 0;
      
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

  // Calculate how many slots match client availability for ranking
  const countMatchingSlots = (clinician: ClinicianWithAvailability, clientAvail: Record<string, string[]> | null): number => {
    if (!clientAvail || Object.keys(clientAvail).length === 0) return 0;
    if (!clinician.availability) return 0;
    
    let matchCount = 0;
    clinician.availability.forEach(slot => {
      if (slot.type === "Vacation" || slot.isBooked || !isSlotActive(slot)) return;
      const day = slot.day || "";
      const clientSlots = clientAvail[day] || [];
      if (clientSlots.length === 0) return;
      
      // Check if any client slot overlaps with clinician slot
      const slotStart = parseInt(slot.startTime?.split(":")[0] || "0");
      const slotEnd = parseInt(slot.endTime?.split(":")[0] || "0");
      
      for (const cs of clientSlots) {
        const clientHour = parseInt(cs.split(":")[0]);
        if (clientHour >= slotStart && clientHour < slotEnd) {
          matchCount++;
          break;
        }
      }
    });
    return matchCount;
  };

  const getCliniciansForAllocation = (client: ClientType) => {
    let filtered = showAllClinicians ? clinicians : clinicians.filter(c => isClinicianMatch(c, client));
    
    // Sort by: 1) Has capacity (0 capacity goes to bottom), 2) availability match, 3) new client capacity
    return [...filtered].sort((a, b) => {
      const capacityA = a.maxNewClients ?? 0;
      const capacityB = b.maxNewClients ?? 0;
      
      // Primary: clinicians with 0 capacity go to the bottom
      if (capacityA === 0 && capacityB > 0) return 1;
      if (capacityB === 0 && capacityA > 0) return -1;
      
      // Secondary: availability match count (most matches first)
      const matchA = countMatchingSlots(a, clientAvailabilityForAllocation);
      const matchB = countMatchingSlots(b, clientAvailabilityForAllocation);
      if (matchB !== matchA) return matchB - matchA;
      
      // Tertiary: prefer clinicians with more new client capacity
      return capacityB - capacityA;
    });
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
                            onValueChange={v => {
                              if (v === "__add_new__") {
                                setAddInsurerTarget("new");
                                setNewInsurerName("");
                                setShowAddInsurerDialog(true);
                              } else {
                                setNewClientData({...newClientData, insurer: v});
                              }
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Private">Private / Self-Pay</SelectItem>
                                {insurerList.map(ins => (
                                  <SelectItem key={ins} value={ins}>{ins}</SelectItem>
                                ))}
                                {isAdmin && <SelectItem value="__add_new__" className="text-blue-600 font-medium">+ Add new insurer...</SelectItem>}
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

      {/* Search and View Toggle */}
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
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch 
              id="show-confirmed"
              checked={showConfirmedState}
              onCheckedChange={(checked) => { setShowConfirmedState(checked); if (checked) setShowArchivedState(false); }}
            />
            <Label htmlFor="show-confirmed" className="text-sm cursor-pointer">Show Confirmed</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch 
              id="show-archived"
              checked={showArchivedState}
              onCheckedChange={(checked) => { setShowArchivedState(checked); if (checked) setShowConfirmedState(false); }}
            />
            <Label htmlFor="show-archived" className="text-sm cursor-pointer">Show Archived/Didn't Engage</Label>
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      {!showConfirmedState && !showArchivedState ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Column 1: Pending Intake */}
          <div className="bg-blue-50/50 rounded-lg p-3 min-h-[400px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-blue-800 text-sm">Pending Intake</h3>
              <Badge variant="secondary" className="bg-blue-100 text-blue-700">{filteredClients.filter(c => c.status === "New").length}</Badge>
            </div>
            <div className="space-y-2">
              {filteredClients.filter(c => c.status === "New").map(client => (
                <Card key={client.id} className="bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer overflow-hidden" data-testid={`kanban-card-${client.id}`}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-semibold text-sm">{client.displayId}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <MoreHorizontal className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenEditClient(client)}>
                            <Edit className="h-4 w-4 mr-2" /> Edit Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleOpenManualAllocate(client)}>
                            <CalendarCheck className="h-4 w-4 mr-2" /> Allocate to Clinician
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => handleOpenArchiveDialog(client)}>
                            Archive/Didn't Engage
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      <Clock className="h-3 w-3 inline mr-1" />
                      Created: {formatDateUK(client.intakeDate)}
                    </p>
                    {client.insurer && client.insurer !== "Private" && (
                      <Badge variant="outline" className="text-[10px] mb-2">{client.insurer}</Badge>
                    )}
                    {client.notes && (
                      <p className="text-[10px] text-muted-foreground mt-1 italic line-clamp-2" data-testid={`notes-${client.id}`}>"{client.notes}"</p>
                    )}
                    <div className="flex flex-col gap-1 mt-2">
                      <Button size="sm" variant="outline" className="w-full gap-1 text-xs" onClick={() => handleOpenSendForms(client)}>
                        <Mail className="h-3 w-3" /> Send Forms
                      </Button>
                      <Button size="sm" variant="outline" className="w-full gap-1 text-xs" onClick={() => handleOpenPhoneFill(client)}>
                        <Phone className="h-3 w-3" /> Fill by Phone
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {filteredClients.filter(c => c.status === "New").length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No clients</p>
              )}
            </div>
          </div>

          {/* Column 2: Screen Booked/Sent */}
          <div className="bg-amber-50/50 rounded-lg p-3 min-h-[400px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-amber-800 text-sm">Screen Booked/Sent</h3>
              <Badge variant="secondary" className="bg-amber-100 text-amber-700">{filteredClients.filter(c => c.status === "Forms Sent").length}</Badge>
            </div>
            <div className="space-y-2">
              {filteredClients.filter(c => c.status === "Forms Sent").map(client => (
                <Card key={client.id} className="bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer overflow-hidden" data-testid={`kanban-card-${client.id}`}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-semibold text-sm">{client.displayId}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <MoreHorizontal className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenEditClient(client)}>
                            <Edit className="h-4 w-4 mr-2" /> Edit Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleOpenSendForms(client)}>
                            <Mail className="h-4 w-4 mr-2" /> Resend Forms
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleOpenPhoneFill(client)}>
                            <Phone className="h-4 w-4 mr-2" /> Fill by Phone
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleOpenManualAllocate(client)}>
                            <CalendarCheck className="h-4 w-4 mr-2" /> Allocate to Clinician
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => handleOpenArchiveDialog(client)}>
                            Archive/Didn't Engage
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      <Clock className="h-3 w-3 inline mr-1" />
                      Sent: {(client as any).formsSentAt ? formatDateUK((client as any).formsSentAt) : formatDateUK(client.intakeDate)}
                    </p>
                    {client.insurer && client.insurer !== "Private" && (
                      <Badge variant="outline" className="text-[10px]">{client.insurer}</Badge>
                    )}
                    {client.notes && (
                      <p className="text-[10px] text-muted-foreground mt-1 italic line-clamp-2" data-testid={`notes-${client.id}`}>"{client.notes}"</p>
                    )}
                    <p className="text-[10px] text-amber-600 mt-2 flex items-center gap-1">
                      <Mail className="h-3 w-3" /> Awaiting response
                    </p>
                  </CardContent>
                </Card>
              ))}
              {filteredClients.filter(c => c.status === "Forms Sent").length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No clients</p>
              )}
            </div>
          </div>

          {/* Column 3: Forms Completed */}
          <div className="bg-emerald-50/50 rounded-lg p-3 min-h-[400px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-emerald-800 text-sm">Forms Completed</h3>
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">{filteredClients.filter(c => c.status === "Forms Completed").length}</Badge>
            </div>
            <div className="space-y-2">
              {filteredClients.filter(c => c.status === "Forms Completed").map(client => (
                <Card key={client.id} className="bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer overflow-hidden" data-testid={`kanban-card-${client.id}`}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-semibold text-sm">{client.displayId}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <MoreHorizontal className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenEditClient(client)}>
                            <Edit className="h-4 w-4 mr-2" /> Edit Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleOpenViewResponses(client)}>
                            <Eye className="h-4 w-4 mr-2" /> View Responses
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleOpenManualAllocate(client)}>
                            <CalendarCheck className="h-4 w-4 mr-2" /> Allocate to Clinician
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => handleOpenArchiveDialog(client)}>
                            Archive/Didn't Engage
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      <Clock className="h-3 w-3 inline mr-1" />
                      Completed: {(client as any).formsCompletedAt ? formatDateUK((client as any).formsCompletedAt) : formatDateUK(client.intakeDate)}
                    </p>
                    {client.insurer && client.insurer !== "Private" && (
                      <Badge variant="outline" className="text-[10px] mb-2">{client.insurer}</Badge>
                    )}
                    {client.notes && (
                      <p className="text-[10px] text-muted-foreground mt-1 italic line-clamp-2" data-testid={`notes-${client.id}`}>"{client.notes}"</p>
                    )}
                    <Button size="sm" className="w-full gap-1 text-xs mt-2 bg-primary hover:bg-primary/90" onClick={() => { setSelectedClient(client); setIsManualAllocation(false); fetchClientAvailability(client.id); setIsAllocateDialogOpen(true); }}>
                      <UserCheck className="h-3 w-3" /> Allocate
                    </Button>
                  </CardContent>
                </Card>
              ))}
              {filteredClients.filter(c => c.status === "Forms Completed").length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No clients</p>
              )}
            </div>
          </div>

          {/* Column 4: Allocated */}
          <div className="bg-indigo-50/50 rounded-lg p-3 min-h-[400px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-indigo-800 text-sm">Allocated</h3>
              <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">{filteredClients.filter(c => c.status === "Assigned").length}</Badge>
            </div>
            <div className="space-y-2">
              {filteredClients.filter(c => c.status === "Assigned").map(client => (
                <Card key={client.id} className="bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer overflow-hidden" data-testid={`kanban-card-${client.id}`}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-semibold text-sm">{client.displayId}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <MoreHorizontal className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenEditClient(client)}>
                            <Edit className="h-4 w-4 mr-2" /> Edit Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleOpenEditStatus(client)}>
                            <CalendarCheck className="h-4 w-4 mr-2" /> Edit Status
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleOpenViewResponses(client)}>
                            <Eye className="h-4 w-4 mr-2" /> View Responses
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => handleOpenArchiveDialog(client)}>
                            Archive/Didn't Engage
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      <Clock className="h-3 w-3 inline mr-1" />
                      Allocated: {(client as any).allocatedAt ? formatDateUK((client as any).allocatedAt) : formatDateUK(client.intakeDate)}
                    </p>
                    {client.assignedClinicianId && (
                      <div className="flex items-center gap-1 text-xs text-indigo-700 bg-indigo-100 px-2 py-1 rounded mb-2">
                        <UserCheck className="h-3 w-3" />
                        {clinicians.find(c => c.id === client.assignedClinicianId)?.name.split(",")[0]}
                      </div>
                    )}
                    {client.assignedSlot && (
                      <p className="text-[10px] text-muted-foreground font-mono">{client.assignedSlot}</p>
                    )}
                    {client.notes && (
                      <p className="text-[10px] text-muted-foreground mt-1 italic line-clamp-2" data-testid={`notes-${client.id}`}>"{client.notes}"</p>
                    )}
                    {(client as any).allocationReason && (
                      <p className="text-[10px] text-muted-foreground mt-2 italic border-t pt-2">
                        "{(client as any).allocationReason}"
                      </p>
                    )}
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="w-full gap-1 text-[10px] mt-2 border-purple-300 text-purple-700 hover:bg-purple-50 h-auto py-2 whitespace-normal"
                      onClick={() => {
                        reassignClientMutation.mutate({ 
                          clientId: client.id, 
                          clinicianId: client.assignedClinicianId,
                          slotId: client.assignedSlotId,
                          status: "AwaitingConfirmation"
                        });
                      }}
                    >
                      <Mail className="h-3 w-3 flex-shrink-0" /> Email Sent
                    </Button>
                  </CardContent>
                </Card>
              ))}
              {filteredClients.filter(c => c.status === "Assigned").length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No clients</p>
              )}
            </div>
          </div>

          {/* Column 5: Awaiting Confirmation */}
          <div className="bg-purple-50/50 rounded-lg p-3 min-h-[400px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-purple-800 text-sm">Awaiting Confirmation</h3>
              <Badge variant="secondary" className="bg-purple-100 text-purple-700">{filteredClients.filter(c => c.status === "AwaitingConfirmation").length}</Badge>
            </div>
            <div className="space-y-2">
              {filteredClients.filter(c => c.status === "AwaitingConfirmation").map(client => (
                <Card key={client.id} className="bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer overflow-hidden" data-testid={`kanban-card-${client.id}`}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-semibold text-sm">{client.displayId}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <MoreHorizontal className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenEditClient(client)}>
                            <Edit className="h-4 w-4 mr-2" /> Edit Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleOpenEditStatus(client)}>
                            <CalendarCheck className="h-4 w-4 mr-2" /> Edit Status
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleOpenViewResponses(client)}>
                            <Eye className="h-4 w-4 mr-2" /> View Responses
                          </DropdownMenuItem>
                          {stripeEnabled && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleOpenPaymentLink(client)}>
                                <CreditCard className="h-4 w-4 mr-2" /> Generate Payment Link
                              </DropdownMenuItem>
                              {client.paymentStatus === "active" && (
                                <DropdownMenuItem onClick={() => handleOpenHistory(client)}>
                                  <History className="h-4 w-4 mr-2" /> Payment History
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => handleOpenArchiveDialog(client)}>
                            Archive/Didn't Engage
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      <Clock className="h-3 w-3 inline mr-1" />
                      Sent: {(client as any).awaitingConfirmationAt ? formatDateUK((client as any).awaitingConfirmationAt) : formatDateUK(client.intakeDate)}
                    </p>
                    {client.assignedClinicianId && (
                      <div className="flex items-center gap-1 text-xs text-purple-700 bg-purple-100 px-2 py-1 rounded mb-2">
                        <UserCheck className="h-3 w-3" />
                        {clinicians.find(c => c.id === client.assignedClinicianId)?.name.split(",")[0]}
                      </div>
                    )}
                    {client.assignedSlot && (
                      <p className="text-[10px] text-muted-foreground font-mono">{client.assignedSlot}</p>
                    )}
                    {client.notes && (
                      <p className="text-[10px] text-muted-foreground mt-1 italic line-clamp-2" data-testid={`notes-${client.id}`}>"{client.notes}"</p>
                    )}
                    {paymentStatusBadge(client) && (
                      <div className="mt-1">{paymentStatusBadge(client)}</div>
                    )}
                    <Button 
                      size="sm" 
                      className="w-full gap-1 text-xs mt-2 bg-green-600 hover:bg-green-700"
                      onClick={() => {
                        updateClientMutation.mutate({ 
                          id: client.id, 
                          updates: { status: "Scheduled", confirmedAt: new Date().toISOString() } 
                        });
                      }}
                    >
                      <CheckCircle2 className="h-3 w-3" /> Mark as Confirmed
                    </Button>
                  </CardContent>
                </Card>
              ))}
              {filteredClients.filter(c => c.status === "AwaitingConfirmation").length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No clients</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* List view for Confirmed and Archived clients */
        <div className="space-y-3">
          <h3 className="font-semibold text-lg">{showConfirmedState ? "Confirmed Clients" : "Archived/Didn't Engage"}</h3>
          {filteredClients.map(client => (
            <Card key={client.id} className="shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold">{client.displayId}</span>
                    <Badge variant="secondary" className={getStatusColor(client.status)}>
                      {getStatusDisplayLabel(client.status)}
                    </Badge>
                    {client.insurer && client.insurer !== "Private" && (
                      <Badge variant="outline">{client.insurer}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {client.status === "Scheduled" && (client as any).confirmedAt && (
                      <span className="text-xs text-muted-foreground">
                        <Clock className="h-3 w-3 inline mr-1" />
                        Confirmed: {formatDateUK((client as any).confirmedAt)}
                      </span>
                    )}
                    {client.assignedClinicianId && (
                      <span className="text-sm text-muted-foreground">
                        <UserCheck className="h-4 w-4 inline mr-1" />
                        {clinicians.find(c => c.id === client.assignedClinicianId)?.name.split(",")[0]}
                      </span>
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
                        <DropdownMenuItem onClick={() => handleOpenEditStatus(client)}>
                          <CalendarCheck className="h-4 w-4 mr-2" /> Edit Status
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleOpenViewResponses(client)}>
                          <Eye className="h-4 w-4 mr-2" /> View Responses
                        </DropdownMenuItem>
                        {stripeEnabled && !client.isArchived && (
                          <>
                            <DropdownMenuSeparator />
                            {client.paymentStatus === "active" ? (
                              <>
                                <DropdownMenuItem onClick={() => handleOpenCharge(client)}>
                                  <CreditCard className="h-4 w-4 mr-2" /> Charge Session
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleOpenHistory(client)}>
                                  <History className="h-4 w-4 mr-2" /> Payment History
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <DropdownMenuItem onClick={() => handleOpenPaymentLink(client)}>
                                <CreditCard className="h-4 w-4 mr-2" /> Generate Payment Link
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                        <DropdownMenuSeparator />
                        {client.isArchived ? (
                          <>
                            <DropdownMenuItem onClick={() => restoreClientMutation.mutate(client.id)}>
                              <RotateCcw className="h-4 w-4 mr-2" /> Restore
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => handleOpenPermanentDelete(client)} data-testid={`btn-permanent-delete-${client.id}`}>
                              <Trash2 className="h-4 w-4 mr-2" /> Permanently Delete
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <DropdownMenuItem className="text-destructive" onClick={() => handleOpenArchiveDialog(client)}>
                            Archive/Didn't Engage
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {showArchivedState && ((client as any).archiveCategory || (client as any).archiveReason) && (
                  <div className="mt-2 p-2 bg-slate-50 rounded border border-slate-200">
                    {(client as any).archiveCategory && (
                      <Badge variant="outline" className="text-xs mb-1 bg-slate-100">{(client as any).archiveCategory}</Badge>
                    )}
                    {(client as any).archiveReason && (
                      <p className="text-xs text-muted-foreground italic" data-testid={`archive-reason-${client.id}`}>"{(client as any).archiveReason}"</p>
                    )}
                  </div>
                )}
                {client.notes && !showArchivedState && (
                  <p className="text-xs text-muted-foreground mt-2 italic line-clamp-2" data-testid={`notes-${client.id}`}>"{client.notes}"</p>
                )}
              </CardContent>
            </Card>
          ))}
          {filteredClients.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">No {showConfirmedState ? "confirmed" : "archived/didn't engage"} clients found.</p>
          )}
        </div>
      )}

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

      {/* Fill by Phone Dialog */}
      <Dialog open={isPhoneFillOpen} onOpenChange={setIsPhoneFillOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Fill Form by Phone
            </DialogTitle>
            <DialogDescription>
              Select the form to fill in on behalf of {phoneFillClient?.displayId} during a phone call. The form will open in a new tab.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            {forms.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No forms available. Create a form template first.</p>
            ) : forms.length === 1 ? (
              <div className="p-3 rounded border bg-muted/30">
                <p className="text-sm font-medium">{forms[0].title}</p>
                {forms[0].description && <p className="text-xs text-muted-foreground mt-1">{forms[0].description}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Select Form</Label>
                <Select value={phoneFillFormId} onValueChange={setPhoneFillFormId}>
                  <SelectTrigger data-testid="select-phone-fill-form">
                    <SelectValue placeholder="Choose a form..." />
                  </SelectTrigger>
                  <SelectContent>
                    {forms.map(form => (
                      <SelectItem key={form.id} value={form.id}>{form.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsPhoneFillOpen(false)}>Cancel</Button>
            <Button onClick={handleStartPhoneFill} disabled={!phoneFillFormId} data-testid="button-start-phone-fill">
              <Phone className="h-4 w-4 mr-2" /> Open Form
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

      {/* Allocate Dialog (from Kanban board) */}
      <Dialog open={isAllocateDialogOpen} onOpenChange={(open) => { setIsAllocateDialogOpen(open); if (!open) { setIsManualAllocation(false); setAllocationReason(""); } }}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Allocate Clinician Slot</DialogTitle>
            <DialogDescription>
              Assign {selectedClient?.displayId} to an available time slot.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="p-3 bg-muted/30 rounded border border-border space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground font-medium">CLIENT PROFILE</p>
                <div className="flex items-center gap-2">
                  <Badge variant={(selectedClient?.insurer || "Private") === "Private" ? "outline" : "default"} className="text-[10px]">
                    {selectedClient?.insurer || "Private"}
                  </Badge>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 text-xs gap-1"
                    onClick={() => {
                      if (selectedClient) {
                        handleOpenViewResponses(selectedClient);
                      }
                    }}
                  >
                    <Eye className="h-3 w-3" /> View Form
                  </Button>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {(selectedClient?.presentingIssues || []).map(i => <Badge key={i} variant="secondary">{i}</Badge>)}
              </div>
              {selectedClient?.notes && (
                <p className="text-sm italic">"{selectedClient.notes}"</p>
              )}
              {selectedClient?.referralSource && (
                <p className="text-xs text-muted-foreground">Referral: {selectedClient.referralSource}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="allocation-reason" className="text-xs font-medium text-muted-foreground">ALLOCATION REASON (Optional)</Label>
              <textarea
                id="allocation-reason"
                data-testid="input-allocation-reason"
                className="w-full min-h-[60px] px-3 py-2 text-sm rounded-md border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                placeholder="Explain why this clinician was selected for this client..."
                value={allocationReason}
                onChange={(e) => setAllocationReason(e.target.value)}
              />
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
                  <Label htmlFor="override-mode-allocate" className="text-xs text-muted-foreground cursor-pointer">Admin Override</Label>
                  <Switch id="override-mode-allocate" checked={showAllClinicians} onCheckedChange={setShowAllClinicians} />
                </div>
              </div>
              
              {selectedClient && getCliniciansForAllocation(selectedClient).length === 0 && (
                <div className="text-center py-8 text-muted-foreground border rounded-md bg-slate-50">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
                  <p>No matching clinicians found.</p>
                  <p className="text-xs mt-1">Try enabling "Admin Override" to see all schedules.</p>
                </div>
              )}

              {selectedClient && getCliniciansForAllocation(selectedClient).map(clinician => {
                const isMatch = isClinicianMatch(clinician, selectedClient);
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
                                    ins === (selectedClient?.insurer || "Private") 
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
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {/* New client capacity indicator */}
                        <div className={`flex items-center text-[10px] px-2 py-0.5 rounded ${
                          (clinician.maxNewClients ?? 0) === 0 
                            ? "text-red-600 bg-red-50" 
                            : "text-muted-foreground bg-muted/50"
                        }`} title="New Client Capacity">
                          <Users className="h-3 w-3 mr-1" />
                          {(clinician.maxNewClients ?? 0) === 0 ? "No capacity" : `${clinician.maxNewClients} available`}
                        </div>
                        
                        {/* Bupa allocation indicator */}
                        {clinician.allocateForBupa && (
                          <div className="flex items-center text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded" title="Allocate for Bupa">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Bupa
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
                      {getActiveSlots(clinician.availability).map(slot => {
                        const isPending = isSlotPending(slot);
                        const pendingDate = getSlotPendingDate(slot);
                        const availMatch = doesSlotMatchClientAvailability(slot, clientAvailabilityForAllocation);
                        const slotIsMatch = availMatch === true && !slot.isBooked;
                        const noMatch = availMatch === false;
                        
                        return (
                          <Button 
                            key={slot.id}
                            variant={slot.isBooked ? "ghost" : "outline"}
                            disabled={!showAllClinicians && (slot.isBooked || (clinician.maxNewClients ?? 0) === 0)}
                            className={`justify-start h-auto py-2 px-3 text-xs relative ${
                              !showAllClinicians && (slot.isBooked || (clinician.maxNewClients ?? 0) === 0)
                                ? "opacity-50 cursor-not-allowed" 
                                : isPending
                                  ? "bg-amber-50 border-amber-300 hover:border-amber-400 hover:bg-amber-100"
                                  : slotIsMatch 
                                    ? "border-emerald-400 bg-emerald-50 hover:border-emerald-500 hover:bg-emerald-100 ring-1 ring-emerald-200" 
                                    : noMatch 
                                      ? "opacity-60 border-slate-200" 
                                      : "hover:border-primary hover:bg-primary/5"
                            }`}
                            onClick={() => { handleAssign(clinician.id, slot.id, isManualAllocation ? "manual" : "form"); setIsAllocateDialogOpen(false); setIsManualAllocation(false); }}
                          >
                            {slotIsMatch && !isPending && <span className="absolute -top-1 -right-1 bg-emerald-500 text-white text-[8px] px-1 rounded">Match</span>}
                            {isPending && <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[8px] px-1 rounded">Pending</span>}
                            <CalendarCheck className={`h-3 w-3 mr-2 ${slotIsMatch && !isPending ? "text-emerald-600" : isPending ? "text-amber-600" : ""}`} />
                            <div className="text-left">
                              <div className={`font-medium ${slotIsMatch && !isPending ? "text-emerald-700" : isPending ? "text-amber-700" : ""}`}>{slot.day || format(parseISO(slot.date!), "EEE")}</div>
                              <div className={`text-[10px] ${slotIsMatch && !isPending ? "text-emerald-600" : isPending ? "text-amber-600" : "text-muted-foreground"}`}>
                                {slot.startTime} - {slot.endTime}
                                {slot.type === "Recurring" && (
                                  <span className={`ml-1 font-bold ${isPending ? "text-amber-700" : slotIsMatch ? "text-emerald-700" : "text-muted-foreground"}`}>
                                    {(slot as any).frequency === "fortnightly" ? "F" : "W"}
                                  </span>
                                )}
                              </div>
                              {isPending && pendingDate && (
                                <div className="text-[9px] text-amber-600">Available from {pendingDate}</div>
                              )}
                            </div>
                          </Button>
                        );
                      })}
                      {getActiveSlots(clinician.availability).length === 0 && (
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
        </DialogContent>
      </Dialog>

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
                  onValueChange={v => {
                    if (v === "__add_new__") {
                      setAddInsurerTarget("edit");
                      setNewInsurerName("");
                      setShowAddInsurerDialog(true);
                    } else {
                      setEditClientData({...editClientData, insurer: v});
                    }
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Private">Private / Self-Pay</SelectItem>
                    {insurerList.map(ins => (
                      <SelectItem key={ins} value={ins}>{ins}</SelectItem>
                    ))}
                    {isAdmin && <SelectItem value="__add_new__" className="text-blue-600 font-medium">+ Add new insurer...</SelectItem>}
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
                    <SelectItem value="New">Pending Intake</SelectItem>
                    <SelectItem value="Forms Sent">Screen Booked/Sent</SelectItem>
                    <SelectItem value="Forms Completed">Forms Completed</SelectItem>
                    <SelectItem value="Assigned">Allocated</SelectItem>
                    <SelectItem value="AwaitingConfirmation">Awaiting Confirmation</SelectItem>
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
                    <SelectItem value="New">Pending Intake</SelectItem>
                    <SelectItem value="Forms Sent">Screen Booked/Sent</SelectItem>
                    <SelectItem value="Forms Completed">Forms Completed</SelectItem>
                    <SelectItem value="Assigned">Allocated</SelectItem>
                    <SelectItem value="AwaitingConfirmation">Awaiting Confirmation</SelectItem>
                    <SelectItem value="Scheduled">Confirmed</SelectItem>
                    <SelectItem value="Waitlist">Waitlist</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Changing to Pending Intake, Screen Booked/Sent, Forms Completed, or Waitlist will release the current time slot.
                </p>
              </div>

              {(editStatusData.status === "Assigned" || editStatusData.status === "AwaitingConfirmation" || editStatusData.status === "Scheduled") && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Reassign to Different Slot (optional)</Label>
                  </div>

                  {clinicians.map(clinician => {
                    const allSlots = getActiveSlots(clinician.availability).filter(s => !s.isBooked);
                    if (allSlots.length === 0) return null;
                    
                    return (
                      <div key={clinician.id} className="p-4 border rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-medium">{clinician.name.split(",")[0]}</span>
                          <span className="text-xs text-muted-foreground">
                            {getSlotCounts(clinician.availability).available} available, {getSlotCounts(clinician.availability).pending} pending
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {allSlots.map(slot => {
                            const isPending = isSlotPending(slot);
                            const pendingDate = getSlotPendingDate(slot);
                            const isSelected = editStatusData.slotId === slot.id && editStatusData.clinicianId === clinician.id;
                            
                            return (
                              <Button
                                key={slot.id}
                                variant={isSelected ? "default" : "outline"}
                                size="sm"
                                className={`justify-start h-auto py-2 px-3 text-xs relative ${
                                  isPending && !isSelected ? "bg-amber-50 border-amber-300 hover:border-amber-400 hover:bg-amber-100" : ""
                                }`}
                                onClick={() => setEditStatusData({
                                  ...editStatusData,
                                  clinicianId: clinician.id,
                                  slotId: slot.id
                                })}
                              >
                                {isPending && <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[8px] px-1 rounded">Pending</span>}
                                <CalendarCheck className={`h-3 w-3 mr-2 ${isPending && !isSelected ? "text-amber-600" : ""}`} />
                                <div className="text-left">
                                  <div className={`font-medium ${isPending && !isSelected ? "text-amber-700" : ""}`}>{slot.day || (slot.date && format(parseISO(slot.date), "EEE"))}</div>
                                  <div className={`text-[10px] ${isPending && !isSelected ? "text-amber-600" : "text-muted-foreground"}`}>
                                    {slot.startTime} - {slot.endTime}
                                    {slot.type === "Recurring" && (
                                      <span className={`ml-1 font-bold ${isPending && !isSelected ? "text-amber-700" : "text-muted-foreground"}`}>
                                        {(slot as any).frequency === "fortnightly" ? "F" : "W"}
                                      </span>
                                    )}
                                  </div>
                                  {isPending && pendingDate && (
                                    <div className="text-[9px] text-amber-600">Available from {pendingDate}</div>
                                  )}
                                </div>
                              </Button>
                            );
                          })}
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
                        {getActiveSlots(clinician.availability).map(slot => (
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
                        {getActiveSlots(clinician.availability).length === 0 && (
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
        <DialogContent className="sm:max-w-[475px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Archive/Didn't Engage
            </DialogTitle>
            <DialogDescription>
              Archive client <strong>{clientToArchive?.displayId}</strong> and record the reason.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm font-medium text-amber-800 mb-2">This client will be moved to Archive/Didn't Engage</p>
              <p className="text-sm text-muted-foreground">
                They can be restored later from the archived list.
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Category</Label>
              {!isAddingCategory ? (
                <>
                  <Select value={archiveCategory} onValueChange={(val) => { if (val === "__add_new__") { setIsAddingCategory(true); } else { setArchiveCategory(val); } }}>
                    <SelectTrigger data-testid="select-archive-category">
                      <SelectValue placeholder="Select a category (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No category</SelectItem>
                      {nonEngagementCategories.map(cat => (
                        <SelectItem key={cat.id} value={cat.name}>{cat.name}</SelectItem>
                      ))}
                      <SelectItem value="__add_new__" className="text-primary font-medium">+ Add new category</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder="New category name"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && newCategoryName.trim()) addCategoryMutation.mutate(newCategoryName.trim()); if (e.key === "Escape") { setIsAddingCategory(false); setNewCategoryName(""); } }}
                    autoFocus
                    data-testid="input-new-archive-category"
                  />
                  <Button
                    size="sm"
                    onClick={() => newCategoryName.trim() && addCategoryMutation.mutate(newCategoryName.trim())}
                    disabled={!newCategoryName.trim() || addCategoryMutation.isPending}
                    data-testid="btn-save-new-category"
                  >
                    Add
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setIsAddingCategory(false); setNewCategoryName(""); }}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="archive-reason">Reason / Notes</Label>
              <Textarea
                id="archive-reason"
                placeholder="Why didn't this client engage? (optional)"
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
                rows={3}
                data-testid="input-archive-reason"
              />
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
              {archiveClientMutation.isPending ? "Archiving..." : "Yes, Archive/Didn't Engage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permanent Delete Confirmation Dialog */}
      <Dialog open={isPermanentDeleteOpen} onOpenChange={(open) => { setIsPermanentDeleteOpen(open); if (!open) { setDeletePassword(""); setDeleteError(""); } }}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Permanently Delete Client
            </DialogTitle>
            <DialogDescription>
              You are about to permanently delete client <strong>{clientToDelete?.displayId}</strong>.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm font-semibold text-red-800 mb-2">This action is irreversible</p>
              <p className="text-sm text-red-700">
                This will permanently remove the client record, including all form submissions and associated data. This cannot be undone.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="delete-password">Enter your password to confirm</Label>
              <Input
                id="delete-password"
                type="password"
                placeholder="Your password"
                value={deletePassword}
                onChange={(e) => { setDeletePassword(e.target.value); setDeleteError(""); }}
                data-testid="input-delete-password"
              />
              {deleteError && (
                <p className="text-sm text-destructive" data-testid="text-delete-error">{deleteError}</p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsPermanentDeleteOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleConfirmPermanentDelete}
              disabled={!deletePassword || permanentDeleteMutation.isPending}
              data-testid="btn-confirm-permanent-delete"
            >
              {permanentDeleteMutation.isPending ? "Deleting..." : "Permanently Delete"}
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
                        
                        let displayValue: React.ReactNode = value;
                        if (Array.isArray(value)) {
                          displayValue = value.join(', ');
                        } else if (typeof value === 'boolean') {
                          displayValue = value ? 'Yes' : 'No';
                        } else if (typeof value === 'object' && value !== null) {
                          // Handle availability picker or other object values
                          const entries = Object.entries(value as Record<string, string[]>);
                          if (entries.length > 0 && Array.isArray(entries[0][1])) {
                            // This is an availability picker value
                            displayValue = (
                              <div className="space-y-1">
                                {entries.filter(([_, times]) => times.length > 0).map(([day, times]) => (
                                  <div key={day} className="text-xs">
                                    <span className="font-medium">{day}:</span>{' '}
                                    {(times as string[]).sort().join(', ')}
                                  </div>
                                ))}
                                {entries.filter(([_, times]) => times.length > 0).length === 0 && (
                                  <span className="text-muted-foreground">No times selected</span>
                                )}
                              </div>
                            );
                          } else {
                            // Generic object - stringify it
                            displayValue = JSON.stringify(value);
                          }
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

      {/* ===== PAYMENT LINK DIALOG ===== */}
      <Dialog open={isPaymentLinkOpen} onOpenChange={setIsPaymentLinkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" /> Generate Payment Link
            </DialogTitle>
            <DialogDescription>
              Set an agreed rate and create a Stripe Checkout link for {paymentLinkClient?.displayId}. The client pays the first session and their card is saved for future charges.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Agreed Session Rate (£)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">£</span>
                <input
                  data-testid="input-agreed-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 150.00"
                  value={agreedRatePounds}
                  onChange={e => setAgreedRatePounds(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-8 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            {generatedPaymentUrl ? (
              <div className="space-y-2">
                <label className="text-sm font-medium text-green-700 flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" /> Payment link ready
                </label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={generatedPaymentUrl}
                    className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1 text-xs font-mono"
                    onClick={e => (e.target as HTMLInputElement).select()}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(generatedPaymentUrl);
                      toast({ title: "Copied", description: "Payment link copied to clipboard." });
                    }}
                  >
                    Copy
                  </Button>
                </div>
                <a
                  href={generatedPaymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> Preview checkout page
                </a>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPaymentLinkOpen(false)}>Close</Button>
            <Button
              data-testid="button-generate-payment-link"
              onClick={handleGeneratePaymentLink}
              disabled={isGeneratingLink || !agreedRatePounds || parseFloat(agreedRatePounds) <= 0}
            >
              {isGeneratingLink ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CreditCard className="h-4 w-4 mr-2" />}
              {generatedPaymentUrl ? "Regenerate Link" : "Generate Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== CHARGE SESSION DIALOG ===== */}
      <Dialog open={isChargeOpen} onOpenChange={setIsChargeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" /> Charge Session
            </DialogTitle>
            <DialogDescription>
              Charge {chargeClient?.displayId}'s saved card for a session.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Amount (£)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">£</span>
                <input
                  data-testid="input-charge-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 150.00"
                  value={chargeAmountPounds}
                  onChange={e => setChargeAmountPounds(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-8 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes <span className="text-muted-foreground font-normal">(optional)</span></label>
              <textarea
                data-testid="input-charge-notes"
                placeholder="e.g. Session 4 – 14 Jan"
                value={chargeNotes}
                onChange={e => setChargeNotes(e.target.value)}
                rows={2}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>
            <div className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              This will immediately charge the client's saved card. Make sure the amount is correct before proceeding.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsChargeOpen(false)}>Cancel</Button>
            <Button
              data-testid="button-confirm-charge"
              onClick={() => {
                if (!chargeClient) return;
                const amountPence = Math.round(parseFloat(chargeAmountPounds) * 100);
                chargeMutation.mutate({ clientId: chargeClient.id, amountPence, notes: chargeNotes });
              }}
              disabled={chargeMutation.isPending || !chargeAmountPounds || parseFloat(chargeAmountPounds) <= 0}
            >
              {chargeMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CreditCard className="h-4 w-4 mr-2" />}
              Charge £{chargeAmountPounds || "0"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== PAYMENT HISTORY DIALOG ===== */}
      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" /> Payment History
            </DialogTitle>
            <DialogDescription>
              All session charges for {historyClient?.displayId}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {loadingCharges ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : charges.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-6">No payment charges recorded yet.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {charges.map((charge: any) => (
                  <div key={charge.id} className="flex items-start justify-between p-3 bg-muted/40 rounded-lg">
                    <div>
                      <p className="text-sm font-medium">£{(charge.amountPence / 100).toFixed(2)}</p>
                      {charge.notes && <p className="text-xs text-muted-foreground mt-0.5">{charge.notes}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(charge.chargedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                      charge.status === "succeeded" ? "bg-green-100 text-green-700" :
                      charge.status === "failed" ? "bg-red-100 text-red-700" :
                      "bg-amber-100 text-amber-700"
                    }`}>
                      {charge.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsHistoryOpen(false)}>Close</Button>
            {historyClient && historyClient.paymentStatus === "active" && (
              <Button onClick={() => { setIsHistoryOpen(false); handleOpenCharge(historyClient); }}>
                <CreditCard className="h-4 w-4 mr-2" /> Charge New Session
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add New Insurer Dialog */}
      <Dialog open={showAddInsurerDialog} onOpenChange={setShowAddInsurerDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add New Insurer</DialogTitle>
            <DialogDescription>Enter the name of the insurer to add it to the list for all future referrals.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <Label>Insurer Name</Label>
            <Input
              data-testid="input-new-insurer-name"
              placeholder="e.g. AXA PPP, Allianz..."
              value={newInsurerName}
              onChange={e => setNewInsurerName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && newInsurerName.trim()) {
                  e.preventDefault();
                  addInsurerMutation.mutate(newInsurerName.trim(), {
                    onSuccess: () => {
                      const name = newInsurerName.trim();
                      if (addInsurerTarget === "new") {
                        setNewClientData(d => ({ ...d, insurer: name }));
                      } else {
                        setEditClientData(d => ({ ...d, insurer: name }));
                      }
                      setShowAddInsurerDialog(false);
                      setNewInsurerName("");
                      toast({ title: "Insurer added", description: `"${name}" is now available in the insurer list.` });
                    },
                  });
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddInsurerDialog(false)}>Cancel</Button>
            <Button
              data-testid="button-confirm-add-insurer"
              disabled={!newInsurerName.trim() || addInsurerMutation.isPending}
              onClick={() => {
                addInsurerMutation.mutate(newInsurerName.trim(), {
                  onSuccess: () => {
                    const name = newInsurerName.trim();
                    if (addInsurerTarget === "new") {
                      setNewClientData(d => ({ ...d, insurer: name }));
                    } else {
                      setEditClientData(d => ({ ...d, insurer: name }));
                    }
                    setShowAddInsurerDialog(false);
                    setNewInsurerName("");
                    toast({ title: "Insurer added", description: `"${name}" is now available in the insurer list.` });
                  },
                });
              }}
            >
              {addInsurerMutation.isPending ? "Adding..." : "Add Insurer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
