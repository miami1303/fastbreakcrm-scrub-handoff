"use server";

import { resolveCardType } from "@/lib/card-type";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { clientIp, getAccessibleEstimate, getStaff, userAgent } from "@/lib/crm-server";
import { cardKeyFromEnv, decryptCardSecret, digitsOnly, encryptCardSecret, luhnValid } from "@/lib/card-crypto";
import { toCents } from "@/lib/money";
import { loadLeadBundle } from "@/lib/lead-data";
import { setPaymentVehicle, vehicleIndexFrom } from "@/lib/payments/records";
import { phoneForField } from "@/lib/phone-format";
import { detectStripeMode, isSchemaMiss, isUuid, legacyLedgerKind } from "@/lib/payments/decide";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const text = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max) || null;

function fail(error: unknown): { ok: false; error: string } {
  // Never log card data: only the message of our own errors is logged.
  const message = error instanceof Error ? error.message : "Something went wrong.";
  console.error("[crm] payment:", message);
  return { ok: false, error: message };
}

/**
 * Ledger entry only. This never calls Stripe.
 * A negative amount is a bookkeeping correction: it does not charge, refund, or store a new card number.
 * Full card numbers are encrypted only while Stripe is not connected, so the merchant-terminal
 * workflow keeps working. Once Stripe keys are set, card numbers are refused here.
 */
export async function addPayment(estimateId: string, form: FormData): Promise<R> {
  try {
    const staff = await getStaff();
    if (!staff) return { ok: false, error: "Your session expired. Please sign in again." };
    const est = await getAccessibleEstimate(staff, estimateId);
    if (!est) return { ok: false, error: "Estimate not found." };

    const amountCents = toCents(form.get("amount"));
    if (amountCents === null) return { ok: false, error: "Enter the amount." };
    const readiness = detectStripeMode(process.env.STRIPE_SECRET_KEY, process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
    const method = String(form.get("method") || "").trim() || "Not specified";
    const ledger = legacyLedgerKind({ method, amountCents, stripeConnected: readiness.connected });
    if (ledger.action === "reject") return { ok: false, error: ledger.message };
    const acceptCard = ledger.action === "legacy_card_record";
    const country = text(form.get("billing_country"), 40) || "USA";
    const number = acceptCard ? digitsOnly(form.get("card_number")) : "";
    const cvv = acceptCard ? digitsOnly(form.get("cvv")) : "";
    const exp = acceptCard ? text(form.get("card_exp"), 7) : null;
    if (exp && !/^(0[1-9]|1[0-2])\/\d{2}$/.test(exp)) return { ok: false, error: "Expiration must be MM/YY." };
    if (cvv && !number) return { ok: false, error: "Enter the card number with the security code." };
    if (cvv && !/^\d{3,4}$/.test(cvv)) return { ok: false, error: "Security code must be 3 or 4 digits." };
    if (readiness.connected && (digitsOnly(form.get("card_number")) || digitsOnly(form.get("cvv")) || digitsOnly(form.get("ach_account")))) {
      return { ok: false, error: "Card and bank numbers are not saved while Stripe is connected. Nothing was charged." };
    }

    let secret: string | null = null;
    if (number) {
      if (!luhnValid(number)) return { ok: false, error: "That card number doesn't look right. Please check it." };
      const key = cardKeyFromEnv();
      if (!key) return { ok: false, error: "Card storage is not configured (CARD_ENCRYPTION_KEY is missing). The card details were NOT saved." };
      secret = encryptCardSecret({ number, cvv, country }, key);
    }
    const admin = createSupabaseAdminClient();
    const isDeposit = form.get("is_deposit") === "on" || form.get("is_deposit") === "true";
    const cardType = acceptCard ? resolveCardType(form.get("card_type"), number) : { type: null, source: null };
    const keyRaw = text(form.get("idempotency_key"), 80);
    const chargeStatus = ledger.action === "bookkeeping" ? "bookkeeping_adjustment" : ledger.action === "log_manual" ? "logged_manual" : "recorded";
    const row: Record<string, unknown> = {
      estimate_id: estimateId,
      created_by: staff.userId,
      created_by_name: staff.name,
      payment_date: text(form.get("payment_date"), 10) || new Date().toISOString().slice(0, 10),
      method,
      is_deposit: isDeposit,
      amount: amountCents / 100,
      confirmation_no: text(form.get("confirmation_no"), 80),
      remark: text(form.get("remark"), 500),
      cardholder_name: acceptCard ? text(form.get("cardholder_name"), 120) : null,
      billing_address: text(form.get("billing_address"), 200),
      billing_city: text(form.get("billing_city"), 80),
      billing_state: text(form.get("billing_state"), 2),
      billing_zip: text(form.get("billing_zip"), 10),
      phone: text(phoneForField(form.get("phone") == null ? "" : String(form.get("phone"))), 40),
      email: text(form.get("email"), 200),
      card_type: cardType.type,
      card_type_source: cardType.source,
      card_last4: number ? number.slice(-4) : null,
      card_exp: exp,
      card_secret_enc: secret,
      key_version: secret ? "v1" : null,
      provider: "manual",
      charge_status: chargeStatus,
      auto_charge: false,
      idempotency_key: keyRaw && isUuid(keyRaw) ? keyRaw : null,
    };
    const saved = await insertLedger(admin, row);
    // Customer payment per vehicle (payments.vehicle_index, migration 20261031190000; skipped before).
    await setPaymentVehicle(admin, saved.id, vehicleIndexFrom(form.get("vehicle_index")));
    if (secret) await admin.from("card_access_log").insert({ payment_id: saved.id, estimate_id: estimateId, user_id: staff.userId, user_name: staff.name, action: "create", ip: await clientIp(), user_agent: await userAgent() });

    // The CC authorization form is filled only from a positive card record (last 4 only).
    if (acceptCard) {
      const { data: quote } = await admin.from("quotes").select("id").eq("estimate_id", estimateId).maybeSingle();
      const cardFields = {
        cardholder_name: row.cardholder_name,
        billing_address: [row.billing_address, [row.billing_city, row.billing_state].filter(Boolean).join(", "), row.billing_zip].filter(Boolean).join(", ") || null,
        billing_zip: row.billing_zip,
        card_type: row.card_type,
        card_type_source: row.card_type_source,
        ...(row.card_last4 ? { card_last4: row.card_last4, card_exp: row.card_exp } : {}),
      };
      if (quote) await admin.from("quotes").update(cardFields).eq("id", quote.id);
      else await admin.from("quotes").insert({ estimate_id: estimateId, total_amount: 0, deposit_amount: 0, ...cardFields });
    }
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Writes the ledger. Drops the new columns when that migration is not applied yet. Never calls Stripe. */
async function insertLedger(admin: ReturnType<typeof createSupabaseAdminClient>, row: Record<string, unknown>) {
  const first = await admin.from("payments").insert(row).select("id").single();
  if (!first.error && first.data) return first.data;
  if (first.error?.code === "23505") throw new Error("This payment is already recorded. It was not saved again.");
  if (!isSchemaMiss(first.error)) throw new Error("The payment could not be saved.");
  const legacy = { ...row };
  for (const key of ["charge_status", "auto_charge", "idempotency_key", "customer_id"]) delete legacy[key];
  const second = await admin.from("payments").insert(legacy).select("id").single();
  if (second.error?.code === "23505") throw new Error("This payment is already recorded. It was not saved again.");
  if (second.error || !second.data) throw new Error("The payment could not be saved.");
  return second.data;
}

/** Admin void (alternative to a negative correction). */
export async function voidPayment(paymentId: string): Promise<R> {
  try {
    const staff = await getStaff();
    if (!staff || staff.role !== "admin") return { ok: false, error: "Only an admin can void a payment." };
    const admin = createSupabaseAdminClient();
    const { data: p } = await admin.from("payments").select("id").eq("id", paymentId).maybeSingle();
    if (!p) return { ok: false, error: "Payment not found." };
    await admin.from("payments").update({ voided_at: new Date().toISOString(), voided_by: staff.userId }).eq("id", paymentId);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export type PaymentDetails = {
  id: string; created_at: string; created_by_name: string | null; payment_date: string | null; method: string; is_deposit: boolean;
  amount: number; confirmation_no: string | null; remark: string | null; cardholder_name: string | null; billing_address: string | null;
  billing_city: string | null; billing_state: string | null; billing_zip: string | null; phone: string | null; email: string | null;
  card_type: string | null; card_last4: string | null; card_exp: string | null; card_number: string | null; cvv: string | null;
  /** true = this user may not see full numbers: only last 4 are returned. */
  masked: boolean; country: string | null; ach: { bank: string; routing: string; account: string } | null;
  voided_at: string | null; total: number | null; /** deposit paid (sum of Deposit payments) */ deposit: number | null;
};

/**
 * Full payment details (card number, CVV …) for running the card through the merchant.
 * Admins, or staff with can_view_cards, only. Every attempt is written to card_access_log.
 */
export async function revealPayment(paymentId: string): Promise<R<{ payment: PaymentDetails }>> {
  try {
    const staff = await getStaff();
    if (!staff) return { ok: false, error: "Your session expired. Please sign in again." };
    const admin = createSupabaseAdminClient();
    const { data: p } = await admin.from("payments").select("*").eq("id", paymentId).maybeSingle();
    if (!p) return { ok: false, error: "Payment not found." };
    const log = (action: "view" | "denied") => admin.from("card_access_log").insert({
      payment_id: p.id, estimate_id: p.estimate_id, user_id: staff.userId, user_name: staff.name, action,
    });
    const est = await getAccessibleEstimate(staff, p.estimate_id);
    if (!est) { await log("denied"); return { ok: false, error: "Payment not found." }; }
    const bundle = await loadLeadBundle(p.estimate_id);
    const totals = { total: bundle?.quote?.total_amount != null ? Number(bundle.quote.total_amount) : null, deposit: bundle?.paidAmount ?? null };
    const { card_secret_enc: _omit, ...rest } = p;
    void _omit;
    if (!staff.canViewCards) {
      // Everyone else sees the payment with the card / account masked (last 4); logged as denied.
      await log("denied");
      return { ok: true, payment: { ...rest, ...totals, card_number: null, cvv: null, masked: true, country: null, ach: null } };
    }
    let number: string | null = null;
    let cvv: string | null = null;
    let ach: PaymentDetails["ach"] = null;
    let country: string | null = null;
    if (p.card_secret_enc) {
      const key = cardKeyFromEnv();
      if (!key) return { ok: false, error: "CARD_ENCRYPTION_KEY is not configured on the server." };
      const secret = decryptCardSecret(p.card_secret_enc, key);
      number = secret.number || null;
      cvv = secret.cvv || null;
      ach = secret.ach || null;
      country = secret.country || null;
    }
    await admin.from("card_access_log").insert({
      payment_id: p.id, estimate_id: p.estimate_id, user_id: staff.userId, user_name: staff.name, action: "view",
      ip: await clientIp(), user_agent: await userAgent(),
    });
    return { ok: true, payment: { ...rest, ...totals, card_number: number, cvv, masked: false, country, ach } };
  } catch (e) { return fail(e); }
}
