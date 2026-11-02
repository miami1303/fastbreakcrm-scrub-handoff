import "server-only";
// Applies a classified Fast Break / Central Dispatch email to the CRM. Every message is
// processed at most once (inbox_watch_messages.message_id is unique). Crystal-company mail never gets here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { notify, jobLabel } from "@/lib/crm-server";
import { formatCents } from "@/lib/money";
import { carrierOwesState } from "@/lib/carrier-owes";
import { CARRIER_OWES_EMAIL_TO, alertCarrierPaid, sendCarrierOwesEmail } from "@/lib/carrier-owes-alert";
import { todayChicago } from "@/lib/calendar";
import { normalizeJobNumber } from "@/lib/job-number";
import type { Classified, InboxMessage } from "./classify";

type Admin = SupabaseClient;
type Est = Record<string, unknown> & { id: string; owner_id: string | null; job_number?: string | null; customer_name?: string | null };
export type ApplyResult = { status: "applied" | "unmatched" | "skipped"; estimateId: string | null; note: string };

async function findEstimate(admin: Admin, c: Classified): Promise<Est | null> {
  const job = normalizeJobNumber(c.jobNumber);
  if (job) {
    const { data } = await admin.from("estimates").select("*").eq("job_number", job).maybeSingle();
    if (data) return data as Est;
  }
  if (c.kind !== "customer_payment") return null; // carrier / CD mail must carry a job number.
  if (c.customerEmail) {
    const { data } = await admin.from("estimates").select("*").ilike("customer_email", c.customerEmail).order("created_at", { ascending: false }).limit(2);
    if (data?.length === 1) return data[0] as Est;
    if (data?.length) return (data.find(e => e.status === "booked") || data[0]) as Est;
  }
  if (c.customerName && c.customerName.split(/\s+/).length >= 2) {
    const { data } = await admin.from("estimates").select("*").ilike("customer_name", c.customerName).order("created_at", { ascending: false }).limit(2);
    if (data?.length === 1) return data[0] as Est; // a name only counts when it is unique
  }
  return null;
}

async function opsNote(admin: Admin, estimateId: string, body: string) {
  await admin.from("estimate_notes").insert({ estimate_id: estimateId, kind: "operations", created_by: null, author_name: "Inbox watch", body });
}

export async function applyClassified(admin: Admin, msg: InboxMessage, c: Classified): Promise<ApplyResult> {
  const est = await findEstimate(admin, c);
  if (!est) {
    // Still tell the office about payments we could not match (manual attach).
    if (c.kind === "customer_payment" || c.kind === "carrier_payment") {
      await notify("payment_received", `Payment received ${formatCents(c.amountCents || 0)} (${c.method}) — not matched to a job: ${msg.subject}`.slice(0, 300), null, null, (c.amountCents || 0) / 100);
    }
    return { status: "unmatched", estimateId: null, note: `no estimate for ${c.jobNumber || c.customerEmail || c.customerName || "(no id)"}` };
  }
  const label = jobLabel(est);
  const now = new Date().toISOString();

  if (c.kind === "cd_pickup") {
    // Picked up flag (strip + green Operations calendar). Tolerates the column not being migrated yet.
    // A pickup implies a carrier: stamp carrier_assigned_at too when it is still empty.
    if (!est.picked_up_at) await admin.from("estimates").update({ picked_up_at: now, last_touched_at: now, ...(est.carrier_assigned_at ? {} : { carrier_assigned_at: now }) }).eq("id", est.id).then(() => null, () => null);
    await notify("customer_pickup", `Customer pickup: ${label}`, est);
    await opsNote(admin, est.id, `Central Dispatch: vehicle picked up (${msg.subject}).`);
    return { status: "applied", estimateId: est.id, note: "pickup banner" };
  }

  if (c.kind === "cd_delivered") {
    if (!est.delivered_at) await admin.from("estimates").update({ delivered_at: now, last_touched_at: now }).eq("id", est.id);
    await notify("customer_delivered", `Customer delivered: ${label}`, est);
    await opsNote(admin, est.id, `Central Dispatch: vehicle delivered (${msg.subject}).`);
    // Same rule as the "Delivered?" button: delivered + carrier still owes -> Carrier owes banner (once).
    const { data: fresh } = await admin.from("estimates").select("*").eq("id", est.id).maybeSingle();
    if (fresh && !fresh.carrier_owes_notified_at && carrierOwesState(fresh).bannerOn) {
      const { data: claimed } = await admin.from("estimates").update({ carrier_owes_notified_at: now }).eq("id", est.id).is("carrier_owes_notified_at", null).select("id");
      if (claimed?.length) {
        const s = carrierOwesState(fresh);
        await notify("carrier_owes", `Carrier owes us money: ${formatCents(s.owesC)} — ${label}`, est, null, s.owesC / 100);
        const emailed = await sendCarrierOwesEmail(admin, fresh as Est, formatCents(s.owesC));
        await opsNote(admin, est.id, `Carrier owes us ${formatCents(s.owesC)}: banner raised (delivered per Central Dispatch)${emailed ? ` and emailed ${CARRIER_OWES_EMAIL_TO} (ATTN Ops)` : " (email NOT sent — check mail setup)"}.`);
      }
    }
    return { status: "applied", estimateId: est.id, note: "delivered banner" };
  }

  const amount = formatCents(c.amountCents || 0);
  if (c.kind === "carrier_payment") {
    const s = carrierOwesState(est as Parameters<typeof carrierOwesState>[0]);
    if (s.owesC > 0 && !s.paid && c.charged !== false) {
      // Carrier paid -> deposit bookkeeping only. Customer Deposit / COD / Total / Balance untouched.
      const paid = {
        carrier_owes_paid_at: now, carrier_owes_paid_by_name: "Inbox watch",
        carrier_owes_paid_note: `${c.method} ${amount}${c.reference ? ` #${c.reference}` : ""} (email)`.slice(0, 300),
        carrier_owes_deposited_at: now,
      };
      await admin.from("estimates").update(paid).eq("id", est.id);
      await admin.from("crm_notifications").update({ dismissed_at: now }).eq("estimate_id", est.id).eq("kind", "carrier_owes").is("dismissed_at", null);
      const pa = await alertCarrierPaid(admin, { ...(est as Est), ...paid }, amount, (c.amountCents || 0) / 100, `Inbox watch: ${paid.carrier_owes_paid_note}`);
      if (pa.alerted) await opsNote(admin, est.id, `Carrier paid banner raised${pa.emailed ? ` and emailed ${CARRIER_OWES_EMAIL_TO} (ATTN Ops)` : " (email NOT sent — check mail setup)"}.`);
    }
    await notify("payment_received", `Carrier payment received ${amount} — ${label}`, est, null, (c.amountCents || 0) / 100);
    await opsNote(admin, est.id, `Carrier payment email: ${amount} via ${c.method}. Added to deposit bookkeeping (carrier). Customer balance, total and quote unchanged.`);
    return { status: "applied", estimateId: est.id, note: "carrier paid" };
  }

  // Customer payment -> Payment Records (deduped on the Gmail id and the processor reference).
  if (c.reference) {
    const { data: dup } = await admin.from("payments").select("id").or(`confirmation_no.eq.${c.reference},stripe_payment_intent_id.eq.${c.reference}`).limit(1);
    if (dup?.length) {
      await notify("payment_received", `Payment received ${amount} (${c.method}) — ${label}`, est, null, (c.amountCents || 0) / 100);
      return { status: "skipped", estimateId: est.id, note: "already recorded (Stripe webhook / manual)" };
    }
  }
  if (c.charged === false) {
    // Failed / pending notice: no Payment Record (it would change the customer balance). Office decides.
    await notify("payment_received", `Payment NOT completed ${amount} (${c.method}) — ${label}`, est, null, (c.amountCents || 0) / 100);
    await opsNote(admin, est.id, `Payment email says ${amount} via ${c.method} was not completed (failed / pending). Nothing recorded.`);
    return { status: "skipped", estimateId: est.id, note: "not charged" };
  }
  const { count } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("estimate_id", est.id);
  const row: Record<string, unknown> = {
    estimate_id: est.id, payment_date: todayChicago(), method: c.method === "Other" ? "Other" : c.method, is_deposit: !count,
    amount: (c.amountCents || 0) / 100, confirmation_no: c.reference || null,
    remark: `Auto-recorded from payment email (${c.charged === true ? "charged" : "charge status unknown"}). Verify. "${msg.subject}"`.slice(0, 500),
    created_by_name: "Inbox watch", email: c.customerEmail || null,
    charge_status: c.charged === true ? "succeeded" : "recorded",
    idempotency_key: `gmail:${msg.id}`,
  };
  let ins = await admin.from("payments").insert(row);
  if (ins.error && ins.error.code !== "23505" && /charge_status|idempotency_key/.test(ins.error.message || "")) {
    delete row.charge_status; delete row.idempotency_key;
    ins = await admin.from("payments").insert(row);
  }
  if (ins.error && ins.error.code !== "23505") throw new Error(ins.error.message);
  await notify("payment_received", `Payment received ${amount} (${c.method}) — ${label}`, est, null, (c.amountCents || 0) / 100);
  await opsNote(admin, est.id, `Customer payment email: ${amount} via ${c.method} recorded on Payments (verify).`);
  return { status: "applied", estimateId: est.id, note: "customer payment recorded" };
}
