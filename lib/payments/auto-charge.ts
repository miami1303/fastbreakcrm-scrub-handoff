import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { toCents } from "@/lib/money";
import { centsToDecimal, decidePayment, runWithStripeGuard, scrubSecrets } from "./decide";
import { chargeSavedCard, readStripeReadiness } from "./stripe-gateway";
import { loadEstimate, paymentsSchemaReady, readEsignFlags } from "./records";

/**
 * Charges the waiting saved card only when auto-charge is on for this booking,
 * both e-signs are complete, Stripe is connected, and the amount is positive.
 * Called after the customer signs on the existing e-sign page. A failure here
 * must not undo the signature. This never charges when Stripe keys are missing.
 */
export async function attemptAutoChargeForEstimate(estimateId: string): Promise<{ charged: boolean; message: string }> {
  try {
    const readiness = readStripeReadiness();
    if (!readiness.connected) return { charged: false, message: "Stripe is not connected. Nothing was charged." };
    const admin = createSupabaseAdminClient();
    if (!(await paymentsSchemaReady(admin))) return { charged: false, message: "The payments database update is not applied yet. Nothing was charged." };
    const estimate = await loadEstimate(admin, estimateId);
    if (!estimate?.auto_charge_enabled) return { charged: false, message: "Auto-charge is off for this booking. Nothing was charged." };
    const esign = await readEsignFlags(admin, estimateId);
    if (!esign.both) return { charged: false, message: "Both e-signs are not complete. Nothing was charged." };

    const { data: waitingRows } = await admin.from("payments")
      .select("id, amount, idempotency_key, stripe_payment_method_id, customer_id, charge_status, created_at")
      .eq("estimate_id", estimateId)
      .eq("charge_status", "auto_charge_waiting")
      .order("created_at", { ascending: false });
    const waiting = waitingRows || [];
    if (waiting.length === 0) return { charged: false, message: "No saved card is waiting. Nothing was charged." };
    const [latest, ...older] = waiting;
    if (older.length) {
      await admin.from("payments").update({ charge_status: "superseded", remark: "Replaced by a newer auto-charge. No money was moved." }).in("id", older.map((row) => row.id));
    }
    const amountCents = toCents(latest.amount);
    if (amountCents === null || amountCents <= 0 || !latest.stripe_payment_method_id || !latest.idempotency_key) {
      return { charged: false, message: "The waiting payment cannot be charged. Nothing was charged." };
    }
    const { data: method } = await admin.from("customer_payment_methods").select("id, stripe_customer_id, stripe_payment_method_id, brand, last4, exp_month, exp_year").eq("customer_id", latest.customer_id).eq("stripe_payment_method_id", latest.stripe_payment_method_id).maybeSingle();
    if (!method?.stripe_customer_id || !method.stripe_payment_method_id) {
      return { charged: false, message: "The saved card could not be found. Nothing was charged." };
    }

    const decision = decidePayment({
      amountCents,
      autoCharge: true,
      bothEsignsComplete: true,
      stripeConnected: true,
      savedPaymentMethod: true,
      purpose: "card",
      idempotencyKey: latest.idempotency_key,
      existingCharge: null,
    });
    const guarded = await runWithStripeGuard(decision, readiness.connected, async () => {
      const grabbed = await admin.from("payments").update({ charge_status: "processing" }).eq("id", latest.id).eq("charge_status", "auto_charge_waiting").select("id").maybeSingle();
      if (grabbed.error || !grabbed.data) return { charged: false as const, message: "This payment is already being processed. Nothing new was charged." };
      const result = await chargeSavedCard({
        amountCents,
        stripeCustomerId: method.stripe_customer_id,
        paymentMethodId: method.stripe_payment_method_id,
        idempotencyKey: latest.idempotency_key,
        metadata: { estimate_id: estimateId, crm_payment_id: latest.id, job_number: estimate.job_number || "" },
      });
      if (!result.ok || result.status !== "succeeded" || result.amount !== amountCents || result.currency !== "usd") {
        await admin.from("payments").update({
          charge_status: "failed",
          stripe_payment_intent_id: result.ok ? result.id : result.paymentIntentId,
          remark: result.ok ? "Stripe did not confirm the charge. It was not marked paid." : result.error,
        }).eq("id", latest.id);
        return { charged: false as const, message: result.ok ? "Stripe did not confirm the charge. It was not marked paid." : result.error };
      }
      await admin.from("payments").update({
        charge_status: "succeeded",
        confirmation_no: result.id,
        stripe_payment_intent_id: result.id,
        amount: centsToDecimal(amountCents),
        remark: "Charged automatically after both e-signs.",
      }).eq("id", latest.id);
      return { charged: true as const, message: "The saved card was charged after both e-signs." };
    });
    if (!guarded.called) return { charged: false, message: guarded.blocked || "Nothing was charged." };
    return guarded.result;
  } catch (error) {
    console.error("[crm] auto-charge:", error instanceof Error ? scrubSecrets(error.message) : "unknown");
    return { charged: false, message: "Auto-charge did not run. Nothing was charged." };
  }
}
