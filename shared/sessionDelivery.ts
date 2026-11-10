import { isCyaPsychologyTenant } from "./practicePolicies";

export type DeliveryMode = "online" | "in_person";

/** Availability capability, not the mode of an existing offer or booking. */
export function availableDeliveryModes(tenantId: string | null | undefined, slotMode: unknown): DeliveryMode[] {
  if (slotMode === "online") return ["online"];
  if (slotMode === "in_person") return isCyaPsychologyTenant(tenantId) ? ["in_person", "online"] : ["in_person"];
  return [];
}

/** Undefined preserves legacy behaviour; invalid/unsupported requests fail explicitly. */
export function resolveDeliveryMode(tenantId: string | null | undefined, slotMode: unknown, requested?: unknown): DeliveryMode | null {
  const mode = requested === undefined ? slotMode : requested;
  return availableDeliveryModes(tenantId, slotMode).find(value => value === mode) ?? null;
}

export function deliveryModeLabel(mode: unknown): string {
  return mode === "in_person" ? "In person" : "Online";
}
