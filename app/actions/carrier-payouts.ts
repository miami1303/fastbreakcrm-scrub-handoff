"use server";

// RETURN TO CARRIER (Owner, 2026-10-31). Admin / supervisor only. Never a customer payment.
//   Zelle    -> direct from Fast Break's bank, Stripe never touches it. Refund Now queues it
//               ASAP ("Zelle to send"); the office sends it in the bank app and marks it sent.
//   Cash App -> through Stripe: Stripe Connect transfer to the carrier's payout account (acct_...).
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getAccessibleEstimate, getStaff, isManager, publicOrigin } from "@/lib/crm-server";
import { toCents } from "@/lib/money";
import { isSchemaMiss, isUuid, scrubSecrets } from "@/lib/payments/decide";
import { createCarrierPayoutAccount, readStripeReadiness, transferToCarrier } from "@/lib/payments/stripe-gateway";
import { carrierMemo, cleanStripeAccount, cleanZelleRecipient } from "@/lib/payments/returns";
import { sendMail, sender } from "@/lib/mailer";

type Fail = { ok: false; error: string; newKey?: boolean };
const text = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max) || null;
const NOT_READY = "The Return to carrier database update (carrier_payouts) is not applied yet. Nothing was sent.";

export type CarrierPayout = {
  id: string; created_at: string; amount: number; source: "deposit" | "cod"; method: "Zelle" | "Cash App" | null; carrier_name: string | null; pay_to: string | null;
  status: string; stripe_transfer_id: string | null; confirmation_no: string | null; memo: string | null; remark: string | null;
  created_by_name: string | null; sent_at: string | null; sent_by_name: string | null;
};
const COLS = "id, created_at, amount, source, method, carrier_name, pay_to, status, stripe_transfer_id, confirmation_no, memo, remark, created_by_name, sent_at, sent_by_name";

function fail(error: unknown): Fail {
  const message = scrubSecrets(error instanceof Error ? error.message : "Something went wrong.").slice(0, 300);
  console.error("[crm] carrier payout:", message);
  return { ok: false, error: `${message} Nothing was sent.` };
}

async function gate(estimateId: string) {
  const staff = await getStaff();
  if (!staff) return { ok: false as const, error: "Your session expired. Please sign in again." };
  const est = await getAccessibleEstimate(staff, estimateId);
  if (!est) return { ok: false as const, error: "Estimate not found." };
  return { ok: true as const, staff, admin: createSupabaseAdminClient() };
}

export async function listCarrierPayouts(estimateId: string): Promise<{ ok: true; ready: boolean; rows: CarrierPayout[] } | Fail> {
  try {
    const g = await gate(estimateId);
    if (!g.ok) return g;
    const { data, error } = await g.admin.from("carrier_payouts").select(COLS).eq("estimate_id", estimateId).order("created_at", { ascending: true });
    if (error) return isSchemaMiss(error) ? { ok: true, ready: false, rows: [] } : { ok: false, error: error.message };
    return { ok: true, ready: true, rows: (data || []) as CarrierPayout[] };
  } catch (e) { return fail(e); }
}

/** Optional heads-up to the office so a queued Zelle goes out ASAP. Only when PAYOUT_ALERT_EMAIL is set. */
async function alertOffice(subject: string, body: string) {
  const to = (process.env.PAYOUT_ALERT_EMAIL || "").trim();
  if (!to) return;
  try {
    const from = sender({});
    await sendMail({ from: { name: from.name, address: from.address }, to, replyTo: from.replyTo, subject, text: body, html: `<pre style="font:14px/1.5 sans-serif">${body.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>` });
  } catch { /* the queue in the CRM is the source of truth */ }
}

/**
 * Refund Now with Return to carrier checked.
 * form: amount, source (deposit | cod), method (Zelle | Cash App), carrier_name,
 *       pay_to (Zelle email/phone, or acct_... for Cash App), reason, idempotency_key
 * source = cod: nothing is sent; the amount is added to the carrier COD (not taken from the deposit).
 */
export async function refundCarrier(estimateId: string, form: FormData): Promise<{ ok: true; message: string; payout: CarrierPayout } | Fail> {
  try {
    const g = await gate(estimateId);
    if (!g.ok) return g;
    const { staff, admin } = g;
    if (!isManager(staff)) return { ok: false, error: "Only an admin or supervisor can return money to a carrier. Nothing was sent." };
    const key = text(form.get("idempotency_key"), 80);
    if (!key || !isUuid(key)) return { ok: false, error: "This was stopped because its safety key was missing. Nothing was sent.", newKey: true };
    const amountCents = toCents(form.get("amount"));
    if (amountCents === null || amountCents <= 0) return { ok: false, error: "Enter the amount to return to the carrier (more than $0). Nothing was sent." };
    const source = String(form.get("source") || "deposit") === "cod" ? "cod" : "deposit";
    const carrierNameEarly = text(form.get("carrier_name"), 120);
    if (source === "cod") {
      const { data: e1 } = await admin.from("estimates").select("job_number").eq("id", estimateId).maybeSingle();
      const { data, error } = await admin.from("carrier_payouts").insert({
        estimate_id: estimateId, amount: amountCents / 100, source: "cod", method: null, carrier_name: carrierNameEarly, pay_to: null,
        status: "added_to_cod", memo: carrierMemo(e1?.job_number, carrierNameEarly).replace("carrier refund", "added to carrier COD"),
        remark: text(form.get("reason"), 300), idempotency_key: key, created_by: staff.userId, created_by_name: staff.name,
      }).select(COLS).single();
      if (error) {
        if (isSchemaMiss(error)) return { ok: false, error: NOT_READY };
        if (error.code === "23505") return { ok: false, error: "This was already added to the COD. It was not added again.", newKey: true };
        return { ok: false, error: `${error.message} Nothing was recorded.` };
      }
      return { ok: true, payout: data as CarrierPayout,
        message: `Added $${(amountCents / 100).toFixed(2)} to the carrier COD. Nothing was taken from the deposit and no money was sent; the carrier collects it with the COD at pickup/delivery. Tell the customer the COD went up (and update Carrier COD on Charges if their documents should show it).` };
    }
    const method = String(form.get("method") || "");
    if (method !== "Zelle" && method !== "Cash App") return { ok: false, error: "Pick Zelle or Cash App for the carrier. Nothing was sent." };
    const carrierName = text(form.get("carrier_name"), 120);
    const reason = text(form.get("reason"), 300);
    const payTo = method === "Zelle" ? cleanZelleRecipient(form.get("pay_to")) : cleanStripeAccount(form.get("pay_to"));
    if (!payTo) {
      return { ok: false, error: method === "Zelle"
        ? "Enter the carrier's Zelle email or 10-digit mobile number. Nothing was sent."
        : "Cash App to a carrier goes through Stripe: enter the carrier's Stripe payout account (acct_…). Use Invite carrier to Stripe if they don't have one. Nothing was sent." };
    }

    const { data: est } = await admin.from("estimates").select("job_number").eq("id", estimateId).maybeSingle();
    const memo = carrierMemo(est?.job_number, carrierName);
    const base = {
      source: "deposit",
      estimate_id: estimateId, amount: amountCents / 100, method, carrier_name: carrierName, pay_to: payTo, memo,
      remark: reason, idempotency_key: key, created_by: staff.userId, created_by_name: staff.name,
    };

    if (method === "Zelle") {
      const { data, error } = await admin.from("carrier_payouts").insert({ ...base, status: "zelle_to_send" }).select(COLS).single();
      if (error) {
        if (isSchemaMiss(error)) return { ok: false, error: NOT_READY };
        if (error.code === "23505") return { ok: false, error: "This return was already queued. It was not queued again.", newKey: true };
        return { ok: false, error: `${error.message} Nothing was queued.` };
      }
      await alertOffice(`ZELLE TO SEND ASAP: $${(amountCents / 100).toFixed(2)} to carrier ${carrierName || payTo} (job ${est?.job_number || "—"})`,
        `Send this Zelle from the Fast Break bank app now, then mark it sent in the CRM (Payments tab) with the Zelle confirmation number.\n\nTo: ${payTo}${carrierName ? ` (${carrierName})` : ""}\nAmount: $${(amountCents / 100).toFixed(2)}\nMemo: ${memo}\nQueued by: ${staff.name}`);
      return { ok: true, payout: data as CarrierPayout,
        message: `From deposit, queued ASAP: Zelle $${(amountCents / 100).toFixed(2)} to ${payTo}. Zelle goes straight from Fast Break's bank (not Stripe): send it in the bank app now, then click Mark Zelle sent and enter the Zelle confirmation number.` };
    }

    // Cash App -> through Stripe (Connect transfer).
    if (!readStripeReadiness().connected) return { ok: false, error: "Stripe is not connected. Nothing was sent to the carrier." };
    const { data: row, error } = await admin.from("carrier_payouts").insert({ ...base, status: "processing" }).select("id").single();
    if (error) {
      if (isSchemaMiss(error)) return { ok: false, error: NOT_READY };
      if (error.code === "23505") return { ok: false, error: "This return was already sent. It was not sent again.", newKey: true };
      return { ok: false, error: `${error.message} Nothing was sent.` };
    }
    const transfer = await transferToCarrier({
      amountCents, destination: payTo, idempotencyKey: key, description: memo,
      metadata: { estimate_id: estimateId, carrier_payout_id: row.id, kind: "return_to_carrier", job_number: est?.job_number || "" },
    });
    if (!transfer.ok) {
      await admin.from("carrier_payouts").update({ status: "failed", remark: [reason, transfer.error].filter(Boolean).join(" — ").slice(0, 500) }).eq("id", row.id);
      return { ok: false, error: transfer.error, newKey: true };
    }
    const { data: done } = await admin.from("carrier_payouts").update({ status: "sent", stripe_transfer_id: transfer.id, confirmation_no: transfer.id, sent_at: new Date().toISOString(), sent_by_name: staff.name })
      .eq("id", row.id).select(COLS).single();
    return { ok: true, payout: done as CarrierPayout,
      message: `From deposit, sent through Stripe: $${(amountCents / 100).toFixed(2)} to the carrier's Stripe payout account (${transfer.id}). Stripe pays it out to their bank or Cash App card on their payout schedule.` };
  } catch (e) { return fail(e); }
}

/** After the office sends the Zelle in the bank app: record the Zelle confirmation number. */
export async function markZelleSent(estimateId: string, payoutId: string, confirmationNo: string): Promise<{ ok: true; message: string } | Fail> {
  try {
    const g = await gate(estimateId);
    if (!g.ok) return g;
    if (!isManager(g.staff)) return { ok: false, error: "Only an admin or supervisor can mark a carrier Zelle sent." };
    if (!isUuid(payoutId)) return { ok: false, error: "That carrier return was not found." };
    const conf = text(confirmationNo, 80);
    if (!conf) return { ok: false, error: "Enter the Zelle confirmation number from the bank app." };
    const { data, error } = await g.admin.from("carrier_payouts")
      .update({ status: "sent", confirmation_no: conf, sent_at: new Date().toISOString(), sent_by_name: g.staff.name })
      .eq("id", payoutId).eq("estimate_id", estimateId).eq("status", "zelle_to_send").select("id");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, error: "That Zelle is not waiting to be sent (already marked, or cancelled)." };
    return { ok: true, message: `Zelle marked sent (confirmation ${conf}).` };
  } catch (e) { return fail(e); }
}

/** Queued Zelle (or add to COD) that should not happen. Nothing moved, so this is safe. The row stays, marked cancelled. */
export async function cancelQueuedZelle(estimateId: string, payoutId: string): Promise<{ ok: true; message: string } | Fail> {
  try {
    const g = await gate(estimateId);
    if (!g.ok) return g;
    if (!isManager(g.staff)) return { ok: false, error: "Only an admin or supervisor can cancel a carrier return." };
    if (!isUuid(payoutId)) return { ok: false, error: "That carrier return was not found." };
    const { data, error } = await g.admin.from("carrier_payouts").update({ status: "cancelled", sent_by_name: g.staff.name })
      .eq("id", payoutId).eq("estimate_id", estimateId).in("status", ["zelle_to_send", "added_to_cod"]).select("id, status");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, error: "Only a Zelle still waiting to be sent, or an add to COD, can be cancelled." };
    return { ok: true, message: "Cancelled. Nothing was sent. The line stays in Payment Records as cancelled." };
  } catch (e) { return fail(e); }
}

/** Cash App carriers: make their Stripe payout account and get the secure onboarding link to send them. */
export async function inviteCarrierToStripe(estimateId: string, form: FormData): Promise<{ ok: true; accountId: string; url: string; message: string } | Fail> {
  try {
    const g = await gate(estimateId);
    if (!g.ok) return g;
    if (!isManager(g.staff)) return { ok: false, error: "Only an admin or supervisor can invite a carrier to Stripe." };
    if (!readStripeReadiness().connected) return { ok: false, error: "Stripe is not connected." };
    const email = text(form.get("carrier_email"), 160);
    const result = await createCarrierPayoutAccount({
      email, carrierName: text(form.get("carrier_name"), 120),
      returnUrl: `${await publicOrigin()}/estimates/${estimateId}`,
      metadata: { estimate_id: estimateId, kind: "carrier_payout_account" },
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, accountId: result.accountId, url: result.url,
      message: `Carrier Stripe account ${result.accountId} created. Send the carrier this secure Stripe link to add their bank or Cash App card; then Refund Now with Cash App sends through Stripe.` };
  } catch (e) { return fail(e); }
}
