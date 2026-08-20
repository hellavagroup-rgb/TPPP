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

// Creates a persistent (non-expiring) Stripe Payment Link for the client's initial
// session payment. Unlike Checkout Sessions (which Stripe hard-caps at 24h expiry),
// Payment Links never expire. No Stripe Customer is pre-created — Stripe creates one
// from the details the client types at checkout, which gives Zapier/Xero a real
// contact name instead of a bare W-number. The webhook tags the customer with our
// identifiers after payment.
export async function createPaymentLink(opts: {
  clientId: string;
  clientDisplayId: string;
  amountPence: number;
  successUrl: string;
  tenantId?: string | null;
  tenantStripeKey?: string | null;
  practiceName?: string | null;
  // If the client already has an active link, pass its ID so it is deactivated first
  previousPaymentLinkId?: string | null;
}): Promise<{ url: string; paymentLinkId: string } | null> {
  const stripe = getStripeInstance(opts.tenantStripeKey);
  if (!stripe) return null;

  // Deactivate any previous link so the client can't pay against a stale rate
  if (opts.previousPaymentLinkId) {
    let previousLinkDeactivated = false;
    try {
      await stripe.paymentLinks.update(opts.previousPaymentLinkId, { active: false });
      previousLinkDeactivated = true;
    } catch (e: any) {
      console.warn(`Failed to deactivate previous payment link ${opts.previousPaymentLinkId}:`, e?.message);
    }

    // Each generated link has its own one-off Price. Once the link is inactive,
    // archive that Price too so repeated regeneration does not leave a growing
    // list of active, unused prices in the Stripe dashboard.
    if (previousLinkDeactivated) {
      try {
        const previousLink = await stripe.paymentLinks.retrieve(opts.previousPaymentLinkId, {
          expand: ["line_items"],
        });
        const lineItems = (previousLink as Stripe.PaymentLink & {
          line_items?: { data?: Array<{ price?: string | Stripe.Price | null }> };
        }).line_items?.data || [];

        for (const item of lineItems) {
          const priceId = typeof item.price === "string" ? item.price : item.price?.id;
          if (priceId) {
            await stripe.prices.update(priceId, { active: false });
          }
        }
      } catch (e: any) {
        // Price cleanup is housekeeping; never prevent creation of the new link.
        console.warn(`Failed to archive the previous payment link price for ${opts.previousPaymentLinkId}:`, e?.message);
      }
    }
  }

  // Payment Links require a Price object (inline price_data is not supported)
  const price = await stripe.prices.create({
    currency: "gbp",
    unit_amount: opts.amountPence,
    product_data: {
      name: `Initial Therapy Session — ${opts.practiceName || "PsychPortal"}`,
    },
  });

  const metadata = {
    clientId: opts.clientId,
    displayId: opts.clientDisplayId,
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
  };

  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    payment_method_types: ["card"],
    customer_creation: "always",
    // Stripe-enforced single use: the link deactivates itself after one completed
    // checkout, so a rapid double-payment race is impossible. Webhook deactivation
    // below remains as defense in depth.
    restrictions: { completed_sessions: { limit: 1 } },
    // Explicitly collect the payer's full name so the Stripe Customer always has
    // a real name — Zapier/Xero contact creation depends on it. Card checkout
    // alone does not guarantee the Customer name field is populated.
    name_collection: { individual: { enabled: true } },
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata,
    },
    after_completion: {
      type: "redirect",
      redirect: { url: opts.successUrl },
    },
    metadata, // propagates to the checkout session created when the client pays
  });

  return { url: link.url, paymentLinkId: link.id };
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
