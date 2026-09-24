import { and, eq, inArray, desc } from "drizzle-orm";
import { db } from "./db";
import { clients, clientClinicianOptions, timeSlots, clinicians, users, bookingSnapshots } from "@shared/schema";
import type { Client } from "@shared/schema";
import { projectAllocationVisibility } from "@shared/allocationVisibility";

// Fetch by tenant AND by client ownership. Never expose selection tokens in staff responses.
export async function getAllocationVisibility(clientList: Client[], tenantId: string) {
  if (!clientList.length) return new Map<string, ReturnType<typeof projectAllocationVisibility>>();
  const ids = clientList.map(c => c.id);
  const clientsById = new Map(clientList.map(c => [c.id, c]));
  const [options, assignments] = await Promise.all([
    db.select({
      clientId: clientClinicianOptions.clientId,
      slotId: clientClinicianOptions.slotId,
      status: clientClinicianOptions.status,
      createdAt: clientClinicianOptions.createdAt,
      sentAt: clientClinicianOptions.sentAt,
      clinicianName: users.name,
      slot: timeSlots,
    }).from(clientClinicianOptions)
      .innerJoin(clients, and(eq(clients.id, clientClinicianOptions.clientId), eq(clients.tenantId, tenantId)))
      .leftJoin(clinicians, and(eq(clinicians.id, clientClinicianOptions.clinicianId), eq(clinicians.tenantId, tenantId)))
      .leftJoin(users, and(eq(users.id, clinicians.userId), eq(users.tenantId, tenantId)))
      .leftJoin(timeSlots, and(eq(timeSlots.id, clientClinicianOptions.slotId), eq(timeSlots.tenantId, tenantId)))
      .where(and(eq(clientClinicianOptions.tenantId, tenantId), inArray(clientClinicianOptions.clientId, ids)))
      .orderBy(desc(clientClinicianOptions.createdAt)),
    db.select({
      clientId: clients.id,
      slot: timeSlots,
      clinicianName: users.name,
      snapshot: bookingSnapshots,
    }).from(clients)
      .leftJoin(timeSlots, and(eq(timeSlots.id, clients.assignedSlotId), eq(timeSlots.tenantId, tenantId)))
      .leftJoin(clinicians, and(eq(clinicians.id, clients.assignedClinicianId), eq(clinicians.tenantId, tenantId)))
      .leftJoin(users, and(eq(users.id, clinicians.userId), eq(users.tenantId, tenantId)))
      .leftJoin(bookingSnapshots, and(eq(bookingSnapshots.clientId, clients.id), eq(bookingSnapshots.tenantId, tenantId)))
      .where(and(eq(clients.tenantId, tenantId), inArray(clients.id, ids))),
  ]);
  const byClient = new Map<string, typeof options>();
  for (const option of options) {
    byClient.set(option.clientId, [...(byClient.get(option.clientId) ?? []), option]);
  }
  return new Map(assignments.map(row => {
    const client = clientsById.get(row.clientId)!;
    const offered = byClient.get(row.clientId) ?? [];
    return [row.clientId, projectAllocationVisibility(client, row, offered)];
  }));
}