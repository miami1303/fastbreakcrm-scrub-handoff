import Stripe from "stripe";

export type VerifiedWebhook =
  | { ok: true; event: Stripe.Event }
  | { ok: false; reason: "missing_secret" | "missing_signature" | "bad_signature" };

/**
 * Checks Stripe's signature. A missing webhook secret refuses the event.
 * The payload is never trusted on its own, even if it says the payment succeeded.
 * The API key below is not a live key and is not used to charge anything; Stripe's
 * signature check does not send it anywhere.
 */
export function verifyStripeWebhook(
  payload: string,
  signature: string | null,
  webhookSecret: string | null | undefined,
): VerifiedWebhook {
  const secret = (webhookSecret ?? "").trim();
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!signature) return { ok: false, reason: "missing_signature" };
  try {
    const stripe = new Stripe("sk_test_signature_check_only", { maxNetworkRetries: 0 });
    return { ok: true, event: stripe.webhooks.constructEvent(payload, signature, secret) };
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
}
