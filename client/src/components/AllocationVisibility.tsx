import { useState } from "react";
import { formatAssignedSlot, formatDateUK } from "@/lib/dateUtils";

export type Appointment = {
  clinicianName: string | null;
  type: string | null;
  day: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  locationType: string | null;
  retired: boolean;
};

export type AllocationVisibilityData = {
  appointment: Appointment | null;
  legacyAssignedSlot?: string | null;
  options: Array<{
    status: "pending" | "selected" | "declined" | "unavailable";
    createdAt: string;
    sentAt: string | null;
    clinicianName: string | null;
    slot: Omit<Appointment, "clinicianName"> | null;
  }>;
};

export function appointmentText(appointment: Appointment | null): string {
  if (!appointment) return "Appointment details unavailable";
  const day = appointment.type === "SpecificDate" ? appointment.date : appointment.day;
  const start = appointment.startTime;
  const end = appointment.endTime;
  if (!day && !start && !end) return "Appointment day/time unavailable";
  if (day && start) {
    try {
      return formatAssignedSlot(`${day} ${start}`) + (end ? `–${end}` : "");
    } catch {
      return "Appointment date unavailable";
    }
  }
  return [day || "Day/date unavailable", start || (end ? `End ${end} · start time unavailable` : "Time unavailable")]
    .join(" · ");
}

function Location({ type }: { type: string | null }) {
  return <span>{type === "in_person" ? "In-Person" : type === "online" ? "Online" : "Location unavailable"}</span>;
}

export function SelectedAppointment({ data, clientId, historicSlot }: {
  data: AllocationVisibilityData | null; clientId: string; historicSlot?: string | null;
}) {
  const appointment = data?.appointment ?? null;
  const legacySlot = data?.legacyAssignedSlot ?? historicSlot;
  const completeTime = appointment?.startTime &&
    (appointment.type === "SpecificDate" ? appointment.date : appointment.day);
  return <div className="mt-2 text-[10px] text-muted-foreground space-y-0.5" data-testid={`selected-appointment-${clientId}`}>
    <p className="font-medium text-foreground">Selected appointment</p>
    <p>{appointment?.clinicianName || "Clinician unavailable"}</p>
    <p>{appointmentText(appointment)}</p>
    {!completeTime && legacySlot?.trim() && <p data-testid={`historic-slot-${clientId}`}>
      Recorded appointment text (not verified): {legacySlot}
    </p>}
    <p><Location type={appointment?.locationType ?? null} />{appointment?.retired ? " · Slot retired" : ""}</p>
  </div>;
}

export function OfferedOptions({ data, clientId, initiallyOpen = false }: {
  data: AllocationVisibilityData | null; clientId: string; initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return <div className="mt-2" data-testid={`offer-history-${clientId}`}>
    <button type="button" className="text-[10px] underline text-indigo-700" onClick={() => setOpen(!open)}
      aria-expanded={open}>Offered options ({data?.options.length ?? 0})</button>
    {open && <div className="mt-1 space-y-2 text-[10px]">
      {data?.options.length ? data.options.map((option, index) => <div key={index} className="border rounded p-1.5">
        <p className="font-medium capitalize">{option.status[0].toUpperCase() + option.status.slice(1)}</p>
        <p>{option.clinicianName || "Clinician unavailable"} · {appointmentText(option.slot ? { ...option.slot, clinicianName: option.clinicianName } : null)}</p>
        <p><Location type={option.slot?.locationType ?? null} />{option.slot?.retired ? " · Slot retired" : ""}</p>
        <p>{option.sentAt ? `Sent ${formatDateUK(option.sentAt)}` : `Offer created ${formatDateUK(option.createdAt)} · send time unavailable`}</p>
      </div>) : <p>No recorded options</p>}
    </div>}
  </div>;
}

export function AllocationCardDetails({
  enabled, status, data, clientId, notes, historicSlot,
}: {
  enabled: boolean;
  status: string;
  data: AllocationVisibilityData | null;
  clientId: string;
  notes: string | null | undefined;
  historicSlot?: string | null;
}) {
  if (!enabled) return null;
  return <>
    {status !== "OptionsSent" && <SelectedAppointment data={data} clientId={clientId} historicSlot={historicSlot} />}
    <OfferedOptions key={`${clientId}-${status}`} data={data} clientId={clientId}
      initiallyOpen={["Assigned", "OptionsSent", "OptionSelected"].includes(status)} />
    {notes && <p className="text-[10px] text-muted-foreground mt-1 italic line-clamp-2" data-testid={`notes-${clientId}`}>"{notes}"</p>}
  </>;
}