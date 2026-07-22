import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Mail, UserPlus, EyeOff, Eye, RefreshCw } from "lucide-react";
import { format } from "date-fns";

interface IntakeMessage {
  id: string;
  channel: "email" | "whatsapp" | "phone";
  fromAddress: string;
  subject: string;
  body: string;
  extractedName: string | null;
  extractedPhone: string | null;
  extractedData: Record<string, string> | null;
  status: "new" | "linked" | "ignored";
  linkedClientId: string | null;
  receivedAt: string;
  threadId: string | null;
}

const STATUS_BADGE: Record<IntakeMessage["status"], { label: string; variant: "default" | "secondary" | "outline" }> = {
  new: { label: "New", variant: "default" },
  linked: { label: "Converted", variant: "secondary" },
  ignored: { label: "Ignored", variant: "outline" },
};

function extractedField(data: Record<string, string> | null, ...keys: string[]): string | null {
  if (!data) return null;
  for (const key of keys) {
    const found = Object.entries(data).find(([k]) => k.toLowerCase().includes(key.toLowerCase()));
    if (found?.[1]) return found[1];
  }
  return null;
}

function ViewEmailDialog({ message, open, onClose }: { message: IntakeMessage; open: boolean; onClose: () => void }) {
  const fields = message.extractedData;
  const hasStructured = fields && Object.keys(fields).length >= 3;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            {message.subject}
          </DialogTitle>
          <DialogDescription>
            From {message.fromAddress} · {format(new Date(message.receivedAt), "dd MMM yyyy HH:mm")}
          </DialogDescription>
        </DialogHeader>

        {hasStructured ? (
          <>
            <div className="space-y-1 mt-2">
              {Object.entries(fields!).map(([label, value]) => (
                <div key={label} className="grid grid-cols-[180px_1fr] gap-2 py-1.5 border-b border-border/50 last:border-0">
                  <span className="text-sm font-medium text-muted-foreground">{label}</span>
                  <span className="text-sm break-words">{value}</span>
                </div>
              ))}
            </div>
            <details className="mt-4">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">
                View raw email body
              </summary>
              <div className="mt-2 p-4 bg-muted rounded-md text-sm whitespace-pre-wrap leading-relaxed">
                {message.body}
              </div>
            </details>
          </>
        ) : (
          <div className="mt-3 p-4 bg-muted/50 rounded-md text-sm whitespace-pre-wrap leading-relaxed max-h-[50vh] overflow-y-auto">
            {message.body || <span className="text-muted-foreground italic">No body content</span>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function IntakeInbox() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [viewingMessage, setViewingMessage] = useState<IntakeMessage | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showIgnored, setShowIgnored] = useState(false);

  const { data: messages = [], isLoading } = useQuery<IntakeMessage[]>({
    queryKey: ["/api/intake-messages"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/intake-messages");
      if (!res.ok) throw new Error("Failed to load intake messages");
      return res.json();
    },
  });

  const visibleMessages = showIgnored ? messages : messages.filter(m => m.status !== "ignored");
  const selectableIds = visibleMessages.filter(m => m.status === "new").map(m => m.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id));
  const someSelected = selected.size > 0;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIds));
    }
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const convertMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/intake-messages/${id}/convert-to-client`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to convert");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Client record created",
        description: `Created with pending ID ${data.client?.displayId}. Assign a WriteUpp W-number once allocated.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/intake-messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const unignoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/intake-messages/${id}/unignore`);
      if (!res.ok) throw new Error("Failed to unignore");
    },
    onSuccess: () => {
      toast({ title: "Message restored", description: "Message is now active again." });
      queryClient.invalidateQueries({ queryKey: ["/api/intake-messages"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to unignore message.", variant: "destructive" }),
  });

  const ignoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/intake-messages/${id}/ignore`);
      if (!res.ok) throw new Error("Failed to ignore");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intake-messages"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const bulkIgnoreMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch("/api/intake-messages/bulk-ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to bulk ignore");
      return data;
    },
    onSuccess: (data) => {
      toast({ title: `${data.count} message${data.count !== 1 ? "s" : ""} ignored` });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/intake-messages"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const reParseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/intake-messages/backfill-parse");
      if (!res.ok) throw new Error("Re-parse failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Re-parse complete", description: `Updated ${data.updated} message${data.updated !== 1 ? "s" : ""}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/intake-messages"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to re-parse messages.", variant: "destructive" });
    },
  });

  const newCount = messages.filter((m) => m.status === "new").length;
  const ignoredCount = messages.filter((m) => m.status === "ignored").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Intake Inbox</h1>
          <p className="text-muted-foreground mt-1">
            Incoming enquiries received via email and other channels.
          </p>
        </div>
        {newCount > 0 && (
          <Badge data-testid="badge-new-count" className="text-sm px-3 py-1">
            {newCount} new
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Messages
            </CardTitle>
            <div className="flex items-center gap-2">
              {someSelected && (
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="button-bulk-ignore"
                  disabled={bulkIgnoreMutation.isPending}
                  onClick={() => bulkIgnoreMutation.mutate([...selected])}
                >
                  <EyeOff className="h-3.5 w-3.5 mr-1.5" />
                  {bulkIgnoreMutation.isPending ? "Ignoring…" : `Ignore ${selected.size} selected`}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                data-testid="button-reparse"
                disabled={reParseMutation.isPending}
                onClick={() => reParseMutation.mutate()}
                title="Re-parse all messages to fix swapped question/answer columns"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${reParseMutation.isPending ? "animate-spin" : ""}`} />
                {reParseMutation.isPending ? "Re-parsing…" : "Re-parse"}
              </Button>
              <Button
                size="sm"
                variant={showIgnored ? "secondary" : "outline"}
                onClick={() => setShowIgnored(v => !v)}
                data-testid="button-toggle-ignored"
              >
                <EyeOff className="h-3.5 w-3.5 mr-1.5" />
                {showIgnored ? "Hide ignored" : `Show ignored${ignoredCount > 0 ? ` (${ignoredCount})` : ""}`}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground">Loading…</div>
          ) : visibleMessages.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              {showIgnored ? "No intake messages yet." : "No active messages. " + (ignoredCount > 0 ? `${ignoredCount} ignored message${ignoredCount !== 1 ? "s" : ""} hidden.` : "")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all"
                      data-testid="checkbox-select-all"
                      disabled={selectableIds.length === 0}
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleMessages.map((msg) => {
                  const { label, variant } = STATUS_BADGE[msg.status];
                  const isNew = msg.status === "new";
                  const isChecked = selected.has(msg.id);
                  const displayName = msg.extractedName
                    || extractedField(msg.extractedData, "name")
                    || null;
                  const displayEmail = extractedField(msg.extractedData, "email")
                    || msg.fromAddress;
                  const displayPhone = msg.extractedPhone
                    || extractedField(msg.extractedData, "phone", "telephone", "mobile");
                  return (
                    <TableRow
                      key={msg.id}
                      data-testid={`row-intake-${msg.id}`}
                      className={msg.status === "ignored" ? "opacity-50" : ""}
                    >
                      <TableCell className="pr-0">
                        {isNew && (
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleOne(msg.id)}
                            aria-label={`Select message ${msg.id}`}
                            data-testid={`checkbox-${msg.id}`}
                          />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        {displayName ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{displayEmail}</TableCell>
                      <TableCell className="text-sm">
                        {displayPhone ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">
                        {msg.subject}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {format(new Date(msg.receivedAt), "dd MMM yyyy HH:mm")}
                      </TableCell>
                      <TableCell>
                        <Badge variant={variant} data-testid={`badge-status-${msg.id}`}>{label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            data-testid={`button-view-${msg.id}`}
                            onClick={() => setViewingMessage(msg)}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            View
                          </Button>
                          {isNew && (
                            <>
                              <Button
                                size="sm"
                                data-testid={`button-convert-${msg.id}`}
                                onClick={() => convertMutation.mutate(msg.id)}
                                disabled={convertMutation.isPending && convertMutation.variables === msg.id}
                              >
                                <UserPlus className="h-3.5 w-3.5 mr-1" />
                                {convertMutation.isPending && convertMutation.variables === msg.id ? "Converting…" : "Convert"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                data-testid={`button-ignore-${msg.id}`}
                                onClick={() => ignoreMutation.mutate(msg.id)}
                                disabled={ignoreMutation.isPending && ignoreMutation.variables === msg.id}
                              >
                                <EyeOff className="h-3.5 w-3.5 mr-1" />
                                Ignore
                              </Button>
                            </>
                          )}
                          {msg.status === "ignored" && (
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`button-unignore-${msg.id}`}
                              onClick={() => unignoreMutation.mutate(msg.id)}
                              disabled={unignoreMutation.isPending && unignoreMutation.variables === msg.id}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              {unignoreMutation.isPending && unignoreMutation.variables === msg.id ? "Restoring…" : "Unignore"}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {viewingMessage && (
        <ViewEmailDialog
          message={viewingMessage}
          open={!!viewingMessage}
          onClose={() => setViewingMessage(null)}
        />
      )}
    </div>
  );
}
