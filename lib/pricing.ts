// Lead pricing on the Charges tab (Owner, 2026-10-23). Integer cents throughout.
//   TOTAL = DEPOSIT + CARRIER PAY (COD) + filled extra charge lines.
//   Typing the Total instead recalculates COD = TOTAL - DEPOSIT - extras (never below 0).
//   Legacy vehicle `price` is the carrier pay per unit: COD defaults to sum(price x qty).
// Per-vehicle Deposit / Carrier COD / Total (and the customer price column) live in
// lib/vehicle-pricing.ts. Customers see each vehicle's total price, not the deposit/COD split.
import { toCents } from "./money.ts";

export type PricedVehicle = { price?: unknown; qty?: unknown; deposit?: unknown; cod?: unknown };
export const qtyOf = (v: PricedVehicle) => { const n = parseInt(String(v.qty ?? 1), 10); return Number.isFinite(n) && n >= 1 ? Math.min(n, 99) : 1; };
export const priceCents = (v: PricedVehicle): number | null => {
  const raw = String(v.price ?? "").trim();
  if (!raw) return null;
  const c = toCents(raw);
  return c === null || c < 0 ? null : c;
};
export const lineCents = (v: PricedVehicle) => (priceCents(v) ?? 0) * qtyOf(v);

const entered = (value: unknown) => String(value ?? "").trim() !== "";
/** Deposit + carrier COD when either box/column is filled (including 0). Null when neither is set. */
export function splitTotalCents(v: PricedVehicle): number | null {
  if (!entered(v.deposit) && !entered(v.cod)) return null;
  const d = entered(v.deposit) ? toCents(v.deposit) : 0;
  const c = entered(v.cod) ? toCents(v.cod) : 0;
  if (d === null || c === null || d < 0 || c < 0) return null;
  return d + c;
}
/** Carrier pay from vehicle prices (null when no vehicle has a price). */
export function vehiclesCodCents(vehicles: PricedVehicle[]): number | null {
  return vehicles.some(v => priceCents(v) !== null) ? vehicles.reduce((t, v) => t + lineCents(v), 0) : null;
}
export const extrasCents = (extras: { amount: unknown }[]) => extras.reduce((t, x) => t + Math.max(toCents(x.amount) ?? 0, 0), 0);

/** Deposit + COD + extras = Total. */
export function totalCents(deposit: unknown, cod: unknown, extras: { amount: unknown }[]): number {
  return (toCents(deposit) ?? 0) + (toCents(cod) ?? 0) + extrasCents(extras);
}

/** Reverse calc when the rep types the Total: COD = Total - Deposit - extras, clamped at 0. */
export function codFromTotal(total: unknown, deposit: unknown, extras: { amount: unknown }[]): { codC: number; short: boolean } {
  const raw = (toCents(total) ?? 0) - (toCents(deposit) ?? 0) - extrasCents(extras);
  return { codC: Math.max(raw, 0), short: raw < 0 };
}

export const centsInput = (c: number) => (c / 100).toFixed(2);

/** Balance = Total - recorded payments (cents). Negative corrections in payments are included. */
export const balanceCents = (totalC: number, paidC: number) => totalC - paidC;

/**
 * Live Charges panel numbers, all from the boxes on screen (never the saved quote):
 *   total   = Deposit + COD + extras (what the Total box shows)
 *   short   = the rep TYPED a Total that is below Deposit + extras (so COD was clamped to 0).
 *             Only a typed Total can be short; once Deposit/COD/extras change, it is re-checked
 *             against the live boxes, so the warning never sticks around stale.
 *   balance = live Total - recorded payments
 */
export function chargesSummary(i: { deposit: unknown; cod: unknown; extras: { amount: unknown }[]; typedTotal: string | null; paidC: number }) {
  const totalC = totalCents(i.deposit, i.cod, i.extras);
  const floorC = (toCents(i.deposit) ?? 0) + extrasCents(i.extras);
  const typedC = i.typedTotal === null || i.typedTotal.trim() === "" ? null : toCents(i.typedTotal);
  const short = typedC !== null && typedC < floorC;
  return { totalC, short, paidC: i.paidC, balanceC: balanceCents(totalC, i.paidC) };
}

/**
 * What the vehicle rows show in the Price column (Owner, 2026-10-23): never "pending" while the
 * Charges boxes have a Total.
 *   own     - the vehicle has its own price: that price x qty
 *   total   - single-vehicle job, no vehicle price: the job Total (Deposit + COD + extras)
 *   inTotal - multi-vehicle job, this vehicle has no price: no fake split; the job Total line shows it
 *   pending - Deposit, COD and extras are all empty/0 and no vehicle price
 */
export type VehiclePriceCell = { kind: "own" | "total"; cents: number } | { kind: "inTotal" | "pending" };
export function vehiclePriceCell(v: PricedVehicle, vehicleCount: number, jobTotalC: number): VehiclePriceCell {
  const split = splitTotalCents(v);
  // One vehicle keeps today's cell: its own carrier price, otherwise the job Total
  // (so a single Mercedes with deposit 295 + COD 1000 still shows $1,295.00).
  if (vehicleCount <= 1) {
    if (priceCents(v) !== null) return { kind: "own", cents: lineCents(v) };
    if (jobTotalC > 0) return { kind: "total", cents: jobTotalC };
    if (split !== null && split > 0) return { kind: "own", cents: split };
    return { kind: "pending" };
  }
  if (split !== null) return { kind: "own", cents: split };
  if (priceCents(v) !== null) return { kind: "own", cents: lineCents(v) };
  if (jobTotalC <= 0) return { kind: "pending" };
  return { kind: "inTotal" };
}
/** Multi-vehicle jobs with an unpriced vehicle show one "Job Total" line under the list. */
export function showJobTotalLine(vehicles: PricedVehicle[], jobTotalC: number): boolean {
  return vehicles.length > 1 && jobTotalC > 0 && vehicles.some(v => priceCents(v) === null && splitTotalCents(v) === null);
}

/** E-Quote / E-Sign send warning: how many vehicles have no price AND nothing else prices the job
 *  (job Total 0). 0 = no warning. */
export function unpricedWarningCount(vehicles: PricedVehicle[], jobTotalC: number): number {
  return jobTotalC > 0 ? 0 : vehicles.filter(v => priceCents(v) === null && splitTotalCents(v) === null).length;
}
