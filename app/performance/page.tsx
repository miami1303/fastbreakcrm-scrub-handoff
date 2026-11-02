"use client";

// SALESMEN PERFORMANCE (admin/supervisor): per rep, leads created, quotes sent, jobs booked
// and booked total, for a Chicago date range. "Reports" links here for now.
import { useEffect, useState } from "react";
import { salesPerformance } from "@/app/actions/lists";
import DatePopup from "@/app/components/DatePopup";
import MenuCard from "@/app/components/MenuCard";
import { presetRange } from "@/lib/date-ranges";
import { formatCents, toCents } from "@/lib/money";

type Data = Extract<Awaited<ReturnType<typeof salesPerformance>>, { ok: true }>;
type Row = Data["rows"][number];

export default function PerformancePage() {
  const m = presetRange("thisMonth");
  const [from, setFrom] = useState(m.from);
  const [to, setTo] = useState(m.to);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sources, setSources] = useState<Data["sources"]>([]);
  const [error, setError] = useState("");
  const run = () => salesPerformance(from, to).then(r => { if (r.ok) { setRows(r.rows); setSources(r.sources); setError(""); } else setError(r.error); });
  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = (k: "leads" | "quotes" | "booked" | "bookedTotal" | "depositTotal") => (rows || []).reduce((t, r) => t + r[k], 0);
  return (
    <MenuCard title="Salesmen Performance" testId="performance-page">
      <form className="eip-row" onSubmit={e => { e.preventDefault(); run(); }}>
        <label>From<DatePopup value={from} onChange={setFrom} label="From" testId="perf-from" clearable={false} /></label>
        <label>To<DatePopup value={to} onChange={setTo} label="To" testId="perf-to" clearable={false} /></label>
        <span className="btn-row">{(["today", "thisWeek", "thisMonth", "lastMonth"] as const).map(p => <button key={p} type="button" className="btn btn-sm" onClick={() => { const r = presetRange(p); setFrom(r.from); setTo(r.to); }}>{{ today: "Today", thisWeek: "This Week", thisMonth: "This Month", lastMonth: "Last Month" }[p]}</button>)}</span>
        <button type="submit" className="btn btn-primary" data-testid="perf-submit">Submit</button>
      </form>
      {error && <p className="status-msg error">{error}</p>}
      {rows && (
        <table className="mini-table job-table" data-testid="perf-table"><thead><tr><th>Rep</th><th className="num">Leads</th><th className="num">Quotes sent</th><th className="num">Booked</th><th className="num">Booked total</th><th className="num">Deposit total</th></tr></thead><tbody>
          {rows.map(r => <tr key={r.rep}><td><b>{r.rep}</b></td><td className="num">{r.leads}</td><td className="num">{r.quotes}</td><td className="num">{r.booked}</td><td className="num">{formatCents(toCents(r.bookedTotal) ?? 0)}</td><td className="num">{formatCents(toCents(r.depositTotal) ?? 0)}</td></tr>)}
          <tr className="total-row"><td>Total</td><td className="num">{sum("leads")}</td><td className="num">{sum("quotes")}</td><td className="num">{sum("booked")}</td><td className="num">{formatCents(toCents(sum("bookedTotal")) ?? 0)}</td><td className="num">{formatCents(toCents(sum("depositTotal")) ?? 0)}</td></tr>
        </tbody></table>
      )}
      {rows && (
        <>
          <h2 className="results-title" style={{ marginTop: 16 }}>By Lead Source</h2>
          <table className="mini-table job-table" data-testid="perf-sources"><thead><tr><th>Lead Source</th><th className="num">Leads</th><th className="num">Booked</th></tr></thead><tbody>
            {sources.map(s => <tr key={s.source} data-testid="perf-source-row" data-source={s.source}><td>{s.source}</td><td className="num">{s.leads}</td><td className="num">{s.booked}</td></tr>)}
            {sources.length === 0 && <tr><td colSpan={3} className="muted">No leads in this range.</td></tr>}
          </tbody></table>
        </>
      )}
      <p className="muted small">Leads = created in the range; Quotes sent = E-Quotes emailed; Booked = jobs booked in the range (America/Chicago). Deposit total = net deposits recorded in the range.</p>
    </MenuCard>
  );
}
