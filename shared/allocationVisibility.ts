import type { BookingSnapshot, Client, TimeSlot } from "./schema";

export type OfferRow = {
  clientId: string;
  slotId: string | null;
  status: "pending" | "selected" | "declined" | "unavailable";
  createdAt: Date;
  sentAt: Date | null;
  clinicianName: string | null;
  slot: TimeSlot | null;
};

export type AssignmentRow = {
  clientId: string;
  slot: TimeSlot | null;
  clinicianName: string | null;
  snapshot: BookingSnapshot | null;
};

export function projectAllocationVisibility(client: Client, row: AssignmentRow, offered: OfferRow[]) {
  const selected = offered.find(o => o.status === "selected" && !!o.slotId &&
    (!client.assignedSlotId || o.slotId === client.assignedSlotId));
  const snapshot = row.snapshot && (!client.assignedSlotId || row.snapshot.slotId === client.assignedSlotId)
    ? row.snapshot : null;
  const slot = row.slot ?? selected?.slot ?? null;
  const appointment = snapshot
    ? { clinicianName: snapshot.clinicianName, type: snapshot.slotType, day: snapshot.day,
        date: snapshot.date, startTime: snapshot.startTime, endTime: snapshot.endTime,
        locationType: snapshot.locationType, retired: false }
    : slot
      ? { clinicianName: selected?.clinicianName ?? row.clinicianName ?? null,
          type: slot.type, day: slot.day, date: slot.date, startTime: slot.startTime,
          endTime: slot.endTime, locationType: slot.locationType, retired: !!slot.retiredAt }
      : selected || (client.assignedSlotId && row.clinicianName)
        ? { clinicianName: selected?.clinicianName ?? row.clinicianName ?? null,
            type: null, day: null, date: null, startTime: null, endTime: null,
            locationType: null, retired: false }
        : null;
  return {
    appointment,
    options: offered.map(o => ({
      status: o.status, createdAt: o.createdAt, sentAt: o.sentAt,
      clinicianName: o.clinicianName,
      slot: o.slot ? { type: o.slot.type, day: o.slot.day, date: o.slot.date,
        startTime: o.slot.startTime, endTime: o.slot.endTime,
        locationType: o.slot.locationType, retired: !!o.slot.retiredAt } : null,
    })),
  };
}

// Preserve the existing API contract for practices that have not opted in.
export function withTenantAllocationVisibility<T extends { id: string; tenantId: string | null }>(
  client: T,
  tenantId: string,
  enabled: boolean,
  visibility: Map<string, ReturnType<typeof projectAllocationVisibility>> | null,
): T | (T & { allocationVisibility: ReturnType<typeof projectAllocationVisibility> | null }) {
  if (!enabled || client.tenantId !== tenantId || !visibility) return client;
  return { ...client, allocationVisibility: visibility.get(client.id) ?? null };
}