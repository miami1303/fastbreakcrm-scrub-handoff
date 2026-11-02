// Carrier Owes (Owner 2026-10-31). BACK OFFICE ONLY: what the carrier owes Fast Break at delivery.
// It never touches the customer's money: Deposit, COD, Total and Balance stay exactly as quoted
// (e.g. Deposit $395 + COD $1,100 = $1,495 for the customer even when the carrier owes us $100).
// Banner "Carrier owes us money" = delivered AND owes > 0 AND not marked paid. Marking paid only
// records the payment and stops the banner.
import { toCents } from "./money.ts";

export type CarrierOwesInput = {
  carrier_owes_amount?: number | string | null;
  carrier_owes_paid_at?: string | null;
  delivered_at?: string | null;
};
export type CarrierOwesState = { owesC: number; paid: boolean; delivered: boolean; outstanding: boolean; bannerOn: boolean };

export function carrierOwesState(e: CarrierOwesInput): CarrierOwesState {
  const c = toCents(e.carrier_owes_amount);
  const owesC = c && c > 0 ? c : 0;
  const paid = !!e.carrier_owes_paid_at;
  const delivered = !!e.delivered_at;
  const outstanding = owesC > 0 && !paid;
  return { owesC, paid, delivered, outstanding, bannerOn: outstanding && delivered };
}

/** Customer-facing money. Carrier Owes is deliberately NOT an input: it can never change these. */
export function customerMoney(o: { deposit: number | string | null | undefined; cod: number | string | null | undefined; paid?: number | string | null }) {
  const depositC = toCents(o.deposit) ?? 0;
  const codC = toCents(o.cod) ?? 0;
  const paidC = toCents(o.paid) ?? 0;
  return { depositC, codC, totalC: depositC + codC, paidC, balanceC: depositC + codC - paidC };
}

/** Parse the typed Carrier Owes amount. "" = clear. Negative / junk = error. */
export function parseCarrierOwes(raw: unknown): { ok: true; amount: number | null } | { ok: false; error: string } {
  const s = String(raw ?? "").replace(/[$,\s]/g, "");
  if (!s) return { ok: true, amount: null };
  const c = toCents(s);
  if (c === null) return { ok: false, error: "Enter the amount the carrier owes, like 100.00." };
  if (c < 0) return { ok: false, error: "Enter the carrier-owes amount as a positive number (it is already treated as owed to us)." };
  if (c > 10_000_000) return { ok: false, error: "That amount is too large." };
  return { ok: true, amount: c === 0 ? null : c / 100 };
}

/** Two-day window: both optional, end may be blank; end before start is an error. YYYY-MM-DD. */
export function checkWindow(label: string, start: string, end: string): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (start && !re.test(start)) return `${label}: pick a start date.`;
  if (end && !re.test(end)) return `${label}: pick an end date.`;
  if (end && !start) return `${label}: pick the first date (the second is optional).`;
  if (start && end && end < start) return `${label}: the second date is before the first.`;
  return null;
}

export function carrierOwesEmail(o: {
  job: string; customer: string; pickup: string; delivery: string; amount: string; deliveredAt: string;
  carrier: string; url: string; vehicles: string;
}) {
  // "ATTN Ops carrier owes" (Owner 2026-10-31): Ops chases the carrier down from this email.
  const subject = `ATTN Ops carrier owes: ${o.amount} — ${[o.job ? `Job #${o.job}` : "", o.customer].filter(Boolean).join(" — ")}`;
  const text = [
    "ATTN Ops — carrier owes.",
    "The vehicle was delivered and the carrier still owes Fast Break money. Please chase the carrier down for payment.",
    "",
    `Amount carrier owes: ${o.amount}`,
    `Job: ${o.job}`,
    `Customer: ${o.customer}`,
    o.vehicles ? `Vehicle(s): ${o.vehicles}` : "",
    `Route: ${o.pickup} -> ${o.delivery}`,
    `Delivered: ${o.deliveredAt}`,
    "",
    "Carrier info:",
    o.carrier.trim() || "(no Carrier Info on the lead yet)",
    "",
    `Open the lead: ${o.url}`,
    "The banner keeps running until someone enters the carrier's payment on the Payments tab (Carrier Owes -> Carrier paid).",
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
  return { subject, text };
}

export function carrierPaidEmail(o: {
  job: string; customer: string; amount: string; paidAt: string; method: string; carrier: string; url: string; vehicles: string;
}) {
  // "ATTN Ops carrier paid" (Owner 2026-10-31): Ops knows the carrier's money came in.
  const subject = `ATTN Ops carrier paid: ${o.amount} — ${[o.job ? `Job #${o.job}` : "", o.customer].filter(Boolean).join(" — ")}`;
  const text = [
    "ATTN Ops — carrier paid.",
    "The carrier paid what it owed Fast Break. It was added to deposit bookkeeping (back office); customer balance, total and quote are unchanged.",
    "",
    `Amount carrier paid: ${o.amount}`,
    `Job: ${o.job}`,
    `Customer: ${o.customer}`,
    o.vehicles ? `Vehicle(s): ${o.vehicles}` : "",
    `Paid: ${o.paidAt}`,
    o.method ? `Recorded: ${o.method}` : "",
    "",
    "Carrier info:",
    o.carrier.trim() || "(no Carrier Info on the lead yet)",
    "",
    `Open the lead: ${o.url}`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
  return { subject, text };
}

/** Ops strip "Carrier owes" pill: hidden unless owed and unpaid; blue before pickup, green once delivered (banner). */
export function carrierOwesPill(e: CarrierOwesInput & { picked_up_at?: string | null }): "hidden" | "blue" | "green" {
  const o = carrierOwesState(e);
  if (!o.outstanding) return "hidden";
  return o.bannerOn ? "green" : "blue";
}

/**
 * Planned settlement (Owner 2026-10-31). STAFF PAYMENTS MENU ONLY — the customer never sees this.
 * Carrier owes is a back-door way to collect more deposit: once the carrier pays, FB's deposit
 * bookkeeping = Deposit + Carrier owes and the carrier keeps COD - Carrier owes at delivery.
 * Example: Deposit $300, COD $1,100, Carrier owes $100 ->
 *   before carrier pays: FB deposit $300, carrier COD $1,100, carrier still owes $100
 *   after carrier pays:  FB deposit $400, carrier COD $1,000
 * Customer math (Total = Deposit + COD, Customer Payment, Balance) is never an output here.
 */
export function carrierSettlement(o: { deposit: number | string | null | undefined; cod: number | string | null | undefined } & CarrierOwesInput) {
  const s = carrierOwesState(o);
  const depositC = toCents(o.deposit) ?? 0;
  const codC = toCents(o.cod) ?? 0;
  const fbDepositAfterC = depositC + s.owesC;
  const carrierCodAfterC = codC - s.owesC;
  return {
    owesC: s.owesC, paid: s.paid, depositC, codC,
    fbDepositAfterC, carrierCodAfterC,
    fbDepositNowC: s.paid ? fbDepositAfterC : depositC,
    carrierCodNowC: s.paid ? carrierCodAfterC : codC,
    stillOwesC: s.paid ? 0 : s.owesC,
  };
}
