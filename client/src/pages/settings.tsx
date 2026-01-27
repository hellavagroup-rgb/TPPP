import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "sonner";
import { Loader2, Save, Mail, Trash2, UserPlus, Link2, Unlink } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";

interface EmailTemplate {
  id: string;
  templateKey: string;
  name: string;
  subject: string;
  bodyText: string;
  updatedAt: string;
}

const DEFAULT_TEMPLATES: Omit<EmailTemplate, "id" | "updatedAt">[] = [
  {
    templateKey: "form_invite",
    name: "Form Invitation",
    subject: "Please Complete Your Intake Form - The Perinatal Psychology Practice",
    bodyText: `Dear Client,

Thank you for reaching out to The Perinatal Psychology Practice.

Please click the link below to complete your intake form:
{{form_link}}

If you have any questions, please don't hesitate to contact us.

Best regards,
The Perinatal Psychology Practice`,
  },
  {
    templateKey: "password_reset",
    name: "Password Reset",
    subject: "Password Reset Request - The Perinatal Psychology Practice",
    bodyText: `Hello {{name}},

You have requested to reset your password.

Please click the link below to set a new password:
{{reset_link}}

If you did not request this, please ignore this email.

Best regards,
The Perinatal Psychology Practice`,
  },
  {
    templateKey: "task_reminder",
    name: "Task Reminder",
    subject: "Task Reminder: {{task_title}}",
    bodyText: `Hello,

This is a reminder about the following task:

Task: {{task_title}}
Description: {{task_description}}
Due: {{due_date}}

Please log in to complete this task.

Best regards,
The Perinatal Psychology Practice`,
  },
  {
    templateKey: "availability_reminder",
    name: "Availability Reminder",
    subject: "Please Update Your Availability - The Perinatal Psychology Practice",
    bodyText: `Hello {{name}},

This is a reminder to update your availability for the coming weeks.

Please log in to your account and update your available time slots:
{{login_link}}

This helps us efficiently match clients with your schedule.

Best regards,
The Perinatal Psychology Practice`,
  },
  {
    templateKey: "form_completion",
    name: "Form Completion Confirmation",
    subject: "Thank You for Completing Your Intake Form - The Perinatal Psychology Practice",
    bodyText: `Thank you for completing our intake form. We know that sharing this information can sometimes feel difficult, and we really appreciate you taking the time to share it with us.

One of our senior clinicians will carefully review the information you've shared within 2-3 working days. Your form helps us to:

Better understand what you are experiencing and what support you might need

Take into account any preferences or adjustments that would help you feel comfortable in therapy

Recommend a Clinical or Counselling Psychologist whose experience and availability best fits what you're looking for

All of our clinicians are HCPC registered Psychologists with specialist expertise in perinatal mental health, and we take care to make thoughtful, individualised recommendations.

Once your form has been reviewed, we'll be in touch with next steps.

If you have any questions in the meantime, please don't hesitate to contact us at pa@perinatalpsychologypractice.co.uk.

Warm regards,

The Perinatal Psychology Practice Team


If you need urgent support, please contact your GP or a trusted healthcare provider. In the UK, you can also receive immediate support from: the Samaritans (Call 116 123 lines open 24/7 365 days a year or email jo@samaritans.org); or contact CALM (https://www.thecalmzone.net/) on their national helpline 0800 585858 (5pm to midnight).`,
  },
];

function EmailTemplatesTab() {
  const queryClient = useQueryClient();
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", subject: "", bodyText: "" });

  const { data: templates, isLoading } = useQuery<EmailTemplate[]>({
    queryKey: ["/api/email-templates"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ key, data }: { key: string; data: { name: string; subject: string; bodyText: string } }) => {
      const res = await apiRequest("PUT", `/api/email-templates/${key}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-templates"] });
      toast.success("Email template updated successfully");
      setEditingTemplate(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update template");
    },
  });

  const getTemplateData = (key: string) => {
    const saved = templates?.find((t) => t.templateKey === key);
    if (saved) return saved;
    const defaultTemplate = DEFAULT_TEMPLATES.find((t) => t.templateKey === key);
    return defaultTemplate ? { ...defaultTemplate, id: "", updatedAt: "" } : null;
  };

  const startEditing = (key: string) => {
    const template = getTemplateData(key);
    if (template) {
      setEditForm({ name: template.name, subject: template.subject, bodyText: template.bodyText });
      setEditingTemplate(key);
    }
  };

  const saveTemplate = () => {
    if (!editingTemplate) return;
    updateMutation.mutate({ key: editingTemplate, data: editForm });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Email Templates</CardTitle>
          <CardDescription>
            Customize the content of emails sent to clients and clinicians. Use placeholders like {"{{name}}"} which will be replaced with actual values.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {DEFAULT_TEMPLATES.map((defaultTemplate) => {
            const template = getTemplateData(defaultTemplate.templateKey);
            const isEditing = editingTemplate === defaultTemplate.templateKey;
            const wasSaved = templates?.some((t) => t.templateKey === defaultTemplate.templateKey);

            return (
              <div
                key={defaultTemplate.templateKey}
                className="border rounded-lg p-4"
                data-testid={`email-template-${defaultTemplate.templateKey}`}
              >
                {isEditing ? (
                  <div className="space-y-4">
                    <div className="grid gap-2">
                      <Label>Template Name</Label>
                      <Input
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        data-testid="input-template-name"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Subject Line</Label>
                      <Input
                        value={editForm.subject}
                        onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                        data-testid="input-template-subject"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Email Body</Label>
                      <Textarea
                        value={editForm.bodyText}
                        onChange={(e) => setEditForm({ ...editForm, bodyText: e.target.value })}
                        rows={10}
                        className="font-mono text-sm"
                        data-testid="input-template-body"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={saveTemplate} disabled={updateMutation.isPending} data-testid="button-save-template">
                        {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                        Save Template
                      </Button>
                      <Button variant="outline" onClick={() => setEditingTemplate(null)} data-testid="button-cancel-edit">
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <h4 className="font-medium">{template?.name || defaultTemplate.name}</h4>
                        {wasSaved && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">Customized</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">Subject: {template?.subject || defaultTemplate.subject}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => startEditing(defaultTemplate.templateKey)} data-testid={`button-edit-template-${defaultTemplate.templateKey}`}>
                      Edit
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  linkedClinicianId?: string | null;
}

interface Clinician {
  id: string;
  name: string;
  avatar: string;
}

function AccountTab() {
  const { user, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setIsSaving(true);
    try {
      const res = await apiRequest("PATCH", "/api/auth/profile", { name: name.trim() });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update profile");
      }
      await refreshUser();
      toast.success("Profile updated successfully");
    } catch (error: any) {
      toast.error(error.message || "Failed to update profile");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="border-none shadow-sm">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Manage your account settings.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="profile-name">Name</Label>
          <Input 
            id="profile-name" 
            value={name} 
            onChange={(e) => setName(e.target.value)}
            data-testid="input-profile-name"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="profile-email">Email</Label>
          <Input 
            id="profile-email" 
            value={user?.email || ""} 
            disabled 
            className="bg-muted"
            data-testid="input-profile-email"
          />
          <p className="text-xs text-muted-foreground">Email cannot be changed.</p>
        </div>
        <Button onClick={handleSave} disabled={isSaving} data-testid="button-save-profile">
          {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save Changes
        </Button>
      </CardContent>
    </Card>
  );
}

function AdminUsersTab() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkingAdmin, setLinkingAdmin] = useState<AdminUser | null>(null);
  const [selectedClinicianId, setSelectedClinicianId] = useState<string>("");
  const [newAdmin, setNewAdmin] = useState({ name: "", email: "" });

  const { data: admins, isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin-users"],
  });

  const { data: clinicians } = useQuery<Clinician[]>({
    queryKey: ["/api/clinicians"],
  });

  const inviteMutation = useMutation({
    mutationFn: async (data: { name: string; email: string }) => {
      const res = await apiRequest("POST", "/api/admin-users/invite", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin-users"] });
      toast.success("Invite sent! The new admin will receive an email to set up their account.");
      setShowAddDialog(false);
      setNewAdmin({ name: "", email: "" });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to send invite");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin-users/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin-users"] });
      toast.success("Admin user deleted");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete admin user");
    },
  });

  const linkMutation = useMutation({
    mutationFn: async ({ adminId, clinicianId }: { adminId: string; clinicianId: string | null }) => {
      const res = await apiRequest("PATCH", `/api/admin-users/${adminId}/link-clinician`, { clinicianId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin-users"] });
      toast.success(selectedClinicianId ? "Admin linked to clinician profile" : "Admin unlinked from clinician profile");
      setShowLinkDialog(false);
      setLinkingAdmin(null);
      setSelectedClinicianId("");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to link admin to clinician");
    },
  });

  const handleOpenLinkDialog = (admin: AdminUser) => {
    setLinkingAdmin(admin);
    setSelectedClinicianId(admin.linkedClinicianId || "");
    setShowLinkDialog(true);
  };

  const handleLinkSubmit = () => {
    if (!linkingAdmin) return;
    linkMutation.mutate({ 
      adminId: linkingAdmin.id, 
      clinicianId: selectedClinicianId || null 
    });
  };

  const getLinkedClinicianName = (clinicianId: string | null | undefined) => {
    if (!clinicianId || !clinicians) return null;
    const clinician = clinicians.find(c => c.id === clinicianId);
    return clinician?.name || null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdmin.name || !newAdmin.email) {
      toast.error("Name and email are required");
      return;
    }
    inviteMutation.mutate(newAdmin);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <Card className="border-none shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Admin Users</CardTitle>
              <CardDescription>Manage administrator accounts with full system access.</CardDescription>
            </div>
            <Button onClick={() => setShowAddDialog(true)} data-testid="button-add-admin">
              <UserPlus className="h-4 w-4 mr-2" />
              Add Admin
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {admins?.map((admin) => {
              const linkedName = getLinkedClinicianName(admin.linkedClinicianId);
              return (
                <div key={admin.id} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`admin-user-${admin.id}`}>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                      {admin.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium">{admin.name}</p>
                      <p className="text-sm text-muted-foreground">{admin.email}</p>
                      {linkedName && (
                        <p className="text-xs text-emerald-600 flex items-center gap-1 mt-0.5">
                          <Link2 className="h-3 w-3" />
                          Linked to {linkedName}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenLinkDialog(admin)}
                      title={linkedName ? "Change clinician link" : "Link to clinician"}
                      data-testid={`button-link-admin-${admin.id}`}
                    >
                      {linkedName ? <Link2 className="h-4 w-4 text-emerald-600" /> : <Link2 className="h-4 w-4" />}
                    </Button>
                    {admin.id !== currentUser?.id && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(admin.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-admin-${admin.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                    {admin.id === currentUser?.id && (
                      <span className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded">You</span>
                    )}
                  </div>
                </div>
              );
            })}
            {(!admins || admins.length === 0) && (
              <p className="text-center text-muted-foreground py-4">No admin users found</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Admin User</DialogTitle>
            <DialogDescription>
              Send an invite email to a new administrator. They will set their own password.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="admin-name">Name</Label>
                <Input
                  id="admin-name"
                  value={newAdmin.name}
                  onChange={(e) => setNewAdmin({ ...newAdmin, name: e.target.value })}
                  placeholder="Full name"
                  data-testid="input-admin-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-email">Email</Label>
                <Input
                  id="admin-email"
                  type="email"
                  value={newAdmin.email}
                  onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })}
                  placeholder="email@example.com"
                  data-testid="input-admin-email"
                />
              </div>
              <p className="text-sm text-muted-foreground">
                An email will be sent with a link to set up their account. The link expires in 7 days.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={inviteMutation.isPending} data-testid="button-submit-admin">
                {inviteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Send Invite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link to Clinician Profile</DialogTitle>
            <DialogDescription>
              Link this admin to a clinician profile to allow them to manage their own availability.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Admin User</Label>
              <p className="text-sm font-medium">{linkingAdmin?.name}</p>
              <p className="text-xs text-muted-foreground">{linkingAdmin?.email}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="clinician-select">Clinician Profile</Label>
              <Select value={selectedClinicianId} onValueChange={setSelectedClinicianId}>
                <SelectTrigger id="clinician-select" data-testid="select-clinician-link">
                  <SelectValue placeholder="Select a clinician (or none to unlink)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None (unlink)</SelectItem>
                  {clinicians?.map((clinician) => (
                    <SelectItem key={clinician.id} value={clinician.id}>
                      {clinician.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                When linked, this admin will see "My Availability" in the dashboard to manage their own slots.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowLinkDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleLinkSubmit} disabled={linkMutation.isPending} data-testid="button-save-clinician-link">
              {linkMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {selectedClinicianId ? "Link" : "Unlink"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Settings() {
  const { user } = useAuth();
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-serif font-bold text-foreground">Settings</h2>
        <p className="text-muted-foreground mt-1">Manage practice configuration and preferences.</p>
      </div>

      <Tabs defaultValue="notifications" className="space-y-4">
        <TabsList>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="email-templates">Email Templates</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="team">Team Members</TabsTrigger>
        </TabsList>

        <TabsContent value="notifications" className="space-y-4">
          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>Email Notifications</CardTitle>
              <CardDescription>Configure when you receive emails.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>New Referrals</Label>
                  <p className="text-sm text-muted-foreground">Receive an email when a new client form is submitted.</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Waitlist Updates</Label>
                  <p className="text-sm text-muted-foreground">Weekly summary of waitlisted clients.</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Task Assignments</Label>
                  <p className="text-sm text-muted-foreground">When a task is assigned to you.</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="email-templates">
          <EmailTemplatesTab />
        </TabsContent>

        <TabsContent value="account">
          <AccountTab />
        </TabsContent>

        <TabsContent value="team">
          <AdminUsersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
