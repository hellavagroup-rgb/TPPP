import type { BookingSnapshot, Client, TimeSlot } from "./schema";

export type OfferRow = {
  clientId: string;
  tenantId: string;
  slotId: string | null;
  clinicianId: string;
  clinicianTenantId: string | null;
  status: "pending" | "selected" | "declined" | "unavailable";
  createdAt: Date;
  sentAt: Date | null;
  clinicianName: string | null;
  slot: TimeSlot | null;
};

export type AssignmentRow = {
  clientId: string;
  tenantId: string | null;
  clinicianId: string | null;
  clinicianTenantId: string | null;
  slot: TimeSlot | null;
  clinicianName: string | null;
  snapshot: BookingSnapshot | null;
  snapshotClinicianTenantId?: string | null;
};

export function projectAllocationVisibility(client: Client, row: AssignmentRow, offered: OfferRow[]) {
  const tenantId = client.tenantId;
  const ownsClientRow = !!tenantId && row.clientId === client.id && row.tenantId === tenantId;
  const matchingSlot = (slot: TimeSlot | null, slotId: string | null) =>
    !!slot && !!slotId && slot.id === slotId && slot.tenantId === tenantId;
  const assignmentSlot = ownsClientRow && client.assignedSlotId &&
    matchingSlot(row.slot, client.assignedSlotId) &&
    !!client.assignedClinicianId &&
    row.clinicianId === client.assignedClinicianId &&
    row.clinicianTenantId === tenantId &&
    row.slot!.clinicianId === row.clinicianId
    ? row.slot : null;
  const assignmentClinicianName = ownsClientRow && client.assignedClinicianId &&
    row.clinicianId === client.assignedClinicianId && row.clinicianTenantId === tenantId &&
    (!client.assignedSlotId || !row.slot)
    ? row.clinicianName : null;

  const safeOffers = offered.flatMap(option => {
    const ownsOption = !!tenantId && option.clientId === client.id && option.tenantId === tenantId;
    if (!ownsOption) return [];
    const clinicianVerified = ownsOption && option.clinicianTenantId === tenantId;
    const slotVerified = clinicianVerified && matchingSlot(option.slot, option.slotId) &&
      option.slot!.clinicianId === option.clinicianId;
    return [{
      option,
      clinicianName: clinicianVerified && (!option.slot || slotVerified) ? option.clinicianName : null,
      slot: slotVerified ? option.slot : null,
      clinicianVerified,
      slotVerified,
    }];
  });
  const selected = safeOffers.find(({ option, clinicianVerified, slotVerified }) =>
    option.status === "selected" && !!option.slotId && clinicianVerified &&
    (!option.slot || slotVerified) &&
    (!client.assignedSlotId || option.slotId === client.assignedSlotId));

  const snapshot = ownsClientRow && row.snapshot &&
    row.snapshot.clientId === client.id && row.snapshot.tenantId === tenantId &&
    (!client.assignedClinicianId || row.snapshot.clinicianId === client.assignedClinicianId) &&
    (!row.snapshot.slotId || !client.assignedSlotId || row.snapshot.slotId === client.assignedSlotId) &&
    (!row.snapshot.clinicianId || row.snapshotClinicianTenantId === tenantId) &&
    (!row.snapshot.slotId || !row.slot || row.snapshot.slotId !== row.slot.id ||
      (row.slot.tenantId === tenantId &&
        (!row.snapshot.clinicianId || row.snapshot.clinicianId === row.slot.clinicianId)))
    ? row.snapshot : null;
  const selectedSlot = selected?.slot ?? null;
  const appointment = snapshot
    ? { clinicianName: snapshot.clinicianName, type: snapshot.slotType, day: snapshot.day,
        date: snapshot.date, startTime: snapshot.startTime, endTime: snapshot.endTime,
        locationType: snapshot.locationType, retired: false }
    : assignmentSlot
      ? { clinicianName: row.clinicianName, type: assignmentSlot.type, day: assignmentSlot.day,
          date: assignmentSlot.date, startTime: assignmentSlot.startTime, endTime: assignmentSlot.endTime,
          locationType: assignmentSlot.locationType, retired: !!assignmentSlot.retiredAt }
      : selected
        ? { clinicianName: selected.clinicianName, type: selectedSlot?.type ?? null,
            day: selectedSlot?.day ?? null, date: selectedSlot?.date ?? null,
            startTime: selectedSlot?.startTime ?? null, endTime: selectedSlot?.endTime ?? null,
            locationType: selectedSlot?.locationType ?? null, retired: !!selectedSlot?.retiredAt }
        : assignmentClinicianName
          ? { clinicianName: assignmentClinicianName, type: null, day: null, date: null,
              startTime: null, endTime: null, locationType: null, retired: false }
        : null;
  return {
    appointment,
    legacyAssignedSlot: ownsClientRow ? client.assignedSlot ?? null : null,
    options: safeOffers.map(({ option: o, clinicianName, slot }) => ({
      status: o.status, createdAt: o.createdAt, sentAt: o.sentAt,
      clinicianName,
      slot: slot ? { type: slot.type, day: slot.day, date: slot.date,
        startTime: slot.startTime, endTime: slot.endTime,
        locationType: slot.locationType, retired: !!slot.retiredAt } : null,
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