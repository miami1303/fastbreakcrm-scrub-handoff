// Per-vehicle Additional charges, Discount and Customer payment (Owner, 2026-10-31).
// Pure helpers (integer cents), safe for client and server.
//
// Each vehicle has, on top of its Deposit and Carrier COD:
//   - up to 3 Additional charge lines {description, amount, collect}
//       collect "payment" (default): Fast Break takes it with the payment method
//                                    (card / Zelle / Cash App ...). Carrier COD is NOT changed.
//       collect "cod":               the carrier collects it at pickup/delivery, so it is added to
//                                    the COD the carrier collects (Carrier COD to collect).
//   - an optional Discount. It comes off the Total and off what Fast Break collects
//     (deposit + charges taken by payment). The Carrier COD stays the same.
//
// Per vehicle (cents):
//   extras        = extrasPay + extrasCod
//   total         = deposit + cod + extras - discount
//   carrierCod    = cod + extrasCod                  (what the carrier collects)
//   company       = deposit + extrasPay - discount   (what Fast Break collects)
//   company + carrierCod === total (always)
//   A discount larger than deposit + extrasPay is refused (it would have to come out of the
//   carrier's COD, and the COD stays the same).
// Job (bottom of Charges): every number is the sum over the vehicles. Legacy job-level extra
// lines (quotes.extra_charges, before per-vehicle charges) still count once, as "payment".
import { toCents } from "./money.ts";

export type ChargeCollect = "payment" | "cod";
/** `all` = typed with a blank vehicle# in the shared box: a job-wide charge, stored once on vehicle 1. */
export type VehicleChargeLine = { description: string; amount: string; collect: ChargeCollect; all?: boolean };
export type SavedChargeLine = { description: string; amount: number; collect: ChargeCollect; all?: true };
export const MAX_VEHICLE_CHARGES = 3;

const pos = (v: unknown) => Math.max(toCents(v) ?? 0, 0);
export const collectOf = (v: unknown): ChargeCollect => (v === "cod" ? "cod" : "payment");

/** Exactly 3 editable lines for the form (blank lines pad the end). */
export function chargeLinesForForm(value: unknown): VehicleChargeLine[] {
  const saved = savedChargeLines(value);
  return Array.from({ length: MAX_VEHICLE_CHARGES }, (_, i) => {
    const x = saved[i];
    return x ? { description: x.description, amount: String(x.amount), collect: x.collect, ...(x.all ? { all: true } : {}) } : { description: "", amount: "", collect: "payment" as ChargeCollect };
  });
}

/** Saved lines from the DB (vehicles.extra_charges): positive amounts only, max 3. */
export function savedChargeLines(value: unknown): SavedChargeLine[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_VEHICLE_CHARGES).flatMap(x => {
    const row = (x ?? {}) as { description?: unknown; amount?: unknown; collect?: unknown; all?: unknown };
    const c = toCents(row.amount);
    if (c === null || c <= 0) return [];
    return [{ description: String(row.description ?? "").trim().slice(0, 80), amount: c / 100, collect: collectOf(row.collect), ...(row.all === true ? { all: true as const } : {}) }];
  });
}

/** A line is "shown" (in summaries, totals, the customer quote) only once it has an amount > 0. */
export const lineHasAmount = (l: { amount: unknown }) => pos(l.amount) > 0;

/** Validate the form lines before saving. Returns the clean lines or the first error. */
export function cleanChargeLines(lines: { description?: unknown; amount?: unknown; collect?: unknown; all?: unknown }[] | undefined, name: string): { ok: true; lines: SavedChargeLine[] } | { ok: false; error: string } {
  const out: SavedChargeLine[] = [];
  for (const [i, line] of (lines || []).slice(0, MAX_VEHICLE_CHARGES).entries()) {
    const d = String(line?.description ?? "").trim();
    const a = String(line?.amount ?? "").trim();
    if (!d && !a) continue;
    const c = toCents(a);
    if (!a || c === null || c < 0) return { ok: false, error: `${name}: Additional charge ${i + 1} must be a dollar amount (e.g. 75 or 75.00).` };
    if (c === 0) continue; // 0 / blank amount = not charged, line not shown
    out.push({ description: (d || `Additional charge ${i + 1}`).slice(0, 80), amount: c / 100, collect: collectOf(line?.collect), ...(line?.all === true ? { all: true as const } : {}) });
  }
  return { ok: true, lines: out };
}

export type VehicleMoneyInput = { deposit?: unknown; cod?: unknown; charges?: { amount: unknown; collect?: unknown }[]; discount?: unknown };
export type VehicleMoney = {
  depositC: number; codC: number;
  extrasPayC: number; extrasCodC: number; extrasC: number;
  discountC: number;
  /** deposit + cod + extras - discount */
  totalC: number;
  /** cod + extras the carrier collects */
  carrierCodC: number;
  /** deposit + extras taken by payment - discount */
  companyC: number;
  /** Discount is more than deposit + charges taken by payment. */
  discountTooBig: boolean;
};

export function vehicleMoney(v: VehicleMoneyInput): VehicleMoney {
  const depositC = pos(v.deposit);
  const codC = pos(v.cod);
  let extrasPayC = 0, extrasCodC = 0;
  for (const l of v.charges || []) {
    const c = pos(l.amount);
    if (collectOf(l.collect) === "cod") extrasCodC += c; else extrasPayC += c;
  }
  const discountC = pos(v.discount);
  const extrasC = extrasPayC + extrasCodC;
  return {
    depositC, codC, extrasPayC, extrasCodC, extrasC, discountC,
    totalC: depositC + codC + extrasC - discountC,
    carrierCodC: codC + extrasCodC,
    companyC: depositC + extrasPayC - discountC,
    discountTooBig: discountC > depositC + extrasPayC,
  };
}

export type JobMoney = Omit<VehicleMoney, "discountTooBig"> & { vehicles: VehicleMoney[]; legacyExtrasC: number };

/** Sum over the vehicles (+ legacy job-level extra lines, taken by payment). */
export function jobMoney(vehicles: VehicleMoneyInput[], legacyJobExtras: { amount: unknown }[] = []): JobMoney {
  const rows = vehicles.map(vehicleMoney);
  const sum = (k: keyof Omit<VehicleMoney, "discountTooBig">) => rows.reduce((t, r) => t + r[k], 0);
  const legacyExtrasC = legacyJobExtras.reduce((t, x) => t + pos(x.amount), 0);
  return {
    vehicles: rows, legacyExtrasC,
    depositC: sum("depositC"), codC: sum("codC"),
    extrasPayC: sum("extrasPayC") + legacyExtrasC, extrasCodC: sum("extrasCodC"), extrasC: sum("extrasC") + legacyExtrasC,
    discountC: sum("discountC"),
    totalC: sum("totalC") + legacyExtrasC,
    carrierCodC: sum("carrierCodC"),
    companyC: sum("companyC") + legacyExtrasC,
  };
}

/** Single-vehicle "type the Total": COD = Total - Deposit - extras + Discount (never below 0). */
export function codFromTotalWithCharges(total: unknown, v: VehicleMoneyInput): { codC: number; short: boolean } {
  const m = vehicleMoney({ ...v, cod: 0 });
  const raw = (toCents(total) ?? 0) - m.depositC - m.extrasC + m.discountC;
  return { codC: Math.max(raw, 0), short: raw < 0 };
}

export type AllocatedPayment = { amount: unknown; vehicle_index?: number | null; voided_at?: string | null; counts?: boolean };

/**
 * Customer payments per vehicle. A payment saved "for vehicle N" (payments.vehicle_index) counts
 * on that vehicle; payments with no vehicle (or a vehicle that no longer exists) are "job" payments.
 * One-vehicle jobs: everything is on vehicle 1. Sum of all buckets === total paid.
 */
export function paymentsByVehicle(payments: AllocatedPayment[], vehicleCount: number): { byVehicleC: number[]; jobC: number; totalC: number } {
  const byVehicleC = Array.from({ length: Math.max(vehicleCount, 0) }, () => 0);
  let jobC = 0;
  for (const p of payments) {
    if (p.voided_at || p.counts === false) continue;
    const c = toCents(p.amount) ?? 0;
    const i = p.vehicle_index;
    if (vehicleCount === 1) byVehicleC[0] += c;
    else if (typeof i === "number" && i >= 0 && i < vehicleCount) byVehicleC[i] += c;
    else jobC += c;
  }
  const totalC = byVehicleC.reduce((t, n) => t + n, 0) + jobC;
  return { byVehicleC, jobC, totalC };
}

/** Customer side: show Customer Payment / Balance only when the payments add up to something (≠ $0). */
export const customerSeesPayment = (paidC: number) => paidC !== 0;

export type CustomerVehicleBlock = {
  /** Total Price cell for the vehicle row (net of any discount; never shows the discount). */
  priceText: string;
  /** Additional charge lines with an amount (after any leftover discount). */
  extras: { description: string; cents: number }[];
  /** This vehicle's Customer Payment (only multi-vehicle jobs with a payment for this vehicle). */
  paidC: number | null;
};

/**
 * Customer quote / booked order / CC form, per vehicle (Owner 2026-10-31):
 *   - the vehicle row shows its price net of the discount; the discount is NEVER a line;
 *   - its Additional charges print under it, only those with an amount;
 *   - multi-vehicle: that vehicle's Customer Payment prints under it when one was saved for it.
 * A discount bigger than the row price comes off the vehicle's charge lines (so what the
 * customer sees always adds up to the Total).
 * `basePriceC(i)` = the row price before discount/charges (Deposit + Carrier COD, or the
 * legacy cell); null = blank cell.
 */
export function customerVehicleBlocks(
  vehicles: { extra_charges?: unknown; discount_amount?: unknown }[],
  basePriceC: (index: number) => number | null,
  paid: { rows: AllocatedPayment[]; show: boolean },
): CustomerVehicleBlock[] {
  const byVehicle = paid.show && vehicles.length > 1 ? paymentsByVehicle(paid.rows, vehicles.length) : null;
  return vehicles.map((v, i) => {
    const lines = savedChargeLines(v.extra_charges).map(l => ({ description: l.description, cents: Math.round(l.amount * 100), collect: l.collect }));
    let discount = pos(v.discount_amount);
    const base = basePriceC(i);
    let price = base;
    if (price !== null && discount > 0) { const off = Math.min(price, discount); price -= off; discount -= off; }
    // Leftover discount: off the charges taken by payment first, then the rest.
    for (const pass of ["payment", "cod"] as const) {
      for (const l of lines) {
        if (discount <= 0 || l.collect !== pass) continue;
        const off = Math.min(l.cents, discount); l.cents -= off; discount -= off;
      }
    }
    const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
    const vPaid = byVehicle ? byVehicle.byVehicleC[i] : 0;
    return {
      priceText: price === null ? "" : fmt(price),
      extras: lines.filter(l => l.cents > 0).map(({ description, cents }) => ({ description, cents })),
      paidC: byVehicle && vPaid !== 0 ? vPaid : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// ONE shared "Additional charges & discount" box for the whole lead (Owner 2026-10-31).
// Each row has an optional vehicle# (1, 2, … = the numbered vehicles in the table).
//   vehicle# set   -> the line / discount belongs to that vehicle.
//   vehicle# blank -> "all vehicles": applied ONCE (never multiplied by the vehicle count) and
//                     stored on vehicle 1. Charge lines keep an `all` flag so they read back blank.
//                     A discount on vehicle 1 reads back blank too (same money either way).
// Storage is unchanged: vehicles.extra_charges (jsonb, max 3 per vehicle) + vehicles.discount_amount.
export type SharedChargeRow = VehicleChargeLine & { veh: string };
export type SharedDiscountRow = { veh: string; amount: string };
export const SHARED_ROWS = 3;

const lineHasContent = (l: { description?: unknown; amount?: unknown }) => !!String(l.description ?? "").trim() || !!String(l.amount ?? "").trim();

/** Parse a vehicle# box: 1..count -> index; blank -> null (all); anything else -> "bad". */
export function parseVehicleNo(veh: string, count: number): number | null | "bad" {
  const t = String(veh ?? "").trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return "bad";
  const n = parseInt(t, 10);
  return n >= 1 && n <= count ? n - 1 : "bad";
}

/** Rows for the shared box from the per-vehicle data (at least 3 charge rows, at least 1 discount row). */
export function sharedRowsFromVehicles(vehicles: { charges?: VehicleChargeLine[]; discount?: string }[]): { charges: SharedChargeRow[]; discounts: SharedDiscountRow[] } {
  const multi = vehicles.length > 1;
  const charges: SharedChargeRow[] = [];
  vehicles.forEach((v, k) => {
    for (const l of v.charges || []) {
      if (!lineHasContent(l)) continue;
      charges.push({ description: l.description, amount: l.amount, collect: collectOf(l.collect), veh: !multi || l.all ? "" : String(k + 1) });
    }
  });
  while (charges.length < SHARED_ROWS) charges.push({ description: "", amount: "", collect: "payment", veh: "" });
  const discounts: SharedDiscountRow[] = [];
  vehicles.forEach((v, k) => {
    if (pos(v.discount) > 0) discounts.push({ veh: !multi || k === 0 ? "" : String(k + 1), amount: String(v.discount ?? "") });
  });
  if (discounts.length === 0) discounts.push({ veh: "", amount: "" });
  return { charges, discounts };
}

/**
 * Shared box rows -> per-vehicle charges + discount. Blank (or invalid) vehicle# goes to vehicle 1
 * once (charge lines flagged `all` when 2+ vehicles). Discounts landing on the same vehicle add up.
 * `bad` lists the rows whose vehicle# is not one of the listed vehicles (shown as a warning).
 */
export function distributeSharedRows(rows: { charges: SharedChargeRow[]; discounts: SharedDiscountRow[] }, count: number): { vehicles: { charges: VehicleChargeLine[]; discount: string }[]; bad: string[] } {
  const out = Array.from({ length: count }, () => ({ charges: [] as VehicleChargeLine[], discountC: 0, discountText: "" }));
  const bad: string[] = [];
  if (count === 0) return { vehicles: [], bad };
  rows.charges.forEach((r, i) => {
    if (!lineHasContent(r)) return;
    const p = parseVehicleNo(r.veh, count);
    if (p === "bad") bad.push(`Additional charge ${i + 1}`);
    const k = typeof p === "number" ? p : 0;
    const { veh: _veh, all: _all, ...line } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
    out[k].charges.push({ ...line, collect: collectOf(line.collect), ...(p === null && count > 1 ? { all: true } : {}) });
  });
  rows.discounts.forEach((r, i) => {
    if (!String(r.amount ?? "").trim()) return;
    const p = parseVehicleNo(r.veh, count);
    if (p === "bad") bad.push(`Discount${rows.discounts.length > 1 ? ` ${i + 1}` : ""}`);
    const k = typeof p === "number" ? p : 0;
    const o = out[k];
    // One discount on a vehicle keeps the typed text; two add up (in cents).
    if (!o.discountText) o.discountText = String(r.amount);
    else o.discountText = ((o.discountC + pos(r.amount)) / 100).toFixed(2);
    o.discountC += pos(r.amount);
  });
  return { vehicles: out.map(o => ({ charges: o.charges, discount: o.discountText })), bad };
}
