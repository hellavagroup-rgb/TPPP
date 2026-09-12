export function isValidZoomLink(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us"));
  } catch {
    return false;
  }
}

export function onlineBookingNeedsZoomLink(locationType: string | null | undefined): boolean {
  return locationType === "online";
}

export function shouldResetZoomDelivery(
  current: { email?: string | null; assignedClinicianId?: string | null; assignedSlotId?: string | null },
  updates: { email?: string | null; assignedClinicianId?: string | null; assignedSlotId?: string | null },
): boolean {
  return (
    ("email" in updates && updates.email !== current.email) ||
    ("assignedClinicianId" in updates && updates.assignedClinicianId !== current.assignedClinicianId) ||
    ("assignedSlotId" in updates && updates.assignedSlotId !== current.assignedSlotId)
  );
}