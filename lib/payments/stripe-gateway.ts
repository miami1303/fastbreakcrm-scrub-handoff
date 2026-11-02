import "server-only";
import Stripe from "stripe";
import {
  detectStripeMode,
  safeLast4,
  scrubSecrets,
  webhookSecretConfigured,
  type CardSnapshot,
  type StripeReadiness,
} from "./decide";
import { stripeLinkMethods } from "../payment-methods";

export function readStripeReadiness(): StripeReadiness {
  return detectStripeMode(process.env.STRIPE_SECRET_KEY, process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
}

export function readWebhookConfigured(): boolean {
  return webhookSecretConfigured(process.env.STRIPE_WEBHOOK_SECRET);
}

let cached: { key: string; stripe: Stripe } | null = null;

/** Null when keys are missing or test/live do not match. Never charges by itself. */
export function getStripe(): Stripe | null {
  if (!readStripeReadiness().connected) return null;
  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) return null;
  if (cached?.key === key) return cached.stripe;
  const stripe = new Stripe(key, { maxNetworkRetries: 1 });
  cached = { key, stripe };
  return stripe;
}

export function stripeErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return scrubSecrets((error as { message: string }).message).slice(0, 300);
  }
  return "Stripe did not complete this. Nothing was marked paid.";
}

export function paymentIntentIdFromError(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("payment_intent" in error)) return null;
  const paymentIntent = (error as { payment_intent?: { id?: string } | string }).payment_intent;
  if (typeof paymentIntent === "string") return paymentIntent || null;
  return paymentIntent?.id || null;
}

export function cardFromStripe(value: unknown): CardSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const card = "card" in value ? (value as { card?: Stripe.PaymentMethod.Card | null }).card : null;
  if (!card) return null;
  return {
    brand: card.brand || null,
    last4: safeLast4(card.last4),
    expMonth: card.exp_month || null,
    expYear: card.exp_year || null,
  };
}

const NOT_CONNECTED = "Stripe is not connected. No charge was made.";

export async function createStripeCustomer(input: { name: string; email: string | null; phone: string | null; crmCustomerId: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: NOT_CONNECTED };
  try {
    const customer = await stripe.customers.create({
      name: input.name || undefined,
      email: input.email || undefined,
      phone: input.phone || undefined,
      metadata: { crm_customer_id: input.crmCustomerId },
    });
    return { ok: true, id: customer.id };
  } catch (error) {
    return { ok: false, error: stripeErrorMessage(error) };
  }
}

export async function createCardSetup(input: { stripeCustomerId: string; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ ok: true; id: string; clientSecret: string } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: NOT_CONNECTED };
  try {
    const setup = await stripe.setupIntents.create({
      customer: input.stripeCustomerId,
      allowed_payment_method_types: ["card"],
      usage: "off_session",
      metadata: input.metadata,
    }, { idempotencyKey: input.idempotencyKey });
    if (!setup.client_secret) return { ok: false, error: "Stripe did not open the secure card box. Nothing was charged." };
    return { ok: true, id: setup.id, clientSecret: setup.client_secret };
  } catch (error) {
    return { ok: false, error: stripeErrorMessage(error) };
  }
}

export async function createCardPayment(input: { amountCents: number; stripeCustomerId: string; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ ok: true; id: string; clientSecret: string } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: NOT_CONNECTED };
  if (input.amountCents <= 0) return { ok: false, error: "Refusing to charge a zero or negative amount. No money was moved." };
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: "usd",
      customer: input.stripeCustomerId,
      allowed_payment_method_types: ["card"],
      setup_future_usage: "off_session",
      metadata: input.metadata,
    }, { idempotencyKey: input.idempotencyKey });
    if (!paymentIntent.client_secret) return { ok: false, error: "Stripe did not open the secure card box. Nothing was charged." };
    return { ok: true, id: paymentIntent.id, clientSecret: paymentIntent.client_secret };
  } catch (error) {
    return { ok: false, error: stripeErrorMessage(error) };
  }
}

export async function chargeSavedCard(input: { amountCents: number; stripeCustomerId: string; paymentMethodId: string; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ ok: true; id: string; status: string; amount: number; currency: string; card: CardSnapshot | null } | { ok: false; error: string; paymentIntentId: string | null }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: NOT_CONNECTED, paymentIntentId: null };
  if (input.amountCents <= 0) return { ok: false, error: "Refusing to charge a zero or negative amount. No money was moved.", paymentIntentId: null };
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: "usd",
      customer: input.stripeCustomerId,
      payment_method: input.paymentMethodId,
      allowed_payment_method_types: ["card"],
      confirm: true,
      off_session: true,
      error_on_requires_action: true,
      metadata: input.metadata,
      expand: ["payment_method"],
    }, { idempotencyKey: input.idempotencyKey });
    const card = paymentIntent.payment_method && typeof paymentIntent.payment_method === "object" ? cardFromStripe(paymentIntent.payment_method) : null;
    return { ok: true, id: paymentIntent.id, status: paymentIntent.status, amount: paymentIntent.amount, currency: paymentIntent.currency, card };
  } catch (error) {
    return { ok: false, error: stripeErrorMessage(error), paymentIntentId: paymentIntentIdFromError(error) };
  }
}

/**
 * Return to customer (refund) on one Stripe PaymentIntent. Only called from the separate
 * Return to Customer box, never from a charge. Idempotency key required.
 */
export async function refundCardPayment(input: { paymentIntentId: string; amountCents: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ ok: true; id: string; status: string; amount: number } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Stripe is not connected. Nothing was returned to the customer." };
  if (!input.idempotencyKey) return { ok: false, error: "This was stopped because its safety key was missing. Nothing was returned." };
  try {
    const refund = await stripe.refunds.create({
      payment_intent: input.paymentIntentId,
      amount: input.amountCents,
      reason: "requested_by_customer",
      metadata: input.metadata,
    }, { idempotencyKey: `refund-${input.idempotencyKey}` });
    return { ok: true, id: refund.id, status: refund.status || "pending", amount: refund.amount };
  } catch (error) {
    return { ok: false, error: `${stripeErrorMessage(error)} Nothing was returned to the customer.` };
  }
}

export async function retrieveCardPayment(id: string): Promise<{ ok: true; id: string; status: string; amount: number; currency: string; metadata: Stripe.Metadata; card: CardSnapshot | null; paymentMethodId: string | null } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: NOT_CONNECTED };
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(id, { expand: ["payment_method"] });
    const paymentMethod = paymentIntent.payment_method;
    const paymentMethodId = typeof paymentMethod === "string" ? paymentMethod : paymentMethod?.id || null;
    const card = paymentMethod && typeof paymentMethod === "object" ? cardFromStripe(paymentMethod) : null;
    return { ok: true, id: paymentIntent.id, status: paymentIntent.status, amount: paymentIntent.amount, currency: paymentIntent.currency, metadata: paymentIntent.metadata, card, paymentMethodId };
  } catch (error) {
    return { ok: false, error: stripeErrorMessage(error) };
  }
}

export async function retrieveSetup(id: string): Promise<{ ok: true; id: string; status: string; metadata: Stripe.Metadata; paymentMethodId: string | null; card: CardSnapshot | null } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: NOT_CONNECTED };
  try {
    const setup = await stripe.setupIntents.retrieve(id, { expand: ["payment_method"] });
    const paymentMethod = setup.payment_method;
    const paymentMethodId = typeof paymentMethod === "string" ? paymentMethod : paymentMethod?.id || null;
    let card = paymentMethod && typeof paymentMethod === "object" ? cardFromStripe(paymentMethod) : null;
    if (!card && paymentMethodId) {
      const loaded = await stripe.paymentMethods.retrieve(paymentMethodId);
      card = cardFromStripe(loaded);
    }
    return { ok: true, id: setup.id, status: setup.status, metadata: setup.metadata || {}, paymentMethodId, card };
  } catch (error) {
    return { ok: false, error: stripeErrorMessage(error) };
  }
}

export async function cancelCardPayment(id: string): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(id);
    if (paymentIntent.status === "succeeded" || paymentIntent.status === "canceled") return;
    await stripe.paymentIntents.cancel(id);
  } catch {
    // A cancel failure must not mark the payment paid.
  }
}

export async function createCheckoutLink(input: {
  amountCents: number;
  idempotencyKey: string;
  stripeCustomerId: string | null;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
  description: string;
  metadata: Record<string, string>;
}): Promise<{ ok: true; id: string; url: string } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: NOT_CONNECTED };
  if (input.amountCents <= 0) return { ok: false, error: "A payment link needs an amount greater than zero. Nothing was created." };
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ...(input.stripeCustomerId ? { customer: input.stripeCustomerId } : input.customerEmail ? { customer_email: input.customerEmail } : {}),
      line_items: [{
        quantity: 1,
        price_data: { currency: "usd", unit_amount: input.amountCents, product_data: { name: input.description } },
      }],
      // Card + Cash App Pay + PayPal + Link (STRIPE_LINK_METHODS), all through Stripe. Zelle is not here (direct bank).
      allowed_payment_method_types: stripeLinkMethods() as Stripe.Checkout.SessionCreateParams.AllowedPaymentMethodType[],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata,
      payment_intent_data: { metadata: input.metadata },
      // Save the CARD for auto-charge (as before); wallets like Cash App are paid once.
      payment_method_options: { card: { setup_future_usage: "off_session" } },
    }, { idempotencyKey: input.idempotencyKey });
    if (!session.url) return { ok: false, error: "Stripe did not return a payment link. Nothing was charged." };
    return { ok: true, id: session.id, url: session.url };
  } catch (error) {
    return { ok: false, error: stripeErrorMessage(error) };
  }
}

/**
 * Return to carrier by Cash App, THROUGH STRIPE (Owner, 2026-10-31). Stripe cannot push money into
 * someone's Cash App $cashtag; it pays a carrier through Stripe Connect: a transfer to the carrier's
 * connected account (acct_...), which Stripe pays out to the bank or debit card (Cash App Card works)
 * they added. Needs Connect turned on for this Stripe account. Never used for Zelle.
 */
export async function transferToCarrier(input: { amountCents: number; destination: string; idempotencyKey: string; description: string; metadata: Record<string, string> }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Stripe is not connected. Nothing was sent to the carrier." };
  if (input.amountCents <= 0) return { ok: false, error: "Refusing to send a zero or negative amount. Nothing was sent." };
  if (!input.idempotencyKey) return { ok: false, error: "This was stopped because its safety key was missing. Nothing was sent." };
  try {
    const transfer = await stripe.transfers.create({
      amount: input.amountCents,
      currency: "usd",
      destination: input.destination,
      description: input.description.slice(0, 120),
      metadata: input.metadata,
    }, { idempotencyKey: `carrier-${input.idempotencyKey}` });
    return { ok: true, id: transfer.id };
  } catch (error) {
    const msg = stripeErrorMessage(error);
    const hint = /connect|platform|destination|No such account|capabilit/i.test(msg)
      ? " The carrier needs a Stripe payout account first (Invite carrier to Stripe), and Stripe Connect must be on for Fast Break's Stripe account."
      : "";
    return { ok: false, error: `${msg}${hint} Nothing was sent to the carrier.` };
  }
}

/** Creates a Stripe Express payout account for a carrier and the secure Stripe onboarding link to send them. */
export async function createCarrierPayoutAccount(input: { email: string | null; carrierName: string | null; returnUrl: string; metadata: Record<string, string> }): Promise<{ ok: true; accountId: string; url: string } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Stripe is not connected." };
  try {
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: input.email || undefined,
      capabilities: { transfers: { requested: true } },
      business_profile: input.carrierName ? { name: input.carrierName.slice(0, 100) } : undefined,
      metadata: input.metadata,
    });
    const link = await stripe.accountLinks.create({ account: account.id, type: "account_onboarding", refresh_url: input.returnUrl, return_url: input.returnUrl });
    return { ok: true, accountId: account.id, url: link.url };
  } catch (error) {
    const msg = stripeErrorMessage(error);
    return { ok: false, error: /connect|platform/i.test(msg) ? `${msg} Turn on Stripe Connect in the Stripe Dashboard first.` : msg };
  }
}
