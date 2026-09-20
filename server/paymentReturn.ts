export type PaymentReturnStatus = "invalid" | "processing" | "confirmed" | "paid" | "incomplete" | "failed";

export type PaymentReturnResult = {
  status: PaymentReturnStatus;
  practice?: {
    name: string;
    logoUrl: string | null;
    primaryColor: string | null;
  };
};

export type PaymentReturnSession = {
  paymentStatus: string | null | undefined;
  checkoutStatus: string | null | undefined;
  expiresAt: number | null | undefined;
  metadataTenantId: string | null | undefined;
  metadataClientId: string | null | undefined;
  metadataAttemptKey: string | null | undefined;
  paymentLinkId: string | null | undefined;
};

export type PaymentReturnClient = {
  id: string;
  tenantId: string | null;
  status: string;
  registrationPaymentAttemptKey: string | null;
  stripePaymentLinkId: string | null;
};

export function classifyPaymentReturn(input: {
  session: PaymentReturnSession;
  client: PaymentReturnClient | null;
  nowSeconds?: number;
}): PaymentReturnStatus {
  const { session, client } = input;
  if (!client
    || !session.metadataTenantId
    || session.metadataTenantId !== client.tenantId
    || session.metadataClientId !== client.id
    || !session.paymentLinkId
    || session.paymentLinkId !== client.stripePaymentLinkId) {
    return "invalid";
  }

  const isRegistrationPayment = !!session.metadataAttemptKey;
  if (isRegistrationPayment && session.metadataAttemptKey !== client.registrationPaymentAttemptKey) {
    return "invalid";
  }

  if (session.paymentStatus !== "paid") {
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (session.checkoutStatus === "expired" || (!!session.expiresAt && session.expiresAt <= now)) {
      return "invalid";
    }
    return "incomplete";
  }

  if (!isRegistrationPayment) return "paid";
  if (client.status === "Scheduled" || client.status === "BookingConfirmed") return "confirmed";
  if (client.status === "RegistrationPending") return "processing";
  return "failed";
}