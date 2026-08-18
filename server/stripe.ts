import Stripe from "stripe";

// Get the Stripe key — env var takes priority, then tenant-stored key
export function getStripeKey(tenantKey?: string | null): string | null {
  return process.env.STRIPE_SECRET_KEY || tenantKey || null;
}

export function getStripeInstance(tenantKey?: string | null): Stripe | null {
  const key = getStripeKey(tenantKey);
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2025-05-28.basil" });
}

// Legacy helper - checks env var only (for status endpoint before tenant is loaded)
export function isStripeConfigured(tenantKey?: string | null): boolean {
  return !!getStripeKey(tenantKey);
}

export async function createCheckoutSession(opts: {
  clientId: string;
  clientEmail: string;
  clientDisplayId: string;
  clientName?: string | null;
  amountPence: number;
  successUrl: string;
  cancelUrl: string;
  tenantId?: string | null;
  tenantStripeKey?: string | null;
  practiceName?: string | null;
}): Promise<{ url: string; customerId: string; sessionId: string } | null> {
  const stripe = getStripeInstance(opts.tenantStripeKey);
  if (!stripe) return null;

  // Use the client's name if available; fall back to their W-number so Zapier/Xero
  // always has a usable identifier when creating the Xero contact and invoice.
  const customerName = opts.clientName?.trim() || opts.clientDisplayId;

  const customer = await stripe.customers.create({
    email: opts.clientEmail,
    name: customerName,
    metadata: { clientId: opts.clientId, displayId: opts.clientDisplayId },
  });

  const session = await stripe.checkout.sessions.create({
    customer: customer.id,
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "gbp",
          unit_amount: opts.amountPence,
          product_data: {
            name: "Initial Therapy Session",
            description: opts.practiceName || "PsychPortal",
          },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      setup_future_usage: "off_session",
    },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    metadata: {
      clientId: opts.clientId,
      displayId: opts.clientDisplayId,
      ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    },
  });

  return { url: session.url!, customerId: customer.id, sessionId: session.id };
}

export async function chargeOffSession(opts: {
  customerId: string;
  paymentMethodId: string;
  amountPence: number;
  clientDisplayId: string;
  clientId?: string | null;
  tenantId?: string | null;
  tenantStripeKey?: string | null;
}): Promise<{ paymentIntentId: string; status: string }> {
  const stripe = getStripeInstance(opts.tenantStripeKey);
  if (!stripe) throw new Error("Stripe not configured");

  const paymentIntent = await stripe.paymentIntents.create({
    amount: opts.amountPence,
    currency: "gbp",
    customer: opts.customerId,
    payment_method: opts.paymentMethodId,
    off_session: true,
    confirm: true,
    description: `Session charge for ${opts.clientDisplayId}`,
    metadata: {
      displayId: opts.clientDisplayId,
      ...(opts.clientId ? { clientId: opts.clientId } : {}),
      ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    },
  });

  return { paymentIntentId: paymentIntent.id, status: paymentIntent.status };
}

export function constructWebhookEvent(payload: Buffer, sig: string, secret: string, tenantKey?: string | null): Stripe.Event {
  // The Stripe key here only instantiates the client for webhooks.constructEvent — the key itself
  // doesn't affect signature verification; only the webhook secret does.
  const key = tenantKey || process.env.STRIPE_SECRET_KEY || "placeholder";
  const stripe = new Stripe(key, { apiVersion: "2025-05-28.basil" });
  return stripe.webhooks.constructEvent(payload, sig, secret);
}
