"use client";

// LEAD HISTORY (Owner 2026-10-31): the full touch history of this lead, opened in a new tab from the
// "Lead History" button under Direction / Operation Details. Admins and supervisors only (the
// staff role comes from the server, lib/crm-server.ts isManager). Replaces the 8-row
// "Charges change history" card that used to sit in the middle of the Charges page.
import { useLead } from "../lead-context";
import { crmStamp } from "@/lib/crm-time";

const NOTE_KIND: Record<string, string> = { rep: "Rep remarks", policy: "Company policy note", customer: "Customer remarks", operations: "Operation details" };
const clip = (t: string, n = 160) => (t.length > n ? t.slice(0, n) + "…" : t);

export default function LeadHistoryPage() {
  const { lead } = useLead();
  if (!lead.staff.isManager) {
    return <section className="lead-card" data-testid="lead-history-page"><p className="muted">Admin or supervisor only.</p></section>;
  }
  const rows = [
    ...lead.priceHistory.map(h => ({ at: h.created_at, by: h.changed_by_name, area: "Price", what: `Total ${h.old_total ?? "—"} → ${h.new_total ?? "—"} · Deposit ${h.old_deposit ?? "—"} → ${h.new_deposit ?? "—"}` })),
    ...lead.changeLog.map(h => ({ at: h.created_at, by: h.edited_by_name, area: h.field === "extra_charges" ? "Charges" : "Vehicles", what: h.text })),
    ...lead.extraNotes.history.map(h => ({ at: h.created_at, by: h.edited_by_name, area: "Extra Stop / Notes", what: h.cleared ? "Cleared" : "Updated" })),
    ...lead.remarksHistory.map(h => ({ at: h.created_at, by: h.edited_by_name, area: "Remarks", what: h.text ? clip(h.text) : "Cleared" })),
    ...lead.notes.map(n => ({ at: n.created_at, by: n.author_name, area: NOTE_KIND[n.kind] || "Note", what: clip(n.body) })),
  ].filter(r => r.at).sort((x, y) => y.at.localeCompare(x.at));
  return (
    <section className="lead-card" data-testid="lead-history-page">
      <h2 className="lead-card-title">Lead History <small className="muted">{lead.est.job_number} · {rows.length} change{rows.length === 1 ? "" : "s"}, newest first</small></h2>
      {rows.length === 0 ? <p className="muted">No history yet.</p> : (
        <div className="table-scroll"><table className="mini-table" data-testid="lead-history"><thead><tr><th>When</th><th>Rep</th><th>Area</th><th>Change</th></tr></thead><tbody>
          {rows.map((h, i) => <tr key={i}><td className="nowrap">{crmStamp(h.at)}</td><td>{h.by || "—"}</td><td className="nowrap">{h.area}</td><td className="ch-change">{h.what}</td></tr>)}
        </tbody></table></div>
      )}
    </section>
  );
}
