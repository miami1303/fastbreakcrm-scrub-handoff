"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasVehicleData } from "@/app/components/EntryForm";
import type { VehicleValue } from "@/app/components/VehiclesEditor";
import { formatCentsComma } from "@/lib/money";
import { qtyOf, showJobTotalLine, vehiclePriceCell } from "@/lib/pricing";
import VehicleFlags from "@/app/components/VehicleFlags";
import VehiclePrice from "@/app/components/VehiclePrice";
import { VehicleToggleCells } from "@/app/components/VehiclePrices";

/** Vehicles on a lead: click one to edit it on the Add/Update Vehicle screen; Add Vehicle opens it blank. */
export default function VehicleList({ leadId, vehicles, showPrices, totalCents, table = false, toggles }: { leadId: string; vehicles: VehicleValue[]; showPrices: boolean; totalCents: number; table?: boolean;
  /** Every vehicle (1 or more) without per-vehicle prices: one small toggle row per vehicle (FLEX / ASAP / INOP / ENC / EXPEDITED). */
  toggles?: { flexOn: boolean; asapOn: boolean; expeditedOn: boolean; onChange: (index: number, patch: Partial<VehicleValue>) => void } }) {
  const list = vehicles.filter(hasVehicleData);
  const router = useRouter();
  const edit = (i: number) => `/estimates/${leadId}/vehicles?edit=${i}`;
  if (table) return (
    <div className="veh-summary" data-testid="vehicle-summary">
      {/* Each vehicle is its own tbody: the vehicle line, then (when any are on) a chip line under it where each chip sits
          under its matching column: FLEX / ASAP / EXPEDITED under Year / Make / Model (spilling into Type, which has no chip, so the row never widens), INOP under Run, Enclosed under Enclosed. */}
      <div className="table-scroll"><table className="mini-table veh-compact" data-testid="vehicle-table"><thead><tr><th>Year / Make / Model</th><th>Type</th><th>Run</th><th>Enclosed</th><th>Qty</th>{showPrices && <th className="num">Price</th>}</tr></thead>
        {list.map((v, i) => {
          const hasFlags = !!(v.flex || v.asap || v.is_running === false || v.is_enclosed || v.expedited);
          const go = () => router.push(edit(i));
          return (
            <tbody key={i} className={`veh-group${hasFlags || (toggles && list.length >= 1) ? " has-flags" : ""}`} onClick={go} title="Click to edit">
              <tr className="clickable" data-testid="vehicle-row">
                <td><Link href={edit(i)} data-testid="vehicle-link" onClick={e => e.stopPropagation()}><b>{[v.year, v.make, v.model].filter(Boolean).join(" ")}</b></Link>{v.color && <small className="muted"> · {v.color}</small>}{v.remarks && <small className="muted"> — {v.remarks}</small>}</td>
                <td>{v.vehicle_type}</td><td>{v.is_running ? "Y" : "N"}</td><td>{v.is_enclosed ? "Y" : "N"}</td><td>{qtyOf(v)}</td>
                {showPrices && <td className="num"><VehiclePrice cell={vehiclePriceCell(v, list.length, totalCents)} /></td>}
              </tr>
              {toggles && list.length >= 1 ? <VehicleToggleCells v={v} flexOn={toggles.flexOn} asapOn={toggles.asapOn} expeditedOn={toggles.expeditedOn}
                trailing={showPrices ? 2 : 1} onChange={p => toggles.onChange(vehicles.indexOf(v), p)} /> : hasFlags && <tr className="clickable veh-flags-line" data-testid="vehicle-flags-line">
                <td colSpan={2}><VehicleFlags flex={v.flex} asap={v.asap} expedited={!!v.expedited} /></td>
                <td data-testid="vehicle-flags-run"><VehicleFlags inop={v.is_running === false} /></td>
                <td data-testid="vehicle-flags-enclosed"><VehicleFlags enclosed={!!v.is_enclosed} /></td>
                <td />{showPrices && <td />}
              </tr>}
            </tbody>
          );
        })}
        <tbody>
        {list.length === 0 && <tr><td colSpan={6} className="muted">No vehicles yet.</td></tr>}
        {showPrices && showJobTotalLine(list, totalCents) && <tr className="veh-job-total" data-testid="veh-job-total"><td colSpan={5}><b>Job Total</b> <small className="muted">(Deposit + Carrier COD + extra charges)</small></td><td className="num"><b>{formatCentsComma(totalCents)}</b></td></tr>}
      </tbody></table></div>
      <Link href={`/estimates/${leadId}/vehicles?new=1`} className="link-btn small add-veh" data-testid="add-vehicle">+ Add Vehicle</Link>
    </div>
  );
  return (
    <div className="veh-summary" data-testid="vehicle-summary">
      {list.length === 0 ? <p className="muted small" style={{ margin: "0 0 6px" }}>No vehicles yet.</p> : (
        <ul className="ch-veh-list">
          {list.map((v, i) => (
            <li key={i}>
              <Link href={`/estimates/${leadId}/vehicles?edit=${i}`} data-testid="vehicle-link"><b>{[v.year, v.make, v.model].filter(Boolean).join(" ")}</b></Link>
              {v.color && ` · ${v.color}`}{v.vehicle_type && ` · ${v.vehicle_type}`} · {v.is_running ? "Running" : "Not running"} · {v.is_enclosed ? "Enclosed" : "Open"}
              {qtyOf(v) > 1 && ` · Qty ${qtyOf(v)}`}
              {showPrices && <> · <VehiclePrice cell={vehiclePriceCell(v, list.length, totalCents)} /></>}
              <VehicleFlags flex={v.flex} asap={v.asap} inop={v.is_running === false} enclosed={!!v.is_enclosed} expedited={!!v.expedited} />
              {v.remarks && <small className="muted"> — {v.remarks}</small>}
            </li>
          ))}
        </ul>
      )}
      {showPrices && showJobTotalLine(list, totalCents) && <p className="small" data-testid="veh-job-total"><b>Job Total: {formatCentsComma(totalCents)}</b> <small className="muted">(Deposit + Carrier COD + extra charges)</small></p>}
      <Link href={`/estimates/${leadId}/vehicles?new=1`} className="btn btn-sm" data-testid="add-vehicle">+ Add Vehicle</Link>
    </div>
  );
}
