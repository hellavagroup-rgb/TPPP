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
import { Loader2, Save, Mail, Trash2, UserPlus, Eye, EyeOff } from "lucide-react";
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
}

function AdminUsersTab() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [newAdmin, setNewAdmin] = useState({ name: "", email: "", password: "" });

  const { data: admins, isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin-users"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; password: string }) => {
      const res = await apiRequest("POST", "/api/admin-users", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin-users"] });
      toast.success("Admin user created successfully");
      setShowAddDialog(false);
      setNewAdmin({ name: "", email: "", password: "" });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create admin user");
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

  const validatePassword = (password: string): string[] => {
    const errors: string[] = [];
    if (password.length < 12) errors.push("at least 12 characters");
    if (!/[A-Z]/.test(password)) errors.push("one uppercase letter");
    if (!/[a-z]/.test(password)) errors.push("one lowercase letter");
    if (!/[0-9]/.test(password)) errors.push("one number");
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) errors.push("one special character");
    return errors;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdmin.name || !newAdmin.email || !newAdmin.password) {
      toast.error("All fields are required");
      return;
    }
    const passwordErrors = validatePassword(newAdmin.password);
    if (passwordErrors.length > 0) {
      toast.error(`Password must contain: ${passwordErrors.join(", ")}`);
      return;
    }
    createMutation.mutate(newAdmin);
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
            {admins?.map((admin) => (
              <div key={admin.id} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`admin-user-${admin.id}`}>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                    {admin.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium">{admin.name}</p>
                    <p className="text-sm text-muted-foreground">{admin.email}</p>
                  </div>
                </div>
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
            ))}
            {(!admins || admins.length === 0) && (
              <p className="text-center text-muted-foreground py-4">No admin users found</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Admin User</DialogTitle>
            <DialogDescription>
              Create a new administrator account with full system access.
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
              <div className="space-y-2">
                <Label htmlFor="admin-password">Password</Label>
                <div className="relative">
                  <Input
                    id="admin-password"
                    type={showPassword ? "text" : "password"}
                    value={newAdmin.password}
                    onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })}
                    placeholder="Enter secure password"
                    data-testid="input-admin-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Must be at least 12 characters with uppercase, lowercase, number, and special character.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-admin">
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Admin
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Settings() {
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
          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Manage your account settings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" defaultValue="Admin User" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" defaultValue="admin@mindfulpath.com" />
              </div>
              <Button>Save Changes</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team">
          <AdminUsersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
