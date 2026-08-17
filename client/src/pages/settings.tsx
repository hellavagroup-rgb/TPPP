import { useState, useEffect } from "react";
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
import { Loader2, Save, Mail, Trash2, UserPlus, Link2, ShieldCheck, Download, Database, RefreshCw, CheckCircle2, AlertCircle, ExternalLink, Layout } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useManagedInsurers, useAddInsurer, useDeleteInsurer } from "@/hooks/use-insurers";

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
    subject: "Please Complete Your Intake Form - {{practice_name}}",
    bodyText: `Dear Client,

Thank you for reaching out to {{practice_name}}.

Please click the link below to complete your intake form:
{{form_link}}

If you have any questions, please don't hesitate to contact us.

Best regards,
{{practice_name}}`,
  },
  {
    templateKey: "password_reset",
    name: "Password Reset",
    subject: "Password Reset Request - {{practice_name}}",
    bodyText: `Hello {{name}},

You have requested to reset your password.

Please click the link below to set a new password:
{{reset_link}}

If you did not request this, please ignore this email.

Best regards,
{{practice_name}}`,
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
{{practice_name}}`,
  },
  {
    templateKey: "availability_reminder",
    name: "Availability Reminder",
    subject: "Please Update Your Availability - {{practice_name}}",
    bodyText: `Hello {{name}},

This is a reminder to update your availability for the coming weeks.

Please log in to your account and update your available time slots:
{{login_link}}

This helps us efficiently match clients with your schedule.

Best regards,
{{practice_name}}`,
  },
  {
    templateKey: "form_completion",
    name: "Form Completion Confirmation",
    subject: "Thank You for Completing Your Intake Form - {{practice_name}}",
    bodyText: `Thank you for completing our intake form. We know that sharing this information can sometimes feel difficult, and we really appreciate you taking the time to share it with us.

One of our senior clinicians will carefully review the information you've shared within 2-3 working days. Your form helps us to:

Better understand what you are experiencing and what support you might need

Take into account any preferences or adjustments that would help you feel comfortable in therapy

Recommend a Clinical or Counselling Psychologist whose experience and availability best fits what you're looking for

All of our clinicians are HCPC registered Psychologists with specialist expertise in perinatal mental health, and we take care to make thoughtful, individualised recommendations.

Once your form has been reviewed, we'll be in touch with next steps.

If you have any questions in the meantime, please don't hesitate to contact us at pa@perinatalpsychologypractice.co.uk.

Warm regards,

{{practice_name}} Team


If you need urgent support, please contact your GP or a trusted healthcare provider. In the UK, you can also receive immediate support from: the Samaritans (Call 116 123 lines open 24/7 365 days a year or email jo@samaritans.org); or contact CALM (https://www.thecalmzone.net/) on their national helpline 0800 585858 (5pm to midnight).`,
  },
  {
    templateKey: "new_referral",
    name: "New Referral Notification",
    subject: "New Referral Received - {{clientDisplayId}}",
    bodyText: `A new client referral has been received.

Client ID: {{clientDisplayId}}
Name: {{clientName}}

Please log in to the practice management system to review and process this referral.

{{practice_name}}`,
  },
  {
    templateKey: "waitlist_update",
    name: "Waitlist Status Update",
    subject: "Client Status Updated - {{clientDisplayId}}",
    bodyText: `A client's status has been updated.

Client ID: {{clientDisplayId}}
Name: {{clientName}}
Previous Status: {{oldStatus}}
New Status: {{newStatus}}

Please log in to the practice management system to review this update.

{{practice_name}}`,
  },
  {
    templateKey: "payment_link",
    name: "Payment Link",
    subject: "Your Session Payment Link - {{practice_name}}",
    bodyText: `Thank you for completing your intake process. To confirm your first therapy session, please complete your initial session payment using the secure link below.

Payment amount: £{{amount}}

Pay securely here: {{payment_url}}

Your card details will be saved securely so that future session payments can be processed automatically.

If you have any questions, please don't hesitate to contact us.

Warm regards,
{{practice_name}} Team`,
  },
  {
    templateKey: "clinician_welcome",
    name: "Clinician Login Credentials",
    subject: "Your Login Credentials - {{practice_name}}",
    bodyText: `Hello {{name}},

Your login credentials have been generated. Here are your details:

Email: {{email}}
Temporary Password: {{temporary_password}}

Please log in and change your password as soon as possible.

Best regards,
{{practice_name}} Team`,
  },
  {
    templateKey: "admin_invite",
    name: "Admin Invitation",
    subject: "You've been invited as an Admin - {{practice_name}}",
    bodyText: `Hello {{name}},

You have been invited to join {{practice_name}} as an administrator.

Please click the link below to set up your password and activate your account:
{{invite_link}}

This link will expire in 7 days.

Best regards,
{{practice_name}}`,
  },
  {
    templateKey: "form_completion_page",
    name: "Form Submitted Page",
    subject: "Thank you for completing our intake form.",
    bodyText: `A senior clinician will review your responses within 2-3 working days. This helps us understand your needs, consider any preferences or adjustments, and suggest the most suitable Psychologist for you.

We will be in touch soon with next steps.

If you have any questions in the meantime, please get in touch with us directly using the contact details we've previously provided you.

If you need urgent support, please contact your GP or a trusted healthcare provider. In the UK, you can also receive immediate support from: the Samaritans (Call 116 123 lines open 24/7 365 days a year or email jo@samaritans.org); or contact CALM (https://www.thecalmzone.net/) on their national helpline 0800 585858 (5pm to midnight).

Warm regards,

{{practice_name}} Team`,
  },
  {
    templateKey: "allocation_options",
    name: "Match Options (CY&A)",
    subject: "Your Match Options - {{practice_name}}",
    bodyText: `We are pleased to let you know that we have found a match for you.

Please review your appointment options below and select the one that works best for you:

{{options_list}}

To view full details and make your selection, please visit the link below:

{{portal_link}}

If none of these options suit you, you can also decline and our team will be in touch to find an alternative.

Warm regards,
{{practice_name}} Team`,
  },
  {
    templateKey: "booking_confirmed",
    name: "Booking Confirmed (CY&A)",
    subject: "Booking Confirmed - {{practice_name}}",
    bodyText: `Your booking is confirmed.

Appointment Details:
Clinician: {{clinician_name}}
Time: {{appointment_time}}

Join your session here: {{zoom_link}}

If you have any questions or need to make changes, please don't hesitate to contact us.

Warm regards,
{{practice_name}} Team`,
  },
];

function NotificationsTab() {
  const { user, refreshUser } = useAuth();
  const [saving, setSaving] = useState(false);
  
  const defaultPrefs = {
    newReferrals: true,
    waitlistUpdates: true,
    taskAssignments: true,
  };
  
  const prefs = user?.notificationPrefs || defaultPrefs;

  const handleToggle = async (key: keyof typeof defaultPrefs, value: boolean) => {
    setSaving(true);
    try {
      const newPrefs = { ...prefs, [key]: value };
      const res = await apiRequest("PATCH", "/api/auth/notifications", { notificationPrefs: newPrefs });
      if (res.ok) {
        await refreshUser();
        toast.success("Notification preference saved");
      } else {
        toast.error("Failed to save preference");
      }
    } catch (error) {
      toast.error("Failed to save preference");
    }
    setSaving(false);
  };

  return (
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
          <Switch 
            checked={prefs.newReferrals !== false}
            onCheckedChange={(checked) => handleToggle("newReferrals", checked)}
            disabled={saving}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Waitlist Updates</Label>
            <p className="text-sm text-muted-foreground">Weekly summary of waitlisted clients.</p>
          </div>
          <Switch 
            checked={prefs.waitlistUpdates !== false}
            onCheckedChange={(checked) => handleToggle("waitlistUpdates", checked)}
            disabled={saving}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Task Assignments</Label>
            <p className="text-sm text-muted-foreground">When a task is assigned to you.</p>
          </div>
          <Switch 
            checked={prefs.taskAssignments !== false}
            onCheckedChange={(checked) => handleToggle("taskAssignments", checked)}
            disabled={saving}
          />
        </div>
      </CardContent>
    </Card>
  );
}

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
          <CardTitle>Message Templates</CardTitle>
          <CardDescription>
            Customize emails and messages sent to clients and clinicians. Use placeholders like {"{{name}}"} or {"{{practice_name}}"} which will be replaced automatically. The <strong>Form Submitted Page</strong> template controls what clients see on screen after submitting their intake form.
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
                      <Label>{editingTemplate === 'form_completion_page' ? 'Heading' : 'Subject Line'}</Label>
                      <Input
                        value={editForm.subject}
                        onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                        data-testid="input-template-subject"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>{editingTemplate === 'form_completion_page' ? 'Page Content' : 'Email Body'}</Label>
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
                        {defaultTemplate.templateKey === 'form_completion_page'
                          ? <Layout className="h-4 w-4 text-muted-foreground" />
                          : <Mail className="h-4 w-4 text-muted-foreground" />}
                        <h4 className="font-medium">{template?.name || defaultTemplate.name}</h4>
                        {defaultTemplate.templateKey === 'form_completion_page' && (
                          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">In-app page</span>
                        )}
                        {wasSaved && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">Customized</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {defaultTemplate.templateKey === 'form_completion_page' ? 'Heading: ' : 'Subject: '}
                        {template?.subject || defaultTemplate.subject}
                      </p>
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
  userId?: string | null;
}

function AccountTab() {
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState(user?.name || "");
  const [isSaving, setIsSaving] = useState(false);

  const { data: tenant } = useQuery<{ defaultLocationType?: string }>({
    queryKey: ["/api/tenant"],
  });

  const [defaultLocationType, setDefaultLocationType] = useState<"online" | "in_person">("online");

  useEffect(() => {
    if (tenant?.defaultLocationType) {
      setDefaultLocationType(tenant.defaultLocationType as "online" | "in_person");
    }
  }, [tenant]);

  const saveAvailabilitySettings = useMutation({
    mutationFn: async (locationType: string) => {
      const res = await apiRequest("PATCH", "/api/tenant/availability-settings", { defaultLocationType: locationType });
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant"] });
      toast.success("Availability default saved");
    },
    onError: () => toast.error("Failed to save availability settings"),
  });

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
    <div className="space-y-4">
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

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Availability Defaults</CardTitle>
          <CardDescription>Choose the default location type when adding new availability slots.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="defaultLocationType"
                value="online"
                checked={defaultLocationType === "online"}
                onChange={() => setDefaultLocationType("online")}
                data-testid="radio-default-location-online"
                className="h-4 w-4 accent-primary"
              />
              <span className="text-sm">Online</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="defaultLocationType"
                value="in_person"
                checked={defaultLocationType === "in_person"}
                onChange={() => setDefaultLocationType("in_person")}
                data-testid="radio-default-location-in-person"
                className="h-4 w-4 accent-primary"
              />
              <span className="text-sm">In-Person</span>
            </label>
          </div>
          <Button
            onClick={() => saveAvailabilitySettings.mutate(defaultLocationType)}
            disabled={saveAvailabilitySettings.isPending || defaultLocationType === (tenant?.defaultLocationType ?? "online")}
            data-testid="button-save-availability-defaults"
          >
            {saveAvailabilitySettings.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Default
          </Button>
        </CardContent>
      </Card>
    </div>
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

  const promoteMutation = useMutation({
    mutationFn: async (clinicianId: string) => {
      const res = await apiRequest("POST", `/api/clinicians/${clinicianId}/promote-to-admin`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clinicians"] });
      toast.success("Clinician promoted to admin with their profile linked");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to promote clinician");
    },
  });

  // Get clinicians who have user accounts but aren't admins yet
  const promotableClinicians = clinicians?.filter(c => {
    if (!c.userId) return false;
    // Check if this clinician's user is already an admin
    const isAlreadyAdmin = admins?.some(a => a.linkedClinicianId === c.id);
    // Also check if their userId matches any admin
    const userIsAdmin = admins?.some(a => a.id === c.userId);
    return !isAlreadyAdmin && !userIsAdmin;
  }) || [];

  const handleOpenLinkDialog = (admin: AdminUser) => {
    setLinkingAdmin(admin);
    setSelectedClinicianId(admin.linkedClinicianId || "none");
    setShowLinkDialog(true);
  };

  const handleLinkSubmit = () => {
    if (!linkingAdmin) return;
    linkMutation.mutate({ 
      adminId: linkingAdmin.id, 
      clinicianId: selectedClinicianId === "none" ? null : selectedClinicianId 
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

      {promotableClinicians.length > 0 && (
        <Card className="border-none shadow-sm mt-6">
          <CardHeader>
            <div>
              <CardTitle>Promote Clinician to Admin</CardTitle>
              <CardDescription>
                These clinicians have user accounts and can be promoted to admin while keeping their clinician profile linked.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {promotableClinicians.map((clinician) => (
                <div key={clinician.id} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`promotable-clinician-${clinician.id}`}>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-600">
                      {clinician.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium">{clinician.name}</p>
                      <p className="text-xs text-muted-foreground">Clinician account</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => promoteMutation.mutate(clinician.id)}
                    disabled={promoteMutation.isPending}
                    data-testid={`button-promote-${clinician.id}`}
                  >
                    {promoteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    Promote to Admin
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
                  <SelectItem value="none">None (unlink)</SelectItem>
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
              {selectedClinicianId && selectedClinicianId !== "none" ? "Link" : "Unlink"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DataExportTab() {
  const [downloading, setDownloading] = useState<string | null>(null);

  const exportTypes = [
    { key: "clients", label: "Clients", description: "All client records including archived clients, status, notes, and assignment details" },
    { key: "clinicians", label: "Clinicians", description: "All clinician profiles including specialties, capacity, and insurance panels" },
    { key: "tasks", label: "Tasks", description: "All tasks including assignments, priorities, due dates, and completion status" },
    { key: "form-responses", label: "Completed Form Responses", description: "All submitted client intake forms — one row per submission with each question as a separate column" },
  ];

  const handleExport = async (type: string, format: "csv" | "xlsx") => {
    setDownloading(`${type}-${format}`);
    try {
      const response = await fetch(`/api/export/${type}?format=${format}`, { credentials: "include" });
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : `${type}_export.${format}`;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success(`${type} exported as ${format.toUpperCase()}`);
    } catch {
      toast.error("Failed to export data");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Data Export
        </CardTitle>
        <CardDescription>
          Download your practice data as CSV or XLSX files. Use these for backups or external analysis. Exports include all records including archived data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {exportTypes.map(({ key, label, description }) => (
          <div key={key} className="flex items-center justify-between p-4 border rounded-lg" data-testid={`export-${key}`}>
            <div className="flex-1">
              <p className="font-medium text-sm">{label}</p>
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            </div>
            <div className="flex gap-2 ml-4">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => handleExport(key, "csv")}
                disabled={downloading === `${key}-csv`}
                data-testid={`btn-export-${key}-csv`}
              >
                {downloading === `${key}-csv` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => handleExport(key, "xlsx")}
                disabled={downloading === `${key}-xlsx`}
                data-testid={`btn-export-${key}-xlsx`}
              >
                {downloading === `${key}-xlsx` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                XLSX
              </Button>
            </div>
          </div>
        ))}

        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg mt-4">
          <p className="text-xs text-blue-800">
            <strong>Tip:</strong> Download regular backups and store them somewhere safe. This gives you an extra layer of protection beyond automatic system checkpoints.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function InsurerManagementSection() {
  const [newInsurerName, setNewInsurerName] = useState("");
  const { data: insurers = [], isLoading } = useManagedInsurers();
  const addMutation = useAddInsurer();
  const deleteMutation = useDeleteInsurer();

  const handleAdd = () => {
    const trimmed = newInsurerName.trim();
    if (!trimmed) return;
    addMutation.mutate(trimmed, {
      onSuccess: () => setNewInsurerName(""),
      onError: (error: any) => {
        if (error?.message?.includes("409") || error?.message?.includes("already exists")) {
          toast.error("This insurer already exists");
        } else {
          toast.error("Failed to add insurer");
        }
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Insurers</CardTitle>
        <CardDescription>
          Manage the insurers your practice accepts. This list drives the "Insurers Accepted" options on each clinician's profile.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="New insurer name"
            value={newInsurerName}
            onChange={(e) => setNewInsurerName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <Button onClick={handleAdd} disabled={!newInsurerName.trim() || addMutation.isPending}>
            {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : insurers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No insurers yet. Add the insurers your practice accepts (e.g. Bupa, Aviva, Vitality).
          </p>
        ) : (
          <div className="space-y-2">
            {insurers.map(ins => (
              <div key={ins.id} className="flex items-center justify-between p-3 border rounded-lg">
                <span className="text-sm font-medium">{ins.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteMutation.mutate(ins.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NonEngagementCategoriesTab() {
  const queryClient = useQueryClient();
  const [newCategoryName, setNewCategoryName] = useState("");

  const { data: categories = [], isLoading } = useQuery<{ id: string; name: string; createdAt: string }[]>({
    queryKey: ["/api/non-engagement-categories"],
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await apiRequest("POST", "/api/non-engagement-categories", { name });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/non-engagement-categories"] });
      setNewCategoryName("");
      toast.success("Category added");
    },
    onError: (error: any) => {
      if (error?.message?.includes("already exists")) {
        toast.error("This category already exists");
      } else {
        toast.error("Failed to add category");
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/non-engagement-categories/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/non-engagement-categories"] });
      toast.success("Category removed");
    },
    onError: () => {
      toast.error("Failed to remove category");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Non-Engagement Categories</CardTitle>
        <CardDescription>
          Manage the categories available when archiving clients who didn't engage. These help you analyse patterns and reasons for non-engagement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="New category name"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newCategoryName.trim()) createMutation.mutate(newCategoryName.trim()); }}
            data-testid="input-new-category"
          />
          <Button
            onClick={() => newCategoryName.trim() && createMutation.mutate(newCategoryName.trim())}
            disabled={!newCategoryName.trim() || createMutation.isPending}
            data-testid="btn-add-category"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : categories.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No categories yet. Add some common reasons like "Cost", "Changed mind", "No availability", etc.
          </p>
        ) : (
          <div className="space-y-2">
            {categories.map(cat => (
              <div key={cat.id} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`category-${cat.id}`}>
                <span className="text-sm font-medium">{cat.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteMutation.mutate(cat.id)}
                  disabled={deleteMutation.isPending}
                  data-testid={`btn-delete-category-${cat.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface GmailConnection {
  id: string;
  gmailAddress: string;
  label: string | null;
  isActive: boolean;
  lastSyncAt: string | null;
  createdAt: string;
}

function GmailConnectionsTab() {
  const queryClient = useQueryClient();
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [resweepingId, setResweepingId] = useState<string | null>(null);
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<{ redirectUri: string; clientId: string; url: string } | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  async function loadDebugInfo() {
    try {
      const res = await fetch("/api/auth/gmail/debug-oauth-url");
      const data = await res.json();
      setDebugInfo(data);
      setShowDebug(true);
    } catch {
      toast.error("Failed to load debug info");
    }
  }

  const redirectUri = `${window.location.origin}/api/auth/gmail/callback`;

  // Read status from URL params (set after OAuth redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) {
      toast.success(`Connected ${decodeURIComponent(connected)} successfully`);
      queryClient.invalidateQueries({ queryKey: ["/api/gmail-connections"] });
      window.history.replaceState({}, "", "/settings?tab=gmail");
    } else if (error) {
      const msgs: Record<string, string> = {
        oauth_denied: "Google sign-in was cancelled.",
        no_tokens: "Google did not return credentials — make sure offline access is enabled.",
        oauth_failed: "Something went wrong during sign-in. Please try again.",
      };
      toast.error(msgs[error] || "Gmail connection failed.");
      window.history.replaceState({}, "", "/settings?tab=gmail");
    }
  }, [queryClient]);

  const { data: connections = [], isLoading } = useQuery<GmailConnection[]>({
    queryKey: ["/api/gmail-connections"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/gmail-connections/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail-connections"] });
      toast.success("Inbox disconnected");
      setDeleteDialogId(null);
    },
    onError: () => toast.error("Failed to disconnect inbox"),
  });

  async function handleSync(id: string) {
    setSyncingId(id);
    try {
      const res = await apiRequest("POST", `/api/gmail-connections/${id}/sync`);
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/gmail-connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intake-messages"] });
      if (data.newMessages > 0) {
        toast.success(`Sync complete — ${data.newMessages} new message${data.newMessages !== 1 ? "s" : ""} found`);
      } else {
        toast.success("Sync complete — no new messages");
      }
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncingId(null);
    }
  }

  async function handleResweep(id: string) {
    setResweepingId(id);
    try {
      const res = await fetch(`/api/gmail-connections/${id}/resweep`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error === "invalid_grant") {
          toast.error("Gmail connection expired — please disconnect this inbox and reconnect it", { duration: 8000 });
        } else {
          toast.error(`Re-sweep failed: ${data?.error || res.statusText}`, { duration: 6000 });
        }
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/gmail-connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intake-messages"] });
      if (data.newMessages > 0) {
        toast.success(`Re-sweep complete — ${data.newMessages} previously missed message${data.newMessages !== 1 ? "s" : ""} found`);
      } else {
        toast.success("Re-sweep complete — no missed messages found");
      }
    } catch (err: any) {
      toast.error(`Re-sweep failed: ${err?.message || "unknown error"}`, { duration: 6000 });
    } finally {
      setResweepingId(null);
    }
  }

  const toDelete = connections.find(c => c.id === deleteDialogId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Connected Gmail Inboxes
          </CardTitle>
          <CardDescription>
            Connect a Gmail inbox to automatically pull enquiry emails into the Intake Inbox.
            New messages are checked every 5 minutes. You can connect multiple inboxes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => { window.open("/api/auth/gmail/connect", "_blank"); }}
              data-testid="button-connect-gmail"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Connect a Gmail inbox
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground text-xs"
              onClick={loadDebugInfo}
            >
              Show debug info
            </Button>
          </div>

          {showDebug && debugInfo && (
            <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-xs space-y-2 font-mono break-all">
              <p><span className="font-semibold text-slate-700">Client ID:</span> {debugInfo.clientId}</p>
              <p><span className="font-semibold text-slate-700">Redirect URI (server):</span> {debugInfo.redirectUri}</p>
              <p><span className="font-semibold text-slate-700">Full OAuth URL:</span> {debugInfo.url}</p>
              <Button size="sm" variant="ghost" className="text-xs h-6 px-2" onClick={() => setShowDebug(false)}>Hide</Button>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {!isLoading && connections.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No inboxes connected yet.</p>
          )}

          {connections.length > 0 && (
            <div className="divide-y divide-border rounded-md border">
              {connections.map(conn => (
                <div key={conn.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {conn.isActive
                        ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        : <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />}
                      <span className="font-medium text-sm truncate">{conn.gmailAddress}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 pl-6">
                      {conn.lastSyncAt
                        ? `Last synced ${new Date(conn.lastSyncAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`
                        : "Not yet synced"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSync(conn.id)}
                      disabled={syncingId === conn.id || resweepingId === conn.id}
                      data-testid={`button-sync-gmail-${conn.id}`}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncingId === conn.id ? "animate-spin" : ""}`} />
                      Sync now
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-muted-foreground"
                      onClick={() => handleResweep(conn.id)}
                      disabled={syncingId === conn.id || resweepingId === conn.id}
                      title="Re-scan the last 30 days to recover any emails that were missed"
                      data-testid={`button-resweep-gmail-${conn.id}`}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${resweepingId === conn.id ? "animate-spin" : ""}`} />
                      Re-sweep inbox
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteDialogId(conn.id)}
                      data-testid={`button-disconnect-gmail-${conn.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs space-y-1.5">
            <p className="font-medium text-amber-900">Required: Authorised Redirect URI</p>
            <p className="text-amber-800">This exact URL must be added to your OAuth 2.0 client in Google Cloud Console under <strong>Clients → your client → Authorised redirect URIs</strong>:</p>
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 bg-white border border-amber-200 rounded px-2 py-1.5 text-amber-900 break-all select-all font-mono">
                {redirectUri}
              </code>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 border-amber-300"
                onClick={() => {
                  navigator.clipboard.writeText(redirectUri);
                  toast.success("Copied");
                }}
              >
                Copy
              </Button>
            </div>
          </div>

          <div className="rounded-md bg-muted/50 border p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">How it works</p>
            <p>Clicking "Connect a Gmail inbox" opens a Google sign-in window. Sign in with the practice inbox you want to monitor (e.g. <em>referrals@yourpractice.com</em>). We only request read access.</p>
            <p>After connecting, existing messages from the last 30 days are imported immediately. After that, new messages are checked every 5 minutes automatically.</p>
          </div>
        </CardContent>
      </Card>

      {/* Disconnect confirm dialog */}
      <Dialog open={!!deleteDialogId} onOpenChange={open => !open && setDeleteDialogId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect inbox?</DialogTitle>
            <DialogDescription>
              This will remove the connection to <strong>{toDelete?.gmailAddress}</strong>.
              Existing intake messages already imported will remain. You can reconnect at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteDialogId && deleteMutation.mutate(deleteDialogId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();

  const { data: tenant } = useQuery({
    queryKey: ["/api/tenant"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/tenant");
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  const dataExportEnabled = tenant?.dataExportEnabled !== false;
  const nonEngagementEnabled = tenant?.nonEngagementEnabled !== false;
  const gmailEnabled = tenant?.gmailIntakeEnabled === true;

  // Support ?tab=gmail deep-links, but fall back if the tab is disabled
  const urlTab = new URLSearchParams(window.location.search).get("tab");
  const defaultTab =
    urlTab === "gmail" && gmailEnabled ? "gmail" :
    "notifications";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-serif font-bold text-foreground">Settings</h2>
        <p className="text-muted-foreground mt-1">Manage practice configuration and preferences.</p>
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="email-templates">Message Templates</TabsTrigger>
          <TabsTrigger value="non-engagement">Categories</TabsTrigger>
          {dataExportEnabled && <TabsTrigger value="data-export">Data Export</TabsTrigger>}
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="team">Team Members</TabsTrigger>
          {gmailEnabled && <TabsTrigger value="gmail">Gmail Inboxes</TabsTrigger>}
        </TabsList>

        <TabsContent value="notifications" className="space-y-4">
          <NotificationsTab />
        </TabsContent>

        <TabsContent value="email-templates">
          <EmailTemplatesTab />
        </TabsContent>

        <TabsContent value="non-engagement" className="space-y-6">
          <InsurerManagementSection />
          {nonEngagementEnabled && <NonEngagementCategoriesTab />}
        </TabsContent>

        {dataExportEnabled && (
          <TabsContent value="data-export">
            <DataExportTab />
          </TabsContent>
        )}

        <TabsContent value="account">
          <AccountTab />
        </TabsContent>

        <TabsContent value="team">
          <AdminUsersTab />
        </TabsContent>

        {gmailEnabled && (
          <TabsContent value="gmail">
            <GmailConnectionsTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
