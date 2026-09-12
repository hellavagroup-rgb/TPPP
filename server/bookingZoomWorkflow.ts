import { createHash } from "node:crypto";

export function zoomDeliveryIdempotencyKey(input: {
  clientId: string;
  slotId: string;
  clinicianId: string;
  clientEmail: string;
  zoomLink: string;
}): string {
  const generation = createHash("sha256")
    .update(JSON.stringify([
      input.clientId,
      input.slotId,
      input.clinicianId,
      input.clientEmail.trim().toLowerCase(),
      input.zoomLink.trim(),
    ]))
    .digest("hex")
    .slice(0, 24);
  return `admin-zoom-follow-up-${input.clientId}-${generation}`;
}