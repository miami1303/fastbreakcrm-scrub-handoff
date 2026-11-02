"use client";

// ONE "Additional charges & discount" box for the whole lead (Owner 2026-10-31): no per-vehicle
// cards, no vehicle tabs. Always 3 charge lines; the Discount row shows only with an amount (+ Add discount), plain inputs (no +/− buttons).
//   vehicle# | description | amount | By payment / Carrier COD
//   vehicle# | Discount | amount
// vehicle# = the number in front of the vehicle in the table (1., 2., …). Blank = all vehicles:
// applied once (never multiplied) and stored on vehicle 1 (lib/vehicle-charges.ts distributeSharedRows).
// Math per vehicle is unchanged from PR #28 (vehicleMoney):
//   Total = Deposit + Carrier COD + Additional charges − Discount. "Carrier COD" lines raise the COD
//   the carrier collects; the discount comes off what Fast Break collects (COD stays the same).
// The discount is never shown to the customer as a line. Carrier Owes (what the carrier owes us at
// delivery) lives in CarrierOwesBox and never touches these numbers.
import { useEffect, useRef, useState } from "react";
import HistoryInput from "@/app/components/HistoryInput";
import { formatCents } from "@/lib/money";
import {
  distributeSharedRows, sharedRowsFromVehicles, vehicleMoney,
  type ChargeCollect, type SharedChargeRow, type SharedDiscountRow, type VehicleChargeLine,
} from "@/lib/vehicle-charges";

export type ExtrasVehicle = {
  /** Index into form.vehicles. */
  vi: number;
  name: string;
  deposit: unknown;
  cod: unknown;
  charges: VehicleChargeLine[] | undefined;
  discount: string | undefined;
  paidC: number;
};

type Rows = { charges: SharedChargeRow[]; discounts: SharedDiscountRow[] };
const sig = (vs: { charges?: VehicleChargeLine[]; discount?: string }[]) =>
  JSON.stringify(vs.map(v => [(v.charges || []).filter(l => l.description.trim() || String(l.amount).trim()).map(l => [l.description, String(l.amount), l.collect, !!l.all]), String(v.discount ?? "")]));

export default function VehicleExtrasBox({ vehicles, showPaid, onChange }: {
  vehicles: ExtrasVehicle[];
  showPaid: boolean;
  /** One call per edit with every listed vehicle's new charges + discount. */
  onChange: (next: { vi: number; charges: VehicleChargeLine[]; discount: string }[]) => void;
}) {
  const count = vehicles.length;
  const multi = count > 1;
  const [rows, setRows] = useState<Rows>(() => sharedRowsFromVehicles(vehicles));
  // Discount row only shows once it has an amount (Owner 2026-10-31): no empty Discount box on
  // regular quotes. "+ Add discount" reveals it; leaving it empty (blur) hides it again.
  const [discOpen, setDiscOpen] = useState(false);
  // Keep typed rows (incl. a vehicle# typed before the amount) while editing; re-read only when the
  // vehicles change from outside (reload / Submit Charges / a vehicle added or removed).
  const mine = useRef(sig(distributeSharedRows(rows, count).vehicles));
  const theirs = sig(vehicles);
  useEffect(() => {
    if (theirs !== mine.current) { const r = sharedRowsFromVehicles(vehicles); setRows(r); mine.current = sig(distributeSharedRows(r, count).vehicles); }
  }, [theirs]); // eslint-disable-line react-hooks/exhaustive-deps
  if (count === 0) return null;

  const dist = distributeSharedRows(rows, count);
  const push = (next: Rows) => {
    setRows(next);
    const d = distributeSharedRows(next, count);
    mine.current = sig(d.vehicles);
    onChange(vehicles.map((v, k) => ({ vi: v.vi, ...d.vehicles[k] })));
  };
  const setLine = (i: number, patch: Partial<SharedChargeRow>) => push({ ...rows, charges: rows.charges.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const setDisc = (i: number, patch: Partial<SharedDiscountRow>) => push({ ...rows, discounts: rows.discounts.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const vehBox = (value: string, label: string, testId: string, set: (v: string) => void) => multi
    ? <input className="vno" value={value} inputMode="numeric" maxLength={2} placeholder="all" aria-label={label} title="Vehicle # from the table (1, 2, …). Blank = all vehicles."
        onChange={e => set(e.target.value.replace(/\D/g, ""))} data-testid={testId} />
    : <span />;
  const money = vehicles.map((x, k) => vehicleMoney({ deposit: x.deposit, cod: x.cod, charges: dist.vehicles[k]?.charges, discount: dist.vehicles[k]?.discount }));
  const tooBig = money.map((m, k) => (m.discountTooBig ? k : -1)).filter(k => k >= 0);

  return (
    <div className={`vxb${multi ? " multi" : ""}`} data-testid="vehicle-extras-box">
      <div className="vxb-head">
        <span className="ch-label">Additional charges</span>
        {multi && <small className="muted">Vehicle # blank = all vehicles</small>}
      </div>
      <div className="vxb-lines" data-testid="veh-charges">
        {rows.charges.map((l, i) => (
          <div className="vxb-line" key={i} data-testid={`charge-${i + 1}`}>
            {vehBox(l.veh, `Additional charge ${i + 1} vehicle number`, `charge-veh-${i + 1}`, v => setLine(i, { veh: v }))}
            <HistoryInput kind="charge-label" value={l.description} maxLength={80} aria-label={`Additional charge ${i + 1} description`}
              onValue={v => setLine(i, { description: v })} data-testid={`charge-desc-${i + 1}`} />
            <input className="amt" value={l.amount} inputMode="decimal" placeholder="0.00" aria-label={`Additional charge ${i + 1} amount`} onChange={e => setLine(i, { amount: e.target.value })} data-testid={`charge-amt-${i + 1}`} />
            <select value={l.collect} aria-label={`Additional charge ${i + 1} collected by`} onChange={e => setLine(i, { collect: e.target.value as ChargeCollect })} data-testid={`charge-collect-${i + 1}`}
              title="By payment: we take it with the payment method (COD unchanged). Carrier COD: the carrier collects it (COD goes up).">
              <option value="payment">By payment</option>
              <option value="cod">Carrier COD</option>
            </select>
          </div>
        ))}
        {!discOpen && !rows.discounts.some(d => d.amount.trim()) && (
          <button type="button" className="vxb-add-disc link-btn" onClick={() => setDiscOpen(true)} data-testid="add-discount">+ Add discount</button>
        )}
        {rows.discounts.map((d, i) => (discOpen || d.amount.trim()) && (
          <div className="vxb-line disc" key={`d${i}`} data-testid={`discount-row-${i + 1}`}>
            {vehBox(d.veh, `Discount ${i + 1} vehicle number`, `discount-veh-${i + 1}`, v => setDisc(i, { veh: v }))}
            <input value="Discount" readOnly tabIndex={-1} aria-label={`Discount ${i + 1} description`} className="vxb-disc-label" />
            <input className="amt" value={d.amount} autoFocus={discOpen && i === 0 && !d.amount}
              onBlur={() => { if (!rows.discounts.some(x => x.amount.trim() && Number(x.amount) !== 0)) { setDiscOpen(false); if (d.amount.trim()) setDisc(i, { amount: "" }); } }} inputMode="decimal" placeholder="0.00" aria-label={`Discount ${i + 1} amount`} onChange={e => setDisc(i, { amount: e.target.value })} data-testid={i === 0 ? "discount" : `discount-${i + 1}`} />
            <span />
          </div>
        ))}
        {dist.bad.length > 0 && <span className="soft-warn" data-testid="vxb-bad-vehicle">{dist.bad.join(", ")}: vehicle # must be 1–{count} (or blank for all). Counted on vehicle 1 for now.</span>}
        {tooBig.map(k => (
          <span key={k} className="soft-warn" data-testid={`veh-${k + 1}-discount-warning`}>{multi ? `${vehicles[k].name}: t` : "T"}he discount is more than the Deposit + charges taken by payment ({formatCents(money[k].depositC + money[k].extrasPayC)}). The COD stays the same, so this can&apos;t be saved.</span>
        ))}
      </div>
      <div className="vxb-sum" data-testid="vxb-summary">
        {vehicles.map((x, i) => {
          const xm = money[i];
          const id = i + 1;
          const shared = multi && i === 0 && (dist.vehicles[0]?.charges.some(l => l.all) || (rows.discounts.some(d => !d.veh.trim() && d.amount.trim())));
          return (
            <div className="vxb-row" key={x.vi} data-testid={`veh-${id}-summary`}>
              {multi && <span className="vxb-name">{x.name}{shared && <small className="muted"> (+ all-vehicle lines)</small>}</span>}
              <span>Total <b data-testid={`veh-${id}-total`}>{formatCents(xm.totalC)}</b></span>
              {xm.discountC > 0 && <span className="vxb-disc" data-testid={`veh-${id}-discount-card`}>Discount <b>−{formatCents(xm.discountC)}</b></span>}
              <span>COD <b data-testid={`veh-${id}-carrier-cod`}>{formatCents(xm.carrierCodC)}</b></span>
              <span>FB collects <b data-testid={`veh-${id}-company`}>{formatCents(xm.companyC)}</b></span>
              {showPaid && <>
                <span>Paid <b data-testid={`veh-${id}-paid`}>{formatCents(x.paidC)}</b></span>
                <span>Balance <b data-testid={`veh-${id}-balance`}>{formatCents(xm.totalC - x.paidC)}</b></span>
              </>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
