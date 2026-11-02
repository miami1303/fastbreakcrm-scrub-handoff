"use client";

// Per-vehicle Deposit / Carrier COD / Total. Shown on Charges only once a second vehicle exists.
// Total = Deposit + Carrier COD + Additional charges - Discount. Each vehicle is numbered (1., 2., …;
// the vehicle# used in the Additional charges & discount box). Under each vehicle row a compact
// chip line puts each toggle under its own column, like VehicleList: FLEX / ASAP / EXPEDITED under
// Year / Make / Model (+ Type), INOP under Run, ENC / OPEN under Enclosed (Owner 2026-10-31).
import { useState } from "react";
import Link from "next/link";
import { hasVehicleData } from "@/app/components/EntryForm";
import type { VehicleValue } from "@/app/components/VehiclesEditor";
import Toggle from "@/app/components/Toggle";
import { qtyOf } from "@/lib/pricing";
import { centsToInput } from "@/lib/vehicle-pricing";
import { codFromTotalWithCharges, vehicleMoney } from "@/lib/vehicle-charges";

export default function VehiclePrices({ leadId, vehicles, flexOn, asapOn, expeditedOn = false, onChange }: {
  leadId: string;
  vehicles: VehicleValue[];
  flexOn: boolean;
  asapOn: boolean;
  /** Expedited toggle (vehicles.expedited column exists). */
  expeditedOn?: boolean;
  onChange: (index: number, patch: Partial<VehicleValue>) => void;
}) {
  const [typing, setTyping] = useState<{ index: number; value: string } | null>(null);
  const rows = vehicles.map((v, index) => ({ v, index })).filter(r => hasVehicleData(r.v));
  return (
    <div className="veh-summary" data-testid="vehicle-prices">
      <div className="table-scroll">
        <table className="mini-table veh-compact" data-testid="vehicle-table">
          <thead><tr>
            <th>Year / Make / Model</th><th>Type</th><th>Run</th><th>Enclosed</th><th>Qty</th>
            <th className="num">Deposit</th><th className="num">Carrier COD</th><th className="num">Total</th>
          </tr></thead>
            {rows.map(({ v, index }, k) => {
              // Vehicle Total = Deposit + Carrier COD + Additional charges - Discount (lib/vehicle-charges.ts).
              const vm = vehicleMoney({ deposit: v.deposit, cod: v.cod, charges: v.charges, discount: v.discount });
              const priced = String(v.deposit ?? "").trim() || String(v.cod ?? "").trim() || vm.extrasC > 0;
              const totalText = typing?.index === index ? typing.value : (priced ? centsToInput(vm.totalC) : "");
              const short = typing?.index === index && codFromTotalWithCharges(typing.value, v).short;
              return (
                <tbody key={index} className="veh-group has-flags">
                <tr data-testid="vehicle-money-row">
                  <td>
                    <b className="veh-no" data-testid="vehicle-number">{k + 1}.</b>{" "}
                    <Link href={`/estimates/${leadId}/vehicles?edit=${index}`} data-testid="vehicle-link"><b>{[v.year, v.make, v.model].filter(Boolean).join(" ")}</b></Link>
                    {v.color && <small className="muted"> · {v.color}</small>}
                    {v.remarks && <small className="muted"> — {v.remarks}</small>}
                  </td>
                  <td>{v.vehicle_type}</td>
                  <td>{v.is_running ? "Y" : "N"}</td>
                  <td>{v.is_enclosed ? "Y" : "N"}</td>
                  <td>{qtyOf(v)}</td>
                  <td className="num veh-money"><input value={v.deposit || ""} inputMode="decimal" placeholder="0.00" aria-label="Deposit" data-testid="veh-deposit"
                    onChange={e => { setTyping(null); onChange(index, { deposit: e.target.value }); }} /></td>
                  <td className="num veh-money"><input value={v.cod || ""} inputMode="decimal" placeholder="0.00" aria-label="Carrier COD" data-testid="veh-cod"
                    onChange={e => { setTyping(null); onChange(index, { cod: e.target.value }); }} /></td>
                  <td className="num veh-money total"><input value={totalText} inputMode="decimal" placeholder="0.00" aria-label="Total" data-testid="veh-total"
                    onFocus={e => { setTyping({ index, value: e.target.value }); e.target.select(); }}
                    onChange={e => {
                      setTyping({ index, value: e.target.value });
                      const r = codFromTotalWithCharges(e.target.value, v);
                      onChange(index, { cod: centsToInput(r.codC) });
                    }}
                    onBlur={() => setTyping(null)} />
                    {short && <span className="soft-warn" data-testid="veh-total-warning">Below Deposit + Additional charges − Discount, so Carrier COD stays at 0.</span>}
                  </td>
                </tr>
                {/* Owner 2026-10-31: each toggle under its own column (mirrors read-only VehicleFlags):
                    FLEX / ASAP / EXPEDITED under Year/Make/Model (+ Type), INOP under Run, ENC/OPEN under Enclosed. */}
                <VehicleToggleCells v={v} flexOn={flexOn} asapOn={asapOn} expeditedOn={expeditedOn} trailing={4} onChange={patch => onChange(index, patch)} />
                </tbody>
              );
            })}
        </table>
      </div>
      <Link href={`/estimates/${leadId}/vehicles?new=1`} className="link-btn small add-veh" data-testid="add-vehicle">+ Add Vehicle</Link>
    </div>
  );
}

type ToggleProps = { v: VehicleValue; flexOn: boolean; asapOn: boolean; expeditedOn: boolean; onChange: (patch: Partial<VehicleValue>) => void };
export type TogglePart = "main" | "run" | "enclosed";

/** One column's chips: "main" = FLEX/ASAP/EXPEDITED, "run" = INOP, "enclosed" = ENC/OPEN. */
export function VehicleToggleRow({ v, flexOn, asapOn, expeditedOn, onChange, part = "main" }: ToggleProps & { part?: TogglePart }) {
  return (
    <div className={`veh-flag-row veh-toggle-row veh-toggle-${part}`} data-testid={`vehicle-toggle-${part}`} onClick={e => e.stopPropagation()}>
      {part === "main" && <>
        {flexOn && <Toggle on={!!v.flex} label="FLEX" size="sm" testId="veh-flex" title="Shows FLEX in this vehicle's Remarks" onChange={on => onChange({ flex: on })} />}
        {asapOn && <Toggle on={!!v.asap} label="ASAP" size="sm" testId="veh-asap" title="Shows ASAP in this vehicle's Remarks" onChange={on => onChange({ asap: on })} />}
        {expeditedOn && <Toggle on={!!v.expedited} label="EXPEDITED" size="sm" testId="veh-expedited" title="Shows EXPEDITED in this vehicle's Remarks" onChange={on => onChange({ expedited: on })} />}
      </>}
      {part === "run" && <Toggle on={v.is_running === false} label="INOP" tone="danger" size="sm" testId="veh-inop" title="Inoperable: sets Run to No and shows INOP in this vehicle's Remarks" onChange={on => onChange({ is_running: !on })} />}
      {part === "enclosed" && <Toggle on={!!v.is_enclosed} label={v.is_enclosed ? "ENC" : "OPEN"} size="sm" testId="veh-enclosed-toggle" title="Enclosed trailer: ON shows Enclosed on the customer order; OFF = OPEN carrier" onChange={on => onChange({ is_enclosed: on })} />}
    </div>
  );
}

/**
 * The toggle line under a vehicle row, column-aligned to Year/Make/Model+Type | Run | Enclosed
 * (shared by VehicleList and VehiclePrices). `trailing` = empty cells after Enclosed.
 */
export function VehicleToggleCells({ trailing, ...p }: ToggleProps & { trailing: number }) {
  return (
    <tr className="veh-flags-line veh-toggle-line" data-testid="vehicle-flags-line">
      <td colSpan={2} data-testid="vehicle-toggle-cell-main"><VehicleToggleRow {...p} part="main" /></td>
      <td data-testid="vehicle-flags-run"><VehicleToggleRow {...p} part="run" /></td>
      <td data-testid="vehicle-flags-enclosed"><VehicleToggleRow {...p} part="enclosed" /></td>
      {Array.from({ length: trailing }, (_, k) => <td key={k} />)}
    </tr>
  );
}
