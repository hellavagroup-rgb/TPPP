export function isExplicitlyWriteUppArranged(row: { writeuppArranged?: boolean | null }): boolean {
  return row.writeuppArranged === true;
}

export function getWriteUppArrangedIds(
  rows: Array<{ id: string; writeuppArranged?: boolean | null }> | undefined,
  state: { compactEnabled: boolean; historicEnabled: boolean; loading: boolean; error: boolean },
): Set<string> {
  if (!state.compactEnabled || !state.historicEnabled || state.loading || state.error || !rows) return new Set();
  return new Set(rows.filter(isExplicitlyWriteUppArranged).map(row => row.id));
}

export function classifyBookingProgress<T extends { status: string; writeuppArranged?: boolean | null }>(clients: T[]) {
  const confirmed = clients.filter(client => client.status === "BookingConfirmed");
  const awaiting = clients.filter(client =>
    client.status === "RegistrationPending" || client.status === "AwaitingConfirmation",
  );
  return {
    active: awaiting.filter(client => !isExplicitlyWriteUppArranged(client)),
    arranged: awaiting.filter(isExplicitlyWriteUppArranged),
    confirmed,
  };
}