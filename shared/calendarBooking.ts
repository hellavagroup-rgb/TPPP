/** Calendar confirmation includes staff-recorded WriteUpp bookings, not just portal checkout. */
export function isCalendarConfirmed(client: { status: string; writeuppArranged?: boolean | null }): boolean {
  return ["Scheduled", "BookingConfirmed"].includes(client.status) ||
    (["AwaitingConfirmation", "RegistrationPending"].includes(client.status) && client.writeuppArranged === true);
}

export function visibleCalendarSlots<T extends { id: string }>(
  slots: T[],
  reservations: { assignedSlotId: string | null; status: string; writeuppArranged?: boolean | null }[],
): T[] {
  const occupied = new Set(reservations.filter(isCalendarConfirmed).map(client => client.assignedSlotId));
  return slots.filter(slot => !occupied.has(slot.id));
}
