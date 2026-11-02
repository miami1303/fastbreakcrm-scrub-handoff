"use client";

// Shared state for every lead tab (Entry Form | Charges | Payments | Printed Estimate | Emails).
// The form lives here so edits survive switching tabs; Submit Charges / Save saves it all.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { addNote, loadLead, saveLead, bookJob, type NoteKind, type LeadSave } from "@/app/actions/leads";
import { prepareEmail, sendCustomerMessage } from "@/app/actions/email";
import { parseAddress, type AddressValue } from "@/app/components/AddressFields";
import { phoneForField } from "@/lib/phone-format";
import type { VehicleValue } from "@/app/components/VehiclesEditor";
import { CUSTOMER_MESSAGE_LABEL, EMAIL_KIND_LABEL, type CustomerMessageKind, type EmailKind } from "@/lib/crm-constants";
import { toCents } from "@/lib/money";
import { totalCents as calcTotal, unpricedWarningCount } from "@/lib/pricing";
import { centsToInput, hydrateVehicleBoxes, sumEnteredVehicles } from "@/lib/vehicle-pricing";
import { chargeLinesForForm, jobMoney } from "@/lib/vehicle-charges";
import { hasVehicleData } from "@/app/components/EntryForm";
import { FreeTextComposer, SnapshotModal, type FreeTextSent } from "./email-center";
import ExtraNotesModal from "./extra-notes";
import { leaveAllowed } from "@/app/components/TabLinks";

export type Lead = Extract<Awaited<ReturnType<typeof loadLead>>, { ok: true }>;
export type Email = Lead["emails"][number];
/** Address with a second street line (stored joined as "line 1, line 2"). */
export type Addr = AddressValue & { street2: string };

export type FormState = {
  customer_name: string; customer_email: string; customer_phone: string; lead_source: string;
  pickup: Addr; delivery: Addr;
  primary_date: string; backup_date: string; pickup_time: string;
  miles: string;
  assigned_rep_id: string; deposit: string; cod: string; vehicles: VehicleValue[];
  /** Extra Stop / Notes rich HTML (edited in the modal, saved by Submit Charges). */
  extra_html: string;
  /** Shared shipment Remarks (customer sees it under Vehicles). */
  remarks: string;
  /** Exactly 3 optional extra charge lines (blank = not used). */
  extra_charges: { description: string; amount: string }[];
};

const escText = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
export const initialExtra = (l: Lead) => l.extraNotes.html || (l.extraNotes.legacy ? escText(l.extraNotes.legacy) : "");
export const hasContent = (html: string) => /<(img|hr|table)/i.test(html) || !!html.replace(/<[^>]*>|&nbsp;|\s/g, "");
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const moneyInput = (v: unknown) => (v === null || v === undefined || v === "" ? "" : (toCents(v) ?? 0) / 100 + "");

/** "233 S Wacker Dr, Suite 400" -> ["233 S Wacker Dr", "Suite 400"] */
export function splitStreet(street: string): [string, string] {
  const i = street.indexOf(", ");
  return i < 0 ? [street, ""] : [street.slice(0, i), street.slice(i + 2)];
}
export const joinStreet = (a: Addr) => [a.street.trim(), a.street2.trim()].filter(Boolean).join(", ");

function addr(stored: string | null | undefined, zip: string | null | undefined, contact: unknown, p1: unknown, p2: unknown, p3: unknown, l1: unknown, l2: unknown, l3: unknown): Addr {
  const p = parseAddress(stored, zip);
  const [street, street2] = splitStreet(p.street);
  const phone = (v: unknown) => phoneForField(s(v));
  return { ...p, street, street2, contact: s(contact), phone1: phone(p1), phone2: phone(p2), phone3: phone(p3), phone1Label: s(l1), phone2Label: s(l2), phone3Label: s(l3) };
}

export function toForm(l: Lead): FormState {
  const e = l.est as Lead["est"] & {
    pickup_time?: string | null;
    pickup_phone1_label?: string | null; pickup_phone2_label?: string | null; pickup_phone3_label?: string | null;
    delivery_phone1_label?: string | null; delivery_phone2_label?: string | null; delivery_phone3_label?: string | null;
    pickup_phone3?: string | null; delivery_phone3?: string | null;
  };
  let deposit = moneyInput(l.quote?.deposit_amount ?? e.deposit_amount);
  let cod = moneyInput(l.quote?.cod_amount ?? e.cod_amount);
  let vehicles = l.vehicles.map(v => {
    const x = v as typeof v & { color?: string | null; engine?: string | null; qty?: number | null; price?: number | string | null; flex?: boolean | null; asap?: boolean | null; expedited?: boolean | null; deposit_amount?: number | string | null; cod_amount?: number | string | null };
    return { year: s(v.year), make: s(v.make), model: s(v.model), vehicle_type: s(v.vehicle_type), is_running: v.is_running !== false, is_enclosed: !!v.is_enclosed, remarks: s(v.remarks),
      color: s(x.color), engine: s(x.engine), qty: x.qty ? String(x.qty) : "1", price: x.price === null || x.price === undefined ? "" : moneyInput(x.price), flex: !!x.flex, asap: !!x.asap, expedited: !!x.expedited,
      deposit: x.deposit_amount === null || x.deposit_amount === undefined ? "" : moneyInput(x.deposit_amount),
      cod: x.cod_amount === null || x.cod_amount === undefined ? "" : moneyInput(x.cod_amount),
      ...(l.features.vehicleCharges ? {
        charges: chargeLinesForForm((v as { extra_charges?: unknown }).extra_charges),
        discount: moneyInput((v as { discount_amount?: unknown }).discount_amount),
      } : {}) };
  });
  // Per-vehicle charges on: old job-level extra lines move onto vehicle 1 (taken by payment, as
  // before). The next Submit Charges saves them on the vehicle and clears the job-level lines.
  let jobExtras = [0, 1, 2].map(i => { const x = l.extraCharges[i]; return x ? { description: x.description, amount: moneyInput(x.amount) } : { description: "", amount: "" }; });
  if (l.features.vehicleCharges && vehicles.length && l.extraCharges.length) {
    const first = vehicles[0];
    const lines = [...(first.charges || [])].filter(c => c.amount.trim());
    for (const x of l.extraCharges) if (lines.length < 3) lines.push({ description: x.description, amount: moneyInput(x.amount), collect: "payment" });
    while (lines.length < 3) lines.push({ description: "", amount: "", collect: "payment" });
    vehicles[0] = { ...first, charges: lines };
    jobExtras = [0, 1, 2].map(() => ({ description: "", amount: "" }));
  }
  // Unsplit jobs show the saved deposit/COD on the first vehicle. A blank job COD that
  // already equals the legacy vehicle prices is filled from those prices (same default as before).
  if (l.features.vehiclePricing && vehicles.length) {
    const hydrated = hydrateVehicleBoxes(vehicles, deposit, cod);
    vehicles = hydrated.vehicles;
    if (hydrated.mode !== "legacy-mismatch") {
      const sums = sumEnteredVehicles(vehicles);
      if (!deposit.trim() && sums.depositC) deposit = centsToInput(sums.depositC);
      if (!cod.trim() && sums.codC) cod = centsToInput(sums.codC);
    }
  }
  return {
    customer_name: s(e.customer_name), customer_email: s(e.customer_email), customer_phone: phoneForField(s(e.customer_phone)), lead_source: s(e.lead_source),
    pickup: addr(e.pickup_address, e.pickup_zip, e.pickup_contact, e.pickup_phone1, e.pickup_phone2, e.pickup_phone3, e.pickup_phone1_label, e.pickup_phone2_label, e.pickup_phone3_label),
    delivery: addr(e.delivery_address, e.delivery_zip, e.delivery_contact, e.delivery_phone1, e.delivery_phone2, e.delivery_phone3, e.delivery_phone1_label, e.delivery_phone2_label, e.delivery_phone3_label),
    primary_date: s(e.primary_date), backup_date: s(e.backup_date), pickup_time: s(e.pickup_time),
    miles: e.miles === null || e.miles === undefined ? "" : String(e.miles),
    assigned_rep_id: s(e.assigned_rep_id),
    deposit, cod,
    vehicles,
    extra_charges: jobExtras,
    extra_html: initialExtra(l),
    remarks: s(l.est.shipment_remarks),
  };
}

/**
 * Live job Total from the form. Per-vehicle charges on: Deposit + Carrier COD (job boxes, which
 * are the vehicle sums) + every vehicle's Additional charges - every vehicle's Discount (+ any
 * job-level lines still on the form). Off: Deposit + COD + job extra lines, as before.
 */
export function formTotalCents(f: FormState, perVehicle: boolean): number {
  const base = calcTotal(f.deposit, f.cod, f.extra_charges);
  if (!perVehicle) return base;
  const jm = jobMoney(f.vehicles.filter(hasVehicleData).map(v => ({ charges: v.charges, discount: v.discount })));
  return base + jm.extrasC - jm.discountC;
}

type Flash = { text: string; error?: boolean } | null;
type Ctx = {
  id: string; lead: Lead; form: FormState; set: (patch: Partial<FormState>) => void; dirty: boolean; busy: boolean;
  msg: Flash; flash: (text: string, isError?: boolean) => void; lastLink: string;
  reload: (resetForm?: boolean) => Promise<void>; saveCharges: (patch?: Partial<FormState>) => Promise<boolean>; book: () => Promise<void>;
  send: (kind: EmailKind, override?: boolean) => Promise<void>;
  sendCustomer: (templateKey: string, name?: string) => Promise<void>;
  openFreeText: () => void; openSnapshot: (m: Email) => void;
  openExtra: () => void; addEntry: (kind: NoteKind, body: string) => Promise<boolean>; totalCents: number;
};
const LeadCtx = createContext<Ctx | null>(null);
export function useLead(): Ctx {
  const c = useContext(LeadCtx);
  if (!c) throw new Error("useLead outside LeadProvider");
  return c;
}

/** Remember the last 20 leads this user opened (Recent Accessed Jobs on the main menu). */
function rememberRecent(lead: Lead) {
  try {
    const key = `crm:recent:${lead.staff.userId}`;
    const list = JSON.parse(localStorage.getItem(key) || "[]") as { id: string }[];
    const item = { id: lead.est.id, job: lead.est.job_number, name: lead.est.customer_name, at: new Date().toISOString() };
    localStorage.setItem(key, JSON.stringify([item, ...list.filter(x => x.id !== item.id)].slice(0, 20)));
  } catch { /* storage unavailable */ }
}

async function copyRich(html: string, text: string) {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      return true;
    }
  } catch { /* fall through */ }
  return false;
}

export function LeadProvider({ id, children }: { id: string; children: React.ReactNode }) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saved, setSaved] = useState("");
  const [msg, setMsg] = useState<Flash>(null);
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState("");
  const [freeText, setFreeText] = useState(false);
  const [snapshot, setSnapshot] = useState<Email | null>(null);
  const [extraOpen, setExtraOpen] = useState(false);

  const loadedRef = useRef(false);
  const reload = useCallback(async (resetForm = true) => {
    // A refresh after the lead has loaded (e.g. after Job Posted) must never replace the whole lead
    // with an error screen; that was the "locks everything out" after Job Posted. Keep the loaded lead
    // usable and just show the error. Only the initial load (no lead yet) may show the error page.
    let r: Awaited<ReturnType<typeof loadLead>>;
    try { r = await loadLead(id); } catch { r = { ok: false as const, error: "Could not refresh the lead. Try again." }; }
    if (!r.ok) {
      if (!loadedRef.current) setError(r.error); else setMsg({ text: r.error, error: true });
      return;
    }
    setError(""); loadedRef.current = true;
    setLead(r);
    if (resetForm) { const f = toForm(r); setForm(f); setSaved(JSON.stringify(f)); }
  }, [id]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (lead) rememberRecent(lead); }, [lead?.est.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live: reload when an e-sign/view event for this job arrives (CrmBanners re-broadcasts Realtime).
  useEffect(() => {
    const h = (ev: Event) => { const n = (ev as CustomEvent).detail as { estimate_id?: string }; if (n?.estimate_id === id) reload(false); };
    window.addEventListener("crm:notification", h);
    return () => window.removeEventListener("crm:notification", h);
  }, [id, reload]);

  const dirty = !!form && JSON.stringify(form) !== saved;
  useEffect(() => {
    // Closing / reloading the tab with unsaved Charges still asks. The header Admin Menu does not
    // (it sets the allow-leave flag first and just goes back to the menu).
    const h = (e: BeforeUnloadEvent) => { if (dirty && !leaveAllowed()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const totalCents = useMemo(() => (form && lead ? formTotalCents(form, !!lead.features.vehicleCharges) : 0), [form, lead]);

  if (error) return <main className="main-content"><p className="status-msg error">{error}</p><Link className="btn" href="/user-menu">Main Menu</Link></main>;
  if (!lead || !form) return <main className="main-content lead-shell">Loading…</main>;

  const flash = (text: string, isError = false) => setMsg({ text, error: isError });
  const set = (patch: Partial<FormState>) => setForm(f => (f ? { ...f, ...patch } : f));
  const refreshBanners = () => window.dispatchEvent(new Event("crm:refresh-banners"));

  async function saveCharges(patch?: Partial<FormState>) {
    if (!form || !lead) return false;
    const f: FormState = patch ? { ...form, ...patch } : form;
    setBusy(true);
    const payload: LeadSave = {
      customer_name: f.customer_name, customer_email: f.customer_email, customer_phone: f.customer_phone, lead_source: f.lead_source,
      pickup_street: joinStreet(f.pickup), pickup_city: f.pickup.city, pickup_state: f.pickup.state, pickup_zip: f.pickup.zip, pickup_contact: f.pickup.contact,
      // Pickup Phone 1 on the Entry Form is the customer's phone.
      pickup_phone1: f.customer_phone, pickup_phone2: f.pickup.phone2, pickup_phone3: f.pickup.phone3,
      pickup_phone1_label: f.pickup.phone1Label, pickup_phone2_label: f.pickup.phone2Label, pickup_phone3_label: f.pickup.phone3Label,
      delivery_street: joinStreet(f.delivery), delivery_city: f.delivery.city, delivery_state: f.delivery.state, delivery_zip: f.delivery.zip, delivery_contact: f.delivery.contact, delivery_phone1: f.delivery.phone1, delivery_phone2: f.delivery.phone2, delivery_phone3: f.delivery.phone3,
      delivery_phone1_label: f.delivery.phone1Label, delivery_phone2_label: f.delivery.phone2Label, delivery_phone3_label: f.delivery.phone3Label,
      primary_date: f.primary_date, backup_date: f.backup_date, pickup_time: f.pickup_time,
      miles: f.miles,
      assigned_rep_id: f.assigned_rep_id, deposit: f.deposit, cod: f.cod, vehicles: f.vehicles,
      // Per-vehicle charges: the job-level lines were moved onto vehicle 1, so send them only in the old mode.
      extra_charges: lead.features.extraCharges && !(lead.features.vehicleCharges && f.vehicles.some(hasVehicleData)) ? f.extra_charges : undefined,
      extra_stop_html: f.extra_html !== initialExtra(lead) ? f.extra_html : undefined,
      shipment_remarks: f.remarks !== s(lead.est.shipment_remarks) ? f.remarks : undefined,
    };
    const r = await saveLead(id, payload);
    setBusy(false);
    if (!r.ok) { flash(r.error, true); return false; }
    flash("Charges saved.");
    await reload();
    return true;
  }

  async function book() {
    if (dirty) return flash("Click Submit Charges before booking.", true);
    setBusy(true);
    const r = await bookJob(id);
    setBusy(false);
    if (!r.ok) return flash(r.error, true);
    flash("JOB BOOKED — moved off Follow Up and onto the Operations calendar.");
    await reload();
  }

  async function send(kind: EmailKind, override = false): Promise<void> {
    if (dirty) return flash("Click Submit Charges first so the email has the latest numbers.", true);
    if (!override && lead && (kind === "e_quote" || kind === "booked_esign") && lead.features.vehicleExtras) {
      const f = toForm(lead);
      // Same rule as the vehicle rows: a vehicle without its own price is fine when the job Total
      // (Deposit + COD + extras) has a value; warn only when both are missing.
      const unpriced = unpricedWarningCount(f.vehicles.filter(v => v.year || v.make || v.model), formTotalCents(f, !!lead.features.vehicleCharges));
      if (unpriced && !window.confirm(`${unpriced} vehicle${unpriced === 1 ? " has" : "s have"} no price yet (counted as $0). Send the ${EMAIL_KIND_LABEL[kind]} anyway?`)) return;
    }
    const r = await prepareEmail(id, kind, override);
    if (!r.ok) {
      if ("needsOverride" in r && r.needsOverride && window.confirm(`${r.error}\n\nAdmin override: send anyway?`)) return send(kind, true);
      return flash(r.error, true);
    }
    setLastLink(r.url);
    if (r.sent) {
      flash(`${EMAIL_KIND_LABEL[kind]} sent to ${r.to}${r.cc ? ` (cc ${r.cc})` : ""}.`);
      refreshBanners();
      return reload(false);
    }
    const copied = await copyRich(r.html, r.text);
    flash(copied
      ? `${EMAIL_KIND_LABEL[kind]} ready: the formatted email is copied. Paste it (Ctrl+V / Cmd+V) into the email that opens.`
      : `${EMAIL_KIND_LABEL[kind]} ready: the email opens with the plain-text version.`);
    refreshBanners();
    await reload(false);
    window.location.href = `mailto:${encodeURIComponent(r.to)}?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(copied ? "" : r.text)}`;
  }

  async function sendCustomer(kind: string, label?: string): Promise<void> {
    if (dirty) return flash("Click Submit Charges first so the email has the latest details.", true);
    const r = await sendCustomerMessage(id, kind);
    if (!r.ok) return flash(r.error, true);
    const name = label || CUSTOMER_MESSAGE_LABEL[kind as CustomerMessageKind] || "Email";
    if (r.sent) {
      flash(`${name} sent to ${r.to}${r.cc ? ` (cc ${r.cc})` : ""}.`);
      refreshBanners();
      return reload(false);
    }
    const copied = await copyRich(r.html, r.text);
    flash(copied
      ? `${name} is ready: the formatted email is copied. Paste it into the email that opens. Nothing goes to the customer until you send that email.`
      : `${name} is ready: the email opens with the plain-text version. Nothing goes to the customer until you send that email.`);
    refreshBanners();
    await reload(false);
    const q = new URLSearchParams({ subject: r.subject, body: copied ? "" : r.text });
    if (r.cc) q.set("cc", r.cc);
    window.location.href = `mailto:${encodeURIComponent(r.to)}?${q.toString().replace(/\+/g, "%20")}`;
  }

  async function freeTextSent(r: FreeTextSent) {
    setFreeText(false);
    if (r.sent) {
      flash(`Free Text email sent to ${r.to}${r.cc ? ` (cc ${r.cc})` : ""}.`);
      refreshBanners();
      return reload(false);
    }
    const copied = await copyRich(r.html, r.text);
    flash(copied ? "Free Text email logged: the formatted email is copied. Paste it into the email that opens." : "Free Text email logged: the email opens with the plain-text version.");
    refreshBanners();
    await reload(false);
    const q = new URLSearchParams({ subject: r.subject, body: copied ? "" : r.text });
    if (r.cc) q.set("cc", r.cc);
    window.location.href = `mailto:${encodeURIComponent(r.to)}?${q.toString().replace(/\+/g, "%20")}`;
  }

  async function addEntry(kind: NoteKind, body: string) {
    const r = await addNote(id, body, kind);
    if (!r.ok) { flash(r.error, true); return false; }
    refreshBanners();
    await reload(false);
    return true;
  }

  const ctx: Ctx = {
    id, lead, form, set, dirty, busy, msg, flash, lastLink, reload, saveCharges, book, send, sendCustomer, totalCents, addEntry,
    openFreeText: () => { if (dirty) flash("Click Submit Charges first so the email has the latest details.", true); else setFreeText(true); },
    openSnapshot: m => setSnapshot(m),
    openExtra: () => setExtraOpen(true),
  };

  return (
    <LeadCtx.Provider value={ctx}>
      {children}
      {freeText && <FreeTextComposer lead={lead} onClose={() => setFreeText(false)} onSent={freeTextSent} onError={m => flash(m, true)} />}
      {snapshot && <SnapshotModal estimateId={id} email={snapshot} onClose={() => setSnapshot(null)} />}
      {extraOpen && <ExtraNotesModal jobNumber={lead.est.job_number ?? null} html={form.extra_html}
        onClose={() => setExtraOpen(false)}
        onApply={html => { setExtraOpen(false); set({ extra_html: hasContent(html) ? html : "" }); flash("Extra Stop / Notes updated. Click Submit Charges to save it to the customer's order."); }} />}
    </LeadCtx.Provider>
  );
}
