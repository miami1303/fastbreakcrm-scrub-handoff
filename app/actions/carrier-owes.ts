"use server";

// Carrier Owes + Delivered + F.A.D. / Delivery windows (Owner 2026-10-31). BACK OFFICE ONLY.
// Nothing here touches quotes, vehicles, deposit, COD, total or payments (customer money stays as quoted).
//   setCarrierOwes   -> amount the carrier owes us at delivery.
//   markDelivered    -> stamps delivered_at (ops strip "Delivered?" button).
//   markCarrierPaid  -> manual entry: carrier paid. Records it, clears the "Carrier owes us money" banner.
//   saveDeliveryWindows -> F.A.D. start/end + Delivery date start/end.
// When delivered AND owes > 0 AND not paid: one crm_notifications "carrier_owes" row per admin/supervisor
// + lead owner (clears for each admin when they view it; marking paid clears it for all) and one
// "ATTN Ops carrier owes" email to OPS_ALERT_EMAIL.
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getAccessibleEstimate, getStaff, jobLabel, notify } from "@/lib/crm-server";
import { isSchemaMiss } from "@/lib/payments/decide";
import { formatCents } from "@/lib/money";
import { CARRIER_OWES_EMAIL_TO, alertCarrierPaid, sendCarrierOwesEmail } from "@/lib/carrier-owes-alert";
import { carrierOwesState, checkWindow, parseCarrierOwes } from "@/lib/carrier-owes";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const NEEDS = "Carrier Owes / delivery dates need the 20261031230000_carrier_owes_and_delivery_windows migration applied. Nothing was saved.";
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });
const text = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max) || null;

async function gate(estimateId: string) {
  const staff = await getStaff();
  if (!staff) throw new Error("Your session expired. Please sign in again.");
  if (!(await getAccessibleEstimate(staff, estimateId))) throw new Error("Estimate not found.");
  const admin = createSupabaseAdminClient();
  const { data: est } = await admin.from("estimates").select("*").eq("id", estimateId).maybeSingle();
  if (!est) throw new Error("Estimate not found.");
  return { staff, admin, est };
}
type Gate = Awaited<ReturnType<typeof gate>>;

async function opsNote(g: Gate, body: string) {
  await g.admin.from("estimate_notes").insert({ estimate_id: g.est.id, kind: "operations", created_by: g.staff.userId, author_name: g.staff.name, body });
}

/** Raise the banner + send the email once, when delivered AND carrier still owes. Safe to call any time. */
async function maybeAlert(g: Gate): Promise<{ alerted: boolean; emailed: boolean }> {
  const { admin } = g;
  const { data: est } = await admin.from("estimates").select("*").eq("id", g.est.id).maybeSingle();
  if (!est || est.carrier_owes_notified_at) return { alerted: false, emailed: false };
  const s = carrierOwesState(est);
  if (!s.bannerOn) return { alerted: false, emailed: false };
  const now = new Date().toISOString();
  // Claim the alert first so two clicks never send two emails.
  const { data: claimed } = await admin.from("estimates").update({ carrier_owes_notified_at: now }).eq("id", est.id).is("carrier_owes_notified_at", null).select("id");
  if (!claimed?.length) return { alerted: false, emailed: false };
  const amount = formatCents(s.owesC);
  await notify("carrier_owes", `Carrier owes us money: ${amount} — ${jobLabel(est)}`, est, null, s.owesC / 100);
  const emailed = await sendCarrierOwesEmail(admin, est, amount);
  await opsNote(g, `Carrier owes us ${amount}: banner raised${emailed ? ` and emailed ${CARRIER_OWES_EMAIL_TO}` : " (email NOT sent — check mail setup)"}.`);
  return { alerted: true, emailed };
}

/** Stop the banner for everyone: dismiss every open carrier_owes row on this lead. */
async function clearBanner(g: Gate) {
  await g.admin.from("crm_notifications").update({ dismissed_at: new Date().toISOString() }).eq("estimate_id", g.est.id).eq("kind", "carrier_owes").is("dismissed_at", null);
}

export async function setCarrierOwes(estimateId: string, raw: string): Promise<R<{ alerted: boolean }>> {
  try {
    const g = await gate(estimateId);
    const p = parseCarrierOwes(raw);
    if (!p.ok) return p;
    const prev = carrierOwesState(g.est);
    const changed = (p.amount === null ? 0 : Math.round(p.amount * 100)) !== prev.owesC;
    const patch: Record<string, unknown> = { carrier_owes_amount: p.amount };
    // A new amount after it was paid = a new debt: reopen it (and allow a new alert).
    if (changed) Object.assign(patch, { carrier_owes_paid_at: null, carrier_owes_paid_by_name: null, carrier_owes_paid_note: null, carrier_owes_notified_at: null });
    const { error } = await g.admin.from("estimates").update(patch).eq("id", estimateId);
    if (!error && changed) await g.admin.from("estimates").update({ carrier_paid_notified_at: null }).eq("id", estimateId); // new debt -> its payment is a new event
    if (error) return { ok: false, error: isSchemaMiss(error) ? NEEDS : error.message };
    if (!changed) return { ok: true, alerted: false };
    if (prev.owesC > 0 && !prev.paid) await clearBanner(g);
    await opsNote(g, p.amount === null ? "Carrier Owes cleared." : `Carrier Owes set to ${formatCents(Math.round(p.amount * 100))} (back office only; customer pricing unchanged).`);
    const a = await maybeAlert(g);
    return { ok: true, alerted: a.alerted };
  } catch (e) { return fail(e); }
}

export async function markDelivered(estimateId: string, undo = false): Promise<R<{ deliveredAt: string | null; alerted: boolean }>> {
  try {
    const g = await gate(estimateId);
    if (g.est.status !== "booked") return { ok: false, error: "Book the job first." };
    if (undo) {
      const { error } = await g.admin.from("estimates").update({ delivered_at: null, carrier_owes_notified_at: null }).eq("id", estimateId);
      if (error) return { ok: false, error: isSchemaMiss(error) ? NEEDS : error.message };
      await clearBanner(g);
      await opsNote(g, `Delivered undone by ${g.staff.name}.`);
      return { ok: true, deliveredAt: null, alerted: false };
    }
    if (g.est.delivered_at) return { ok: true, deliveredAt: g.est.delivered_at, alerted: false };
    const at = new Date().toISOString();
    const { error } = await g.admin.from("estimates").update({ delivered_at: at, last_touched_at: at }).eq("id", estimateId);
    if (error) return { ok: false, error: isSchemaMiss(error) ? NEEDS : error.message };
    await opsNote(g, `Vehicle delivered (marked by ${g.staff.name}).`);
    const a = await maybeAlert(g);
    return { ok: true, deliveredAt: at, alerted: a.alerted };
  } catch (e) { return fail(e); }
}

export async function markCarrierPaid(estimateId: string, note: string, undo = false): Promise<R<{ paidAt: string | null }>> {
  try {
    const g = await gate(estimateId);
    const s = carrierOwesState(g.est);
    if (undo) {
      const { error } = await g.admin.from("estimates").update({ carrier_owes_paid_at: null, carrier_owes_paid_by_name: null, carrier_owes_paid_note: null, carrier_owes_notified_at: null }).eq("id", estimateId);
      if (!error) await g.admin.from("estimates").update({ carrier_owes_deposited_at: null }).eq("id", estimateId); // ignore if column missing
      if (!error) await g.admin.from("estimates").update({ carrier_paid_notified_at: null }).eq("id", estimateId); // next payment = new event
      if (error) return { ok: false, error: isSchemaMiss(error) ? NEEDS : error.message };
      await opsNote(g, `Carrier paid entry undone by ${g.staff.name}.`);
      await maybeAlert(g);
      return { ok: true, paidAt: null };
    }
    if (s.owesC <= 0) return { ok: false, error: "Enter what the carrier owes first." };
    if (s.paid) return { ok: true, paidAt: g.est.carrier_owes_paid_at };
    const at = new Date().toISOString();
    const paid = { carrier_owes_paid_at: at, carrier_owes_paid_by_name: g.staff.name, carrier_owes_paid_note: text(note) };
    // Carrier's money goes to deposit bookkeeping (back office). It is NOT a customer payment:
    // no payments row, so customer Deposit / COD / Total / Balance and the quote stay as they were.
    let { error } = await g.admin.from("estimates").update({ ...paid, carrier_owes_deposited_at: at }).eq("id", estimateId);
    if (error && isSchemaMiss(error)) ({ error } = await g.admin.from("estimates").update(paid).eq("id", estimateId)); // deposit column migration not applied yet
    if (error) return { ok: false, error: isSchemaMiss(error) ? NEEDS : error.message };
    await clearBanner(g);
    await opsNote(g, `Carrier paid what it owed (${formatCents(s.owesC)})${text(note) ? `: ${text(note)}` : ""}. Added to deposit bookkeeping (carrier, back office). Recorded by ${g.staff.name}. Customer balance due, total and quote unchanged.`);
    const pa = await alertCarrierPaid(g.admin, { ...g.est, ...paid }, formatCents(s.owesC), s.owesC / 100, `Marked paid by ${g.staff.name}${text(note) ? ` — ${text(note)}` : ""}`);
    if (pa.alerted) await opsNote(g, `Carrier paid banner raised${pa.emailed ? ` and emailed ${CARRIER_OWES_EMAIL_TO} (ATTN Ops)` : " (email NOT sent — check mail setup)"}.`);
    return { ok: true, paidAt: at };
  } catch (e) { return fail(e); }
}

export type DeliveryWindows = { fad_start: string; fad_end: string; delivery_window_start: string; delivery_window_end: string };
export async function saveDeliveryWindows(estimateId: string, w: DeliveryWindows): Promise<R> {
  try {
    const g = await gate(estimateId);
    const c = (v: unknown) => String(v ?? "").trim().slice(0, 10);
    const v = { fad_start: c(w.fad_start), fad_end: c(w.fad_end), delivery_window_start: c(w.delivery_window_start), delivery_window_end: c(w.delivery_window_end) };
    const bad = checkWindow("F.A.D.", v.fad_start, v.fad_end) || checkWindow("Delivery date", v.delivery_window_start, v.delivery_window_end);
    if (bad) return { ok: false, error: bad };
    const { error } = await g.admin.from("estimates").update({
      fad_start: v.fad_start || null, fad_end: v.fad_end || null,
      delivery_window_start: v.delivery_window_start || null, delivery_window_end: v.delivery_window_end || null,
    }).eq("id", estimateId);
    if (error) return { ok: false, error: isSchemaMiss(error) ? NEEDS : error.message };
    return { ok: true };
  } catch (e) { return fail(e); }
}
