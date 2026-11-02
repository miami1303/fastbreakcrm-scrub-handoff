// Needs Carrier (Owner 2026-10-31). A BOOKED job with no carrier assigned 2 days after the END of its
// pickup window (Pickup second date, or the first date when there is no second) raises a
// "Needs carrier" banner so the office can update the customer / raise COD. The banner does NOT
// clear on view: it stays until a carrier is assigned or the pickup window dates change.
export const NEEDS_CARRIER_GRACE_DAYS = 2;

export type NeedsCarrierInput = {
  status?: string | null;
  deleted_at?: string | null;
  primary_date?: string | null;
  backup_date?: string | null;
  carrier_assigned_at?: string | null;
};

const ymd = (v: unknown) => { const s = String(v ?? "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; };

/** End of the pickup window: the second date when present (and not before the first), else the first. */
export function pickupWindowEnd(e: NeedsCarrierInput): string {
  const a = ymd(e.primary_date), b = ymd(e.backup_date);
  if (a && b) return b >= a ? b : a;
  return b || a;
}

/** Identifies the window the banner was raised for. A different key = dates changed. */
export function pickupWindowKey(e: NeedsCarrierInput): string {
  return `${ymd(e.primary_date)}|${ymd(e.backup_date)}`;
}

/** YYYY-MM-DD + n days (calendar math, no time zone drift). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** today (YYYY-MM-DD, Chicago) is at least 2 days after the window end and still no carrier. */
export function needsCarrierDue(e: NeedsCarrierInput, today: string): boolean {
  if (e.status !== "booked" || e.deleted_at || e.carrier_assigned_at) return false;
  const end = pickupWindowEnd(e);
  if (!end) return false;
  return today >= addDays(end, NEEDS_CARRIER_GRACE_DAYS);
}

/**
 * What the scan should do for one job, given the window key the banner was raised for (null = none).
 *   raise  -> due and not yet raised for this window
 *   clear  -> a raised banner must go (carrier assigned, window changed, no longer booked)
 *   keep   -> nothing to do
 * When the window changes and the new window is already overdue: clear + raise again ("clear_raise").
 */
export function needsCarrierAction(e: NeedsCarrierInput, raisedKey: string | null | undefined, today: string): "raise" | "clear" | "clear_raise" | "keep" {
  const due = needsCarrierDue(e, today);
  const key = pickupWindowKey(e);
  if (!raisedKey) return due ? "raise" : "keep";
  if (raisedKey === key) return due ? "keep" : "clear";
  return due ? "clear_raise" : "clear";
}

export function needsCarrierMessage(e: { job_number?: string | null; customer_name?: string | null } & NeedsCarrierInput): string {
  const job = e.job_number ? `Job #${e.job_number}` : "Job";
  const who = e.customer_name ? ` — ${e.customer_name}` : "";
  return `Needs carrier: ${job}${who} — pickup window ended ${pickupWindowEnd(e)} (2+ days ago) with no carrier assigned. Update the customer / raise COD.`;
}

/** "ATTN / Needs carrier" email to OPS_ALERT_EMAIL (Owner 2026-10-31), once per pickup window. */
export function needsCarrierEmail(o: { job: string; customer: string; windowEnd: string; url: string }) {
  const subject = `ATTN needs carrier: ${[o.job ? `Job #${o.job}` : "", o.customer].filter(Boolean).join(" — ")}`;
  const text = [
    "ATTN needs carrier.",
    `This booked job still has no carrier ${NEEDS_CARRIER_GRACE_DAYS}+ days after the last day of its pickup window. Please update the customer / find a carrier.`,
    "",
    `Job: ${o.job}`,
    `Customer: ${o.customer}`,
    `Pickup window ended: ${o.windowEnd}`,
    "",
    `Open the lead: ${o.url}`,
    "The red Needs carrier banner stays until a carrier is assigned or the pickup dates change.",
  ].join("\n");
  return { subject, text };
}
