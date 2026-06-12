import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Mail, UserPlus, EyeOff, Eye } from "lucide-react";
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
  const hasStructured = fields && Object.keys(fields).length > 0;

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
          <div className="space-y-1 mt-2">
            {Object.entries(fields!).map(([label, value]) => (
              <div key={label} className="grid grid-cols-[180px_1fr] gap-2 py-1.5 border-b border-border/50 last:border-0">
                <span className="text-sm font-medium text-muted-foreground">{label}</span>
                <span className="text-sm break-words">{value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 p-4 bg-muted rounded-md text-sm whitespace-pre-wrap font-mono leading-relaxed">
            {message.body}
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

  const { data: messages = [], isLoading } = useQuery<IntakeMessage[]>({
    queryKey: ["/api/intake-messages"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/intake-messages");
      if (!res.ok) throw new Error("Failed to load intake messages");
      return res.json();
    },
  });

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

  const newCount = messages.filter((m) => m.status === "new").length;

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
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Messages
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">No intake messages yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
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
                {messages.map((msg) => {
                  const { label, variant } = STATUS_BADGE[msg.status];
                  const displayName = msg.extractedName
                    || extractedField(msg.extractedData, "name")
                    || null;
                  const displayEmail = extractedField(msg.extractedData, "email")
                    || msg.fromAddress;
                  const displayPhone = msg.extractedPhone
                    || extractedField(msg.extractedData, "phone", "telephone", "mobile");
                  return (
                    <TableRow key={msg.id} data-testid={`row-intake-${msg.id}`}>
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
                          {msg.status === "new" && (
                            <>
                              <Button
                                size="sm"
                                data-testid={`button-convert-${msg.id}`}
                                onClick={() => convertMutation.mutate(msg.id)}
                                disabled={convertMutation.isPending}
                              >
                                <UserPlus className="h-3.5 w-3.5 mr-1" />
                                Convert
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                data-testid={`button-ignore-${msg.id}`}
                                onClick={() => ignoreMutation.mutate(msg.id)}
                                disabled={ignoreMutation.isPending}
                              >
                                <EyeOff className="h-3.5 w-3.5 mr-1" />
                                Ignore
                              </Button>
                            </>
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
