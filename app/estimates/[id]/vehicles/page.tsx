"use client";

// ADD/UPDATE VEHICLE: one row (Year, Make, Model, Color, Type, Engine, Run, Enclosed, Qty,
// Price) + Save. Saved vehicles list underneath (click a row to edit it here), Add Another
// Vehicle, Back to Charges. Price = carrier pay per vehicle (optional; blank = $0 for now).
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { emptyVehicle, type VehicleValue } from "@/app/components/VehiclesEditor";
import { hasVehicleData } from "@/app/components/EntryForm";
import { formatCents, formatCentsComma, toCents } from "@/lib/money";
import { centsInput, lineCents, priceCents, qtyOf, splitTotalCents, vehiclesCodCents, showJobTotalLine, vehiclePriceCell } from "@/lib/pricing";
import { centsToInput, codFromVehicleTotal, sumEnteredVehicles, vehicleMoneyError } from "@/lib/vehicle-pricing";
import VehicleFlags from "@/app/components/VehicleFlags";
import { todayChicago } from "@/lib/calendar";
import { CatalogNameInput, rememberCustom, useCustomTypes } from "@/app/components/CatalogNameInput";
import { TypeSelect, YearSelect } from "@/app/components/VehicleFields";
import { validTypedYear } from "@/lib/vehicle-fields";
import { withKnownType } from "@/lib/vehicle-catalog/major-makes";
import { useLead } from "../lead-context";
import VehiclePrice from "@/app/components/VehiclePrice";

const ENGINES = ["Gas", "Diesel", "Hybrid", "Electric"];
const COLORS = ["Black", "White", "Silver", "Gray", "Red", "Blue", "Green", "Brown", "Beige", "Gold", "Orange", "Yellow"];

export default function VehiclesPage() {
  return <Suspense fallback={null}><VehiclesScreen /></Suspense>;
}

function VehiclesScreen() {
  const { lead, form, set, saveCharges, busy, flash, id, totalCents } = useLead();
  const router = useRouter();
  const params = useSearchParams();
  const list = form.vehicles.filter(hasVehicleData);
  const editParam = params.get("edit");
  const [editing, setEditing] = useState<number>(() => (editParam !== null && +editParam < list.length ? +editParam : list.length === 0 || params.get("new") ? -1 : -2));
  const [row, setRow] = useState<VehicleValue>(() => (editing >= 0 ? { ...emptyVehicle(), ...list[editing] } : emptyVehicle()));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [totalDraft, setTotalDraft] = useState<string | null>(null);
  useEffect(() => { setConfirmRemove(false); setTotalDraft(null); }, [editing]);
  const extras = lead.features.vehicleExtras;
  const pricing = !!lead.features.vehiclePricing;
  // Deposit / Carrier COD / Total show on this screen only once a second vehicle is being added.
  // A one-vehicle job keeps the single set of boxes on Charges. ASAP is on every vehicle.
  const addingAnother = editing === -1 && list.length >= 1;
  const showMoney = pricing && (list.length >= 2 || addingAnother);
  const customTypes = useCustomTypes();
  const up = (p: Partial<VehicleValue>) => setRow(r => ({ ...r, ...p }));

  // Carrier Pay (COD) follows the vehicle prices unless the rep typed a different COD.
  function codPatch(before: VehicleValue[], after: VehicleValue[]): { cod?: string } {
    if (!extras) return {};
    const was = vehiclesCodCents(before), now = vehiclesCodCents(after);
    const cur = toCents(form.cod);
    if (now === null) return was !== null && cur === was ? { cod: "" } : {};
    return !form.cod.trim() || cur === was ? { cod: centsInput(now) } : {};
  }
  function moneyPatch(before: VehicleValue[], after: VehicleValue[]): { deposit?: string; cod?: string } {
    if (!pricing) return codPatch(before, after);
    const was = sumEnteredVehicles(before);
    const now = sumEnteredVehicles(after);
    if (was.depositC === now.depositC && was.codC === now.codC) return {};
    return { deposit: centsToInput(now.depositC), cod: centsToInput(now.codC) };
  }

  function open(i: number) { setEditing(i); setRow(i >= 0 ? { ...emptyVehicle(), ...list[i] } : emptyVehicle()); }

  async function save() {
    if (!hasVehicleData(row)) return flash("Enter at least the year, make or model.", true);
    if (row.year && !validTypedYear(row.year, todayChicago())) return flash("Year must be 4 digits (e.g. 1932).", true);
    if (pricing) {
      const err = vehicleMoneyError(row, [row.year, row.make, row.model].filter(Boolean).join(" ") || "Vehicle");
      if (err) return flash(err, true);
    } else {
      const price = String(row.price ?? "").trim();
      if (price && priceCents(row) === null) return flash("Price must be a dollar amount (e.g. 650 or 650.00).", true);
    }
    const next = editing >= 0 ? list.map((v, j) => (j === editing ? row : v)) : [...list, row];
    const patch = { vehicles: next, ...moneyPatch(list, next) };
    set(patch);
    const at = editing;
    if (await saveCharges(patch)) { flash(at >= 0 ? "Vehicle updated." : "Vehicle saved."); closeIf(at); }
  }
  // Close the editor after a save only if the rep hasn't already opened another row meanwhile.
  function closeIf(at: number) { setEditing(e => { if (e === at) { setRow(emptyVehicle()); return -2; } return e; }); }
  async function remove() {
    if (editing < 0) return;
    const next = list.filter((_, j) => j !== editing);
    const patch = { vehicles: next, ...moneyPatch(list, next) };
    set(patch);
    const at = editing;
    if (await saveCharges(patch)) { flash("Vehicle removed."); closeIf(at); }
  }

  const lineTotalC = Math.max(toCents(row.deposit) ?? 0, 0) + Math.max(toCents(row.cod) ?? 0, 0);
  const totalShown = totalDraft !== null ? totalDraft : (String(row.deposit || "").trim() || String(row.cod || "").trim() ? centsToInput(lineTotalC) : "");

  return (
    <section className="lead-card" data-testid="tab-vehicles">
      <h2 className="lead-card-title">Add/Update Vehicle</h2>
      <div className="veh-meta"><span>Job No: <b>{lead.est.job_number}</b></span><span>Customer: <b>{lead.est.customer_name}</b></span></div>
      {editing !== -2 && (
        <div className="table-scroll">
          <table className="veh-edit" data-testid="vehicle-editor"><thead><tr>
            <th>Year</th><th>Make</th><th>Model</th>{extras && <th>Color</th>}<th>Type</th>{extras && <th>Engine</th>}<th>Run</th><th>Enclosed</th>{extras && <th>Qty</th>}{showMoney ? <><th>Deposit</th><th>Carrier COD</th><th>Total</th></> : extras && <th>Price</th>}<th>Action</th>
          </tr></thead><tbody><tr>
            <td className="veh-year"><YearSelect key={`y${editing}`} value={row.year} onChange={year => up({ year })} /></td>
            <td className="veh-make"><CatalogNameInput kind="make" value={row.make} onChange={make => up(withKnownType(row, { make }))} year={row.year} ariaLabel="Make" testId="veh-make" /></td>
            <td className="veh-model"><CatalogNameInput kind="model" value={row.model} onChange={model => up(withKnownType(row, { model }))} year={row.year} make={row.make} ariaLabel="Model" testId="veh-model" /></td>
            {extras && <td><input value={row.color || ""} onChange={e => up({ color: e.target.value })} aria-label="Color" list="veh-colors" maxLength={40} className="w90" data-testid="veh-color" /><datalist id="veh-colors">{COLORS.map(c => <option key={c} value={c} />)}</datalist></td>}
            <td className="veh-type"><TypeSelect key={`t${editing}`} value={row.vehicle_type} onChange={vehicle_type => up({ vehicle_type })} extraTypes={customTypes} onCustomValue={typed => { void rememberCustom({ kind: "type", value: typed }); }} /></td>
            {extras && <td><select value={row.engine || ""} onChange={e => up({ engine: e.target.value })} aria-label="Engine" data-testid="veh-engine"><option value=""></option>{ENGINES.map(x => <option key={x}>{x}</option>)}</select></td>}
            <td className="c"><input type="checkbox" checked={row.is_running} onChange={e => up({ is_running: e.target.checked })} aria-label="Running" data-testid="veh-run" /></td>
            <td className="c"><input type="checkbox" checked={row.is_enclosed} onChange={e => up({ is_enclosed: e.target.checked })} aria-label="Enclosed" data-testid="veh-enclosed" /></td>
            {extras && <td><input value={row.qty || "1"} inputMode="numeric" maxLength={2} onChange={e => up({ qty: e.target.value.replace(/\D/g, "") })} aria-label="Qty" className="w44" data-testid="veh-qty" /></td>}
            {showMoney ? <>
              <td><span className="money-in">$<input value={row.deposit || ""} inputMode="decimal" placeholder="0.00" onChange={e => { setTotalDraft(null); up({ deposit: e.target.value }); }} aria-label="Deposit" className="w80" data-testid="veh-deposit" /></span></td>
              <td><span className="money-in">$<input value={row.cod || ""} inputMode="decimal" placeholder="0.00" onChange={e => { setTotalDraft(null); up({ cod: e.target.value }); }} aria-label="Carrier COD" className="w80" data-testid="veh-cod" /></span></td>
              <td><span className="money-in">$<input value={totalShown} inputMode="decimal" placeholder="0.00" aria-label="Total" className="w80" data-testid="veh-total"
                onFocus={e => { setTotalDraft(e.target.value); e.target.select(); }}
                onChange={e => { setTotalDraft(e.target.value); const r = codFromVehicleTotal(e.target.value, row.deposit); up({ cod: centsToInput(r.codC) }); }}
                onBlur={() => setTotalDraft(null)} /></span></td>
            </> : extras && <td><span className="money-in">$<input value={row.price || ""} inputMode="decimal" placeholder="optional" onChange={e => up({ price: e.target.value })} aria-label="Price" className="w80" data-testid="veh-price" /></span></td>}
            <td className="nowrap">
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save} data-testid="veh-save">Save</button>{" "}
              {editing >= 0 && <button type="button" className="btn btn-sm" onClick={() => open(-2)}>Cancel</button>}
            </td>
          </tr>
          <tr><td colSpan={16}><div className="veh-remarks-cell"><VehicleFlags asap={row.asap} inop={row.is_running === false} enclosed={!!row.is_enclosed} expedited={!!row.expedited} asapTestId="veh-asap-tag" inopTestId="veh-inop-tag" enclosedTestId="veh-enclosed-tag" /><input value={row.remarks} onChange={e => up({ remarks: e.target.value })} aria-label="Vehicle remarks" placeholder="Vehicle remarks (optional: low clearance, no keys…)" maxLength={300} className="veh-remarks" data-testid="veh-remarks" /></div></td></tr>
          </tbody></table>
          <p className="muted small">If a make, model, or type is not listed, type it. It is saved for the next vehicle. Saving still works if a list does not load.</p>
          {editing >= 0 && (
            <div className="veh-remove">{confirmRemove
              ? <><span>Remove this vehicle?</span> <button type="button" className="btn btn-sm btn-danger" onClick={remove} data-testid="veh-remove-confirm">Yes, remove</button> <button type="button" className="btn btn-sm" onClick={() => setConfirmRemove(false)}>No</button></>
              : <button type="button" className="link-btn danger" onClick={() => setConfirmRemove(true)} data-testid="veh-remove">Remove vehicle</button>}</div>
          )}
        </div>
      )}

      <h3 className="section-title" style={{ marginTop: 14 }}>Vehicles on this lead ({list.length})</h3>
      {list.length === 0 ? <p className="muted small">No vehicles yet.</p> : (
        <div className="table-scroll"><table className="mini-table veh-list" data-testid="vehicle-list"><thead><tr><th>#</th><th>Year / Make / Model</th>{extras && <th>Color</th>}<th>Type</th>{extras && <th>Engine</th>}<th>Run</th><th>Enclosed</th>{extras && <th>Qty</th>}{pricing && list.length > 1 && <><th>Deposit</th><th>Carrier COD</th><th>Total</th></>}{extras && !pricing && <><th>Price</th><th>Line</th></>}{extras && pricing && list.length <= 1 && <th>Price</th>}</tr></thead><tbody>
          {list.map((v, i) => {
            const cell = vehiclePriceCell(v, list.length, totalCents);
            const legacyUnit = cell.kind === "own" && priceCents(v) !== null && splitTotalCents(v) === null;
            return (
            <tr key={i} className={`clickable${editing === i ? " sel" : ""}`} onClick={() => open(i)} data-testid="vehicle-row" title="Click to edit">
              <td>{i + 1}</td><td><b>{[v.year, v.make, v.model].filter(Boolean).join(" ")}</b><VehicleFlags asap={v.asap} inop={v.is_running === false} enclosed={!!v.is_enclosed} expedited={!!v.expedited} />{v.remarks && <small className="muted"> — {v.remarks}</small>}</td>
              {extras && <td>{v.color}</td>}<td>{v.vehicle_type}</td>{extras && <td>{v.engine}</td>}<td>{v.is_running ? "Y" : "N"}</td><td>{v.is_enclosed ? "Y" : "N"}</td>
              {extras && <td>{qtyOf(v)}</td>}
              {pricing && list.length > 1 && <>
                <td className="num">{v.deposit ? formatCents(toCents(v.deposit) ?? 0) : ""}</td>
                <td className="num">{v.cod ? formatCents(toCents(v.cod) ?? 0) : ""}</td>
                <td className="num">{(v.deposit || v.cod) ? formatCents((toCents(v.deposit) ?? 0) + (toCents(v.cod) ?? 0)) : <VehiclePrice cell={cell} />}</td>
              </>}
              {extras && !pricing && <>
                <td>{legacyUnit ? formatCents(priceCents(v)!) : <VehiclePrice cell={cell} />}</td>
                <td>{legacyUnit ? formatCents(lineCents(v)) : <VehiclePrice cell={cell} />}</td>
              </>}
              {extras && pricing && list.length <= 1 && <td>{legacyUnit ? formatCents(priceCents(v)!) : <VehiclePrice cell={cell} />}</td>}
            </tr>
            );
          })}
        </tbody></table></div>
      )}
      {extras && showJobTotalLine(list, totalCents) && <p className="small" data-testid="veh-job-total"><b>Job Total: {formatCentsComma(totalCents)}</b> <small className="muted">(Deposit + Carrier COD + extra charges)</small></p>}
      <div className="ef-actions">
        <button type="button" className="btn" onClick={() => open(-1)} disabled={busy} data-testid="veh-add-another">{list.length ? "Add Another Vehicle" : "Add Vehicle"}</button>
        <button type="button" className="btn btn-primary" onClick={() => router.push(`/estimates/${id}`)} data-testid="veh-back">Back to Charges</button>
      </div>
      <p className="muted small" style={{ textAlign: "center" }}>{pricing ? "Each vehicle has its own Deposit and Carrier COD. Total = Deposit + Carrier COD. The job total adds extra charges once. One vehicle uses the Charges boxes." : "Prices are the carrier pay per vehicle; the Charges COD defaults to their total."} <Link href={`/estimates/${id}/entry`} className="link-btn small">Entry Form</Link></p>
    </section>
  );
}
