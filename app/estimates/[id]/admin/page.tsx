"use client";

// ADMIN tab (admins and supervisors): admin facts about this lead and its discount picture, from
// fields the CRM already stores. Read-only; nothing new is saved from here.
import { useLead } from "../lead-context";
import { crmStamp } from "@/lib/crm-time";
import { statusLabel } from "@/lib/lead-status";
import { formatPriority } from "@/lib/follow-up-domain";
import { money, netPriceChange, priceReductions, returnsToCustomer } from "@/lib/lead-admin";
import { jobMoney, savedChargeLines } from "@/lib/vehicle-charges";

const c = (v: number | string | null | undefined) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };

export default function AdminTab() {
  const { lead } = useLead();
  if (!lead.staff.isManager) {
    return <section className="lead-card" data-testid="tab-admin"><p className="muted">The Admin tab is for admins and supervisors.</p></section>;
  }
  const e = lead.est as typeof lead.est & { created_at?: string | null; auto_charged_at?: string | null; intake_notice_sent_at?: string | null; intake_notice_error?: string | null };
  const q = lead.quote;
  const totalC = c(q?.total_amount ?? e.total_amount);
  const depositC = c(q?.deposit_amount ?? e.deposit_amount);
  const codC = c(q?.cod_amount ?? e.cod_amount);
  const paidC = Math.round(lead.paidAmount * 100);
  const extras = lead.extraCharges;
  // Per-vehicle Additional charges / Discount (migration 20261031190000), saved values.
  const vjm = jobMoney(lead.vehicles.map(v => { const x = v as typeof v & { deposit_amount?: unknown; cod_amount?: unknown; extra_charges?: unknown; discount_amount?: unknown }; return { deposit: x.deposit_amount, cod: x.cod_amount, charges: savedChargeLines(x.extra_charges), discount: x.discount_amount }; }));
  const red = priceReductions(lead.priceHistory);
  const net = netPriceChange(lead.priceHistory, q?.total_amount ?? e.total_amount);
  const ret = returnsToCustomer(lead.payments);
  const voided = lead.payments.filter(p => p.voided_at);
  const row = (label: string, value: React.ReactNode, testId?: string) => <tr><th>{label}</th><td data-testid={testId}>{value}</td></tr>;

  return (
    <section className="lead-card" data-testid="tab-admin">
      <h2 className="lead-card-title">Admin <small className="muted">read-only · from data already on this lead</small></h2>
      <div className="admin-grid">
        <div>
          <h3 className="section-title">Admin</h3>
          <table className="mini-table admin-facts" data-testid="admin-facts"><tbody>
            {row("Job No", <b>{e.job_number}</b>)}
            {row("Status", statusLabel(e.status), "admin-status")}
            {row("Priority", formatPriority(lead.priorityLabels, e.priority, "status"))}
            {row("Rep", lead.rep?.name || "Unassigned", "admin-rep")}
            {row("Lead source", e.lead_source || "—")}
            {row("Created", crmStamp(e.created_at))}
            {row("Last touched", crmStamp(e.last_touched_at))}
            {row("Follow-up", e.follow_up_at ? crmStamp(e.follow_up_at) : "—")}
            {row("Booked", e.booked_at ? crmStamp(e.booked_at) : "—")}
            {row("Auto-charge", `${lead.autoCharge.on ? "On" : "Off"}${e.auto_charged_at ? ` · charged ${crmStamp(e.auto_charged_at)}` : ""}${lead.autoCharge.stripeConnected ? "" : " · Stripe not connected"}`)}
            {row("E-sign", <>{lead.esign.quoteSignedAt ? `Contract ${crmStamp(lead.esign.quoteSignedAt)}` : "Contract pending"} · {lead.esign.ccSignedAt ? `CC ${crmStamp(lead.esign.ccSignedAt)}` : "CC pending"}</>)}
            {row("Emails sent", String(lead.emails.length))}
            {row("Email opt-out", lead.block ? `Opted out ${crmStamp(lead.block.created_at)} · Block ${lead.block.id}` : "No")}
            {(e.intake_notice_sent_at || e.intake_notice_error) && row("Website notice", e.intake_notice_error || `Sent ${crmStamp(e.intake_notice_sent_at)}`)}
          </tbody></table>
        </div>
        <div>
          <h3 className="section-title">Discount</h3>
          <p className="muted small admin-note">Per-vehicle Discount (Charges tab, staff only) plus price reductions from the price history and money returned to the customer.</p>
          <table className="mini-table admin-facts" data-testid="admin-discount"><tbody>
            {row("Total", money(totalC))}
            {row("Deposit / Carrier COD", `${money(depositC)} / ${money(codC)}`)}
            {extras.length > 0 && row("Extra charges", extras.map(x => `${x.description} ${money(c(x.amount))}`).join(" · "))}
            {vjm.extrasC > 0 && row("Additional charges (vehicles)", `${money(vjm.extrasC)}${vjm.extrasCodC > 0 ? ` (${money(vjm.extrasCodC)} on carrier COD)` : ""}`, "admin-vehicle-extras")}
            {vjm.discountC > 0 && row("Discount (vehicles)", `−${money(vjm.discountC)}`, "admin-vehicle-discount")}
            {row("Paid", money(paidC))}
            {row("Balance", money(totalC - paidC))}
            {row("Price reductions", red.rows.length ? `${money(red.totalOffCents)} (${red.rows.length})` : "None", "admin-reductions")}
            {net && row("First total → now", `${money(net.firstCents)} → ${money(net.currentCents)} (${net.diffCents <= 0 ? "" : "+"}${money(net.diffCents)})`, "admin-net")}
            {row("Returned to customer", ret.rows.length ? `${money(ret.totalCents)} (${ret.rows.length})` : "None", "admin-returns")}
          </tbody></table>
          {red.rows.length > 0 && (
            <table className="mini-table" data-testid="admin-reduction-rows"><thead><tr><th>When</th><th>By</th><th>Total</th><th>Off</th></tr></thead><tbody>
              {red.rows.map((r, i) => <tr key={i}><td className="nowrap">{crmStamp(r.at)}</td><td>{r.by}</td><td>{money(r.fromCents)} → {money(r.toCents)}</td><td>{money(r.offCents)}</td></tr>)}
            </tbody></table>
          )}
          {ret.rows.length > 0 && (
            <table className="mini-table" data-testid="admin-return-rows"><thead><tr><th>When</th><th>By</th><th>Amount</th><th>Reason</th></tr></thead><tbody>
              {ret.rows.map(p => <tr key={p.id}><td className="nowrap">{crmStamp(p.created_at)}</td><td>{p.created_by_name}</td><td>{money(-c(p.amount))}</td><td>{p.remark || ""}</td></tr>)}
            </tbody></table>
          )}
          {voided.length > 0 && <p className="muted small">{voided.length} voided payment{voided.length === 1 ? "" : "s"} (not counted).</p>}
        </div>
      </div>
      {lead.statusLog.length > 0 && (
        <>
          <h3 className="section-title" style={{ marginTop: 10 }}>Status log</h3>
          <table className="mini-table" data-testid="admin-status-log"><thead><tr><th>When</th><th>By</th><th>Action</th><th>Status</th></tr></thead><tbody>
            {lead.statusLog.map((s, i) => <tr key={i}><td className="nowrap">{crmStamp(s.created_at)}</td><td>{s.actor_name}</td><td>{s.action}</td><td>{s.from_status ? `${statusLabel(s.from_status)} → ` : ""}{statusLabel(s.to_status)}</td></tr>)}
          </tbody></table>
        </>
      )}
    </section>
  );
}
