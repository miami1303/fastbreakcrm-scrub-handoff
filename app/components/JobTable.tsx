"use client";

import Link from "next/link";
import type { JobRow } from "@/app/actions/lists";
import { crmDate, crmStamp } from "@/lib/crm-time";
import { formatCents, toCents } from "@/lib/money";
import { statusLabel } from "@/lib/lead-status";
import { formatPriority, type PriorityLabel } from "@/lib/follow-up-domain";

/** Results table shared by the Follow-Up Menu and Estimates in Process. */
export default function JobTable({ rows, labels = [], testId = "job-table", empty = "No matching estimates.", showSource = false }: { rows: JobRow[]; labels?: PriorityLabel[]; testId?: string; empty?: string; showSource?: boolean }) {
  return (
    <div className="table-scroll">
      <table className="mini-table job-table" data-testid={testId}><thead><tr>
        <th>Job No</th><th>Rep</th><th>Status / Priority</th><th>Follow-Up</th><th>Pickup Date</th><th>Customer</th><th>Origin / Destination</th><th>Vehicle(s)</th><th className="num">Total</th>{showSource && <th>Lead Source</th>}<th>E-sign</th><th>E-quote viewed</th>
      </tr></thead><tbody>
        {rows.map(r => (
          <tr key={r.id} data-testid="job-row" data-job={r.job_number || ""}>
            <td><Link href={`/estimates/${r.id}`} className="job-link" target="_blank" rel="noopener" data-newtab data-testid="job-link">{r.job_number}</Link></td>
            <td>{(r.rep || "—").toUpperCase()}</td>
            <td className={r.status === "booked" ? "st-booked" : ""}>{statusLabel(r.status)}<br /><small>{formatPriority(labels, r.priority, "table")}</small></td>
            <td className="nowrap">{crmStamp(r.follow_up_at)}</td>
            <td className="nowrap pickup">{crmDate(r.primary_date)}</td>
            <td>{r.customer}</td>
            <td>{r.origin}<br />{r.destination}</td>
            <td>{r.vehicles}</td>
            <td className="num">{r.total !== null ? formatCents(toCents(r.total) ?? 0) : ""}</td>
            {showSource && <td data-testid="job-source">{r.lead_source}</td>}
            <td className="c">{r.contractSigned && <span className="esign-box green" title="Contract e-signed">$</span>}{r.ccSigned && <span className="esign-box blue" title="CC form e-signed">CC</span>}</td>
            <td className="c">{r.quoteViewed ? <span className="ok" title="Quote viewed">✓</span> : r.quoteSent ? <small className="muted">sent</small> : ""}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={showSource ? 12 : 11} className="muted">{empty}</td></tr>}
      </tbody></table>
    </div>
  );
}
