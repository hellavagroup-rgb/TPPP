import { and, eq } from "drizzle-orm";
import { availabilityTimeOffBlocks, type AvailabilityTimeOffBlock } from "@shared/schema";
import { timeOffBlockOverlapsSlot } from "@shared/timeOffBlocks";

export async function findTimeOffBlockForSlot(
  tx: any,
  tenantId: string,
  slot: { type: string; date?: string | null; clinicianId: string; startTime: string; endTime: string; day?: string | null; startDate?: string | null; endDate?: string | null; frequency?: string | null },
  occurrenceDate?: string,
): Promise<AvailabilityTimeOffBlock | undefined> {
  const date = slot.type === "SpecificDate" ? slot.date : occurrenceDate;
  if (!date) return undefined;
  const blocks: AvailabilityTimeOffBlock[] = await tx.select().from(availabilityTimeOffBlocks).where(and(
    eq(availabilityTimeOffBlocks.tenantId, tenantId),
    eq(availabilityTimeOffBlocks.clinicianId, slot.clinicianId),
    eq(availabilityTimeOffBlocks.date, date),
  ));
  return blocks.find(block => timeOffBlockOverlapsSlot(block, slot, occurrenceDate));
}
