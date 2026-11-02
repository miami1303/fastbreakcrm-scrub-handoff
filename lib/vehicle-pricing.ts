// Per-vehicle Deposit, Carrier COD, and Total (Owner, 2026-10-26). Integer cents.
//
// vehicles.price is the LEGACY per-unit carrier pay. It is not reused as the vehicle
// total, because existing rows already store carrier pay there. New columns are
// deposit_amount, cod_amount, and total_amount (deposit + carrier COD). Extra charges
// stay on the job and are not inside a vehicle total.
//
// Legacy jobs (no vehicle has deposit or carrier COD yet):
//   - Each vehicle's carrier COD starts as price × qty (0 when price is blank).
//   - The job deposit is shown on the FIRST vehicle. Other vehicles stay at 0.
//   - When no vehicle has a price, the job carrier COD is shown on the first vehicle
//     too, so a one-vehicle job looks like today and nothing is dropped.
//   - When vehicles have legacy prices and the saved job COD is a different number
//     that cannot be rebuilt by parking the difference on vehicle 1 without going
//     negative, the saved job deposit/COD stay in charge (mode "legacy-mismatch").
//     Opening the lead does not rewrite them. The next save keeps those job numbers
//     until someone edits a vehicle price; that edit makes the vehicle sums the
//     job deposit, COD, and total.
//
// Customer quote: each vehicle shows its TOTAL price (not the deposit/COD split).
// One vehicle keeps today's cell (the job total, extras included). Job-level Deposit
// and Carrier COD are not printed on the quote; the booked order already shows
// Total / Customer Payment / Customer Balance once a payment exists.
import { extrasCents, lineCents, priceCents, type PricedVehicle } from "./pricing.ts";
import { formatCents, toCents } from "./money.ts";

export type SplitVehicle = PricedVehicle & {
  year?: unknown;
  make?: unknown;
  model?: unknown;
  /** Form box or already-normalized dollars. */
  deposit?: unknown;
  cod?: unknown;
  /** DB column, used when `deposit` is blank. */
  deposit_amount?: unknown;
  /** DB column, used when `cod` is blank. */
  cod_amount?: unknown;
};

export type MoneyMode = "split" | "fallback" | "legacy-mismatch";

export type ResolvedVehicle = { depositC: number; codC: number; totalC: number };

export type ResolvedJob = {
  vehicles: ResolvedVehicle[];
  depositC: number;
  codC: number;
  extrasC: number;
  /** Deposit + carrier COD + extra charges. */
  totalC: number;
  mode: MoneyMode;
};

export const moneyFieldSet = (value: unknown) => String(value ?? "").trim() !== "";

/** Dollars the rep typed, or the stored column when the box is blank. */
export function normalizeVehicleMoney<T extends SplitVehicle>(v: T): T & { deposit: unknown; cod: unknown } {
  return {
    ...v,
    deposit: moneyFieldSet(v.deposit) ? v.deposit : v.deposit_amount ?? "",
    cod: moneyFieldSet(v.cod) ? v.cod : v.cod_amount ?? "",
  };
}

export function vehicleHasSplit(v: SplitVehicle): boolean {
  const n = normalizeVehicleMoney(v);
  return moneyFieldSet(n.deposit) || moneyFieldSet(n.cod);
}

const nonNeg = (value: unknown): number => {
  const c = toCents(value);
  return c === null || c < 0 ? 0 : c;
};

const rowOf = (depositC: number, codC: number): ResolvedVehicle => ({ depositC, codC, totalC: depositC + codC });

function finish(vehicles: ResolvedVehicle[], extrasC: number, mode: MoneyMode): ResolvedJob {
  const depositC = vehicles.reduce((t, v) => t + v.depositC, 0);
  const codC = vehicles.reduce((t, v) => t + v.codC, 0);
  return { vehicles, depositC, codC, extrasC, totalC: depositC + codC + extrasC, mode };
}

/**
 * Per-vehicle amounts plus the job sums. See the file comment for the legacy choice.
 * Extras are included in `totalC` only.
 */
export function resolveVehicleMoney(vehicles: SplitVehicle[], jobDeposit: unknown, jobCod: unknown, extras: { amount: unknown }[] = []): ResolvedJob {
  const extrasC = extrasCents(extras);
  const list = vehicles.map(normalizeVehicleMoney);
  const jobDep = nonNeg(jobDeposit);
  const jobCodSet = moneyFieldSet(jobCod);
  const jobCodC = nonNeg(jobCod);

  if (list.some(vehicleHasSplit)) {
    const rows = list.map(v => {
      const depositC = moneyFieldSet(v.deposit) ? nonNeg(v.deposit) : 0;
      const codC = moneyFieldSet(v.cod) ? nonNeg(v.cod) : priceCents(v) !== null ? lineCents(v) : 0;
      return rowOf(depositC, codC);
    });
    return finish(rows, extrasC, "split");
  }

  const legacy = list.map(v => (priceCents(v) !== null ? lineCents(v) : 0));
  const legacySum = legacy.reduce((t, n) => t + n, 0);
  if (list.length === 0) {
    return { vehicles: [], depositC: jobDep, codC: jobCodC, extrasC, totalC: jobDep + jobCodC + extrasC, mode: "fallback" };
  }
  if (legacySum === 0) {
    const rows = list.map((_, i) => (i === 0 ? rowOf(jobDep, jobCodC) : rowOf(0, 0)));
    return finish(rows, extrasC, "fallback");
  }
  const rows = list.map((v, i) => rowOf(i === 0 ? jobDep : 0, legacy[i]));
  if (!jobCodSet || jobCodC === legacySum) return finish(rows, extrasC, "fallback");
  return { vehicles: rows, depositC: jobDep, codC: jobCodC, extrasC, totalC: jobDep + jobCodC + extrasC, mode: "legacy-mismatch" };
}

/** Sum of the boxes on screen. Blank counts as 0. `invalid` when a filled box is not a non-negative dollar amount. */
export function sumEnteredVehicles(vehicles: { deposit?: unknown; cod?: unknown }[]): { depositC: number; codC: number; totalC: number; invalid: boolean } {
  let depositC = 0, codC = 0, invalid = false;
  for (const v of vehicles) {
    if (moneyFieldSet(v.deposit)) {
      const c = toCents(v.deposit);
      if (c === null || c < 0) invalid = true;
      else depositC += c;
    }
    if (moneyFieldSet(v.cod)) {
      const c = toCents(v.cod);
      if (c === null || c < 0) invalid = true;
      else codC += c;
    }
  }
  return { depositC, codC, totalC: depositC + codC, invalid };
}

export function sameVehicleMoney(a: { depositC: number; codC: number }[], b: { depositC: number; codC: number }[]): boolean {
  return a.length === b.length && a.every((v, i) => v.depositC === b[i].depositC && v.codC === b[i].codC);
}

/** Box text. `blankZero` leaves a zero as "" so an unpriced vehicle does not look filled in. */
export function centsToInput(cents: number, blankZero = false): string {
  if (blankZero && cents === 0) return "";
  return String(cents / 100);
}

/** Fill deposit/cod boxes from the legacy fallback. Explicit splits are left as stored. */
export function hydrateVehicleBoxes<T extends SplitVehicle>(vehicles: T[], jobDeposit: unknown, jobCod: unknown): { vehicles: T[]; mode: MoneyMode } {
  const resolved = resolveVehicleMoney(vehicles, jobDeposit, jobCod, []);
  if (resolved.mode === "split") return { vehicles, mode: resolved.mode };
  return {
    mode: resolved.mode,
    vehicles: vehicles.map((v, i) => {
      const row = resolved.vehicles[i];
      return { ...v, deposit: centsToInput(row?.depositC ?? 0, true), cod: centsToInput(row?.codC ?? 0, true) };
    }),
  };
}

/** Per-vehicle Total typed by the rep: carrier COD = Total − Deposit, never below 0. Extras are not in a vehicle total. */
export function codFromVehicleTotal(total: unknown, deposit: unknown): { codC: number; short: boolean } {
  const raw = (toCents(total) ?? 0) - nonNeg(deposit);
  return { codC: Math.max(raw, 0), short: raw < 0 };
}

export function vehicleDisplayName(v: { year?: unknown; make?: unknown; model?: unknown }, index = 0): string {
  const name = [v.year, v.make, v.model].map(x => String(x ?? "").trim()).filter(Boolean).join(" ");
  return name || `Vehicle ${index + 1}`;
}

/** First problem with a vehicle's deposit/COD boxes, or null. */
export function vehicleMoneyError(v: { deposit?: unknown; cod?: unknown }, name = "Vehicle"): string | null {
  for (const [label, raw] of [["Deposit", v.deposit], ["Carrier COD", v.cod]] as const) {
    if (!moneyFieldSet(raw)) continue;
    const c = toCents(raw);
    if (c === null) return `${name}: ${label} must be a dollar amount (e.g. 200 or 200.00).`;
    if (c < 0) return `${name}: ${label} can't be negative.`;
  }
  return null;
}

export type NamedMoney = { year?: unknown; make?: unknown; model?: unknown; depositC: number; codC: number };

const fmtMoney = (cents: number | null) => (cents === null ? "—" : (cents / 100).toFixed(2));

/** Charges history lines. Unchanged vehicles are skipped. Amounts are dollars with cents. */
export function describeVehiclePriceChanges(before: NamedMoney[], after: NamedMoney[]): string[] {
  const lines: string[] = [];
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const b = before[i];
    const a = after[i];
    const name = vehicleDisplayName(a || b, i);
    if (b && a) {
      if (b.depositC === a.depositC && b.codC === a.codC) continue;
      lines.push(`${name}: Deposit ${fmtMoney(b.depositC)} → ${fmtMoney(a.depositC)} · Carrier COD ${fmtMoney(b.codC)} → ${fmtMoney(a.codC)} · Total ${fmtMoney(b.depositC + b.codC)} → ${fmtMoney(a.depositC + a.codC)}`);
    } else if (a) {
      lines.push(`${name}: added · Deposit ${fmtMoney(a.depositC)} · Carrier COD ${fmtMoney(a.codC)} · Total ${fmtMoney(a.depositC + a.codC)}`);
    } else if (b) {
      lines.push(`${name}: removed · Deposit ${fmtMoney(b.depositC)} · Carrier COD ${fmtMoney(b.codC)} · Total ${fmtMoney(b.depositC + b.codC)}`);
    }
  }
  return lines;
}

/**
 * Customer documents show a payments section only on a booked order (or the CC form)
 * after a payment has been recorded. A regular quote never does, even if a payment exists.
 */
export function customerShowsPayments(kind: string, hasPayment: boolean): boolean {
  // Owner 2026-10-31: once a payment is entered (any method, or none) the customer side shows
  // Customer Payment / Balance, even before booking (E-Quote too). No payment: Total only.
  void kind;
  return !!hasPayment;
}

/**
 * Total Price cell on the customer quote / e-sign / printed estimate.
 * One vehicle: the job total (extras included), same as before.
 * Several vehicles: that vehicle's total (deposit + carrier COD). Blank when it has none.
 * An explicit $0 is shown; a fallback zero on vehicle 2+ stays blank.
 */
export function customerVehiclePriceText(vehicles: SplitVehicle[], index: number, quote: { total_amount?: unknown; deposit_amount?: unknown; cod_amount?: unknown } | null): string {
  if (vehicles.length <= 1) {
    const c = toCents(quote?.total_amount);
    return c === null ? "" : formatCents(c);
  }
  const list = vehicles.map(normalizeVehicleMoney);
  const resolved = resolveVehicleMoney(list, quote?.deposit_amount, quote?.cod_amount, []);
  const row = resolved.vehicles[index];
  const v = list[index];
  if (!row || !v) return "";
  // Saved job COD does not match the old carrier prices. Show each vehicle's own
  // carrier line (price × qty). Do not also print the job deposit on vehicle 1.
  if (resolved.mode === "legacy-mismatch") {
    const line = priceCents(v) === null ? 0 : lineCents(v);
    return line > 0 ? formatCents(line) : "";
  }
  if (row.totalC > 0) return formatCents(row.totalC);
  if (resolved.mode === "split" && vehicleHasSplit(v)) return formatCents(0);
  return "";
}
