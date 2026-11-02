"use server";

// Manual ops until Central Dispatch (Owner 2026-10-31): Job Posted button + carrier-assigned text.
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getAccessibleEstimate, getStaff, jobLabel, notify } from "@/lib/crm-server";
import { recheckNeedsCarrier } from "@/lib/needs-carrier-run";
import { getCompanyInfo } from "@/lib/company-settings";
import { formatDate } from "@/lib/quote-template";
import { carrierAssignedSms } from "@/lib/ops-status";
import { sendSms, smsMode } from "@/lib/sms";
import { scrubSecrets } from "@/lib/payments/decide";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function gate(estimateId: string) {
  const staff = await getStaff();
  if (!staff) throw new Error("Your session expired. Please sign in again.");
  if (!(await getAccessibleEstimate(staff, estimateId))) throw new Error("Estimate not found.");
  const admin = createSupabaseAdminClient();
  const { data: est } = await admin.from("estimates").select("*").eq("id", estimateId).maybeSingle();
  if (!est) throw new Error("Estimate not found.");
  return { staff, admin, est };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

/** Job Posted (manual until Central): stamps estimates.posted_at, logs an Operations note. Re-clickable: a repost refreshes posted_at. */
export async function markJobPosted(estimateId: string): Promise<R<{ postedAt: string; reposted: boolean }>> {
  try {
    const { staff, admin, est } = await gate(estimateId);
    if (est.status !== "booked") return { ok: false, error: "Book the job first." };
    const reposted = !!est.posted_at;
    const postedAt = new Date().toISOString();
    const { error } = await admin.from("estimates").update({ posted_at: postedAt, last_touched_at: postedAt }).eq("id", estimateId);
    if (error) return { ok: false, error: /posted_at/.test(error.message) ? "Job Posted needs the 20261031220000 migration applied." : error.message };
    await admin.from("estimate_notes").insert({ estimate_id: estimateId, kind: "operations", created_by: staff.userId, author_name: staff.name, body: reposted ? `Job Reposted (manual) by ${staff.name}; previously posted ${est.posted_at}.` : `Job Posted (manual) by ${staff.name}.` });
    return { ok: true, postedAt, reposted };
  } catch (e) { return fail(e); }
}

/** Is texting configured? (Text button shows "Text (API pending)" when not.) */
export async function carrierTextSetup(): Promise<{ sms: boolean }> {
  return { sms: !!smsMode() };
}

/** Texts the customer the newest Carrier Info + pickup date (and time when set). Logged as an Operations note. */
export async function textCarrierAssigned(estimateId: string): Promise<R<{ message: string }>> {
  try {
    const { staff, admin, est } = await gate(estimateId);
    if (est.status !== "booked") return { ok: false, error: "Book the job first." };
    if (!smsMode()) return { ok: false, error: "Texting is not set up yet (SMS API pending)." };
    if (!est.customer_phone) return { ok: false, error: "Add the customer's phone first." };
    const { data: notes } = await admin.from("estimate_notes").select("body").eq("estimate_id", estimateId).eq("kind", "carrier").order("created_at", { ascending: false }).limit(1);
    const carrier = String(notes?.[0]?.body || "").trim();
    if (!carrier) return { ok: false, error: "Add the carrier in Carrier Info (under Vehicles) first." };
    const company = await getCompanyInfo();
    const pickup = [formatDate(est.primary_date), String(est.pickup_time || "").trim()].filter(Boolean).join(" ");
    const body = carrierAssignedSms({ company: company.quoteCompanyName, job: est.job_number || "", carrier, pickup, phone: company.mainPhone });
    const r = await sendSms(est.customer_phone, body);
    await admin.from("estimate_notes").insert({
      estimate_id: estimateId, kind: "operations", created_by: staff.userId, author_name: staff.name,
      body: r.ok ? `Carrier-assigned text sent to ${est.customer_phone}.` : `Carrier-assigned text failed: ${scrubSecrets(r.error)}`,
    });
    if (!r.ok) return { ok: false, error: `The text was not sent: ${scrubSecrets(r.error)}` };
    await admin.from("estimates").update({ last_touched_at: new Date().toISOString() }).eq("id", estimateId);
    return { ok: true, message: `Carrier info texted to ${est.customer_phone}.` };
  } catch (e) { return fail(e); }
}

export type OpsFlag = "charged" | "posted" | "carrier" | "picked" | "delivered";
const FLAG_COL: Record<OpsFlag, string> = { charged: "charged_override", posted: "posted_at", carrier: "carrier_assigned_at", picked: "picked_up_at", delivered: "delivered_at" };
const FLAG_LABEL: Record<OpsFlag, string> = { charged: "Charged", posted: "Job Posted", carrier: "Carrier assigned", picked: "Picked up", delivered: "Delivered" };
const FLAG_MIGRATION: Record<OpsFlag, string> = { charged: "20261101070000_charged_override", posted: "20261031220000", carrier: "20261031220000", picked: "20261101020000_picked_up_at", delivered: "20261031230000" };

/**
 * Ops strip on/off toggles (Owner 2026-10-31): Job Posted, Carrier assigned, Picked up, Delivered.
 * on = stamp now (Delivered "on" goes through markDelivered so the Carrier Owes alert still fires);
 * off = clear the stamp. Every change is logged as an Operations note.
 */
export async function setOpsFlag(estimateId: string, flag: OpsFlag, on: boolean): Promise<R<{ at: string | null }>> {
  try {
    if (!(flag in FLAG_COL)) return { ok: false, error: "Unknown status." };
    // Charged / Job Posted / Carrier assigned are always clickable on/off (Owner, repeatedly): no booked gate.
    const { staff, admin, est } = await gate(estimateId);
    if ((flag === "picked" || flag === "delivered") && est.status !== "booked") return { ok: false, error: "Book the job first." };
    const col = FLAG_COL[flag];
    const at = on ? new Date().toISOString() : null;
    const patch: Record<string, unknown> = { [col]: flag === "charged" ? on : at, last_touched_at: new Date().toISOString() };
    const { error } = await admin.from("estimates").update(patch).eq("id", estimateId);
    if (error) return { ok: false, error: new RegExp(col).test(error.message) ? `${FLAG_LABEL[flag]} needs the ${FLAG_MIGRATION[flag]} migration applied.` : error.message };
    if (flag === "carrier" && !on) {
      // Unassigned: the Job Assigned banner no longer applies.
      await admin.from("crm_notifications").update({ dismissed_at: new Date().toISOString() }).eq("estimate_id", estimateId).eq("kind", "job_assigned").is("dismissed_at", null).then(() => null, () => null);
    }
    if (flag === "carrier") {
      // Same as Carrier Info save: ON raises Job Assigned; either way recheck "Needs carrier".
      if (on) await notify("job_assigned", `Job Assigned: ${jobLabel(est)}`, est);
      await recheckNeedsCarrier(estimateId);
    }
    await admin.from("estimate_notes").insert({ estimate_id: estimateId, kind: "operations", created_by: staff.userId, author_name: staff.name,
      body: `${FLAG_LABEL[flag]} ${on ? "ON" : "OFF"} (manual) by ${staff.name}.` });
    return { ok: true, at };
  } catch (e) { return fail(e); }
}

/** Carrier pickup time ("HH:MM" Chicago wall clock, or "" to clear). Prints on the customer order next to the pickup date. */
export async function setPickupTime(estimateId: string, hhmm: string): Promise<R<{ time: string | null }>> {
  try {
    const { staff, admin } = await gate(estimateId);
    const t = String(hhmm || "").trim();
    if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return { ok: false, error: "Pick a valid time." };
    const { error } = await admin.from("estimates").update({ pickup_time: t || null, last_touched_at: new Date().toISOString() }).eq("id", estimateId);
    if (error) return { ok: false, error: error.message };
    await admin.from("estimate_notes").insert({ estimate_id: estimateId, kind: "operations", created_by: staff.userId, author_name: staff.name,
      body: t ? `Pickup time set to ${t} (CT) by ${staff.name}.` : `Pickup time cleared by ${staff.name}.` });
    return { ok: true, time: t || null };
  } catch (e) { return fail(e); }
}
