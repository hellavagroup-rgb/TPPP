import { and, eq, inArray, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "./db";
import { clients, clientClinicianOptions, timeSlots, clinicians, users, bookingSnapshots } from "@shared/schema";
import type { Client } from "@shared/schema";
import { projectAllocationVisibility } from "@shared/allocationVisibility";

// Fetch by tenant AND by client ownership. Never expose selection tokens in staff responses.
export async function getAllocationVisibility(clientList: Client[], tenantId: string) {
  if (!clientList.length) return new Map<string, ReturnType<typeof projectAllocationVisibility>>();
  const ownedClients = clientList.filter(client => client.tenantId === tenantId);
  if (!ownedClients.length) return new Map<string, ReturnType<typeof projectAllocationVisibility>>();
  const ids = ownedClients.map(c => c.id);
  const clientsById = new Map(ownedClients.map(c => [c.id, c]));
  const snapshotClinicians = alias(clinicians, "allocation_snapshot_clinicians");
  const [options, assignments, snapshots] = await Promise.all([
    db.select({
      clientId: clientClinicianOptions.clientId,
      tenantId: clientClinicianOptions.tenantId,
      slotId: clientClinicianOptions.slotId,
      locationType: clientClinicianOptions.locationType,
      clinicianId: clientClinicianOptions.clinicianId,
      clinicianTenantId: clinicians.tenantId,
      status: clientClinicianOptions.status,
      createdAt: clientClinicianOptions.createdAt,
      sentAt: clientClinicianOptions.sentAt,
      clinicianName: users.name,
      slot: timeSlots,
    }).from(clientClinicianOptions)
      .innerJoin(clients, and(eq(clients.id, clientClinicianOptions.clientId), eq(clients.tenantId, tenantId)))
      .leftJoin(clinicians, and(eq(clinicians.id, clientClinicianOptions.clinicianId), eq(clinicians.tenantId, tenantId)))
      .leftJoin(users, and(eq(users.id, clinicians.userId), eq(users.tenantId, tenantId)))
      // Load the referenced row even when corrupt legacy data points across
      // tenants; the shared projection checks ownership before exposing it.
      .leftJoin(timeSlots, eq(timeSlots.id, clientClinicianOptions.slotId))
      .where(and(eq(clientClinicianOptions.tenantId, tenantId), inArray(clientClinicianOptions.clientId, ids)))
      .orderBy(desc(clientClinicianOptions.createdAt)),
    db.select({
      clientId: clients.id,
      tenantId: clients.tenantId,
      clinicianId: clients.assignedClinicianId,
      clinicianTenantId: clinicians.tenantId,
      slot: timeSlots,
      clinicianName: users.name,
    }).from(clients)
      .leftJoin(timeSlots, eq(timeSlots.id, clients.assignedSlotId))
      .leftJoin(clinicians, and(eq(clinicians.id, clients.assignedClinicianId), eq(clinicians.tenantId, tenantId)))
      .leftJoin(users, and(eq(users.id, clinicians.userId), eq(users.tenantId, tenantId)))
      .where(and(eq(clients.tenantId, tenantId), inArray(clients.id, ids))),
    db.select({
      snapshot: bookingSnapshots,
      snapshotClinicianTenantId: snapshotClinicians.tenantId,
    }).from(bookingSnapshots)
      .leftJoin(snapshotClinicians, and(
        eq(snapshotClinicians.id, bookingSnapshots.clinicianId),
        eq(snapshotClinicians.tenantId, tenantId),
      ))
      .where(and(eq(bookingSnapshots.tenantId, tenantId), inArray(bookingSnapshots.clientId, ids)))
      .orderBy(desc(bookingSnapshots.confirmedAt), desc(bookingSnapshots.id)),
  ]);
  const latestSnapshots = new Map<string, typeof snapshots[number]>();
  for (const snapshot of snapshots) {
    if (!latestSnapshots.has(snapshot.snapshot.clientId)) latestSnapshots.set(snapshot.snapshot.clientId, snapshot);
  }
  const byClient = new Map<string, typeof options>();
  for (const option of options) {
    byClient.set(option.clientId, [...(byClient.get(option.clientId) ?? []), option]);
  }
  return new Map(assignments.flatMap(row => {
    const client = clientsById.get(row.clientId);
    if (!client || row.tenantId !== tenantId) return [];
    const offered = byClient.get(row.clientId) ?? [];
    const latest = latestSnapshots.get(row.clientId);
    return [[row.clientId, projectAllocationVisibility(client, {
      ...row,
      snapshot: latest?.snapshot ?? null,
      snapshotClinicianTenantId: latest?.snapshotClinicianTenantId ?? null,
    }, offered)] as const];
  }));
}