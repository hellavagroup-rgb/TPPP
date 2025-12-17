import { useData } from "@/lib/mockData";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarClock, Mail, ArrowRight } from "lucide-react";

export default function Waitlist() {
  const { clients } = useData();
  const waitlistClients = clients.filter(c => c.status === "Waitlist");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-serif font-bold text-foreground">Waitlist</h2>
        <p className="text-muted-foreground mt-1">Clients waiting for availability or specific clinician matches.</p>
      </div>

      <Card className="border-none shadow-sm bg-amber-50/50 dark:bg-amber-950/10">
        <CardContent className="p-4 flex items-center gap-4 text-amber-800 dark:text-amber-200">
            <CalendarClock className="h-5 w-5" />
            <p className="text-sm">
                <strong>Waitlist Policy:</strong> Clients on the waitlist should receive an update email every 14 days. 
                Currently, 2 clients are due for an update.
            </p>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {waitlistClients.map(client => (
            <Card key={client.id} className="border-none shadow-sm hover:shadow-md transition-all">
                <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-6">
                    <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-lg">{client.name}</h3>
                            <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">
                                {client.presentingIssues.join(", ")}
                            </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Waiting since: <span className="font-medium text-foreground">{client.intakeDate}</span>
                        </p>
                        <p className="text-sm mt-2 italic text-muted-foreground/80">
                            "{client.notes}"
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button variant="outline" className="gap-2">
                            <Mail className="h-4 w-4" /> Send Update
                        </Button>
                        <Button className="gap-2">
                            Review Availability <ArrowRight className="h-4 w-4" />
                        </Button>
                    </div>
                </CardContent>
            </Card>
        ))}

        {waitlistClients.length === 0 && (
            <div className="text-center py-12">
                <p className="text-muted-foreground">The waitlist is currently empty. Great job!</p>
            </div>
        )}
      </div>
    </div>
  );
}
