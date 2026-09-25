export type BookingCompletionEvidence = {
  status: string;
  isArchived: boolean;
  confirmedAt: Date | string | null;
  writeuppAppointmentConfirmed: boolean | null;
  writeuppDataTransferred: boolean | null;
  paymentType: string | null;
  paymentStatus: string | null;
};

export function bookingCompletionDecision(
  client: BookingCompletionEvidence & { tenantId: string | null; completedAt: Date | string | null },
  options: { tenantId: string; enabled: boolean; hasSnapshot: boolean; checklistEnabled: boolean },
): { kind: "denied" | "already_completed" | "blocked" | "ready"; reason?: string } {
  if (!options.enabled || client.tenantId !== options.tenantId) return { kind: "denied" };
  if (client.completedAt) return { kind: "already_completed" };
  const reason = bookingCompletionBlocker(client, options);
  return reason ? { kind: "blocked", reason } : { kind: "ready" };
}

export function bookingCompletionBlocker(
  client: BookingCompletionEvidence,
  options: { hasSnapshot: boolean; checklistEnabled: boolean },
): string | null {
  if (client.isArchived) return "Restore this archived client before completing a booking.";
  if (client.status !== "BookingConfirmed" || !client.confirmedAt || !options.hasSnapshot) {
    return "A confirmed booking with a booking record is required before completion.";
  }
  if (options.checklistEnabled && (!client.writeuppAppointmentConfirmed || !client.writeuppDataTransferred)) {
    return "Complete both WriteUpp checklist items first.";
  }
  if (client.paymentType !== "self_pay" && client.paymentType !== "insurer") {
    return "Review and set the payment type before completing this older booking.";
  }
  if (client.paymentType === "self_pay" && client.paymentStatus !== "active") {
    return "Verify self-pay payment setup before completing this booking.";
  }
  return null;
}