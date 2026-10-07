import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { MANAGER_SETTINGS_KEY, managerErrorMessage, useManagerConfirmationAccess } from "@/lib/managerConfirmation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ManagerConfirmationSettings() {
  const { user } = useAuth();
  const access = useManagerConfirmationAccess(user?.role === "admin");
  const admins = useQuery<Array<{ id: string; name: string; email: string }>>({
    queryKey: ["/api/admin-users"], enabled: user?.role === "admin",
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newPin, setNewPin] = useState("");
  const [repeatPin, setRepeatPin] = useState("");
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const cache = useQueryClient();
  useEffect(() => {
    if (access.data) setSelectedIds(access.data.configured ? access.data.managerUserIds : user?.id ? [user.id] : []);
  }, [access.data?.updatedAt, access.data?.configured, user?.id]);
  const mutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/manager-confirmation/settings", {
        currentPassword: password,
        ...(newPin ? { newPin } : {}),
        managerUserIds: selectedIds, expectedUpdatedAt: access.data?.updatedAt ?? null,
      });
    },
    onSuccess: () => {
      setPassword(""); setNewPin(""); setRepeatPin(""); setSaved(true);
      cache.invalidateQueries({ queryKey: MANAGER_SETTINGS_KEY });
    },
    onError: () => { setPassword(""); setSaved(false); },
  });
  if (user?.role !== "admin") return null;
  const editable = access.data?.canConfigure === true;
  const validPin = access.data?.configured && !newPin || /^\d{6,12}$/.test(newPin) && newPin === repeatPin;
  return <Card className="mb-6">
    <CardHeader>
      <CardTitle>Manager confirmation</CardTitle>
      <CardDescription>
        Selected managers can move clients to Confirmed using a separate practice PIN.
        Overrides record the manager and reason; they do not verify payment or send booking emails.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {access.isLoading ? <p>Loading manager permissions…</p> : access.isError
        ? <p role="alert">Manager confirmation settings could not be loaded.</p>
        : !editable ? <p>Only selected managers can change these settings. Ask a practice manager to grant access.</p>
        : <>
          <p className="text-sm text-muted-foreground">
            {access.data?.configured ? "Leave the PIN blank to keep the existing PIN." :
              "For first-time setup, include your own admin account. After setup, only selected managers can change these settings."}
            {" "}The PIN is stored as a hash and cannot be viewed later.
          </p>
          <fieldset disabled={mutation.isPending}>
            <legend className="mb-2 text-sm font-medium">Selected practice managers</legend>
            {admins.isError && <p role="alert">Team members could not be loaded. Please reload before saving.</p>}
            {admins.data?.map(admin => <label key={admin.id} className="flex items-center gap-2 py-1 text-sm">
              <input type="checkbox" checked={selectedIds.includes(admin.id)}
                onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, admin.id] : ids.filter(id => id !== admin.id))} />
              {admin.name} ({admin.email}){admin.id === user.id ? " · you" : ""}
            </label>)}
          </fieldset>
          {access.data?.configured && !selectedIds.includes(user.id) && <p className="text-sm text-amber-800">
            You are removing your own manager access. Only the remaining selected managers will be able to change these settings.
          </p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="manager-new-pin">{access.data?.configured ? "New manager PIN (optional)" : "Manager PIN"}</Label>
              <Input id="manager-new-pin" type="password" inputMode="numeric" maxLength={12} autoComplete="new-password"
                value={newPin} onChange={event => { setNewPin(event.target.value); setSaved(false); }} /></div>
            <div><Label htmlFor="manager-repeat-pin">Repeat new manager PIN</Label>
              <Input id="manager-repeat-pin" type="password" inputMode="numeric" maxLength={12} autoComplete="new-password"
                value={repeatPin} onChange={event => setRepeatPin(event.target.value)} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Use 6–12 digits. Five incorrect attempts temporarily lock the manager out for 15 minutes.</p>
          <div><Label htmlFor="manager-settings-password">Your account password</Label>
            <Input id="manager-settings-password" type="password" autoComplete="current-password" value={password}
              onChange={event => setPassword(event.target.value)} /></div>
          {mutation.error && <p role="alert" className="text-sm text-destructive">{managerErrorMessage(mutation.error)}</p>}
          {saved && <p role="status">Manager confirmation settings saved.</p>}
          <Button disabled={!validPin || !password || selectedIds.length === 0 || admins.isError || admins.isLoading || mutation.isPending}
            onClick={() => mutation.mutate()}>{mutation.isPending ? "Saving…" : "Save manager confirmation settings"}</Button>
        </>}
    </CardContent>
  </Card>;
}
