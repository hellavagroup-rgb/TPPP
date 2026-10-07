export type BookingCompletionEvidence = {
  status: string;
  isArchived: boolean;
  confirmedAt: Date | string | null;
  writeuppAppointmentConfirmed: boolean | null;
  writeuppDataTransferred: boolean | null;
  paymentType: string | null;
  paymentStatus: string | null;
};

export type BookingCompletionBlockerCode =
  | "archived"
  | "booking_unverified"
  | "writeupp_incomplete"
  | "payment_type_missing"
  | "payment_setup_unverified";

export const bookingCompletionBlockerCopy: Record<BookingCompletionBlockerCode, string> = {
  archived: "Restore this archived client before completing a booking.",
  booking_unverified: "A confirmed booking with a booking record is required before completion.",
  writeupp_incomplete: "Complete both WriteUpp checklist items first.",
  payment_type_missing: "Review and set the payment type before completing this older booking.",
  payment_setup_unverified: "Verify self-pay payment setup before completing this booking.",
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
  const code = bookingCompletionBlockerCode(client, options);
  return code ? bookingCompletionBlockerCopy[code] : null;
}

export function bookingCompletionBlockerCode(
  client: BookingCompletionEvidence,
  options: { hasSnapshot: boolean; checklistEnabled: boolean },
): BookingCompletionBlockerCode | null {
  if (client.isArchived) return "archived";
  if (client.status !== "BookingConfirmed" || !client.confirmedAt || !options.hasSnapshot) {
    return "booking_unverified";
  }
  if (options.checklistEnabled && (!client.writeuppAppointmentConfirmed || !client.writeuppDataTransferred)) {
    return "writeupp_incomplete";
  }
  if (client.paymentType !== "self_pay" && client.paymentType !== "insurer") {
    return "payment_type_missing";
  }
  if (client.paymentType === "self_pay" && client.paymentStatus !== "active") {
    return "payment_setup_unverified";
  }
  return null;
}