import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { MapPin, Building, Users, Shield, Edit, Briefcase, Lock, Mail, MessageSquare, Phone, Trash2, UserX, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Clinician } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

const INSURERS = ["Aviva", "Axa", "Bupa", "Cigna", "Vitality", "WPA", "Other"];
const CONTACT_METHODS = ["Email", "Text", "WhatsApp"];

type ClinicianWithName = Clinician & { name: string; email?: string | null };

export default function Clinicians() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [selectedClinician, setSelectedClinician] = useState<ClinicianWithName | null>(null);
  const [editedClinician, setEditedClinician] = useState<Partial<ClinicianWithName & { email?: string }>>({});
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [clinicianToDelete, setClinicianToDelete] = useState<ClinicianWithName | null>(null);
  const [newClinician, setNewClinician] = useState({
    name: "",
    email: "",
    tier: "Mid" as "High" | "Mid" | "Low",
    bio: "",
    location: "",
    nhsTrust: "",
    capacity: 15,
    maxNewClients: 3,
    worksWithCouples: false,
    allocateForBupa: false,
    insurers: [] as string[],
    contactMethods: [] as string[],
  });

  const { data: clinicians = [] } = useQuery<ClinicianWithName[]>({
    queryKey: ["/api/clinicians"],
  });

  const updateClinicianMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Clinician> & { email?: string } }) => {
      const response = await apiRequest("PATCH", `/api/clinicians/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinicians"] });
      toast({ title: "Clinician Updated", description: "Changes saved successfully." });
      setIsEditOpen(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update clinician.", variant: "destructive" });
    },
  });

  const deleteClinicianMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/clinicians/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinicians"] });
      toast({ title: "Clinician Deleted", description: "The clinician has been permanently removed." });
      setDeleteConfirmOpen(false);
      setClinicianToDelete(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete clinician.", variant: "destructive" });
    },
  });

  const createClinicianMutation = useMutation({
    mutationFn: async (data: typeof newClinician) => {
      const response = await apiRequest("POST", "/api/clinicians/with-user", data);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create clinician");
      }
      return response.json();
    },
    onSuccess: (data: { clinician: Clinician; emailSent: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinicians"] });
      const emailMessage = data.emailSent 
        ? "Login credentials have been sent to their email." 
        : "Account created but email could not be sent.";
      toast({ title: "Clinician Added", description: emailMessage });
      setIsAddOpen(false);
      setNewClinician({
        name: "", email: "", tier: "Mid", bio: "", location: "", nhsTrust: "",
        capacity: 15, maxNewClients: 3, worksWithCouples: false, allocateForBupa: false, insurers: [], contactMethods: [],
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleEditClick = (clinician: ClinicianWithName) => {
    setSelectedClinician(clinician);
    setEditedClinician({
      name: clinician.name,
      tier: clinician.tier || "Mid",
      bio: clinician.bio || "",
      location: clinician.location || "",
      nhsTrust: clinician.nhsTrust || "",
      maxNewClients: clinician.maxNewClients ?? 0,
      worksWithCouples: clinician.worksWithCouples || false,
      insurers: clinician.insurers || [],
      contactMethods: clinician.contactMethods || [],
      isActive: clinician.isActive !== false,
      email: clinician.email || "",
    });
    setIsEditOpen(true);
  };

  const handleDeleteClick = (clinician: ClinicianWithName) => {
    setClinicianToDelete(clinician);
    setDeleteConfirmOpen(true);
  };

  const handleToggleActive = (clinician: ClinicianWithName) => {
    updateClinicianMutation.mutate({
      id: clinician.id,
      updates: { isActive: !clinician.isActive }
    });
  };

  const handleSave = () => {
    if (!selectedClinician) return;
    
    const updates: Record<string, unknown> = {};
    if (editedClinician.name !== undefined) updates.name = editedClinician.name;
    if (editedClinician.tier !== undefined) updates.tier = editedClinician.tier;
    if (editedClinician.bio !== undefined) updates.bio = editedClinician.bio;
    if (editedClinician.location !== undefined) updates.location = editedClinician.location;
    if (editedClinician.nhsTrust !== undefined) updates.nhsTrust = editedClinician.nhsTrust;
    if (editedClinician.maxNewClients !== undefined) updates.maxNewClients = editedClinician.maxNewClients;
    if (editedClinician.worksWithCouples !== undefined) updates.worksWithCouples = editedClinician.worksWithCouples;
    if (editedClinician.allocateForBupa !== undefined) updates.allocateForBupa = editedClinician.allocateForBupa;
    if (editedClinician.insurers !== undefined) updates.insurers = editedClinician.insurers;
    if (editedClinician.contactMethods !== undefined) updates.contactMethods = editedClinician.contactMethods;
    if (editedClinician.isActive !== undefined) updates.isActive = editedClinician.isActive;
    if (editedClinician.email !== undefined) updates.email = editedClinician.email;
    
    updateClinicianMutation.mutate({
      id: selectedClinician.id,
      updates: updates as Partial<Clinician> & { email?: string }
    });
  };

  const handleConfirmDelete = () => {
    if (clinicianToDelete) {
      deleteClinicianMutation.mutate(clinicianToDelete.id);
    }
  };

  const handleGenerateCredentials = (clinicianName: string) => {
    const email = `${clinicianName.split(' ')[1]?.toLowerCase() || 'user'}@perinatalpsych.com`;
    toast({ title: "Credentials Generated", description: `Login details sent to ${email}` });
  };

  const activeClinicians = clinicians.filter(c => c.isActive !== false);
  const inactiveClinicians = clinicians.filter(c => c.isActive === false);

  const handleAddClinician = () => {
    if (!newClinician.name || !newClinician.email) {
      toast({ title: "Missing fields", description: "Please provide name and email.", variant: "destructive" });
      return;
    }
    createClinicianMutation.mutate(newClinician);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-slate-900">Clinician Directory</h1>
          <p className="text-muted-foreground mt-1">Manage clinician profiles, insurance panels, and practice tiers.</p>
        </div>
        <Button onClick={() => setIsAddOpen(true)} data-testid="button-add-clinician">
          <Plus className="h-4 w-4 mr-2" />
          Add Clinician
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {activeClinicians.map((clinician) => (
          <Card key={clinician.id} className="overflow-hidden border-none shadow-sm hover:shadow-md transition-all group h-full flex flex-col" data-testid={`card-clinician-${clinician.id}`}>
            <CardHeader className="relative pb-0 pt-6 px-6">
              <div className="flex items-start justify-between">
                <div className="flex gap-4">
                  <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center text-lg font-bold text-slate-600 ring-2 ring-white shadow-sm">
                    {clinician.avatar}
                  </div>
                  <div>
                    <CardTitle className="text-lg font-serif">{clinician.name}</CardTitle>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-[10px] font-normal border-slate-200">
                        {clinician.tier || "Mid"}
                      </Badge>
                      {clinician.worksWithCouples && (
                        <Badge variant="secondary" className="text-[10px] font-normal bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
                          Couples
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-900" onClick={() => handleEditClick(clinician)} data-testid={`button-edit-${clinician.id}`}>
                    <Edit className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            
            <CardContent className="p-6 space-y-4 flex-grow">
              {clinician.bio && (
                <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
                  {clinician.bio}
                </p>
              )}
              
              <div className="space-y-3 pt-2">
                <div className="flex items-start gap-3 text-sm">
                  <MapPin className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium block text-slate-700">Location</span>
                    <span className="text-slate-500">{clinician.location || "Not specified"}</span>
                  </div>
                </div>
                
                <div className="flex items-start gap-3 text-sm">
                  <Building className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium block text-slate-700">NHS Trust</span>
                    <span className="text-slate-500">{clinician.nhsTrust || "Not specified"}</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-sm">
                  <Shield className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium block text-slate-700">Insurers</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {clinician.insurers?.map(insurer => (
                        <span key={insurer} className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-100">
                          {insurer}
                        </span>
                      ))}
                      {(!clinician.insurers || clinician.insurers.length === 0) && (
                        <span className="text-slate-400 italic">None listed</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-sm">
                  <MessageSquare className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium block text-slate-700">Contact Methods</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {clinician.contactMethods?.map(method => (
                        <span key={method} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100 flex items-center gap-1">
                          {method === 'Email' && <Mail className="h-2.5 w-2.5" />}
                          {method === 'Text' && <Phone className="h-2.5 w-2.5" />}
                          {method === 'WhatsApp' && <MessageSquare className="h-2.5 w-2.5" />}
                          {method}
                        </span>
                      ))}
                      {(!clinician.contactMethods || clinician.contactMethods.length === 0) && (
                        <span className="text-slate-400 italic">Not specified</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>

            <CardFooter className="bg-slate-50/50 p-4 border-t border-slate-100 text-xs text-muted-foreground flex flex-col gap-3">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-1.5" title="Max New Clients">
                  <Users className="h-3.5 w-3.5" />
                  <span>Cap: {clinician.maxNewClients || 0} New</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5" />
                  <span>Load: {clinician.currentLoad}/{clinician.capacity}</span>
                </div>
              </div>
              <div className="flex gap-2 w-full">
                <Button variant="outline" size="sm" className="flex-1 text-xs h-7" onClick={() => handleGenerateCredentials(clinician.name)} data-testid={`button-credentials-${clinician.id}`}>
                  <Lock className="h-3 w-3 mr-2" />
                  Generate Login
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-amber-600 hover:text-amber-700 hover:bg-amber-50" onClick={() => handleToggleActive(clinician)} data-testid={`button-deactivate-${clinician.id}`}>
                  <UserX className="h-3 w-3" />
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteClick(clinician)} data-testid={`button-delete-${clinician.id}`}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </CardFooter>
          </Card>
        ))}
      </div>

      {inactiveClinicians.length > 0 && (
        <>
          <div className="border-t pt-6">
            <h2 className="text-xl font-serif font-semibold text-slate-700 mb-4">Inactive Clinicians</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {inactiveClinicians.map((clinician) => (
                <Card key={clinician.id} className="overflow-hidden border-none shadow-sm opacity-60 hover:opacity-100 transition-opacity" data-testid={`card-inactive-clinician-${clinician.id}`}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-slate-200 flex items-center justify-center text-sm font-bold text-slate-500">
                        {clinician.avatar}
                      </div>
                      <div>
                        <p className="font-medium text-slate-600">{clinician.name}</p>
                        <Badge variant="outline" className="text-[10px] mt-1 border-amber-200 bg-amber-50 text-amber-700">
                          Inactive
                        </Badge>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="h-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" onClick={() => handleToggleActive(clinician)} data-testid={`button-activate-${clinician.id}`}>
                        Reactivate
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteClick(clinician)} data-testid={`button-delete-inactive-${clinician.id}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Clinician Profile</DialogTitle>
            <DialogDescription>Update professional details, capacity, and preferences.</DialogDescription>
          </DialogHeader>
          
          {selectedClinician && (
            <div className="grid gap-6 py-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Full Name</Label>
                  <Input 
                    value={editedClinician.name || selectedClinician.name} 
                    onChange={(e) => setEditedClinician({...editedClinician, name: e.target.value})}
                    placeholder="e.g. Dr Smith, Jane"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email Address</Label>
                  <Input 
                    type="email"
                    value={editedClinician.email || ""}
                    onChange={(e) => setEditedClinician({...editedClinician, email: e.target.value})}
                    placeholder="clinician@example.com"
                  />
                  <p className="text-[10px] text-muted-foreground">Used for login and reminders</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Tier</Label>
                <Select value={editedClinician.tier || "Mid"} onValueChange={(v) => setEditedClinician({...editedClinician, tier: v as any})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Mid">Mid</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Bio</Label>
                <Textarea 
                  className="min-h-[100px]" 
                  value={editedClinician.bio || ""} 
                  onChange={(e) => setEditedClinician({...editedClinician, bio: e.target.value})}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Geographical Location</Label>
                  <Input 
                    value={editedClinician.location || ""} 
                    onChange={(e) => setEditedClinician({...editedClinician, location: e.target.value})}
                    placeholder="e.g. North London" 
                  />
                </div>
                <div className="space-y-2">
                  <Label>NHS Trust</Label>
                  <Input 
                    value={editedClinician.nhsTrust || ""} 
                    onChange={(e) => setEditedClinician({...editedClinician, nhsTrust: e.target.value})}
                    placeholder="e.g. Tavistock" 
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Insurers Accepted</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 border p-3 rounded-md bg-slate-50/50">
                  {INSURERS.map(insurer => (
                    <div key={insurer} className="flex items-center space-x-2">
                      <Checkbox 
                        id={`ins-${insurer}`} 
                        checked={editedClinician.insurers?.includes(insurer) || false}
                        onCheckedChange={(checked) => {
                          const current = editedClinician.insurers || [];
                          setEditedClinician({
                            ...editedClinician, 
                            insurers: checked ? [...current, insurer] : current.filter(i => i !== insurer)
                          });
                        }}
                      />
                      <Label htmlFor={`ins-${insurer}`} className="font-normal cursor-pointer">{insurer}</Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Preferred Contact Methods</Label>
                <div className="grid grid-cols-3 gap-2 border p-3 rounded-md bg-slate-50/50">
                  {CONTACT_METHODS.map(method => (
                    <div key={method} className="flex items-center space-x-2">
                      <Checkbox 
                        id={`contact-${method}`} 
                        checked={editedClinician.contactMethods?.includes(method) || false}
                        onCheckedChange={(checked) => {
                          const current = editedClinician.contactMethods || [];
                          setEditedClinician({
                            ...editedClinician, 
                            contactMethods: checked ? [...current, method] : current.filter(m => m !== method)
                          });
                        }}
                      />
                      <Label htmlFor={`contact-${method}`} className="font-normal cursor-pointer">{method}</Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2 border p-3 rounded-md">
                  <div className="flex items-center justify-between mb-2">
                    <Label>New Client Capacity</Label>
                    <span className="text-xs text-muted-foreground">Monthly Cap</span>
                  </div>
                  <Input 
                    type="number" 
                    value={editedClinician.maxNewClients ?? 0}
                    onChange={(e) => setEditedClinician({...editedClinician, maxNewClients: parseInt(e.target.value) || 0})}
                  />
                  <p className="text-[10px] text-muted-foreground pt-1">
                    Stop allocating after this many new clients.
                  </p>
                </div>
                <div className="space-y-3 border p-3 rounded-md flex flex-col justify-center">
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="couples" 
                      checked={editedClinician.worksWithCouples || false}
                      onCheckedChange={(checked) => setEditedClinician({...editedClinician, worksWithCouples: !!checked})}
                    />
                    <Label htmlFor="couples" className="font-medium cursor-pointer">Works with Couples</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="bupa" 
                      checked={editedClinician.allocateForBupa || false}
                      onCheckedChange={(checked) => setEditedClinician({...editedClinician, allocateForBupa: !!checked})}
                    />
                    <Label htmlFor="bupa" className="font-medium cursor-pointer">Allocate for Bupa</Label>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border p-3 rounded-md bg-amber-50/50">
                <div>
                  <Label className="font-medium">Clinician Status</Label>
                  <p className="text-xs text-muted-foreground">Inactive clinicians won't receive new client allocations.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{editedClinician.isActive !== false ? "Active" : "Inactive"}</span>
                  <Switch 
                    checked={editedClinician.isActive !== false} 
                    onCheckedChange={(checked) => setEditedClinician({...editedClinician, isActive: checked})}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Permanently Delete Clinician?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>You are about to permanently delete <strong>{clinicianToDelete?.name}</strong>.</p>
              <p className="font-semibold text-destructive">This action cannot be undone.</p>
              <p>All associated data including availability slots will be removed. Consider marking as inactive instead if you might need this data later.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmDelete}
              data-testid="button-confirm-delete"
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Clinician</DialogTitle>
            <DialogDescription>Create a new clinician profile. A login account will be created automatically.</DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-6 py-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Full Name *</Label>
                <Input 
                  value={newClinician.name}
                  onChange={(e) => setNewClinician({...newClinician, name: e.target.value})}
                  placeholder="Dr. Jane Smith"
                  data-testid="input-new-clinician-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Email Address *</Label>
                <Input 
                  type="email"
                  value={newClinician.email}
                  onChange={(e) => setNewClinician({...newClinician, email: e.target.value})}
                  placeholder="jane@perinatalpsych.com"
                  data-testid="input-new-clinician-email"
                />
                <p className="text-[10px] text-muted-foreground">Used for login and reminders</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tier</Label>
              <Select value={newClinician.tier} onValueChange={(v: "High" | "Mid" | "Low") => setNewClinician({...newClinician, tier: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Mid">Mid</SelectItem>
                  <SelectItem value="Low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Bio</Label>
              <Textarea 
                className="min-h-[100px]" 
                value={newClinician.bio}
                onChange={(e) => setNewClinician({...newClinician, bio: e.target.value})}
                placeholder="Professional background, specialties, and approach..."
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Location</Label>
                <Input 
                  value={newClinician.location}
                  onChange={(e) => setNewClinician({...newClinician, location: e.target.value})}
                  placeholder="e.g. North London"
                />
              </div>
              <div className="space-y-2">
                <Label>NHS Trust</Label>
                <Input 
                  value={newClinician.nhsTrust}
                  onChange={(e) => setNewClinician({...newClinician, nhsTrust: e.target.value})}
                  placeholder="e.g. Tavistock"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Insurers Accepted</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 border p-3 rounded-md bg-slate-50/50">
                {INSURERS.map(insurer => (
                  <div key={insurer} className="flex items-center space-x-2">
                    <Checkbox 
                      id={`new-ins-${insurer}`} 
                      checked={newClinician.insurers.includes(insurer)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setNewClinician({...newClinician, insurers: [...newClinician.insurers, insurer]});
                        } else {
                          setNewClinician({...newClinician, insurers: newClinician.insurers.filter(i => i !== insurer)});
                        }
                      }}
                    />
                    <Label htmlFor={`new-ins-${insurer}`} className="font-normal cursor-pointer">{insurer}</Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Client Capacity</Label>
                <Input 
                  type="number" 
                  value={newClinician.capacity}
                  onChange={(e) => setNewClinician({...newClinician, capacity: parseInt(e.target.value) || 15})}
                />
              </div>
              <div className="space-y-2">
                <Label>Max New Clients</Label>
                <Input 
                  type="number" 
                  value={newClinician.maxNewClients}
                  onChange={(e) => setNewClinician({...newClinician, maxNewClients: parseInt(e.target.value) || 0})}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox 
                id="new-couples" 
                checked={newClinician.worksWithCouples}
                onCheckedChange={(checked) => setNewClinician({...newClinician, worksWithCouples: !!checked})}
              />
              <Label htmlFor="new-couples" className="font-medium cursor-pointer">Works with Couples</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="new-bupa" 
                checked={newClinician.allocateForBupa}
                onCheckedChange={(checked) => setNewClinician({...newClinician, allocateForBupa: !!checked})}
              />
              <Label htmlFor="new-bupa" className="font-medium cursor-pointer">Allocate for Bupa</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddClinician} disabled={createClinicianMutation.isPending} data-testid="button-submit-clinician">
              {createClinicianMutation.isPending ? "Creating..." : "Add Clinician"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
