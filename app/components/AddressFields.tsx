"use client";

import { useState } from "react";
import PhoneLabelSelect from "@/app/components/PhoneLabelSelect";
import PhoneNumberInput from "@/app/components/PhoneNumberInput";
import { isUsZip, lookupZip } from "@/lib/zip-lookup";

export type AddressValue = {
  street: string; city: string; state: string; zip: string; contact: string;
  phone1: string; phone2: string; phone3: string;
  phone1Label: string; phone2Label: string; phone3Label: string;
};

/** Pickup / delivery block. ZIP is enough: City and State fill from the ZIP and stay editable. */
export default function AddressFields({ side, value, onChange }: { side: "pickup" | "delivery"; value: AddressValue; onChange: (v: AddressValue) => void }) {
  const [hint, setHint] = useState("");
  const set = (patch: Partial<AddressValue>) => onChange({ ...value, ...patch });
  async function zipChanged(zip: string) {
    set({ zip });
    if (!isUsZip(zip)) { setHint(""); return; }
    setHint("Looking up ZIP…");
    const place = await lookupZip(zip);
    if (!place) { setHint("ZIP not found — enter city and state."); return; }
    setHint("");
    onChange({ ...value, zip, city: place.city, state: place.state });
  }
  const label = side === "pickup" ? "Pickup" : "Delivery";
  return (
    <div className="card" style={{ margin: 0 }}>
      <h3 className="section-title">{label}</h3>
      <div style={{ display: "grid", gap: 10 }}>
        <div className="grid-3">
          <label className="field">ZIP *<input name={`${side}_zip`} value={value.zip} inputMode="numeric" maxLength={5} pattern="[0-9]{5}" required placeholder="ZIP" onChange={e => zipChanged(e.target.value.replace(/\D/g, ""))} /></label>
          <label className="field">City<input name={`${side}_city`} value={value.city} onChange={e => set({ city: e.target.value })} /></label>
          <label className="field">State<input name={`${side}_state`} value={value.state} maxLength={2} onChange={e => set({ state: e.target.value.toUpperCase() })} /></label>
        </div>
        {hint && <span className="zip-hint">{hint}</span>}
        <label className="field">Address (optional)<input name={`${side}_address`} value={value.street} onChange={e => set({ street: e.target.value })} /></label>
        <label className="field">Contact name<input name={`${side}_contact`} value={value.contact} onChange={e => set({ contact: e.target.value })} /></label>
        <div className="grid-2">
          {([1, 2, 3] as const).map(n => {
            const numberKey = `phone${n}` as const;
            const labelKey = `phone${n}Label` as const;
            const current = value[labelKey];
            return (
              <label className="field" key={n}>Phone {n}
                <span className="ef-phone">
                  <PhoneLabelSelect name={`${side}_phone${n}_label`} ariaLabel={`Phone ${n} label`} value={current} onChange={v => set({ [labelKey]: v })} />
                  <PhoneNumberInput name={`${side}_phone${n}`} value={value[numberKey]} ariaLabel={`Phone ${n} number`} onChange={v => set({ [numberKey]: v })} />
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const emptyAddress = (): AddressValue => ({ street: "", city: "", state: "", zip: "", contact: "", phone1: "", phone2: "", phone3: "", phone1Label: "", phone2Label: "", phone3Label: "" });

/** Stored "street, City, ST 12345" -> parts (inverse of composeAddress). */
export function parseAddress(stored: string | null | undefined, zip: string | null | undefined): Pick<AddressValue, "street" | "city" | "state" | "zip"> {
  let s = (stored || "").trim();
  const z = (zip || "").trim();
  if (z && s.endsWith(z)) s = s.slice(0, -z.length).trim();
  const m = /^(?:(.*),\s*)?([^,]+),\s*([A-Za-z]{2})$/.exec(s);
  if (m) return { street: (m[1] || "").trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: z };
  return { street: s.replace(/,$/, ""), city: "", state: "", zip: z };
}
