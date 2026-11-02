"use client";

// RECURRING: every time a customer opened (tracking pixel) or clicked (tracked link) an email
// the CRM sent, newest first. Quotes = "Quote Viewed", every other email = "Email Viewed".
// Click a row to open the lead. Times America/Chicago.
import { useEffect, useState } from "react";
import Link from "next/link";
import { viewEvents } from "@/app/actions/lists";
import { SendChatButton } from "@/app/components/SendChatButton";
import MenuCard from "@/app/components/MenuCard";
import { crmDate, crmStamp } from "@/lib/crm-time";
import { presetRange, type RangePreset } from "@/lib/date-ranges";

type Data = Extract<Awaited<ReturnType<typeof viewEvents>>, { ok: true }>;
const OPTIONS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "Today" }, { key: "yesterday", label: "Yesterday" }, { key: "thisWeek", label: "This Week" }, { key: "lastWeek", label: "Last Week" }, { key: "thisMonth", label: "This Month" },
];

export default function RecurringPage() {
  const [range, setRange] = useState<RangePreset>("today");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { setData(null); viewEvents(range).then(r => { if (r.ok) setData(r); else setError(r.error); }); }, [range]);
  const label = (o: { key: RangePreset; label: string }) => o.key === "today" ? `Today ${crmDate(presetRange("today").from)}` : o.label;
  const quotes = data?.rows.filter(r => r.label === "Quote Viewed").length ?? 0;
  return (
    <MenuCard title="Recurring" testId="recurring-page" wide>
      <div className="rc-bar">
        <label>Show views for:{" "}
          <select value={range} onChange={e => setRange(e.target.value as RangePreset)} data-testid="rc-range">{OPTIONS.map(o => <option key={o.key} value={o.key}>{label(o)}</option>)}</select>
        </label>
        <b data-testid="rc-total">Total: {data ? data.rows.length : "…"}{data ? ` (${quotes} Quote Viewed · ${data.rows.length - quotes} Email Viewed)` : ""}</b>
      </div>
      {error && <p className="status-msg error">{error}</p>}
      <div className="table-scroll">
        <table className="mini-table job-table rc-events" data-testid="rc-table"><thead><tr>
          <th>When</th><th>Event</th><th>Job No</th><th>Customer</th><th>Rep</th><th>Email (template · subject)</th><th>Open / Click</th><th className="num">Views</th>
        </tr></thead><tbody>
          {data?.rows.map(r => (
            <tr key={r.id} className="clickable" data-newtab={`/estimates/${r.estimate_id}`} data-testid="rc-row" data-job={r.job_number || ""} data-label={r.label} data-method={r.method}>
              <td className="nowrap"><b>{crmStamp(r.at)}</b></td>
              <td>
                <span className={`rc-badge ${r.label === "Quote Viewed" ? "q" : "e"}`} data-testid="rc-label">{r.label}</span>
                {r.suggestChat && <div style={{ marginTop: 4 }}><SendChatButton estimateId={r.estimate_id} /></div>}
              </td>
              <td><Link href={`/estimates/${r.estimate_id}`} className="job-link" target="_blank" rel="noopener" data-newtab data-testid="job-link">{r.job_number}</Link></td>
              <td>{r.customer}</td>
              <td>{(r.rep || "—").toUpperCase()}</td>
              <td><b>{r.template}</b>{r.subject && <> · <span className="muted">{r.subject}</span></>}</td>
              <td>{r.method === "click" ? "Clicked link" : r.automatic ? "Opened email (may be automatic)" : "Opened email"}</td>
              <td className="num" data-testid="rc-views">{r.views}</td>
            </tr>
          ))}
          {data && data.rows.length === 0 && <tr><td colSpan={8} className="muted" data-testid="rc-empty">No quote or email views in this range.</td></tr>}
        </tbody></table>
      </div>
      <p className="muted small">Opens come from a tracking image in the email; clicks from the email&apos;s own link (the strongest signal). Opens in the first minute after sending and known link scanners are not counted on the main history. A tracking-image hit after about 10 seconds can still show here as Email Viewed and is marked &quot;may be automatic.&quot; Quote viewed on a quote letter is recorded when the customer clicks the job-number button, not when the page loads. Apple Mail Privacy Protection can load images without the customer opening the email. All times America/Chicago.</p>
    </MenuCard>
  );
}
