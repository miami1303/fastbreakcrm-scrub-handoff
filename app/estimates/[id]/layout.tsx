"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { chargebackOpen } from "@/lib/chargeback";
import LeadTabBar from "@/app/components/LeadTabBar";
import { LeadProvider, useLead } from "./lead-context";
import { cityState, crmStamp } from "@/lib/crm-time";
import { statusLabel } from "@/lib/lead-status";
import { formatPriority } from "@/lib/follow-up-domain";
import { chargeState, opsSteps, stripNeedsCarrier, type OpsStep, type OpsStepKey } from "@/lib/ops-status";
import { setOpsFlag, type OpsFlag } from "@/app/actions/ops";
import { todayChicago } from "@/lib/calendar";
import { markDelivered } from "@/app/actions/carrier-owes";
import { carrierOwesPill, carrierOwesState } from "@/lib/carrier-owes";

/** Same on every lead tab: Job No, Status under it, the ops status strip, Book This Job (or booked status + date). */
function JobPanel() {
  const { lead, book, busy, flash, reload } = useLead();
  const e = lead.est;
  const booked = e.status === "booked";
  const ex = e as typeof e & { posted_at?: string | null; carrier_assigned_at?: string | null; picked_up_at?: string | null; delivered_at?: string | null; carrier_owes_amount?: number | null; carrier_owes_paid_at?: string | null; charged_override?: boolean | null; chargeback_status?: string | null; chargeback_amount?: number | null; chargeback_at?: string | null; primary_date?: string | null; backup_date?: string | null; deleted_at?: string | null };
  const owes = carrierOwesState(ex);
  const owesPill = carrierOwesPill(ex);
  const hasCarrierNote = lead.notes.some(n => n.kind === "carrier");
  const newestCarrier = lead.notes.filter(n => n.kind === "carrier").map(n => n.created_at).sort().pop() || null;
  const charge = chargeState(lead.payments as { created_at?: string | null; amount?: number | string | null; voided_at?: string | null; charge_status?: string | null }[]);
  // carrier_assigned_at is the toggle; older rows without the column fall back to the newest Carrier Info note.
  const carrierAt = ex.carrier_assigned_at !== undefined ? ex.carrier_assigned_at : (booked ? newestCarrier : null);
  // Charged (Owner 2026-10-31): a real payment charge always keeps Charged green (manual override cannot clear it).
  // The manual on/off override only applies when there is no payment charge.
  const paymentCharged = charge.state !== "none";
  const chargedAt = paymentCharged ? charge.at : ex.charged_override === true ? (e.booked_at || new Date().toISOString()) : null;
  const steps = opsSteps({ chargedAt, postedAt: ex.posted_at, carrierAssignedAt: carrierAt, pickedUpAt: ex.picked_up_at, deliveredAt: ex.delivered_at });
  const carrierStep = steps.find(x => x.key === "carrier")!;
  const postedStep = steps.find(x => x.key === "posted")!;
  const needsCarrier = booked && stripNeedsCarrier({ ...ex, carrier_assigned_at: carrierAt }, todayChicago());
  const router = useRouter();
  const [working, setWorking] = useState<OpsStepKey | null>(null);

  // Carrier Info box on Charges (first assign with no carrier typed yet).
  const goCarrierInfo = () => {
    const focus = () => {
      const box = document.querySelector<HTMLElement>('[data-testid="notes-carrier"]');
      if (!box) return false;
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      box.querySelector<HTMLElement>("textarea, [contenteditable=true], input")?.focus();
      return true;
    };
    if (focus()) return;
    router.push(`/estimates/${e.id}`);
    let n = 0; const t = setInterval(() => { if (focus() || ++n > 30) clearInterval(t); }, 150);
  };

  const OFF_ASK: Record<string, string> = {
    charged: "Turn Charged off?",
    posted: "Take this job off Central (on hold / not posted)? Click again later to repost.",
    carrier: "Clear the carrier (carrier cancelled)? Add the new carrier in Carrier Info, then turn this back on.",
    picked: "Mark this vehicle as NOT picked up?",
    delivered: "Mark this vehicle as NOT delivered?",
  };
  // Every ops pill is an on/off toggle (post, hold, get a carrier, carrier cancels, reassign...).
  // Each pill has its own busy flag so a toggle never disables the rest of the lead.
  const toggle = async (x: OpsStep) => {
    if (working) return;
    // Real payment charge: Charged is locked green; clicking just opens Payments (never clears it).
    if (x.key === "charged" && paymentCharged) { router.push(`/estimates/${e.id}/payments`); return; }
    // Charged / Job Posted / Carrier assigned: always a plain on/off toggle (no booked or carrier-note lock).
    if (!booked && (x.key === "picked" || x.key === "delivered")) { flash("Book this job first."); return; }
    if (x.done && OFF_ASK[x.key] && !window.confirm(OFF_ASK[x.key])) return;
    if (!x.done && x.key === "delivered" && !window.confirm("Mark this vehicle as delivered?")) return;
    setWorking(x.key);
    try {
      if (!x.done && x.key === "delivered") {
        const r = await markDelivered(e.id);
        if (!r.ok) return flash(r.error, true);
        flash(r.alerted ? "Delivered. Carrier still owes us — banner raised and office emailed." : "Delivered.");
        window.dispatchEvent(new Event("crm:refresh-banners"));
      } else if (x.done && x.key === "delivered") {
        // Undo through markDelivered so carrier_owes_notified_at resets and a later delivery alerts again.
        const r = await markDelivered(e.id, true);
        if (!r.ok) return flash(r.error, true);
        flash("Delivered off.");
        window.dispatchEvent(new Event("crm:refresh-banners"));
      } else {
        const r = await setOpsFlag(e.id, x.key as OpsFlag, !x.done);
        if (!r.ok) return flash(r.error, true);
        flash(`${x.label} ${x.done ? "off" : "on"}.`);
        if (x.key === "carrier") { window.dispatchEvent(new Event("crm:refresh-banners")); if (!x.done && !hasCarrierNote) goCarrierInfo(); }
      }
      await reload(false);
    } catch { flash(`Could not update ${x.label}. Try again.`, true); }
    finally { setWorking(null); }
  };

  const pillText = (x: OpsStep) => x.label;
  const pillTitle = (x: OpsStep) => x.key === "charged" && paymentCharged ? `Charged ${crmStamp(x.at)} (payment) · open Payments` : x.done ? `${x.label} ${crmStamp(x.at)} · click to turn off` : `${x.label}: off · click to turn on`;

  return (
    <div className={`job-panel${booked ? " booked" : ""}`} data-testid="job-panel">
      <div className="jp-no">Job No <b data-testid="job-number">{e.job_number}</b></div>
      {booked ? (
        <div className="jp-status booked" data-testid="job-booked">Booked - Operations<small data-testid="booked-at">Booked {crmStamp(e.booked_at)}</small></div>
      ) : (
        <div className="jp-status" data-testid="lead-status">{statusLabel(e.status)}{e.status !== "cancelled" && e.status !== "unassigned" && <small>{formatPriority(lead.priorityLabels, e.priority, "status")}</small>}</div>
      )}
      {/* Ops status strip (Owner 2026-10-31): one tidy row of on/off pills the whole office sees. */}
      {e.status !== "cancelled" && (
        <div className="ops-strip" data-testid="ops-strip" role="group" aria-label="Job status">
          {steps.map(x => {
            const can = true;
            const cls = `ops-pill ${x.key}${x.done ? " on" : ""}`;
            const testId = x.key === "posted" ? "job-posted-btn" : x.key === "delivered" ? "ops-delivered" : `ops-${x.key}`;
            return can
              ? <button key={x.key} type="button" className={cls} onClick={() => toggle(x)} disabled={working === x.key} aria-pressed={x.done}
                  data-testid={testId} data-done={x.done ? "1" : "0"} data-state={x.key === "charged" ? charge.state : undefined} title={pillTitle(x)}>
                  <i aria-hidden="true">{x.done ? "✓" : ""}</i>{pillText(x)}</button>
              : <span key={x.key} className={cls} data-testid={testId} data-done={x.done ? "1" : "0"} title={pillTitle(x)}><i aria-hidden="true">{x.done ? "✓" : ""}</i>{pillText(x)}</span>;
          })}
          {/* Refund pill (red): only on leads with a FULL refund (net charged $0 or less). Hidden otherwise. */}
          {charge.state === "refund" && <button type="button" className="ops-pill refund" data-testid="ops-refund" data-state="refund"
            onClick={() => router.push(`/estimates/${e.id}/payments`)} title={`Fully refunded ${crmStamp(charge.at)} · open Payments`}><i aria-hidden="true">↺</i>Refund</button>}
          {/* Chargeback pill (red): only while a Stripe dispute is open/active. Hidden otherwise. */}
          {chargebackOpen(ex.chargeback_status) && <button type="button" className="ops-pill chargeback" data-testid="ops-chargeback" data-state={ex.chargeback_status || ""}
            onClick={() => router.push(`/estimates/${e.id}/payments`)} title={`Chargeback opened ${crmStamp(ex.chargeback_at)} (${ex.chargeback_status}) · open Payments`}><i aria-hidden="true">!</i>Chargeback</button>}
          <span className={`ops-pill needs${needsCarrier ? "" : " idle"}`} data-testid="ops-needs-carrier" data-done={needsCarrier ? "1" : "0"} title={needsCarrier ? "2+ days past the end of the pickup window with no carrier assigned" : "Needs carrier: off (turns on 2+ days past pickup window with no carrier)"}><i aria-hidden="true">{needsCarrier ? "!" : ""}</i>Needs carrier</span>
          {owesPill !== "hidden" && <button type="button" className={`ops-pill owes ${owesPill === "green" ? "on" : "idle-blue"}`} data-testid="ops-carrier-owes" data-state={owesPill}
            onClick={() => router.push(`/estimates/${e.id}`)} title={`Carrier owes us ${(owes.owesC / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} · open Charges`}><i aria-hidden="true">$</i>Carrier owes</button>}
        </div>
      )}
      {booked && owes.bannerOn && <div className="jp-carrier owes" data-testid="carrier-owes-window">Carrier owes us money<small>{(owes.owesC / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} · see Payments</small></div>}
      {booked && carrierStep.done && <div className="jp-carrier" data-testid="carrier-assigned-window">Carrier assigned<small>{crmStamp(carrierStep.at)}</small></div>}
      {booked && postedStep.done && <small className="muted" data-testid="posted-at">Posted {crmStamp(postedStep.at)}</small>}
      {!booked && e.status !== "cancelled" && <button type="button" className="btn btn-book" onClick={book} disabled={busy} data-testid="book-job">Book This Job</button>}
    </div>
  );
}

function LeadFrame({ children }: { children: React.ReactNode }) {
  const { lead, dirty, msg } = useLead();
  const e = lead.est;
  return (
    <main className="main-content lead-shell" data-testid="lead-page" data-status={e.status}>
      <LeadTabBar base={`/estimates/${e.id}`} dirty={dirty} showAdmin={lead.staff.isManager} />
      <div className="lead-strip">
        <div className="ls-left">
          <span className="ls-name" data-testid="lead-customer">{e.customer_name}</span>
          <span className="ls-route">{cityState(e.pickup_address)} → {cityState(e.delivery_address)}</span>
          {dirty && <span className="zip-hint" data-testid="unsaved">Unsaved changes — click Submit Charges</span>}
        </div>
        <JobPanel />
      </div>
      {lead.esign.quoteSignedAt && <div className="lead-banner green" data-testid="banner-contract-signed"><span className="esign-box green">$</span> Contract E-sign received · {crmStamp(lead.esign.quoteSignedAt)}</div>}
      {lead.esign.ccSignedAt && <div className="lead-banner blue" data-testid="banner-cc-signed"><span className="esign-box blue">CC</span> CC form E-sign received · {crmStamp(lead.esign.ccSignedAt)}</div>}
      {msg && <p className={`status-msg${msg.error ? " error" : ""}`} role="status" data-testid="lead-msg">{msg.text}</p>}
      {children}
    </main>
  );
}

export default function LeadLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  return <LeadProvider id={id}><LeadFrame>{children}</LeadFrame></LeadProvider>;
}
