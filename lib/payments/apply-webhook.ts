import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { todayChicago } from "@/lib/calendar";
import { toCents } from "@/lib/money";
import { centsToDecimal, type CardSnapshot, type WebhookEffect } from "./decide";
import { cardColumns, paymentsSchemaReady } from "./records";
import { alertChargeback } from "@/lib/carrier-owes-alert";
import type { SupabaseClient } from "@supabase/supabase-js";

/** charge.dispute.*: find the lead by PaymentIntent, record the dispute, alert once when it opens. */
async function applyDispute(admin: SupabaseClient, effect: Extract<WebhookEffect, { kind: "dispute" }>): Promise<void> {
  if (!effect.paymentIntentId) return;
  const { data: pay } = await admin.from("payments").select("estimate_id").eq("stripe_payment_intent_id", effect.paymentIntentId).maybeSingle();
  if (!pay?.estimate_id) return;
  const patch: Record<string, unknown> = { chargeback_status: effect.status, chargeback_dispute_id: effect.disputeId, chargeback_amount: centsToDecimal(effect.amountCents) };
  if (effect.created) patch.chargeback_at = new Date().toISOString();
  const { error } = await admin.from("estimates").update(patch).eq("id", pay.estimate_id);
  if (error) throw new Error(`Chargeback needs the 20261101080000_chargeback migration applied: ${error.message}`);
  await alertChargeback(admin, pay.estimate_id, effect);
}

/**
 * Applies an already-verified Stripe event. Refunds never get here.
 * A payment is marked paid only when the event says it succeeded and the amount is positive USD.
 */
export async function applyWebhookEffect(effect: WebhookEffect): Promise<void> {
  if (effect.kind === "ignore") return;
  const admin = createSupabaseAdminClient();
  if (effect.kind === "dispute") { await applyDispute(admin, effect); return; }
  if (!(await paymentsSchemaReady(admin))) throw new Error("Payments storage is not ready. Nothing was marked paid.");

  if (effect.kind === "payment_intent") {
    const { data: row } = await admin.from("payments").select("id, amount, charge_status").eq("id", effect.crmPaymentId || "").maybeSingle();
    const byIntent = row || (await admin.from("payments").select("id, amount, charge_status").eq("stripe_payment_intent_id", effect.paymentIntentId).maybeSingle()).data;
    if (!byIntent) return;
    if (byIntent.charge_status === "bookkeeping_adjustment" || byIntent.charge_status === "logged_manual") return;
    const expected = toCents(byIntent.amount);
    if (!effect.succeeded) {
      if (byIntent.charge_status !== "succeeded") {
        await admin.from("payments").update({ charge_status: "failed", stripe_payment_intent_id: effect.paymentIntentId, remark: "Stripe reported this card payment failed. It was not marked paid." }).eq("id", byIntent.id);
      }
      return;
    }
    if (expected !== effect.amountCents) return;
    await admin.from("payments").update({
      charge_status: "succeeded",
      confirmation_no: effect.paymentIntentId,
      stripe_payment_intent_id: effect.paymentIntentId,
      ...cardPatch(effect.card),
    }).eq("id", byIntent.id);
    return;
  }

  if (effect.kind === "checkout_paid") {
    const { data: existing } = effect.paymentIntentId
      ? await admin.from("payments").select("id, charge_status").eq("stripe_payment_intent_id", effect.paymentIntentId).maybeSingle()
      : { data: null };
    if (existing?.charge_status === "succeeded") return;
    if (existing) {
      await admin.from("payments").update({
        charge_status: "succeeded",
        confirmation_no: effect.paymentIntentId,
        amount: centsToDecimal(effect.amountCents),
        ...cardPatch(effect.card),
      }).eq("id", existing.id);
      return;
    }
    const { data: link } = await admin.from("payment_links").select("is_deposit").eq("stripe_checkout_session_id", effect.sessionId).maybeSingle();
    const inserted = await admin.from("payments").insert({
      estimate_id: effect.estimateId,
      payment_date: todayChicago(),
      method: "Credit Card",
      is_deposit: link?.is_deposit !== false,
      amount: centsToDecimal(effect.amountCents),
      confirmation_no: effect.paymentIntentId,
      remark: "Paid from the customer payment link.",
      created_by_name: "Stripe",
      customer_id: effect.customerId,
      provider: "stripe",
      charge_status: "succeeded",
      auto_charge: false,
      stripe_payment_intent_id: effect.paymentIntentId,
      stripe_checkout_session_id: effect.sessionId,
      idempotency_key: effect.paymentIntentId ? undefined : effect.sessionId,
      ...cardColumns(effect.card),
    });
    if (inserted.error && inserted.error.code !== "23505") throw new Error(inserted.error.message);
    return;
  }

  if (effect.kind === "setup_succeeded") {
    if (effect.paymentMethodId && effect.customerId && effect.card?.last4) {
      const { data: existing } = await admin.from("customer_payment_methods").select("id").eq("customer_id", effect.customerId).eq("stripe_payment_method_id", effect.paymentMethodId).maybeSingle();
      if (!existing) {
        const saved = await admin.from("customer_payment_methods").insert({
          customer_id: effect.customerId,
          stripe_payment_method_id: effect.paymentMethodId,
          brand: effect.card.brand,
          last4: effect.card.last4,
          exp_month: effect.card.expMonth,
          exp_year: effect.card.expYear,
          original_estimate_id: effect.estimateId,
        });
        if (saved.error && saved.error.code !== "23505") throw new Error(saved.error.message);
      }
    }
    if (effect.idempotencyKey) {
      await admin.from("payments").update({
        charge_status: "auto_charge_waiting",
        stripe_setup_intent_id: effect.setupIntentId,
        stripe_payment_method_id: effect.paymentMethodId,
        remark: "Card saved. Waiting until both e-signs are complete. Nothing was charged yet.",
        ...cardPatch(effect.card),
      }).eq("idempotency_key", effect.idempotencyKey).in("charge_status", ["pending", "processing"]);
    }
  }
}

function cardPatch(card: CardSnapshot | null) {
  if (!card?.last4) return {};
  return cardColumns(card);
}
