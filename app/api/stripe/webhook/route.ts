import { NextResponse } from "next/server";
import { applyWebhookEffect } from "@/lib/payments/apply-webhook";
import { interpretStripeEvent, scrubSecrets } from "@/lib/payments/decide";
import { verifyStripeWebhook } from "@/lib/payments/webhook-verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stripe notifies this URL. The body is checked with STRIPE_WEBHOOK_SECRET before anything
 * is marked paid. A missing secret or a bad signature does not mark a payment paid.
 * Handled events: payment_intent.succeeded, payment_intent.payment_failed,
 * checkout.session.completed, setup_intent.succeeded, charge.dispute.created/updated/closed (chargebacks).
 * Refunds are ignored. Refunds stay in Stripe.
 */
export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  const verified = verifyStripeWebhook(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
  if (!verified.ok) {
    if (verified.reason === "missing_secret") {
      return NextResponse.json({ error: "Webhook secret is not configured. Nothing was marked paid." }, { status: 503 });
    }
    return NextResponse.json({ error: "Signature check failed. Nothing was marked paid." }, { status: 400 });
  }
  const effect = interpretStripeEvent(verified.event);
  if (effect.kind === "ignore") return NextResponse.json({ received: true, ignored: effect.reason });
  try {
    await applyWebhookEffect(effect);
  } catch (error) {
    console.error("[crm] stripe webhook:", error instanceof Error ? scrubSecrets(error.message) : "unknown");
    return NextResponse.json({ error: "Could not record this yet. Nothing new was marked paid." }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
