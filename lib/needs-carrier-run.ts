import "server-only";
// Needs carrier scan. Called by /api/cron/needs-carrier (any scheduler, once or a few times a day) and,
// for one job, right after a carrier is assigned or the pickup dates are saved (clears at once).
// estimates.needs_carrier_window = pickup window key the banner was raised for (idempotent: one raise per window).
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { notify } from "@/lib/crm-server";
import { todayChicago } from "@/lib/calendar";
import { sendNeedsCarrierEmail } from "@/lib/carrier-owes-alert";
import { needsCarrierAction, needsCarrierMessage, pickupWindowKey } from "@/lib/needs-carrier";

const COLS = "id, owner_id, status, deleted_at, job_number, customer_name, primary_date, backup_date, carrier_assigned_at, needs_carrier_window";
type Row = { id: string; owner_id: string | null; status: string; deleted_at: string | null; job_number: string | null; customer_name: string | null;
  primary_date: string | null; backup_date: string | null; carrier_assigned_at: string | null; needs_carrier_window: string | null };

async function clearRows(admin: SupabaseClient, id: string) {
  await admin.from("crm_notifications").update({ dismissed_at: new Date().toISOString() }).eq("estimate_id", id).eq("kind", "needs_carrier").is("dismissed_at", null);
  await admin.from("estimates").update({ needs_carrier_window: null }).eq("id", id);
}

async function handle(admin: SupabaseClient, e: Row, today: string): Promise<"raised" | "cleared" | "kept"> {
  const act = needsCarrierAction(e, e.needs_carrier_window, today);
  if (act === "keep") return "kept";
  if (act === "clear" || act === "clear_raise") await clearRows(admin, e.id);
  if (act === "clear") return "cleared";
  const key = pickupWindowKey(e);
  // Claim before notifying so overlapping runs never raise twice for the same window.
  const { data: claimed } = await admin.from("estimates").update({ needs_carrier_window: key }).eq("id", e.id).is("needs_carrier_window", null).select("id");
  if (!claimed?.length) return "kept";
  await notify("needs_carrier", needsCarrierMessage(e), e);
  // Email/CC OPS_ALERT_EMAIL once per window (same needs_carrier_window claim -> no spam).
  await sendNeedsCarrierEmail(e);
  return "raised";
}

export async function runNeedsCarrier(now: Date = new Date()) {
  const admin = createSupabaseAdminClient();
  const today = todayChicago(now);
  // Candidates: booked + no carrier (may need raising), plus anything already raised (may need clearing).
  const [{ data: open, error }, { data: raised }] = await Promise.all([
    admin.from("estimates").select(COLS).eq("status", "booked").is("deleted_at", null).is("carrier_assigned_at", null).limit(2000),
    admin.from("estimates").select(COLS).not("needs_carrier_window", "is", null).limit(2000),
  ]);
  if (error) throw new Error(error.message);
  const rows = new Map<string, Row>();
  for (const r of [...(open || []), ...(raised || [])] as Row[]) rows.set(r.id, r);
  const out = { raised: 0, cleared: 0, checked: rows.size };
  for (const e of rows.values()) {
    const r = await handle(admin, e, today);
    if (r === "raised") out.raised++;
    if (r === "cleared") out.cleared++;
  }
  return { ok: true as const, today, ...out };
}

/** Re-check one job now (carrier assigned / pickup dates saved). Never throws. */
export async function recheckNeedsCarrier(estimateId: string) {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("estimates").select(COLS).eq("id", estimateId).maybeSingle();
    if (error || !data) return; // migration not applied yet -> nothing to do
    await handle(admin, data as Row, todayChicago());
  } catch (e) { console.error("[crm] needs carrier recheck failed:", e instanceof Error ? e.message : "unknown"); }
}
