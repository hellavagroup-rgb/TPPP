import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarClock, MoreHorizontal, Edit, CalendarCheck, Eye, Clock } from "lucide-react";
import { formatDateUK } from "@/lib/dateUtils";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Client as ClientType } from "@shared/schema";

export default function Waitlist() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: clients = [] } = useQuery<ClientType[]>({
    queryKey: ["/api/clients"],
  });

  const waitlistClients = clients.filter(c => c.status === "Waitlist" && !c.isArchived);

  const [isEditStatusOpen, setIsEditStatusOpen] = useState(false);
  const [editStatusClient, setEditStatusClient] = useState<ClientType | null>(null);
  const [editStatusValue, setEditStatusValue] = useState("");

  const [isEditClientOpen, setIsEditClientOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientType | null>(null);
  const [editClientData, setEditClientData] = useState({
    email: "",
    phone: "",
    notes: "",
    insurer: "",
  });

  const handleOpenEditStatus = (client: ClientType) => {
    setEditStatusClient(client);
    setEditStatusValue(client.status);
    setIsEditStatusOpen(true);
  };

  const handleOpenEditClient = (client: ClientType) => {
    setEditingClient(client);
    setEditClientData({
      email: client.email || "",
      phone: client.phone || "",
      notes: client.notes || "",
      insurer: client.insurer || "",
    });
    setIsEditClientOpen(true);
  };

  const updateStatusMutation = useMutation({
    mutationFn: async ({ clientId, status }: { clientId: string; status: string }) => {
      const response = await apiRequest("PATCH", `/api/clients/${clientId}`, { status });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Status Updated", description: "Client status has been changed." });
      setIsEditStatusOpen(false);
      setEditStatusClient(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update status.", variant: "destructive" });
    },
  });

  const updateClientMutation = useMutation({
    mutationFn: async ({ clientId, data }: { clientId: string; data: Record<string, string> }) => {
      const response = await apiRequest("PATCH", `/api/clients/${clientId}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client Updated", description: "Client details have been saved." });
      setIsEditClientOpen(false);
      setEditingClient(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update client.", variant: "destructive" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const response = await apiRequest("POST", `/api/clients/${clientId}/archive`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client Archived", description: "This client has been moved to Archive/Didn't Engage." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to archive client.", variant: "destructive" });
    },
  });

  const getStatusLabel = (status: string) => {
    if (status === "Assigned") return "Allocated";
    if (status === "Scheduled") return "Confirmed";
    return status;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-serif font-bold text-foreground" data-testid="text-waitlist-title">Waitlist</h2>
        <p className="text-muted-foreground mt-1">Clients waiting for availability or specific clinician matches.</p>
      </div>

      <Card className="border-none shadow-sm bg-amber-50/50 dark:bg-amber-950/10">
        <CardContent className="p-4 flex items-center gap-4 text-amber-800 dark:text-amber-200">
          <CalendarClock className="h-5 w-5" />
          <p className="text-sm">
            <strong>{waitlistClients.length}</strong> client{waitlistClients.length !== 1 ? "s" : ""} currently on the waitlist.
            Use the menu on each client to edit their status or allocate them when availability opens up.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {waitlistClients.map(client => (
          <Card key={client.id} className="border-none shadow-sm hover:shadow-md transition-all" data-testid={`card-waitlist-${client.id}`}>
            <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-lg" data-testid={`text-client-id-${client.id}`}>{client.displayId}</h3>
                  <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">
                    Waitlist
                  </Badge>
                  {client.insurer && client.insurer !== "Private" && (
                    <Badge variant="outline" className="text-xs">{client.insurer}</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  <Clock className="h-3 w-3 inline mr-1" />
                  Waiting since: <span className="font-medium text-foreground">{formatDateUK(client.intakeDate)}</span>
                </p>
                {client.notes && (
                  <p className="text-sm mt-2 italic text-muted-foreground/80" data-testid={`notes-${client.id}`}>
                    "{client.notes}"
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" data-testid={`btn-menu-${client.id}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleOpenEditClient(client)} data-testid={`btn-edit-details-${client.id}`}>
                      <Edit className="h-4 w-4 mr-2" /> Edit Details
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleOpenEditStatus(client)} data-testid={`btn-edit-status-${client.id}`}>
                      <CalendarCheck className="h-4 w-4 mr-2" /> Edit Status
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={() => archiveMutation.mutate(client.id)} data-testid={`btn-archive-${client.id}`}>
                      Archive/Didn't Engage
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
          </Card>
        ))}

        {waitlistClients.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">The waitlist is currently empty.</p>
          </div>
        )}
      </div>

      <Dialog open={isEditStatusOpen} onOpenChange={setIsEditStatusOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Edit Status - {editStatusClient?.displayId}</DialogTitle>
            <DialogDescription>Change the workflow status for this client.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>Status</Label>
            <Select value={editStatusValue} onValueChange={setEditStatusValue}>
              <SelectTrigger data-testid="select-edit-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="New">Pending Intake</SelectItem>
                <SelectItem value="Forms Sent">Screen Booked/Sent</SelectItem>
                <SelectItem value="Forms Completed">Forms Completed</SelectItem>
                <SelectItem value="Waitlist">Waitlist</SelectItem>
                <SelectItem value="Assigned">Allocated</SelectItem>
                <SelectItem value="Awaiting Confirmation">Awaiting Confirmation</SelectItem>
                <SelectItem value="Scheduled">Confirmed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditStatusOpen(false)}>Cancel</Button>
            <Button
              onClick={() => editStatusClient && updateStatusMutation.mutate({ clientId: editStatusClient.id, status: editStatusValue })}
              disabled={updateStatusMutation.isPending}
              data-testid="btn-save-status"
            >
              {updateStatusMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditClientOpen} onOpenChange={setIsEditClientOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Edit Details - {editingClient?.displayId}</DialogTitle>
            <DialogDescription>Update client contact information and notes.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" value={editClientData.email} onChange={(e) => setEditClientData(d => ({ ...d, email: e.target.value }))} data-testid="input-edit-email" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input id="edit-phone" value={editClientData.phone} onChange={(e) => setEditClientData(d => ({ ...d, phone: e.target.value }))} data-testid="input-edit-phone" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-insurer">Insurer</Label>
              <Input id="edit-insurer" value={editClientData.insurer} onChange={(e) => setEditClientData(d => ({ ...d, insurer: e.target.value }))} data-testid="input-edit-insurer" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea id="edit-notes" value={editClientData.notes} onChange={(e) => setEditClientData(d => ({ ...d, notes: e.target.value }))} data-testid="input-edit-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditClientOpen(false)}>Cancel</Button>
            <Button
              onClick={() => editingClient && updateClientMutation.mutate({ clientId: editingClient.id, data: editClientData })}
              disabled={updateClientMutation.isPending}
              data-testid="btn-save-details"
            >
              {updateClientMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
