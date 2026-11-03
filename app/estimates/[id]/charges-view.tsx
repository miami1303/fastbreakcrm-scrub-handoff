"use client";

// CHARGES (default lead view): compact like the old CRM. Top: Pickup | Delivery boxes with
// View Map, the customer's email (hover = Email Center), e-sign line, Extra Stop / Submit.
// Price box (vehicles, Remarks, Deposit, COD, Total). Right panel: Job No, Status, Priority,
// Rep, Miles, Book This Job, Follow Up, Pickup dates. Below: the four note sections + buttons.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelJob, changeLeadUser, deleteJob, recalcMiles, releaseBook, reopenJob, setFollowUp, setPriority } from "@/app/actions/leads";
import { removeBlock } from "@/app/actions/optout";
import DatePopup from "@/app/components/DatePopup";
import CarrierOwesBox, { type CarrierOwesEst } from "@/app/components/CarrierOwesBox";
import DeliveryWindowsBox from "@/app/components/DeliveryWindowsBox";
import { hasVehicleData } from "@/app/components/EntryForm";
import { priorityColor } from "@/lib/crm-constants";
import { formatPriority, priorityChoices } from "@/lib/follow-up-domain";
import { crmStamp } from "@/lib/crm-time";
import { googleMapsDirectionsUrl, googleMapsSearchUrl, type Place } from "@/lib/maps";
import RouteMapButton from "@/app/components/RouteMapButton";
import { milesLabel } from "@/lib/mileage";
import { perMile, perMileLabel, type LaneRate } from "@/lib/lane-rates";
import { recentLaneRate } from "@/app/actions/lane-rates";
import { formatCents, toCents } from "@/lib/money";
import { centsInput, chargesSummary, codFromTotal, vehiclesCodCents } from "@/lib/pricing";
import { sumEnteredVehicles } from "@/lib/vehicle-pricing";
import VehicleList from "@/app/components/VehicleList";
import HistoryInput from "@/app/components/HistoryInput";
import VehiclePrices from "@/app/components/VehiclePrices";
import type { VehicleValue } from "@/app/components/VehiclesEditor";
import { normalizeJobNumber } from "@/lib/job-number";
import { EmailCenter } from "./email-center";
import FollowUpPicker from "./follow-up-picker";
import NotesSection from "./notes-section";
import CarrierPickupTime from "@/app/components/CarrierPickupTime";
import { pickupDateText } from "@/lib/quote-template";
import DocFrame from "./doc-frame";
import { nameLines, phoneLines } from "@/lib/contact-display";
import { formTotalCents, hasContent, joinStreet, useLead, type Addr } from "./lead-context";
import VehicleExtrasBox from "@/app/components/VehicleExtrasBox";
import { codFromTotalWithCharges, jobMoney, paymentsByVehicle } from "@/lib/vehicle-charges";
import { countsAsPaid } from "@/lib/payments/decide";
import { vehicleDisplayName } from "@/lib/vehicle-pricing";

function AddrBox({ side, a, customerName, phones, mapHref }: {
  side: "pickup" | "delivery"; a: Addr; customerName: string; phones: { label?: string; number?: string }[]; mapHref: string;
}) {
  const names = nameLines(customerName, a.contact);
  const shown = phoneLines(phones);
  return (
    <div className="ch-box" data-testid={`ch-${side}`}>
      <div className="ch-box-head"><span>{side === "pickup" ? "Pickup" : "Delivery"}</span>
        <a href={mapHref} target="_blank" rel="noopener noreferrer" title={`Open the ${side} address in Google Maps (new tab)`} data-testid={side === "pickup" ? "google-maps" : "google-maps-2"}>View Map</a>
      </div>
      <div className="ch-box-body">
        {names.length ? names.map((n, i) => <b key={i}>{n}</b>) : <b>—</b>}
        {joinStreet(a) && <span>{joinStreet(a)}</span>}
        <span>{[a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—"}</span>
        {shown.map((p, i) => <span className="ch-phone" key={i}>☎ {p}</span>)}
      </div>
    </div>
  );
}

export default function ChargesView() {
  const c = useLead();
  const { id, lead, form, set, dirty, busy, flash, reload } = c;
  const router = useRouter();
  const [emailMenu, setEmailMenu] = useState(false);
  const [ecFilter, setEcFilter] = useState<"all" | "esign">("all");
  const [priorityMenu, setPriorityMenu] = useState(false);
  const [policyPreview, setPolicyPreview] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [totalInput, setTotalInput] = useState<string | null>(null);
  // The last Total the rep typed (kept after blur so the warning stays truthful); cleared
  // as soon as Deposit / COD / extras are edited, because then the Total is computed again.
  const [typedTotal, setTypedTotal] = useState<string | null>(null);
  const e = lead.est;
  const booked = e.status === "booked";
  const refresh = () => window.dispatchEvent(new Event("crm:refresh-banners"));

  const pickupPlace: Place = { street: joinStreet(form.pickup), city: form.pickup.city || lead.geo.pickup?.city, state: form.pickup.state || lead.geo.pickup?.state, zip: form.pickup.zip, lat: lead.geo.pickup?.lat, lon: lead.geo.pickup?.lon };
  const deliveryPlace: Place = { street: joinStreet(form.delivery), city: form.delivery.city || lead.geo.delivery?.city, state: form.delivery.state || lead.geo.delivery?.state, zip: form.delivery.zip, lat: lead.geo.delivery?.lat, lon: lead.geo.delivery?.lon };
  // Route = pickup -> delivery; each address box has its own map (search for that one place).
  const mapHref = googleMapsDirectionsUrl(pickupPlace, deliveryPlace);
  const es = lead.emails.filter(m => m.kind === "cc_form" || m.kind === "booked_esign");
  const received = es.filter(m => m.signed_at).length;
  const pending = es.length - received;
  const vehicles = form.vehicles.filter(hasVehicleData);
  const vehCod = lead.features.vehicleExtras && !lead.features.vehiclePricing ? vehiclesCodCents(vehicles) : null;
  const codNegative = (toCents(form.cod) ?? 0) < 0;
  // COD defaults to the vehicles' carrier pay when it is still blank (legacy price column only).
  useEffect(() => { if (vehCod !== null && !form.cod.trim()) set({ cod: centsInput(vehCod) }); }, [vehCod]); // eslint-disable-line react-hooks/exhaustive-deps
  const pricing = !!lead.features.vehiclePricing;
  const multi = pricing && vehicles.length >= 2;
  const oneIndex = form.vehicles.findIndex(hasVehicleData);
  const entered = sumEnteredVehicles(vehicles);
  const moneyDiffers = multi && (
    (form.deposit.trim() ? (toCents(form.deposit) ?? 0) : entered.depositC) !== entered.depositC
    || (form.cod.trim() ? (toCents(form.cod) ?? 0) : entered.codC) !== entered.codC
  );
  function writeSingle(patch: { deposit?: string; cod?: string }, keepTyped = false) {
    if (!keepTyped) edited();
    const deposit = patch.deposit ?? form.deposit;
    const cod = patch.cod ?? form.cod;
    const next = oneIndex < 0 ? form.vehicles : form.vehicles.map((v, i) => (i === oneIndex ? { ...v, deposit, cod } : v));
    set({ deposit, cod, vehicles: next });
  }
  function writeVehicle(index: number, patch: Partial<VehicleValue>) {
    const next = form.vehicles.map((v, i) => (i === index ? { ...v, ...patch } : v));
    if (patch.deposit === undefined && patch.cod === undefined) { set({ vehicles: next }); return; }
    edited();
    const sums = sumEnteredVehicles(next.filter(hasVehicleData));
    set({ vehicles: next, deposit: centsInput(sums.depositC), cod: centsInput(sums.codC) });
  }
  const paidC = Math.round(lead.paidAmount * 100);
  // Owner 2026-10-31: multi-vehicle, not booked, no payment yet -> only each vehicle's Total and the job
  // Total. Customer payment + balance show once a payment is entered (Payment Center) or the job is booked.
  const showPayment = booked || paidC !== 0 || vehicles.length < 2;
  // Per-vehicle Additional charges / Discount / Customer payment (migration 20261031190000).
  const perVehicle = !!lead.features.vehicleCharges && vehicles.length > 0;
  const listedIdx = form.vehicles.map((v, i) => (hasVehicleData(v) ? i : -1)).filter(i => i >= 0);
  const jm = jobMoney(vehicles.map(v => ({ deposit: v.deposit, cod: v.cod, charges: v.charges, discount: v.discount })), form.extra_charges);
  const paidBy = paymentsByVehicle(lead.payments.map(p => ({ amount: p.amount, vehicle_index: (p as { vehicle_index?: number | null }).vehicle_index ?? null, voided_at: p.voided_at, counts: countsAsPaid(p.charge_status) })), vehicles.length);
  const base = chargesSummary({ deposit: form.deposit, cod: form.cod, extras: form.extra_charges, typedTotal, paidC });
  const liveTotalC = formTotalCents(form, perVehicle);
  const sum = perVehicle ? { ...base, totalC: liveTotalC, balanceC: liveTotalC - paidC } : base;
  // $/mile under Route (Owner 2026-10-31): carrier COD (+ COD charges) / miles, plus the
  // recent average carriers accepted on this ZIP corridor (learned from booked jobs).
  const carrierPayC = (toCents(form.cod) ?? entered.codC) + jm.extrasCodC;
  const milesNow = Number(form.miles) || e.miles || 0;
  const ppm = perMile(carrierPayC / 100, milesNow);
  const [lane, setLane] = useState<LaneRate | null>(null);
  useEffect(() => {
    let live = true;
    if (!form.pickup.zip || !form.delivery.zip) { setLane(null); return; }
    recentLaneRate(id, form.pickup.zip, form.delivery.zip).then(r => { if (live) setLane(r.ok ? r.rate : null); }).catch(() => {});
    return () => { live = false; };
  }, [id, form.pickup.zip, form.delivery.zip]);
  // The one shared Additional charges & discount box hands back every listed vehicle at once.
  function setVehicleCharges(next: { vi: number; charges: VehicleValue["charges"]; discount: string }[]) {
    edited();
    set({ vehicles: form.vehicles.map((v, i) => { const n = next.find(x => x.vi === i); return n ? { ...v, charges: n.charges, discount: n.discount } : v; }) });
  }
  const edited = () => { setTotalInput(null); setTypedTotal(null); };
  // After Submit Charges / reload the boxes come from the saved quote: drop a typed Total.
  useEffect(() => { setTypedTotal(null); }, [lead.quote?.total_amount]);
  const prColor = priorityColor(e.priority);
  const choices = priorityChoices(lead.priorityLabels, e.priority);

  return (
    <div className="charges" data-testid="tab-charges">
      <div className="charges-layout">
        <section className="charges-main">
          <h2 className="lead-card-title">Charges</h2>
          <div className="ch-addr">
            <AddrBox side="pickup" a={form.pickup} customerName={form.customer_name} mapHref={googleMapsSearchUrl(pickupPlace)} phones={[
              { label: form.pickup.phone1Label, number: form.customer_phone },
              { label: form.pickup.phone2Label, number: form.pickup.phone2 },
              { label: form.pickup.phone3Label, number: form.pickup.phone3 },
            ]} />
            <AddrBox side="delivery" a={form.delivery} customerName={form.customer_name} mapHref={googleMapsSearchUrl(deliveryPlace)} phones={[
              { label: form.delivery.phone1Label, number: form.delivery.phone1 },
              { label: form.delivery.phone2Label, number: form.delivery.phone2 },
              { label: form.delivery.phone3Label, number: form.delivery.phone3 },
            ]} />
          </div>

          <div className="ch-email-row" data-testid="ch-email-row">
            <span className="ch-email" data-testid="email-hover">
              {lead.block
                // Opted out: plain, greyed, not clickable (no mailto).
                ? <span className="ch-email-optout" data-testid="email-opted-out" title="Customer opted out of email">{form.customer_email}
                    <span className="optout-tag" data-testid="optout-tag">Opted out {crmStamp(lead.block.created_at).split(" ")[0]}</span></span>
                : <button type="button" className="link-btn ch-email-link" onClick={() => setEmailMenu(m => !m)}>{form.customer_email || "no email"} ✉</button>}
              {emailMenu && (
                <>
                  <EmailCenter lead={lead} booked={booked} filter={ecFilter} onFilter={setEcFilter} onSend={k => { setEmailMenu(false); c.send(k); }}
                    onSendCustomer={(k, n) => { setEmailMenu(false); c.sendCustomer(k, n); }}
                    onFreeText={() => { setEmailMenu(false); c.openFreeText(); }}
                    onSnapshot={m => { setEmailMenu(false); c.openSnapshot(m); }}
                    onPaymentLinkSent={(text, ok) => { setEmailMenu(false); c.flash(text, !ok); void c.reload(false); }} />
                  <div style={{ marginTop: 6, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" className="btn btn-sm" onClick={() => setEcFilter("all")} data-testid="ec-return">Return to Email</button>
                    <button type="button" className="btn btn-sm" onClick={() => { setEmailMenu(false); setEcFilter("all"); }} data-testid="ec-exit">Exit</button>
                  </div>
                </>
              )}
            </span>
            <span className="email-count" data-testid="email-count">{lead.emails.length} {lead.emails.length === 1 ? "email" : "emails"} sent</span>
            <span className="esign-status" data-testid="esign-status">
              <span className="boxes">
                {lead.esign.quoteSignedAt && <span className="esign-box green" title="Contract e-signed" data-testid="esign-icon-contract">$</span>}
                {lead.esign.ccSignedAt && <span className="esign-box blue" title="CC Auth form e-signed" data-testid="esign-icon-cc">CC</span>}
              </span>
              <button type="button" className="link-btn pending" onClick={() => { setEcFilter("esign"); setEmailMenu(true); }} data-testid="esign-pending">{pending} E-sign Pending</button>
              <button type="button" className="link-btn received" onClick={() => { setEcFilter("esign"); setEmailMenu(true); }} data-testid="esign-received">{received} E-sign Received</button>
            </span>
            {lead.block && (
              <small className="removal-notice" data-testid="removal-notice">
                The email is on the removal list. Block ID:{" "}
                <button type="button" className="link-btn block-id-link" data-testid="remove-block" title="Remove this email from the removal list"
                  onClick={async () => {
                    if (!window.confirm("Remove this email from the removal list and allow emails again?")) return;
                    const r = await removeBlock(id);
                    if (r.ok) { flash("Block removed."); reload(false); } else flash(r.error, true);
                  }}>{lead.block.block_id}</button>
              </small>
            )}
          </div>
          <div className="ch-buttons">
            <button type="button" className="btn btn-sm" onClick={c.openExtra} data-testid="open-extra-notes">
              Extra Stop / Notes{hasContent(form.extra_html) && <span className="has-notes" data-testid="has-notes"> (has notes)</span>}
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => c.saveCharges()} disabled={busy} data-testid="save-charges-top">Submit Charges</button>
          </div>

          <div className={`ch-price${multi ? " multi" : ""}`} data-testid="price-box">
            <div className="ch-veh">
              <div className="ch-label">Vehicles</div>
              {multi
                ? <>
                  <VehiclePrices leadId={id} vehicles={form.vehicles} asapOn={pricing} expeditedOn={!!lead.features.vehicleExpedited} onChange={writeVehicle} />
                  {perVehicle && <VehicleExtrasBox showPaid={showPayment} onChange={setVehicleCharges}
                    vehicles={listedIdx.map((vi, k) => ({ vi, name: `${k + 1}. ${vehicleDisplayName(form.vehicles[vi], k)}`, deposit: form.vehicles[vi].deposit, cod: form.vehicles[vi].cod,
                      charges: form.vehicles[vi].charges, discount: form.vehicles[vi].discount, paidC: paidBy.byVehicleC[k] ?? 0 }))} />}
                </>
                : <VehicleList leadId={id} vehicles={form.vehicles} showPrices={lead.features.vehicleExtras} totalCents={sum.totalC} table
                  toggles={{ asapOn: !!lead.features.vehiclePricing, expeditedOn: !!lead.features.vehicleExpedited, onChange: writeVehicle }} />}
              {/* Owner 2026-10-31: the notes stack replaces the single Remarks box (shipment_remarks stays in the data;
                  the customer's "Remarks" under Vehicles now prints the newest Customer's Remarks note). */}
              <div className="notes-stack under-veh" data-testid="notes-grid">
                <NotesSection kind="rep" title="Representative's Remarks" notes={lead.notes} quickNotes={lead.quickNotes} onAdd={b => c.addEntry("rep", b)} />
                <NotesSection kind="customer" title="Customer's Remarks" hint="The newest one prints as Remarks under Vehicles on the customer order." notes={lead.notes} onAdd={b => c.addEntry("customer", b)} />
                <NotesSection kind="carrier" title="Carrier Info" hint="Carrier assigned on Central Dispatch. Once booked, the newest prints in the Carrier Info box on the customer order and the Carrier Confirmation email." notes={lead.notes} onAdd={b => c.addEntry("carrier", b)} />
                <CarrierPickupTime estimateId={id} value={(e as { pickup_time?: string | null }).pickup_time} pickupText={pickupDateText({ primary_date: form.primary_date, backup_date: form.backup_date, pickup_time: (e as { pickup_time?: string | null }).pickup_time })}
                  onSaved={() => void reload(false)} flash={flash} />
                <NotesSection kind="operations" title="Direction / Operation Details" hint="For operations and dispatch." notes={lead.notes} onAdd={b => c.addEntry("operations", b)}
                  footer={lead.staff.isManager ? <a href={`/estimates/${id}/history`} target="_blank" rel="noopener" className="btn btn-sm" data-testid="lead-history"
                    title="Full lead history (prices, vehicles, charges, notes) in a new tab">Lead History</a> : undefined} />
                <NotesSection kind="policy" title="Add Notes to Company Policy" hint="Added to the Terms & Conditions on this customer's quote, booked order and CC form (this lead only)." notes={lead.notes} onAdd={b => c.addEntry("policy", b)}
                  footer={<button type="button" className="link-btn small" onClick={() => setPolicyPreview(true)} data-testid="preview-policy">Preview Company Policy on Estimate</button>} />
              </div>
            </div>
            <div className="ch-money">
              {multi && <div className="ch-label">Job totals</div>}
              {multi && moneyDiffers && <span className="soft-warn" data-testid="money-mismatch">Saved job Deposit / Carrier COD does not match the vehicle prices. Edit a vehicle price to use the per-vehicle totals.</span>}
              {/* Owner 2026-10-31: ASAP / INOP / ENC / EXPEDITED are set here on the lead only (one small toggle
                  row under every vehicle, 1 vehicle or many). The Add/Update Vehicle screen no longer has its own toggles. */}
              {multi ? <>
                <div className="ch-mrow">Deposit<b data-testid="job-deposit">{formatCents(toCents(form.deposit) ?? entered.depositC)}</b></div>
                <div className="ch-mrow">Carrier COD<b data-testid="job-cod">{formatCents(toCents(form.cod) ?? entered.codC)}</b></div>
                {perVehicle && jm.extrasPayC > 0 && <div className="ch-mrow">+ Charges by payment<b data-testid="job-extras-pay">{formatCents(jm.extrasPayC)}</b></div>}
                {perVehicle && jm.extrasCodC > 0 && <div className="ch-mrow">+ Charges on carrier COD<b data-testid="job-extras-cod">{formatCents(jm.extrasCodC)}</b></div>}
                {perVehicle && jm.discountC > 0 && <div className="ch-mrow vcc-discount" data-testid="job-discount-card">Discount (all vehicles)<b>−{formatCents(jm.discountC)}</b></div>}
                <div className="ch-mrow total">Total<b data-testid="job-total">{formatCents(sum.totalC)}</b></div>
                {perVehicle && <>
                  <div className="ch-mrow"><small>Carrier collects (COD)</small><b data-testid="job-carrier-cod">{formatCents((toCents(form.cod) ?? entered.codC) + jm.extrasCodC)}</b></div>
                  <div className="ch-mrow"><small>Fast Break collects</small><b data-testid="job-company">{formatCents(sum.totalC - (toCents(form.cod) ?? entered.codC) - jm.extrasCodC)}</b></div>
                  {paidBy.jobC !== 0 && <div className="ch-mrow"><small>Payments not tied to a vehicle</small><b data-testid="job-paid-unassigned">{formatCents(paidBy.jobC)}</b></div>}
                </>}
              </> : <>
              <label className="ch-mrow">Deposit<input value={form.deposit} inputMode="decimal" placeholder="0.00" onChange={x => writeSingle({ deposit: x.target.value })} data-testid="deposit" /></label>
              <label className="ch-mrow">Carrier COD<input value={form.cod} inputMode="decimal" placeholder={vehCod !== null ? centsInput(vehCod) : "0.00"} onChange={x => writeSingle({ cod: x.target.value })} data-testid="cod" /></label>
              {vehCod !== null && toCents(form.cod) !== vehCod && <button type="button" className="link-btn small ch-hint" onClick={() => writeSingle({ cod: centsInput(vehCod) })} data-testid="cod-from-vehicles">Use vehicle prices: {formatCents(vehCod)}</button>}
              <label className="ch-mrow total">Total<input value={totalInput ?? centsInput(sum.totalC)} inputMode="decimal" data-testid="total"
                onFocus={x => x.target.select()}
                onChange={x => {
                  setTotalInput(x.target.value);
                  setTypedTotal(x.target.value);
                  const one = oneIndex >= 0 ? form.vehicles[oneIndex] : null;
                  const r = perVehicle && one
                    ? codFromTotalWithCharges(x.target.value, { deposit: form.deposit, charges: [...(one.charges || []), ...form.extra_charges.map(e => ({ amount: e.amount, collect: "payment" as const }))], discount: one.discount })
                    : codFromTotal(x.target.value, form.deposit, form.extra_charges);
                  writeSingle({ cod: centsInput(r.codC) }, true);
                }}
                onBlur={() => setTotalInput(null)} /></label>
              </>}
              {sum.short && <span className="soft-warn" data-testid="total-warning">The Total is less than Deposit + extra charges{perVehicle ? " − discount" : ""}, so Carrier Pay stays at $0.00.</span>}
              {codNegative && <span className="soft-warn" data-testid="cod-warning">Carrier Pay can&apos;t be negative.</span>}
              {perVehicle && !multi && oneIndex >= 0 && (
                <VehicleExtrasBox showPaid={false} onChange={setVehicleCharges}
                  vehicles={[{ vi: oneIndex, name: vehicleDisplayName(form.vehicles[oneIndex], oneIndex), deposit: form.deposit, cod: form.cod,
                    charges: form.vehicles[oneIndex].charges, discount: form.vehicles[oneIndex].discount, paidC: paidBy.totalC }]} />
              )}
              {lead.features.extraCharges && !perVehicle && <div className="ch-extras"><div className="ch-extras-title">Extra charges (optional)</div>
                {lead.features.extraCharges && form.extra_charges.map((x, i) => (
                <div className="ch-extra" key={i} data-testid={`extra-${i + 1}`}>
                  <HistoryInput kind="charge-label" value={x.description} maxLength={80} aria-label={`Extra charge ${i + 1} description`}
                    onValue={v => { edited(); set({ extra_charges: form.extra_charges.map((y, j) => (j === i ? { ...y, description: v } : y)) }); }} data-testid={`extra-desc-${i + 1}`} />
                  <input value={x.amount} placeholder="0.00" inputMode="decimal" aria-label={`Extra charge ${i + 1} amount`}
                    onChange={ev => { edited(); set({ extra_charges: form.extra_charges.map((y, j) => (j === i ? { ...y, amount: ev.target.value } : y)) }); }} data-testid={`extra-amt-${i + 1}`} />
                </div>
              ))}
              </div>}
              {showPayment && <p className="balance" data-testid="deposit-paid">Payments: <b data-testid="panel-paid">{formatCents(sum.paidC)}</b> · Balance: <b data-testid="panel-balance">{formatCents(sum.balanceC)}</b></p>}
              {/* Carrier Owes (Owner 2026-10-31): back office only, does not change Deposit / COD / Total. */}
              <CarrierOwesBox est={e as unknown as CarrierOwesEst} onSaved={() => void reload(false)} compact />
            </div>
          </div>
        </section>

        <aside className="ch-panel" data-testid="lead-summary">
          <div className="chp-row"><span>Priority</span>
            <span className="priority-wrap" onMouseEnter={() => setPriorityMenu(true)} onMouseLeave={() => setPriorityMenu(false)}>
              <button type="button" className="priority-chip" aria-haspopup="menu" aria-expanded={priorityMenu} style={{ borderColor: prColor, color: prColor }}
                onClick={() => setPriorityMenu(m => !m)} data-testid="priority-chip">
                {formatPriority(lead.priorityLabels, e.priority, "chip")}
              </button>
              {priorityMenu && (
                <span className="priority-menu" role="menu" data-testid="priority-menu">
                  {choices.map(c => {
                    const current = (e.priority ?? null) === c.value;
                    return (
                      <button key={String(c.value)} type="button" role="menuitemradio" aria-checked={current} className={`priority-opt${current ? " current" : ""}`}
                        style={{ background: priorityColor(c.value) }} data-testid={`priority-opt-${c.value === null ? "none" : c.value}`}
                        onClick={async () => { setPriorityMenu(false); const r = await setPriority(id, c.value); if (!r.ok) flash(r.error, true); refresh(); reload(false); }}>
                        <span className="check">{current ? "✓" : ""}</span>{c.text}
                      </button>
                    );
                  })}
                </span>
              )}
            </span>
          </div>
          <label className="chp-row"><span>Rep</span>
            <span className="rep-change">
              <select value={form.assigned_rep_id} onChange={x => set({ assigned_rep_id: x.target.value })} data-testid="rep-select">
                <option value="">— Unassigned —</option>
                {lead.reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {lead.staff.role === "admin" && (
                <button type="button" className="btn btn-sm" data-testid="change-user"
                  disabled={busy || !form.assigned_rep_id || form.assigned_rep_id === (e.assigned_rep_id || "")}
                  onClick={async () => {
                    const r = await changeLeadUser(id, form.assigned_rep_id);
                    if (!r.ok) flash(r.error, true);
                    else { flash(`This lead now belongs to ${lead.reps.find(rep => rep.id === form.assigned_rep_id)?.name || "that user"}.`); refresh(); reload(false); }
                  }}>Change User</button>
              )}
            </span>
          </label>
          <div className="chp-row small"><span>Source</span><b className="lead-source-tag" data-testid="lead-source-display">{form.lead_source || "—"}</b></div>
          <div className="chp-row"><span>Miles</span>
            <span className="chp-miles"><b data-testid="distance">{e.miles !== null && e.miles !== undefined ? milesLabel(e.miles, e.miles_source) : "—"}</b>
              <input value={form.miles} inputMode="numeric" onChange={x => set({ miles: x.target.value.replace(/[^\d]/g, "") })} aria-label="Miles (override)" data-testid="miles-input" />
              <button type="button" className="link-btn small" onClick={async () => { const r = await recalcMiles(id); if (r.ok) { flash("Miles recalculated from the ZIPs."); reload(false); } else flash(r.error, true); }} data-testid="recalc-miles">recalc</button>
              <RouteMapButton href={mapHref} />
            </span>
          </div>
          {(ppm !== null || lane) && (
            <div className="chp-ppm" data-testid="per-mile">
              {ppm !== null && <b data-testid="cod-per-mile">{perMileLabel(ppm)}</b>}
              {lane && <small title={`Recent carrier pay on ${lane.label} (${lane.level} match, ${lane.count} job${lane.count === 1 ? "" : "s"}, $${lane.min.toFixed(2)}–$${lane.max.toFixed(2)}/mi)`} data-testid="lane-per-mile">
                Recent avg ${lane.perMile.toFixed(2)}/mi · {lane.count} job{lane.count === 1 ? "" : "s"}{lane.level !== "metro" ? ` · ${lane.level}` : ""}
              </small>}
            </div>
          )}

          {/* One dates group (Owner 2026-10-31): Pickup days, F.A.D. / Delivery date, then Follow Up. */}
          <div className="chp-section" data-testid="dates-group">
            <div className="chp-title">Pickup</div>
            <label className="chp-row"><span>Primary</span><DatePopup value={form.primary_date} onChange={v => set({ primary_date: v })} label="Primary pickup date" testId="primary-date" /></label>
            <label className="chp-row"><span>Backup</span><DatePopup value={form.backup_date} onChange={v => set({ backup_date: v })} label="Backup pickup date" testId="backup-date" /></label>
            {/* No pickup time (Owner): pickup is date only; the carrier sets the time via Central Dispatch. Column/data kept. */}
            <small className="muted">Booked jobs show on the Operations calendar on the Primary date.</small>
            <DeliveryWindowsBox est={e as unknown as Parameters<typeof DeliveryWindowsBox>[0]["est"]} onSaved={() => void reload(false)} />
            <div className="chp-row" style={{ marginTop: 6 }}><span>Follow Up <small>(CT)</small></span></div>
            <FollowUpPicker key={e.follow_up_at || "none"} value={e.follow_up_at} onSave={async iso => { const r = await setFollowUp(id, iso); if (!r.ok) flash(r.error, true); else { flash(iso ? "Follow-up set." : "Follow-up cleared."); refresh(); reload(false); } }} />
          </div>
        </aside>
      </div>

      {policyPreview && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Company policy preview" onClick={() => setPolicyPreview(false)}>
          <div className="modal" style={{ width: "min(760px, 100%)" }} onClick={x => x.stopPropagation()} data-testid="policy-preview">
            <div className="btn-row" style={{ justifyContent: "space-between" }}><h3 className="section-title" style={{ margin: 0 }}>Estimate preview — Terms &amp; Conditions</h3><button type="button" className="btn" onClick={() => setPolicyPreview(false)}>Close</button></div>
            <DocFrame html={lead.docs.quote} title="Estimate preview" scrollTo="[data-terms]" />
          </div>
        </div>
      )}

      <div className="lead-actions" data-testid="lead-actions">
        <button type="button" className="btn btn-primary" onClick={() => c.saveCharges()} disabled={busy} data-testid="save-charges">Submit Charges</button>
        {lead.staff.role === "admin" && <button type="button" className="btn btn-danger" data-testid="delete-lead" onClick={() => setDeleting(true)}>Delete Lead</button>}
        {e.status === "cancelled"
          ? <button type="button" className="btn" data-testid="reopen-lead" onClick={async () => { const r = await reopenJob(id); if (r.ok) { flash("Lead reopened."); reload(); } else flash(r.error, true); }}>Reopen Lead</button>
          : <button type="button" className="btn btn-danger-outline" data-testid="cancel-lead" onClick={async () => { if (window.confirm("Cancel this lead? It leaves Follow Up, the banners, the calendar and all lists, and is only found through Search (marked CANCELLED). You can reopen it.")) { const r = await cancelJob(id); if (r.ok) { flash("Lead cancelled."); refresh(); reload(); } else flash(r.error, true); } }}>Cancel Lead</button>}
        {lead.staff.role === "admin" && booked && (
          <button type="button" className="btn btn-warn" data-testid="release-book" disabled={busy} onClick={async () => {
            if (!window.confirm(`Release the booking for ${e.job_number}? It goes back to Follow Up and comes off the Operations calendar.`)) return;
            const r = await releaseBook(id); if (r.ok) { flash("Booking released. Back in Follow Up."); refresh(); reload(); } else flash(r.error, true);
          }}>Release Book</button>
        )}
        {dirty && <span className="zip-hint lead-actions-note">Unsaved changes</span>}
      </div>
      {deleting && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete lead" onClick={() => setDeleting(false)}>
          <form className="modal" data-testid="delete-modal" onClick={x => x.stopPropagation()} onSubmit={async x => {
            x.preventDefault();
            // Second confirmation (Owner 2026-10-31): typing the job number is the first, this pop is the second.
            if (!window.confirm(`Last check: permanently delete ${e.job_number} and all of its data? This cannot be undone.`)) return;
            const r = await deleteJob(id, deleteConfirm);
            if (r.ok) router.push("/user-menu"); else flash(r.error, true);
          }}>
            <h3 className="section-title" style={{ marginTop: 0, color: "var(--brand-red)" }}>Permanently delete {e.job_number}?</h3>
            <p style={{ fontSize: 13 }}>This deletes the lead and ALL of its data: vehicles, quote, payments and card details, notes, email history and e-signatures. It cannot be undone. Only a minimal record (job number, who, when) is kept.</p>
            <label className="field">Type the job number <b>{e.job_number}</b> (or just {String(e.job_number || "").replace(/^FB/i, "")}) to confirm<input value={deleteConfirm} onChange={x => setDeleteConfirm(x.target.value)} autoFocus data-testid="delete-confirm" /></label>
            <div className="btn-row">
              <button type="submit" className="btn btn-danger" disabled={!e.job_number || normalizeJobNumber(deleteConfirm) !== String(e.job_number).toUpperCase()} data-testid="delete-submit">Delete permanently</button>
              <button type="button" className="btn" onClick={() => setDeleting(false)}>Keep lead</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
