"use client";

// Entry Form: compact two-column Pickup | Delivery, dates + source, Job No / Status, Vehicles.
// Used for a NEW estimate (saving creates the lead) and on an existing lead's Entry Form tab.
import { useState } from "react";
import DatePopup from "@/app/components/DatePopup";
import LeadSourceSelect from "@/app/components/LeadSourceSelect";
import type { LeadSourceOption } from "@/lib/lead-sources";
import PhoneLabelSelect from "@/app/components/PhoneLabelSelect";
import PhoneNumberInput from "@/app/components/PhoneNumberInput";
import { isUsZip, lookupZip } from "@/lib/zip-lookup";
import type { VehicleValue } from "@/app/components/VehiclesEditor";
import type { Addr } from "@/app/estimates/[id]/lead-context";

export type EntryValue = {
  customer_name: string; customer_email: string; customer_phone: string; lead_source: string;
  pickup: Addr; delivery: Addr; primary_date: string; backup_date: string; pickup_time: string; vehicles: VehicleValue[];
};
export const emptyAddr = (): Addr => ({ street: "", street2: "", city: "", state: "", zip: "", contact: "", phone1: "", phone2: "", phone3: "", phone1Label: "", phone2Label: "", phone3Label: "" });

function Row({ label, children, req }: { label: string; children: React.ReactNode; req?: boolean }) {
  return <label className="ef-row"><span className={req ? "req" : undefined}>{label}{req && " *"}</span>{children}</label>;
}

/**
 * Contact name + "Contact" button (same on Pickup and Delivery). The button puts the customer's name
 * in the box. Left blank, the box shows the customer's name as the default.
 */
function ContactRow({ name, value, customer, onChange }: { name: string; value: string; customer: string; onChange: (v: string) => void }) {
  return (
    <Row label="Contact name">
      <span className="ef-contact">
        <input name={name} placeholder={customer.trim() || "if not the customer"} value={value} onChange={e => onChange(e.target.value)} maxLength={120} data-testid={`${name}-input`} />
        <button type="button" className="btn btn-sm ef-contact-btn" onClick={() => onChange(customer.trim())} disabled={!customer.trim()}
          title="Use the customer's name as the contact" data-testid={`${name}-btn`}>Contact</button>
      </span>
    </Row>
  );
}

function PhoneRow({ label, req, numberName, numberValue, onNumber, labelName, labelValue, onLabel }: {
  label: string; req?: boolean; numberName: string; numberValue: string; onNumber: (v: string) => void;
  labelName: string; labelValue: string; onLabel: (v: string) => void;
}) {
  return (
    <Row label={label} req={req}>
      <span className="ef-phone">
        <PhoneLabelSelect name={labelName} ariaLabel={`${label} label`} value={labelValue} onChange={onLabel} />
        <PhoneNumberInput name={numberName} value={numberValue} onChange={onNumber} required={req} ariaLabel={`${label} number`} />
      </span>
    </Row>
  );
}

function Side({ side, value, onChange, children, after, customer = "" }: { side: "pickup" | "delivery"; value: Addr; onChange: (a: Addr) => void; children?: React.ReactNode; after?: React.ReactNode; customer?: string }) {
  const [hint, setHint] = useState("");
  const set = (p: Partial<Addr>) => onChange({ ...value, ...p });
  async function zip(z: string) {
    set({ zip: z });
    if (!isUsZip(z)) { setHint(""); return; }
    setHint("Looking up ZIP…");
    const place = await lookupZip(z);
    if (!place) { setHint("ZIP not found — enter city and state."); return; }
    setHint("");
    onChange({ ...value, zip: z, city: place.city, state: place.state });
  }
  return (
    <div className="ef-side" data-testid={`ef-${side}`}>
      <h3 className="ef-head">{side === "pickup" ? "Pickup" : "Delivery"}</h3>
      {children}
      {side === "delivery" && <ContactRow name="delivery_contact" value={value.contact} customer={customer} onChange={contact => set({ contact })} />}
      <Row label="Address 1"><input name={`${side}_address`} value={value.street} onChange={e => set({ street: e.target.value })} maxLength={150} /></Row>
      <Row label="Address 2"><input name={`${side}_address2`} value={value.street2} onChange={e => set({ street2: e.target.value })} maxLength={80} /></Row>
      <Row label="ZIP" req><input name={`${side}_zip`} value={value.zip} inputMode="numeric" maxLength={5} required placeholder="ZIP" onChange={e => zip(e.target.value.replace(/\D/g, ""))} /></Row>
      <div className="ef-row ef-citystate">
        <span>City / State</span>
        <span className="ef-pair">
          <input name={`${side}_city`} aria-label={`${side} city`} value={value.city} onChange={e => set({ city: e.target.value })} maxLength={80} />
          <input name={`${side}_state`} aria-label={`${side} state`} value={value.state} maxLength={2} onChange={e => set({ state: e.target.value.toUpperCase() })} className="st" />
        </span>
      </div>
      {hint && <span className="zip-hint">{hint}</span>}
      {after}
    </div>
  );
}

/**
 * Typing the customer's name never touches the Pickup or Delivery contact (Owner 2026-10-31): the customer
 * is who pays, each side can have its own contact, and the Contact name + Contact button stay on both sides.
 * A blank contact (or one equal to the customer) shows the customer only on the order.
 */
export function withCustomerName(_value: Pick<EntryValue, "customer_name" | "delivery">, name: string): Partial<EntryValue> {
  return { customer_name: name };
}

export const hasVehicleData = (v: VehicleValue) => !!(v.year || v.make || v.model);

export default function EntryForm({ value, onChange, right, vehicles, leadSources, showErrors = false }: {
  value: EntryValue; onChange: (patch: Partial<EntryValue>) => void; right: React.ReactNode;
  /** Pickup time is no longer shown (date only); kept in the type for callers. */
  features?: { pickupTime: boolean }; vehicles?: React.ReactNode; leadSources: LeadSourceOption[]; showErrors?: boolean;
}) {
  return (
    <div className="ef" data-testid="entry-form">
      <div className="ef-sides">
        <Side side="pickup" value={value.pickup} onChange={pickup => onChange({ pickup })} after={<>
          <PhoneRow label="Phone 1" req numberName="customer_phone" numberValue={value.customer_phone} onNumber={customer_phone => onChange({ customer_phone })}
            labelName="pickup_phone1_label" labelValue={value.pickup.phone1Label} onLabel={phone1Label => onChange({ pickup: { ...value.pickup, phone1Label } })} />
          <PhoneRow label="Phone 2" numberName="pickup_phone2" numberValue={value.pickup.phone2} onNumber={phone2 => onChange({ pickup: { ...value.pickup, phone2 } })}
            labelName="pickup_phone2_label" labelValue={value.pickup.phone2Label} onLabel={phone2Label => onChange({ pickup: { ...value.pickup, phone2Label } })} />
          <PhoneRow label="Phone 3" numberName="pickup_phone3" numberValue={value.pickup.phone3} onNumber={phone3 => onChange({ pickup: { ...value.pickup, phone3 } })}
            labelName="pickup_phone3_label" labelValue={value.pickup.phone3Label} onLabel={phone3Label => onChange({ pickup: { ...value.pickup, phone3Label } })} />
          <Row label="Email"><input name="customer_email" type="email" value={value.customer_email} onChange={e => onChange({ customer_email: e.target.value })} maxLength={200} /></Row>
        </>}>
          <Row label="Customer" req><input name="customer_name" value={value.customer_name} onChange={e => onChange(withCustomerName(value, e.target.value))} required maxLength={120} /></Row>
          <ContactRow name="pickup_contact" value={value.pickup.contact} customer={value.customer_name} onChange={contact => onChange({ pickup: { ...value.pickup, contact } })} />
        </Side>
        <Side side="delivery" value={value.delivery} customer={value.customer_name} onChange={delivery => onChange({ delivery })} after={<>
          <PhoneRow label="Phone 1" numberName="delivery_phone1" numberValue={value.delivery.phone1} onNumber={phone1 => onChange({ delivery: { ...value.delivery, phone1 } })}
            labelName="delivery_phone1_label" labelValue={value.delivery.phone1Label} onLabel={phone1Label => onChange({ delivery: { ...value.delivery, phone1Label } })} />
          <PhoneRow label="Phone 2" numberName="delivery_phone2" numberValue={value.delivery.phone2} onNumber={phone2 => onChange({ delivery: { ...value.delivery, phone2 } })}
            labelName="delivery_phone2_label" labelValue={value.delivery.phone2Label} onLabel={phone2Label => onChange({ delivery: { ...value.delivery, phone2Label } })} />
          <PhoneRow label="Phone 3" numberName="delivery_phone3" numberValue={value.delivery.phone3} onNumber={phone3 => onChange({ delivery: { ...value.delivery, phone3 } })}
            labelName="delivery_phone3_label" labelValue={value.delivery.phone3Label} onLabel={phone3Label => onChange({ delivery: { ...value.delivery, phone3Label } })} />
        </>} />
      </div>
      <div className="ef-bottom">
        <div className="ef-dates">
          {/* ONE pickup date here (as the website intake will have). The backup date (pickup
              window) is set on the Charges right panel while talking to the customer. */}
          <div className="ef-row"><span>Pickup date</span>
            <DatePopup value={value.primary_date} onChange={v => onChange({ primary_date: v })} name="primary_date" label="Pickup date" testId="primary-date" placeholder="Pick a date" />
          </div>
          <div className="ef-row"><span className="req">Lead Source *</span>
            <LeadSourceSelect value={value.lead_source} onChange={v => onChange({ lead_source: v })} options={leadSources} invalid={showErrors} />
          </div>
        </div>
        <div className="ef-job">{right}</div>
      </div>
      {vehicles}
    </div>
  );
}
