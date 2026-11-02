"use client";

import { withKnownType } from "@/lib/vehicle-catalog/major-makes";
import { CatalogNameInput, rememberCustom, useCustomTypes } from "./CatalogNameInput";
import { TypeSelect, YearSelect } from "./VehicleFields";

export type VehicleValue = {
  year: string; make: string; model: string; vehicle_type: string; is_running: boolean; is_enclosed: boolean; remarks: string;
  /** Add/Update Vehicle screen (migration 20261023200000). price "" = legacy carrier pay not set. */
  color?: string; engine?: string; qty?: string; price?: string;
  /** Per-vehicle deposit and carrier COD (migration 20261027010000). Blank = not entered. */
  deposit?: string; cod?: string;
  /** FLEX pricing for this vehicle (migration 20261024010000). */
  flex?: boolean;
  /** ASAP: shown in this vehicle's remarks the same way as FLEX. */
  asap?: boolean;
  /** Expedited (migration 20261031150000): shown in remarks the same way as FLEX / ASAP. */
  expedited?: boolean;
  /** Per-vehicle Additional charges (3 lines) and Discount (migration 20261031190000). */
  charges?: { description: string; amount: string; collect: "payment" | "cod"; all?: boolean }[];
  discount?: string;
};
export const emptyVehicle = (): VehicleValue => ({ year: "", make: "", model: "", vehicle_type: "Sedan", is_running: true, is_enclosed: false, remarks: "", color: "", engine: "", qty: "1", price: "", deposit: "", cod: "", flex: false, asap: false, expedited: false });

function YesNo({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="field">{label}
      <div className="yn" role="group" aria-label={label}>
        <button type="button" className={value ? "on" : ""} aria-pressed={value} onClick={() => onChange(true)}>Y</button>
        <button type="button" className={!value ? "on" : ""} aria-pressed={!value} onClick={() => onChange(false)}>N</button>
      </div>
    </div>
  );
}

/** Vehicles on the salesman side. Year and type use the shared pickers; make and model come from the catalog. */
export default function VehiclesEditor({ vehicles, onChange }: { vehicles: VehicleValue[]; onChange: (v: VehicleValue[]) => void }) {
  const update = (i: number, patch: Partial<VehicleValue>) => onChange(vehicles.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const add = () => onChange([...vehicles, emptyVehicle()]);
  const customTypes = useCustomTypes();
  return (
    <div>
      {vehicles.length === 0 && <button type="button" className="btn" onClick={add}>+ Add Vehicle</button>}
      <p className="muted small">If a make, model, or type is not listed, type it. It is saved for the next vehicle. Saving still works if a list does not load.</p>
      {vehicles.map((v, i) => (
        <div key={i} className="vehicle-card" data-testid="vehicle">
          <div className="grid-v">
            <label className="field">Year<YearSelect value={v.year} onChange={year => update(i, { year })} testId={`veh-year-${i}`} /></label>
            <label className="field">Make<CatalogNameInput kind="make" value={v.make} onChange={make => update(i, withKnownType(v, { make }))} year={v.year} ariaLabel="Make" testId={`veh-make-${i}`} /></label>
            <label className="field">Model<CatalogNameInput kind="model" value={v.model} onChange={model => update(i, withKnownType(v, { model }))} year={v.year} make={v.make} ariaLabel="Model" testId={`veh-model-${i}`} /></label>
            <label className="field">Type<TypeSelect value={v.vehicle_type} onChange={vehicle_type => update(i, { vehicle_type })} extraTypes={customTypes} onCustomValue={typed => { void rememberCustom({ kind: "type", value: typed }); }} testId={`veh-type-${i}`} /></label>
            <YesNo label="Running" value={v.is_running} onChange={x => update(i, { is_running: x })} />
            <YesNo label="Enclosed" value={v.is_enclosed} onChange={x => update(i, { is_enclosed: x })} />
          </div>
          <label className="field">Remarks<input value={v.remarks} onChange={e => update(i, { remarks: e.target.value })} /></label>
          <div className="btn-row">
            {i === vehicles.length - 1 && <button type="button" className="btn" onClick={add}>+ Add Vehicle</button>}
            {vehicles.length > 1 && <button type="button" className="btn btn-danger" onClick={() => onChange(vehicles.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
