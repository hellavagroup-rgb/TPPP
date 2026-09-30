import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { clientClinicianOptions, type Client } from "@shared/schema";

export type AllocationOfferState = "pending" | "declined" | "closed";

// Workflow actions need this summary even when appointment-detail visibility is off.
// Never include public selection tokens in the staff list.
export async function getAllocationOfferStates(clientList: Client[], tenantId: string) {
  const ownedIds = clientList
    .filter(client => client.tenantId === tenantId && client.status === "OptionsSent")
    .map(client => client.id);
  const result = new Map<string, AllocationOfferState>();
  if (!ownedIds.length) return result;
  const rows = await db.select({
    clientId: clientClinicianOptions.clientId,
    tenantId: clientClinicianOptions.tenantId,
    status: clientClinicianOptions.status,
    createdAt: clientClinicianOptions.createdAt,
  }).from(clientClinicianOptions).where(and(
    eq(clientClinicianOptions.tenantId, tenantId),
    inArray(clientClinicianOptions.clientId, ownedIds),
  )).orderBy(desc(clientClinicianOptions.createdAt));
  for (const id of ownedIds) {
    const options = rows.filter(row => row.clientId === id && row.tenantId === tenantId);
    const newestTime = options[0]?.createdAt?.getTime();
    const latest = options.filter(row => row.createdAt?.getTime() === newestTime);
    result.set(id, options.some(row => row.status === "pending") ? "pending"
      : latest.length && latest.every(row => row.status === "declined") ? "declined" : "closed");
  }
  return result;
}