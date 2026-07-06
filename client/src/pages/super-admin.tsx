import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, CheckCircle2, AlertCircle, Save, Trash2, Plus, Eye, EyeOff, ShieldAlert, Upload } from "lucide-react";
import { toast } from "sonner";

const SESSION_KEY = "super_admin_key";

function getStoredKey(): string {
  return sessionStorage.getItem(SESSION_KEY) || "";
}

function setStoredKey(key: string) {
  sessionStorage.setItem(SESSION_KEY, key);
}

async function superAdminFetch(path: string, options: RequestInit = {}, key: string): Promise<Response> {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-super-admin-key": key,
      ...(options.headers || {}),
    },
  });
}

// ─── Key Entry Screen ────────────────────────────────────────────────────────

function KeyEntry({ onSuccess }: { onSuccess: (key: string) => void }) {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await superAdminFetch("/api/super-admin/verify", {}, key.trim());
      if (res.ok) {
        setStoredKey(key.trim());
        onSuccess(key.trim());
      } else {
        setError("Invalid key. Please try again.");
      }
    } catch {
      setError("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-3">
            <ShieldAlert className="h-10 w-10 text-slate-400" />
          </div>
          <CardTitle className="text-xl">Super Admin</CardTitle>
          <CardDescription>Enter your operator key to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sa-key">Operator Key</Label>
              <div className="relative">
                <Input
                  id="sa-key"
                  data-testid="input-super-admin-key"
                  type={show ? "text" : "password"}
                  value={key}
                  onChange={e => setKey(e.target.value)}
                  placeholder="Enter key…"
                  autoFocus
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShow(v => !v)}
                  tabIndex={-1}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !key.trim()} data-testid="button-sa-login">
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Unlock
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface GmailConn {
  id: string;
  gmailAddress: string;
  isActive: boolean;
  lastSyncAt: string | null;
  createdAt: string;
}

interface TenantSummary {
  id: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  stripeConnected: boolean;
  gmailConnections: GmailConn[];
  paymentsEnabled: boolean;
  tasksEnabled: boolean;
  analyticsEnabled: boolean;
  waitlistEnabled: boolean;
  formsEnabled: boolean;
  dataExportEnabled: boolean;
  nonEngagementEnabled: boolean;
  gmailIntakeEnabled: boolean;
  clinicianProfileConfig: { showTier?: boolean; showTherapyMode?: boolean } | null;
  createdAt: string;
}

interface TenantDetail extends TenantSummary {
  stripeWebhookConnected: boolean;
}

// ─── Tenant List ─────────────────────────────────────────────────────────────

function FeatureChip({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <Badge variant={enabled ? "default" : "secondary"} className={`text-xs ${enabled ? "" : "opacity-50"}`}>
      {label}
    </Badge>
  );
}

function TenantList({ adminKey, onSelect, onCreate }: {
  adminKey: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const { data: tenants = [], isLoading, refetch } = useQuery<TenantSummary[]>({
    queryKey: ["super-admin-tenants"],
    queryFn: async () => {
      const res = await superAdminFetch("/api/super-admin/tenants", {}, adminKey);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Tenants</h2>
          <p className="text-sm text-muted-foreground">{tenants.length} tenant{tenants.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-tenants">
            Refresh
          </Button>
          <Button size="sm" onClick={onCreate} data-testid="button-create-tenant">
            <Plus className="h-4 w-4 mr-1.5" />
            New Tenant
          </Button>
        </div>
      </div>

      {tenants.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No tenants yet. Create the first one.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {tenants.map(t => (
          <Card
            key={t.id}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => onSelect(t.id)}
            data-testid={`tenant-row-${t.id}`}
          >
            <CardContent className="py-4 px-5">
              <div className="flex items-center gap-4">
                {t.logoUrl ? (
                  <img src={t.logoUrl} alt={t.name} className="h-10 w-10 rounded object-contain border" />
                ) : (
                  <div className="h-10 w-10 rounded bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-500">
                    {t.name.substring(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.id}</p>
                </div>
                <div className="flex items-center gap-4 shrink-0 flex-wrap justify-end">
                  <div className="flex flex-wrap gap-1">
                    <FeatureChip label="Payments" enabled={t.paymentsEnabled} />
                    <FeatureChip label="Tasks" enabled={t.tasksEnabled} />
                    <FeatureChip label="Analytics" enabled={t.analyticsEnabled} />
                    <FeatureChip label="Waitlist" enabled={t.waitlistEnabled} />
                    <FeatureChip label="Forms" enabled={t.formsEnabled} />
                    <FeatureChip label="Export" enabled={t.dataExportEnabled} />
                    <FeatureChip label="Non-Eng." enabled={t.nonEngagementEnabled} />
                    <FeatureChip label="Gmail" enabled={t.gmailIntakeEnabled} />
                  </div>
                  <div className="flex flex-col items-end gap-1 text-xs">
                    <span className={`flex items-center gap-1 ${t.stripeConnected ? "text-green-600" : "text-muted-foreground"}`}>
                      {t.stripeConnected ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                      Stripe
                    </span>
                    <span className={`flex items-center gap-1 ${t.gmailConnections.length ? "text-green-600" : "text-muted-foreground"}`}>
                      {t.gmailConnections.length ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                      Gmail ({t.gmailConnections.length})
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Branding Tab ─────────────────────────────────────────────────────────────

function BrandingTab({ tenant, adminKey, onSaved }: { tenant: TenantDetail; adminKey: string; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: tenant.name,
    logoUrl: tenant.logoUrl || "",
    primaryColor: tenant.primaryColor || "",
    accentColor: tenant.accentColor || "",
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await superAdminFetch(`/api/super-admin/tenants/${tenant.id}/branding`, {
        method: "PATCH",
        body: JSON.stringify(form),
      }, adminKey);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save");
      }
      toast.success("Branding saved");
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Failed to save branding");
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const data = new FormData();
      data.append("logo", file);
      const res = await fetch(`/api/super-admin/tenants/${tenant.id}/logo-upload`, {
        method: "POST",
        headers: { "x-super-admin-key": adminKey },
        body: data,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Upload failed");
      }
      const { logoUrl } = await res.json();
      setForm(f => ({ ...f, logoUrl }));
      toast.success("Logo uploaded — click Save Branding to apply");
    } catch (e: any) {
      toast.error(e.message || "Failed to upload logo");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-5 max-w-lg">
      <div className="space-y-1.5">
        <Label>Practice Name</Label>
        <Input
          data-testid="input-branding-name"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Logo</Label>

        {/* Preview */}
        {form.logoUrl && (
          <div className="p-3 border rounded-lg bg-slate-50 flex items-center gap-3">
            <img
              src={form.logoUrl}
              alt="Logo preview"
              className="h-14 max-w-[160px] object-contain rounded"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-700 truncate">{form.logoUrl}</p>
              <button
                onClick={() => setForm(f => ({ ...f, logoUrl: "" }))}
                className="text-xs text-red-500 hover:underline mt-0.5"
                data-testid="button-remove-logo"
              >
                Remove
              </button>
            </div>
          </div>
        )}

        {/* Upload button */}
        <label className="flex items-center gap-2 cursor-pointer w-fit">
          <input
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/gif,image/webp"
            className="sr-only"
            onChange={handleLogoUpload}
            data-testid="input-logo-upload"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            asChild
            data-testid="button-upload-logo"
          >
            <span>
              {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              {uploading ? "Uploading…" : form.logoUrl ? "Replace Logo" : "Upload Logo"}
            </span>
          </Button>
        </label>

        {/* Manual URL fallback */}
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
            Or paste a URL instead
          </summary>
          <div className="mt-1.5">
            <Input
              data-testid="input-branding-logo"
              placeholder="https://…"
              value={form.logoUrl}
              onChange={e => setForm(f => ({ ...f, logoUrl: e.target.value }))}
            />
          </div>
        </details>
        <p className="text-xs text-muted-foreground">PNG, JPG, SVG or GIF — max 2 MB</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Primary Colour</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.primaryColor || "#000000"}
              onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
              className="h-9 w-9 cursor-pointer rounded border"
            />
            <Input
              data-testid="input-primary-color"
              placeholder="#000000"
              value={form.primaryColor}
              onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Accent Colour</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.accentColor || "#000000"}
              onChange={e => setForm(f => ({ ...f, accentColor: e.target.value }))}
              className="h-9 w-9 cursor-pointer rounded border"
            />
            <Input
              data-testid="input-accent-color"
              placeholder="#000000"
              value={form.accentColor}
              onChange={e => setForm(f => ({ ...f, accentColor: e.target.value }))}
            />
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} data-testid="button-save-branding">
        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        <Save className="h-4 w-4 mr-2" />
        Save Branding
      </Button>
    </div>
  );
}

// ─── Features Tab ─────────────────────────────────────────────────────────────

const FEATURE_FLAGS: { key: keyof TenantDetail; label: string; description: string }[] = [
  { key: "paymentsEnabled", label: "Payments", description: "Payments dashboard/nav link (revenue & charge history). Payment-link generation on client records works independently, whenever a Stripe key is configured on the Stripe tab." },
  { key: "tasksEnabled", label: "Tasks", description: "Administrative task management" },
  { key: "analyticsEnabled", label: "Analytics", description: "Practice analytics dashboard" },
  { key: "waitlistEnabled", label: "Waitlist", description: "Waitlist management view" },
  { key: "formsEnabled", label: "Forms", description: "Dynamic form builder and client intake forms" },
  { key: "dataExportEnabled", label: "Data Export", description: "CSV/XLSX data exports" },
  { key: "nonEngagementEnabled", label: "Non-Engagement Tracking", description: "Archive reason categories for non-engaging clients" },
  { key: "gmailIntakeEnabled", label: "Intake Inbox / Gmail", description: "Gmail integration for intake email processing" },
];

const CLINICIAN_PROFILE_FIELDS: { key: keyof NonNullable<TenantSummary["clinicianProfileConfig"]>; label: string; description: string; defaultOn: boolean }[] = [
  { key: "showTier", label: "Show Tier Field", description: "High / Mid / Low tier selector on clinician profiles", defaultOn: true },
  { key: "showTherapyMode", label: "Show Therapy Mode Field", description: "Online / In-person / Both mode selector on clinician profiles", defaultOn: false },
];

function FeaturesTab({ tenant, adminKey, onSaved }: { tenant: TenantDetail; adminKey: string; onSaved: () => void }) {
  const [flags, setFlags] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(FEATURE_FLAGS.map(f => [f.key, Boolean((tenant as any)[f.key])]))
  );
  const [profileConfig, setProfileConfig] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      CLINICIAN_PROFILE_FIELDS.map(f => [
        f.key,
        tenant.clinicianProfileConfig != null
          ? Boolean((tenant.clinicianProfileConfig as any)[f.key] ?? f.defaultOn)
          : f.defaultOn,
      ])
    )
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await superAdminFetch(`/api/super-admin/tenants/${tenant.id}/features`, {
        method: "PATCH",
        body: JSON.stringify({ ...flags, clinicianProfileConfig: profileConfig }),
      }, adminKey);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save");
      }
      toast.success("Feature flags saved");
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Failed to save features");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="divide-y pt-4">
          {FEATURE_FLAGS.map(f => (
            <div key={f.key} className="flex items-center justify-between py-3" data-testid={`feature-${f.key}`}>
              <div>
                <p className="font-medium text-sm">{f.label}</p>
                <p className="text-xs text-muted-foreground">{f.description}</p>
              </div>
              <Switch
                checked={flags[f.key] ?? true}
                onCheckedChange={v => setFlags(prev => ({ ...prev, [f.key]: v }))}
                data-testid={`switch-${f.key}`}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <div>
        <h3 className="text-sm font-semibold mb-2">Clinician Profile Fields</h3>
        <Card>
          <CardContent className="divide-y pt-4">
            {CLINICIAN_PROFILE_FIELDS.map(f => (
              <div key={f.key} className="flex items-center justify-between py-3" data-testid={`profile-config-${f.key}`}>
                <div>
                  <p className="font-medium text-sm">{f.label}</p>
                  <p className="text-xs text-muted-foreground">{f.description}</p>
                </div>
                <Switch
                  checked={profileConfig[f.key] ?? f.defaultOn}
                  onCheckedChange={v => setProfileConfig(prev => ({ ...prev, [f.key]: v }))}
                  data-testid={`switch-profile-${f.key}`}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Button onClick={handleSave} disabled={saving} data-testid="button-save-features">
        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        <Save className="h-4 w-4 mr-2" />
        Save Feature Flags
      </Button>
    </div>
  );
}

// ─── Stripe Tab ────────────────────────────────────────────────────────────────

function StripeTab({ tenant, adminKey, onSaved }: { tenant: TenantDetail; adminKey: string; onSaved: () => void }) {
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [showWebhook, setShowWebhook] = useState(false);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connected, setConnected] = useState(tenant.stripeConnected);
  const [webhookConnected, setWebhookConnected] = useState(tenant.stripeWebhookConnected);

  const handleSave = async () => {
    if (!secretKey && !webhookSecret) return;
    setSaving(true);
    try {
      const body: any = {};
      if (secretKey) body.stripeSecretKey = secretKey;
      if (webhookSecret) body.stripeWebhookSecret = webhookSecret;
      const res = await superAdminFetch(`/api/super-admin/tenants/${tenant.id}/stripe`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }, adminKey);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save");
      }
      const data = await res.json();
      setConnected(data.stripeConnected);
      setWebhookConnected(data.stripeWebhookConnected);
      setSecretKey("");
      setWebhookSecret("");
      toast.success("Stripe credentials saved");
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Failed to save Stripe credentials");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await superAdminFetch(`/api/super-admin/tenants/${tenant.id}/stripe`, {
        method: "PATCH",
        body: JSON.stringify({ stripeSecretKey: "", stripeWebhookSecret: "" }),
      }, adminKey);
      if (!res.ok) throw new Error("Failed to disconnect");
      setConnected(false);
      setWebhookConnected(false);
      toast.success("Stripe disconnected");
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-5 max-w-lg">
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
        {connected ? (
          <>
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-sm">Stripe connected</p>
              <p className="text-xs text-muted-foreground">
                Secret key saved.{" "}
                {webhookConnected
                  ? "Webhook secret saved."
                  : <span className="text-amber-600 font-medium">Webhook secret missing.</span>}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={disconnecting} data-testid="button-disconnect-stripe">
              {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disconnect"}
            </Button>
          </>
        ) : (
          <>
            <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
            <div>
              <p className="font-medium text-sm">Not connected</p>
              <p className="text-xs text-muted-foreground">Enter credentials below to enable payments for this tenant.</p>
            </div>
          </>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Stripe Secret Key</Label>
        <div className="relative">
          <Input
            data-testid="input-sa-stripe-secret"
            type={showSecret ? "text" : "password"}
            placeholder={connected ? "sk_••••• (enter new key to update)" : "sk_live_… or sk_test_…"}
            value={secretKey}
            onChange={e => setSecretKey(e.target.value)}
            className="pr-10"
          />
          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowSecret(v => !v)}>
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Webhook Signing Secret</Label>
        <div className="relative">
          <Input
            data-testid="input-sa-stripe-webhook"
            type={showWebhook ? "text" : "password"}
            placeholder={webhookConnected ? "whsec_••••• (enter new secret to update)" : "whsec_…"}
            value={webhookSecret}
            onChange={e => setWebhookSecret(e.target.value)}
            className="pr-10"
          />
          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowWebhook(v => !v)}>
            {showWebhook ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <Button
        onClick={handleSave}
        disabled={saving || (!secretKey && !webhookSecret)}
        data-testid="button-save-stripe-sa"
      >
        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        <Save className="h-4 w-4 mr-2" />
        Save Credentials
      </Button>
    </div>
  );
}

// ─── Gmail Tab ────────────────────────────────────────────────────────────────

function GmailTab({ tenant, adminKey, onSaved }: { tenant: TenantDetail; adminKey: string; onSaved: () => void }) {
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const handleDisconnect = async (connId: string) => {
    setDisconnecting(connId);
    try {
      const res = await superAdminFetch(`/api/super-admin/tenants/${tenant.id}/gmail/${connId}`, {
        method: "DELETE",
      }, adminKey);
      if (!res.ok) throw new Error("Failed to disconnect");
      toast.success("Gmail connection removed");
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Failed to disconnect Gmail");
    } finally {
      setDisconnecting(null);
    }
  };

  return (
    <div className="space-y-4">
      {tenant.gmailConnections.length === 0 ? (
        <div className="rounded-lg border p-6 text-center text-muted-foreground text-sm">
          No Gmail inboxes connected for this tenant. The tenant admin can connect via <strong>Settings → Gmail Inboxes</strong>.
        </div>
      ) : (
        <div className="divide-y divide-border rounded-md border">
          {tenant.gmailConnections.map(conn => (
            <div key={conn.id} className="flex items-center justify-between px-4 py-3 gap-4" data-testid={`gmail-conn-${conn.id}`}>
              <div>
                <div className="flex items-center gap-2">
                  {conn.isActive
                    ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    : <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />}
                  <span className="font-medium text-sm">{conn.gmailAddress}</span>
                </div>
                <p className="text-xs text-muted-foreground pl-6 mt-0.5">
                  {conn.lastSyncAt
                    ? `Last synced ${new Date(conn.lastSyncAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`
                    : "Not yet synced"}
                  {" · "}Connected {new Date(conn.createdAt).toLocaleDateString("en-GB")}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive shrink-0"
                onClick={() => handleDisconnect(conn.id)}
                disabled={disconnecting === conn.id}
                data-testid={`button-disconnect-gmail-${conn.id}`}
              >
                {disconnecting === conn.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        OAuth must be initiated by the tenant admin. You can disconnect here but cannot reconnect on their behalf.
      </p>
    </div>
  );
}

// ─── Tenant Detail ────────────────────────────────────────────────────────────

function TenantDetail({ tenantId, adminKey, onBack }: { tenantId: string; adminKey: string; onBack: () => void }) {
  const queryClient = useQueryClient();

  const { data: tenant, isLoading, refetch } = useQuery<TenantDetail>({
    queryKey: ["super-admin-tenant", tenantId],
    queryFn: async () => {
      const res = await superAdminFetch(`/api/super-admin/tenants/${tenantId}`, {}, adminKey);
      if (!res.ok) throw new Error("Failed to load tenant");
      return res.json();
    },
  });

  const onSaved = useCallback(() => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["super-admin-tenants"] });
  }, [refetch, queryClient]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="text-center py-20 text-destructive">Failed to load tenant.</div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-to-list">
          <ArrowLeft className="h-4 w-4 mr-1" />
          All Tenants
        </Button>
      </div>

      <div className="flex items-center gap-4">
        {tenant.logoUrl ? (
          <img src={tenant.logoUrl} alt={tenant.name} className="h-12 w-12 rounded object-contain border" />
        ) : (
          <div className="h-12 w-12 rounded bg-slate-100 flex items-center justify-center text-base font-bold text-slate-500">
            {tenant.name.substring(0, 2).toUpperCase()}
          </div>
        )}
        <div>
          <h2 className="text-2xl font-bold">{tenant.name}</h2>
          <p className="text-xs text-muted-foreground font-mono">{tenant.id}</p>
        </div>
      </div>

      <Tabs defaultValue="branding" className="space-y-4">
        <TabsList>
          <TabsTrigger value="branding" data-testid="tab-branding">Branding</TabsTrigger>
          <TabsTrigger value="features" data-testid="tab-features">Features</TabsTrigger>
          <TabsTrigger value="stripe" data-testid="tab-stripe">Stripe</TabsTrigger>
          <TabsTrigger value="gmail" data-testid="tab-gmail">Gmail</TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users">Users</TabsTrigger>
          <TabsTrigger value="forms" data-testid="tab-forms">Forms</TabsTrigger>
        </TabsList>

        <TabsContent value="branding">
          <BrandingTab tenant={tenant} adminKey={adminKey} onSaved={onSaved} />
        </TabsContent>

        <TabsContent value="features">
          <FeaturesTab tenant={tenant} adminKey={adminKey} onSaved={onSaved} />
        </TabsContent>

        <TabsContent value="stripe">
          <StripeTab tenant={tenant} adminKey={adminKey} onSaved={onSaved} />
        </TabsContent>

        <TabsContent value="gmail">
          <GmailTab tenant={tenant} adminKey={adminKey} onSaved={onSaved} />
        </TabsContent>

        <TabsContent value="users">
          <UsersTab adminKey={adminKey} />
        </TabsContent>

        <TabsContent value="forms">
          <FormsTab adminKey={adminKey} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Users Tab ───────────────────────────────────────────────────────────────

function UsersTab({ adminKey }: { adminKey: string }) {
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !newPassword) return;
    setLoading(true);
    try {
      const res = await superAdminFetch("/api/super-admin/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, newPassword }),
      }, adminKey);
      if (res.ok) {
        toast.success("Password reset successfully");
        setEmail("");
        setNewPassword("");
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to reset password");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reset User Password</CardTitle>
          <CardDescription>Override a user's password directly. Use when the user cannot receive a password-reset email.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleReset} className="space-y-4 max-w-sm">
            <div className="space-y-1.5">
              <Label htmlFor="reset-email">User email</Label>
              <Input
                id="reset-email"
                data-testid="input-reset-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-pw">New password</Label>
              <div className="relative">
                <Input
                  id="reset-pw"
                  data-testid="input-reset-password"
                  type={showPw ? "text" : "password"}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  required
                  minLength={8}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" disabled={loading} data-testid="button-reset-password">
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reset Password
            </Button>
          </form>
        </CardContent>
      </Card>

      <ReassignTenantCard adminKey={adminKey} />
      <BulkReassignTenantCard adminKey={adminKey} />
      <BackfillFormSubmissionTenantsCard adminKey={adminKey} />
    </div>
  );
}

function ReassignTenantCard({ adminKey }: { adminKey: string }) {
  const [email, setEmail] = useState("");
  const [newTenantId, setNewTenantId] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: tenantList } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["super-admin-tenants"],
    queryFn: async () => {
      const res = await superAdminFetch("/api/super-admin/tenants", {}, adminKey);
      if (!res.ok) throw new Error("Failed to load tenants");
      return res.json();
    },
  });

  const handleReassign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !newTenantId) return;
    setLoading(true);
    try {
      const res = await superAdminFetch("/api/super-admin/users/reassign-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, newTenantId }),
      }, adminKey);
      const data = await res.json();
      if (res.ok) {
        toast.success(`Moved ${email} to ${data.tenantName}${data.clinicianUpdated ? " (clinician profile updated too)" : ""}`);
        setEmail("");
        setNewTenantId("");
      } else {
        toast.error(data.error || "Failed to reassign tenant");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reassign User to a Different Tenant</CardTitle>
        <CardDescription>
          Moves a user account (and their clinician profile, if any) to another tenant. Use this for
          data-entry corrections — e.g. an account accidentally created under the wrong practice.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleReassign} className="space-y-4 max-w-sm">
          <div className="space-y-1.5">
            <Label htmlFor="reassign-email">User email</Label>
            <Input
              id="reassign-email"
              data-testid="input-reassign-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="clinician@example.com"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reassign-tenant">New tenant</Label>
            <select
              id="reassign-tenant"
              data-testid="select-reassign-tenant"
              className="w-full border rounded-md h-9 px-3 text-sm bg-background"
              value={newTenantId}
              onChange={e => setNewTenantId(e.target.value)}
              required
            >
              <option value="" disabled>Select a tenant</option>
              {tenantList?.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={loading} data-testid="button-reassign-tenant">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Reassign Tenant
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function BulkReassignTenantCard({ adminKey }: { adminKey: string }) {
  const [emailsText, setEmailsText] = useState("");
  const [newTenantId, setNewTenantId] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ email: string; success: boolean; error?: string; clinicianUpdated?: boolean }[] | null>(null);

  const { data: tenantList } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["super-admin-tenants"],
    queryFn: async () => {
      const res = await superAdminFetch("/api/super-admin/tenants", {}, adminKey);
      if (!res.ok) throw new Error("Failed to load tenants");
      return res.json();
    },
  });

  const emails = emailsText
    .split(/[\n,]/)
    .map(e => e.trim())
    .filter(Boolean);

  const handleBulkReassign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emails.length === 0 || !newTenantId) return;
    setLoading(true);
    setResults(null);
    try {
      const res = await superAdminFetch("/api/super-admin/users/reassign-tenant-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails, newTenantId }),
      }, adminKey);
      const data = await res.json();
      if (res.ok) {
        setResults(data.results);
        const failCount = data.results.filter((r: any) => !r.success).length;
        if (failCount === 0) {
          toast.success(`Moved ${data.results.length} account(s) to ${data.tenantName}`);
        } else {
          toast.error(`${failCount} of ${data.results.length} account(s) failed — see details below`);
        }
      } else {
        toast.error(data.error || "Failed to bulk reassign tenant");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bulk Reassign Users to a Different Tenant</CardTitle>
        <CardDescription>
          Moves several accounts (and their linked clinician profiles, if any) to another tenant in one
          go. Use this to clean up a batch of accounts affected by the same past data issue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleBulkReassign} className="space-y-4 max-w-sm">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-reassign-emails">User emails (one per line or comma-separated)</Label>
            <Textarea
              id="bulk-reassign-emails"
              data-testid="input-bulk-reassign-emails"
              value={emailsText}
              onChange={e => setEmailsText(e.target.value)}
              placeholder={"clinician1@example.com\nclinician2@example.com"}
              rows={6}
              required
            />
            <p className="text-xs text-muted-foreground">{emails.length} email(s) detected</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-reassign-tenant">New tenant</Label>
            <select
              id="bulk-reassign-tenant"
              data-testid="select-bulk-reassign-tenant"
              className="w-full border rounded-md h-9 px-3 text-sm bg-background"
              value={newTenantId}
              onChange={e => setNewTenantId(e.target.value)}
              required
            >
              <option value="" disabled>Select a tenant</option>
              {tenantList?.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={loading} data-testid="button-bulk-reassign-tenant">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Reassign All
          </Button>
        </form>
        {results && (
          <div className="mt-4 space-y-1 text-sm" data-testid="results-bulk-reassign">
            {results.map(r => (
              <div key={r.email} className={r.success ? "text-green-600" : "text-destructive"}>
                {r.success ? "✓" : "✗"} {r.email}
                {r.success && r.clinicianUpdated ? " (clinician profile updated)" : ""}
                {!r.success && r.error ? ` — ${r.error}` : ""}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BackfillFormSubmissionTenantsCard({ adminKey }: { adminKey: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ updated: number } | null>(null);

  const handleBackfill = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await superAdminFetch("/api/super-admin/form-submissions/backfill-tenant-ids", {
        method: "POST",
      }, adminKey);
      const data = await res.json();
      if (res.ok) {
        setResult({ updated: data.updated });
        toast.success(data.updated > 0 ? `Fixed ${data.updated} form submission(s)` : "No form submissions needed fixing");
      } else {
        toast.error(data.error || "Failed to backfill form submission tenant IDs");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fix Untagged Form Submissions</CardTitle>
        <CardDescription>
          Some form submissions and drafts saved before tenant tagging was added to the public submission
          flow are missing a tenant. This finds those rows and tags them using their client's tenant
          (never guessed). Safe to run more than once.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleBackfill} disabled={loading} data-testid="button-backfill-form-submission-tenants">
          {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Fix Untagged Form Submissions
        </Button>
        {result && (
          <p className="mt-3 text-sm text-muted-foreground" data-testid="text-backfill-result">
            {result.updated > 0 ? `Updated ${result.updated} row(s).` : "No rows needed updating."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Forms Tab ───────────────────────────────────────────────────────────────

function FormsTab({ adminKey }: { adminKey: string }) {
  return (
    <div className="space-y-6">
      <CopyFormToTenantCard adminKey={adminKey} />
    </div>
  );
}

function CopyFormToTenantCard({ adminKey }: { adminKey: string }) {
  const [sourceFormId, setSourceFormId] = useState("");
  const [targetTenantId, setTargetTenantId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: forms, refetch: refetchForms } = useQuery<{ id: string; title: string; tenantId: string | null; tenantName: string }[]>({
    queryKey: ["super-admin-forms"],
    queryFn: async () => {
      const res = await superAdminFetch("/api/super-admin/forms", {}, adminKey);
      if (!res.ok) throw new Error("Failed to load forms");
      return res.json();
    },
  });

  const { data: tenantList } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["super-admin-tenants"],
    queryFn: async () => {
      const res = await superAdminFetch("/api/super-admin/tenants", {}, adminKey);
      if (!res.ok) throw new Error("Failed to load tenants");
      return res.json();
    },
  });

  const selectedForm = forms?.find(f => f.id === sourceFormId);

  const handleCopy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceFormId || !targetTenantId) return;
    setLoading(true);
    try {
      const res = await superAdminFetch("/api/super-admin/forms/copy-to-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formTemplateId: sourceFormId,
          targetTenantId,
          ...(newTitle.trim() ? { newTitle: newTitle.trim() } : {}),
        }),
      }, adminKey);
      const data = await res.json();
      if (res.ok) {
        toast.success(`Copied "${data.form?.title}" to ${data.tenantName} as a new, independently-editable form`);
        setSourceFormId("");
        setTargetTenantId("");
        setNewTitle("");
        refetchForms();
      } else {
        toast.error(data.error || "Failed to copy form");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Copy a Form to Another Tenant</CardTitle>
        <CardDescription>
          Creates a brand-new, independent copy of a form template under a different practice. The two
          copies are never linked — each tenant can edit their own without affecting the other. Use this
          when one practice agrees to share a form with another.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleCopy} className="space-y-4 max-w-sm">
          <div className="space-y-1.5">
            <Label htmlFor="copy-form-source">Form to copy</Label>
            <select
              id="copy-form-source"
              data-testid="select-copy-form-source"
              className="w-full border rounded-md h-9 px-3 text-sm bg-background"
              value={sourceFormId}
              onChange={e => setSourceFormId(e.target.value)}
              required
            >
              <option value="" disabled>Select a form</option>
              {forms?.map(f => (
                <option key={f.id} value={f.id}>{f.title} — {f.tenantName ?? "No tenant"}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="copy-form-target">Copy to tenant</Label>
            <select
              id="copy-form-target"
              data-testid="select-copy-form-target"
              className="w-full border rounded-md h-9 px-3 text-sm bg-background"
              value={targetTenantId}
              onChange={e => setTargetTenantId(e.target.value)}
              required
            >
              <option value="" disabled>Select a tenant</option>
              {tenantList?.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="copy-form-title">New title (optional)</Label>
            <Input
              id="copy-form-title"
              data-testid="input-copy-form-title"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder={selectedForm ? selectedForm.title : "Defaults to the original title"}
            />
          </div>
          <Button type="submit" disabled={loading} data-testid="button-copy-form">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Copy Form
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Create Tenant Modal ──────────────────────────────────────────────────────

function CreateTenantModal({ open, adminKey, onClose, onCreated }: {
  open: boolean;
  adminKey: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    slug: "",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
  });
  const [creating, setCreating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await superAdminFetch("/api/super-admin/tenants", {
        method: "POST",
        body: JSON.stringify(form),
      }, adminKey);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(
          Array.isArray(d.error)
            ? d.error.map((e: any) => e.message).join(", ")
            : d.error || "Failed to create tenant"
        );
      }
      const data = await res.json();
      toast.success(`Tenant "${data.tenant.name}" created`);
      onCreated(data.tenant.id);
    } catch (e: any) {
      toast.error(e.message || "Failed to create tenant");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Tenant</DialogTitle>
          <DialogDescription>
            Provisions a new tenant and its first admin account in one step.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Practice Name</Label>
            <Input
              data-testid="input-new-tenant-name"
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Sunridge Psychology Practice"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Slug / Domain identifier <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
            <Input
              data-testid="input-new-tenant-slug"
              value={form.slug}
              onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))}
              placeholder="e.g. sunridge (URL-safe, lowercase)"
            />
            <p className="text-xs text-muted-foreground">Used for future subdomain / routing. Leave blank if not needed yet.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Admin Full Name</Label>
            <Input
              data-testid="input-new-tenant-admin-name"
              required
              value={form.adminName}
              onChange={e => setForm(f => ({ ...f, adminName: e.target.value }))}
              placeholder="e.g. Jane Smith"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Admin Email</Label>
            <Input
              data-testid="input-new-tenant-admin-email"
              type="email"
              required
              value={form.adminEmail}
              onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))}
              placeholder="admin@practice.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Temporary Password</Label>
            <div className="relative">
              <Input
                data-testid="input-new-tenant-password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                value={form.adminPassword}
                onChange={e => setForm(f => ({ ...f, adminPassword: e.target.value }))}
                placeholder="Min. 8 characters"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowPassword(v => !v)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Share this with the admin so they can log in and change it.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={creating}>Cancel</Button>
            <Button type="submit" disabled={creating} data-testid="button-submit-create-tenant">
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Tenant
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SuperAdmin() {
  const storedKey = getStoredKey();
  const [adminKey, setAdminKey] = useState<string>(storedKey);
  const [verified, setVerified] = useState(false);
  const [autoVerifying, setAutoVerifying] = useState(!!storedKey);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // On mount: if sessionStorage has a key, auto-verify it.
  // This means users don't re-enter the key after navigating away and back.
  useEffect(() => {
    const key = getStoredKey();
    if (!key) { setAutoVerifying(false); return; }
    superAdminFetch("/api/super-admin/verify", {}, key)
      .then(res => {
        if (res.ok) {
          setAdminKey(key);
          setVerified(true);
        } else {
          sessionStorage.removeItem(SESSION_KEY);
          setAdminKey("");
        }
      })
      .catch(() => {
        sessionStorage.removeItem(SESSION_KEY);
        setAdminKey("");
      })
      .finally(() => setAutoVerifying(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeySuccess = (key: string) => {
    setAdminKey(key);
    setVerified(true);
  };

  const handleSignOut = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setAdminKey("");
    setVerified(false);
    setSelectedTenantId(null);
  };

  const handleTenantCreated = (id: string) => {
    setShowCreate(false);
    setSelectedTenantId(id);
  };

  if (autoVerifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!adminKey || !verified) {
    return (
      <KeyEntry
        onSuccess={handleKeySuccess}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-slate-400" />
            <span className="font-semibold text-sm text-slate-700">Super Admin</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut} data-testid="button-sa-signout">
            Sign out
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {selectedTenantId ? (
          <TenantDetail
            tenantId={selectedTenantId}
            adminKey={adminKey}
            onBack={() => setSelectedTenantId(null)}
          />
        ) : (
          <TenantList
            adminKey={adminKey}
            onSelect={setSelectedTenantId}
            onCreate={() => setShowCreate(true)}
          />
        )}
      </div>

      <CreateTenantModal
        open={showCreate}
        adminKey={adminKey}
        onClose={() => setShowCreate(false)}
        onCreated={handleTenantCreated}
      />
    </div>
  );
}
