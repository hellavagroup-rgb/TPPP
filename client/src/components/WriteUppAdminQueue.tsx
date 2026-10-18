import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { formatOfferDate, formatOfferTimeRange } from "@shared/offerSchedule";

type QueueClient = {
  id: string;
  displayId: string;
  name?: string | null;
  description?: string | null;
  writeuppAppointmentConfirmed?: boolean | null;
  writeuppDataTransferred?: boolean | null;
  bookingSnapshot?: {
    clinicianName: string;
    slotType: string | null;
    day: string | null;
    date: string | null;
    startTime: string;
    endTime: string;
  } | null;
};

type ChecklistUpdate = { writeuppAppointmentConfirmed: boolean } | { writeuppDataTransferred: boolean };

export function WriteUppAdminQueue({ clients, saving, canEdit, onUpdate, onView }: {
  clients: QueueClient[];
  saving: boolean;
  canEdit: boolean;
  onUpdate: (id: string, update: ChecklistUpdate) => void;
  onView: (client: QueueClient) => void;
}) {
  if (!clients.length) return null;
  return <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-3"
    aria-label="Confirmed bookings needing WriteUpp admin" data-testid="writeupp-admin-queue">
    <div>
      <h3 className="font-semibold text-amber-950">
        Confirmed · WriteUpp admin outstanding <Badge variant="secondary">{clients.length}</Badge>
      </h3>
      <p className="text-sm text-muted-foreground">
        These bookings are confirmed. Complete both WriteUpp checks to clear them from this working list.
        They will remain in Show Confirmed.
      </p>
    </div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {clients.map(client => {
        const appointment = client.bookingSnapshot;
        const day = appointment?.slotType === "SpecificDate" && appointment.date
          ? formatOfferDate(appointment.date) : appointment?.day;
        return <Card key={client.id} data-testid={`writeupp-admin-card-${client.id}`}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-mono font-semibold">{client.displayId}</p>
                {client.name && <p className="text-sm font-medium">{client.name}</p>}
              </div>
              <Badge variant="outline">Booking confirmed</Badge>
            </div>
            {client.description && <p className="text-sm text-muted-foreground">{client.description}</p>}
            {appointment && <p className="text-sm">
              {appointment.clinicianName}{day ? ` · ${day}` : ""} · {formatOfferTimeRange(appointment.startTime, appointment.endTime)}
            </p>}
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox disabled={saving || !canEdit} checked={client.writeuppAppointmentConfirmed === true}
                  onCheckedChange={checked => onUpdate(client.id, { writeuppAppointmentConfirmed: checked === true })} />
                Appointment confirmed in WriteUpp
              </label>
              <label className="flex items-center gap-2">
                <Checkbox disabled={saving || !canEdit} checked={client.writeuppDataTransferred === true}
                  onCheckedChange={checked => onUpdate(client.id, { writeuppDataTransferred: checked === true })} />
                Data transferred to WriteUpp
              </label>
            </div>
            <Button variant="outline" size="sm" onClick={() => onView(client)}>View confirmed booking</Button>
          </CardContent>
        </Card>;
      })}
    </div>
  </section>;
}
