// Manual operations progress until the Central Dispatch API (Owner 2026-10-31). One strip near
// Job No that the whole office sees:
//   Charged -> Job Posted -> Carrier assigned -> Picked up -> Delivered   (+ red "Needs carrier")
// Charged turns green from Payment Records. Posted / Carrier / Picked up / Delivered are on/off toggles;
// Picked up / Delivered are also stamped by the Central Dispatch inbox watch.
// Contract e-signed / CC e-signed were removed from the strip (Owner 2026-10-31): they already show on the order.
import { needsCarrierDue, type NeedsCarrierInput } from "./needs-carrier.ts";

export type OpsStepKey = "charged" | "posted" | "carrier" | "picked" | "delivered";
export type OpsStep = { key: OpsStepKey; label: string; done: boolean; at: string | null; toggle: boolean };

export function opsSteps(o: {
  chargedAt?: string | null;
  postedAt?: string | null; carrierAssignedAt?: string | null;
  pickedUpAt?: string | null; deliveredAt?: string | null;
}): OpsStep[] {
  const s = (key: OpsStepKey, label: string, at?: string | null, toggle = true): OpsStep => ({ key, label, done: !!at, at: at || null, toggle });
  return [
    s("charged", "Charged", o.chargedAt),
    s("posted", "Job Posted", o.postedAt),
    s("carrier", "Carrier assigned", o.carrierAssignedAt),
    s("picked", "Picked up", o.pickedUpAt),
    s("delivered", "Delivered", o.deliveredAt),
  ];
}

/** Strip "Needs carrier" (red): booked, 2+ days past the end of the pickup window, no carrier. */
export const stripNeedsCarrier = (e: NeedsCarrierInput, today: string) => needsCarrierDue(e, today);

export type OpsColor = "red" | "orange" | "green" | "delivered" | "none";
export type OpsCalendarInput = NeedsCarrierInput & { picked_up_at?: string | null; delivered_at?: string | null };

/**
 * Operations calendar color (Owner 2026-10-31), strongest signal first:
 *   delivered -> "delivered" (dark green + Delivered tag)
 *   picked up -> "green"
 *   carrier assigned (not picked up) -> "orange"
 *   2+ days past the last pickup-window date, still no carrier -> "red"
 *   otherwise "none" (normal card)
 */
export function opsCalendarColor(e: OpsCalendarInput, today: string): OpsColor {
  if (e.delivered_at) return "delivered";
  if (e.picked_up_at) return "green";
  if (e.carrier_assigned_at) return "orange";
  if (needsCarrierDue(e, today)) return "red";
  return "none";
}

export const OPS_COLOR_LABEL: Record<OpsColor, string> = {
  red: "Needs carrier", orange: "Carrier assigned", green: "Picked up", delivered: "Delivered", none: "",
};

// Same rule as countsAsPaid (lib/payments/decide.ts): no status (older rows) or a counted status.
// Pending / processing / held / failed rows are NOT charged, so the pill stays off for them.
const COUNTED = new Set(["recorded", "logged_manual", "succeeded", "bookkeeping_adjustment"]);
const counted = (p: { charge_status?: string | null }) => !p.charge_status || COUNTED.has(p.charge_status);

/** Earliest counted (non-void, positive, actually charged/recorded) payment = "Charged". */
export function firstChargedAt(payments: { created_at?: string | null; amount?: number | string | null; voided_at?: string | null; charge_status?: string | null }[]): string | null {
  const ok = payments.filter(p => !p.voided_at && counted(p) && Number(p.amount) > 0 && p.created_at).map(p => String(p.created_at)).sort();
  return ok[0] || null;
}

/** Carrier-assigned text: plain, from Fastbreak CRM, with the newest Carrier Info as pasted. */
export function carrierAssignedSms(o: { company: string; job: string; carrier: string; pickup: string; phone: string }): string {
  const pick = o.pickup.trim() ? ` Pickup: ${o.pickup.trim()}.` : "";
  return `${o.company}: a carrier is assigned for your job ${o.job}.${pick}\nCarrier info:\n${o.carrier.trim()}\nQuestions? Call ${o.phone}. Reply STOP to opt out.`;
}

type Pay = { created_at?: string | null; amount?: number | string | null; voided_at?: string | null; charge_status?: string | null };
/**
 * Charged pill state from Payment Records (Owner 2026-10-31):
 *   "charged" -> at least one counted positive payment and the net is above $0 (green)
 *   "refund"  -> money was charged but negative entries (refund / return to customer) bring the net to $0 or less
 *   "none"    -> nothing charged (pending / held / failed rows never count)
 * Strip (2026-10-31 follow-up): Charged stays green once charged; a separate red Refund pill
 * appears ONLY when state is "refund" (full refund). Partial refunds show no Refund pill.
 * Money is never toggled from the strip: the pill opens Payments, where charges / refunds are recorded.
 */
export function chargeState(payments: Pay[]): { state: "none" | "charged" | "refund"; at: string | null } {
  const live = payments.filter(p => !p.voided_at && counted(p));
  const at = firstChargedAt(live);
  if (!at) return { state: "none", at: null };
  const netC = live.reduce((n, p) => n + Math.round((Number(p.amount) || 0) * 100), 0);
  if (netC <= 0) {
    const last = live.filter(p => Number(p.amount) < 0 && p.created_at).map(p => String(p.created_at)).sort().pop() || at;
    return { state: "refund", at: last };
  }
  return { state: "charged", at };
}
