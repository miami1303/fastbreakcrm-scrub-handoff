"use client";

// OPERATIONS CALENDAR: booked jobs by pickup date (Sun-Sat month grid, or a week). Paging is
// unlimited in both directions (shared calendar math, lib/calendar.ts; Chicago "today").
// A job also shows on its 2nd pickup date (Backup Date), marked "2nd Pick-Up".
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { operationsJobs, type JobRow } from "@/app/actions/lists";
import MenuCard from "@/app/components/MenuCard";
import { addDays, addMonths, MONTH_NAMES, monthGrid, monthLabel, parseYmd, todayChicago, weekRange, type YM } from "@/lib/calendar";
import { crmDate } from "@/lib/crm-time";
import { milesLabel } from "@/lib/mileage";
import { toCents } from "@/lib/money";
import { OPS_COLOR_LABEL, opsCalendarColor } from "@/lib/ops-status";

export default function OperationsPage() {
  // useSearchParams() needs a Suspense boundary or `next build` fails to prerender this page.
  return <Suspense fallback={null}><OperationsCalendar /></Suspense>;
}

type View = { mode: "month"; ym: YM } | { mode: "week"; from: string };
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function JobCard({ j, second, today }: { j: JobRow; second: boolean; today: string }) {
  const totalC = toCents(j.total) ?? 0, paidC = Math.round(j.paid * 100);
  // Red = needs carrier (2+ days past the window), orange = carrier assigned, green = picked up, dark green = delivered.
  const color = j.status === "booked" ? opsCalendarColor({ ...j, ...(j.ops || {}) }, today) : "none";
  return (
    <div className={`op-card${second ? " second" : ""}${j.status !== "booked" ? " open" : ""}${color !== "none" ? ` ops-${color}` : ""}`} data-testid="cal-job" data-job={j.job_number || ""} data-second={second ? "1" : "0"} data-ops={color}>
      <div className="op-top">
        <Link href={`/estimates/${j.id}`} className="job-link" target="_blank" rel="noopener" data-newtab data-testid="cal-job-link">{j.job_number}</Link>
        {second ? <span className="op-tag second">2nd Pick-Up</span> : <span className="op-tag">Pick Up</span>}
      </div>
      {color !== "none" && <span className={`op-state ${color}`} data-testid="cal-ops-state">{OPS_COLOR_LABEL[color]}</span>}
      <div className="op-icons" aria-label="Status">
        {j.status === "booked" && <span className="ic booked" title="Booked">✓</span>}
        {j.contractSigned && <span className="ic signed" title="Contract e-signed">✓</span>}
        {j.ccSigned && <span className="ic cc" title="CC form e-signed">CC</span>}
        {paidC > 0 && <span className="ic paid" title="Payment received">$$$$</span>}
        {totalC - paidC > 0 && <span className="ic due" title="Balance due">$$$$</span>}
      </div>
      <b className="op-cust">{j.customer}</b>
      <span>{j.origin}</span>
      <span>{j.destination}</span>
      {j.miles !== null && <small>{milesLabel(j.miles, null)}</small>}
      {!second && j.backup_date && <small className="op-2nd">2<sup>nd</sup> Pick-Up: {crmDate(j.backup_date)}</small>}
      {second && j.primary_date && <small className="op-2nd">1<sup>st</sup> Pick-Up: {crmDate(j.primary_date)}</small>}
    </div>
  );
}

function OperationsCalendar() {
  const params = useSearchParams();
  const today = todayChicago();
  const t = parseYmd(today)!;
  const [view, setView] = useState<View>(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(params.get("month") || "");
    return { mode: "month", ym: m ? { y: +m[1], m: +m[2] - 1 } : { y: t.y, m: t.m } };
  });
  const [phase, setPhase] = useState<"booked" | "all">("booked");
  const [rep, setRep] = useState("");
  const [pending, setPending] = useState({ phase: "booked" as "booked" | "all", rep: "", y: view.mode === "month" ? view.ym.y : t.y, m: view.mode === "month" ? view.ym.m : t.m });
  const [rows, setRows] = useState<JobRow[] | null>(null);
  const [reps, setReps] = useState<{ id: string; name: string }[]>([]);
  const [manager, setManager] = useState(false);

  const weeks = useMemo(() => {
    if (view.mode === "week") return [Array.from({ length: 7 }, (_, i) => { const d = addDays(view.from, i); const p = parseYmd(d)!; return { ymd: d, d: p.d, m: p.m, y: p.y, inMonth: true, dow: i }; })];
    return monthGrid(view.ym);
  }, [view]);
  const from = weeks[0][0].ymd, to = weeks[weeks.length - 1][6].ymd;

  useEffect(() => {
    setRows(null);
    operationsJobs(from, to, phase, rep || undefined).then(r => { if (r.ok) { setRows(r.rows); setReps(r.reps); setManager(r.manager); } else setRows([]); });
  }, [from, to, phase, rep]);

  const go = (v: View) => { setView(v); if (v.mode === "month") setPending(p => ({ ...p, y: v.ym.y, m: v.ym.m })); };
  const cur = view.mode === "month" ? view.ym : { y: parseYmd(view.from)!.y, m: parseYmd(view.from)!.m };
  const inView = (d: string) => view.mode === "week" || (parseYmd(d)!.m === cur.m && parseYmd(d)!.y === cur.y);
  const pickups = (rows || []).filter(j => j.primary_date && j.primary_date >= from && j.primary_date <= to && inView(j.primary_date)).length;
  const years = Array.from({ length: 21 }, (_, i) => cur.y - 10 + i);

  return (
    <MenuCard title="Operations Calendar" testId="operations-page" wide right={<b className="op-count" data-testid="op-count">Booked Jobs (Pick-up): {rows ? pickups : "…"}</b>}>
      <div className="op-head">
        <div className="op-legend" data-testid="op-legend">
          <span><i className="ic booked">✓</i> Booked</span><span><i className="ic signed">✓</i> Contract e-signed</span><span><i className="ic cc">CC</i> CC form signed</span>
          <span><i className="ic paid">$$$$</i> Payment received</span><span><i className="ic due">$$$$</i> Balance due</span>
          <span><i className="op-sw red" /> Needs carrier</span><span><i className="op-sw orange" /> Carrier assigned</span>
          <span><i className="op-sw green" /> Picked up</span><span><i className="op-sw delivered" /> Delivered</span>
        </div>
        <div className="op-nav">
          <button type="button" className="btn btn-sm" onClick={() => go({ mode: "month", ym: { y: t.y, m: t.m } })} data-testid="cal-today">Today</button>
          <button type="button" className="btn btn-sm" onClick={() => go({ mode: "week", from: weekRange(today).from })} data-testid="cal-week">This Week</button>
          <button type="button" className="btn btn-sm" onClick={() => go({ mode: "month", ym: addMonths(cur, -1) })} data-testid="cal-prev">Previous Month</button>
          <button type="button" className="btn btn-sm" onClick={() => go({ mode: "month", ym: { y: t.y, m: t.m } })} data-testid="cal-this">This Month</button>
          <button type="button" className="btn btn-sm" onClick={() => go({ mode: "month", ym: addMonths(cur, 1) })} data-testid="cal-next">Next Month</button>
        </div>
      </div>
      <form className="op-filters" onSubmit={e => { e.preventDefault(); setPhase(pending.phase); setRep(pending.rep); go({ mode: "month", ym: { y: pending.y, m: pending.m } }); }}>
        <label>Job Phase<select value={pending.phase} onChange={e => setPending({ ...pending, phase: e.target.value as "booked" | "all" })} data-testid="op-phase"><option value="booked">Booked Jobs</option><option value="all">All with pickup dates</option></select></label>
        <label>Month / Year<span className="ef-pair">
          <select value={pending.m} onChange={e => setPending({ ...pending, m: +e.target.value })} data-testid="op-month">{MONTH_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}</select>
          <select value={pending.y} onChange={e => setPending({ ...pending, y: +e.target.value })} data-testid="op-year">{years.map(y => <option key={y}>{y}</option>)}</select>
        </span></label>
        {manager && <label>User<select value={pending.rep} onChange={e => setPending({ ...pending, rep: e.target.value })} data-testid="op-user"><option value="">ALL</option>{reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
        <button type="submit" className="btn btn-primary" data-testid="op-submit">Submit</button>
      </form>
      <h2 className="op-title" data-testid="cal-title">{view.mode === "week" ? `Week of ${crmDate(from)}` : monthLabel(cur)}</h2>
      <div className={`op-grid${view.mode === "week" ? " week" : ""}`} data-testid="cal-grid" data-from={from} data-to={to}>
        {DOW.map(d => <div key={d} className="op-dow">{d}</div>)}
        {weeks.flat().map(c => {
          const first = (rows || []).filter(j => j.primary_date === c.ymd);
          const second = (rows || []).filter(j => j.backup_date === c.ymd && j.backup_date !== j.primary_date);
          return (
            <div key={c.ymd} className={`cal-day op-day${c.inMonth ? "" : " out"}${c.ymd === today ? " today" : ""}`} data-day={c.inMonth ? c.d : undefined} data-date={c.ymd}>
              <div className="day-num">{c.inMonth || view.mode === "week" ? (c.d === 1 || view.mode === "week" ? `${MONTH_NAMES[c.m].slice(0, 3)} ${c.d}` : c.d) : `${MONTH_NAMES[c.m].slice(0, 3)} ${c.d}`}</div>
              {(c.inMonth || view.mode === "week") && <>
                {first.map(j => <JobCard key={j.id} j={j} second={false} today={today} />)}
                {second.map(j => <JobCard key={`${j.id}-2`} j={j} second today={today} />)}
              </>}
            </div>
          );
        })}
      </div>
    </MenuCard>
  );
}
