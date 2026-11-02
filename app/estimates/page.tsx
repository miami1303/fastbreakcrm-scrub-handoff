"use client";

// ESTIMATES IN PROCESS (also Advanced Search): Date Factor + range (presets or From/To),
// From/To State, Priority, Rep (admin), Type of Estimate, Sort By -> results table.
import { useEffect, useState } from "react";
import { searchEstimates, type JobRow, type SearchParams } from "@/app/actions/lists";
import { listReps } from "@/app/actions/leads";
import { DEFAULT_LEAD_SOURCES, type LeadSourceOption } from "@/lib/lead-sources";
import DatePopup from "@/app/components/DatePopup";
import JobTable from "@/app/components/JobTable";
import MenuCard from "@/app/components/MenuCard";
import type { PriorityLabel } from "@/lib/follow-up-domain";
import { presetRange } from "@/lib/date-ranges";
import { crmDate } from "@/lib/crm-time";
import { todayChicago, addDays } from "@/lib/calendar";
import { US_STATES } from "@/lib/us-states";

const PRESETS = [["today", "Today"], ["yesterday", "Yesterday"], ["thisWeek", "This Week"], ["lastWeek", "Last Week"], ["thisMonth", "This Month"], ["lastMonth", "Last Month"]] as const;
const TYPES: [SearchParams["type"], string][] = [["all", "All Estimates"], ["followUp", "Follow-Up Estimates"], ["esign", "Estimates with E-sign by Sent Date"], ["booked", "Booked Jobs"], ["cancelled", "Cancelled"]];
const SORTS: [SearchParams["sort"], string][] = [["job", "Job No"], ["pickup", "Pickup Date"], ["total", "Total"], ["followUp", "Follow-Up Date"], ["priority", "Priority"]];

export default function EstimatesInProcess() {
  const today = todayChicago();
  const [p, setP] = useState<SearchParams>({ dateFactor: "open", preset: "", from: addDays(today, -15), to: today, fromState: "", toState: "", priority: "all", repId: "", leadSource: "", type: "all", sort: "job" });
  const [sources, setSources] = useState<LeadSourceOption[]>(DEFAULT_LEAD_SOURCES);
  useEffect(() => { listReps().then(r => { if (r.ok) setSources(r.leadSources); }); }, []);
  const [rows, setRows] = useState<JobRow[] | null>(null);
  const [reps, setReps] = useState<{ id: string; name: string }[] | null>(null);
  const [priorities, setPriorities] = useState<PriorityLabel[]>([]);
  const [msg, setMsg] = useState("");
  const set = (patch: Partial<SearchParams>) => setP(x => ({ ...x, ...patch }));
  // Load the rep list once (admins); harmless for reps.
  // (in an effect: a server action can't run during render, which 500'd a direct page load)
  useEffect(() => {
    searchEstimates({ ...p, preset: "today", type: "all" }).then(r => { if (r.ok) { setPriorities(r.priorities); if (r.manager) setReps(r.reps); } else setReps([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const r = await searchEstimates(p);
    if (!r.ok) return setMsg(r.error);
    setRows(r.rows);
    setPriorities(r.priorities);
    if (r.manager) setReps(r.reps);
  }

  return (
    <MenuCard title="Estimates in Process" testId="estimates-page" wide>
      <form onSubmit={submit} className="eip">
        <div className="eip-row">
          <label>Date Factor<select value={p.dateFactor} onChange={e => set({ dateFactor: e.target.value as SearchParams["dateFactor"] })} data-testid="eip-factor">
            <option value="open">Open Date</option><option value="pickup">Pickup Date</option><option value="followUp">Follow-Up Date</option><option value="booked">Booked Date</option></select></label>
          <label>Date Range<select value={p.preset} onChange={e => { const v = e.target.value as SearchParams["preset"]; set(v ? { preset: v, ...presetRange(v) } : { preset: "" }); }} data-testid="eip-preset">
            <option value="">-- Select --</option>{PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>From Date<DatePopup value={p.from || ""} onChange={v => set({ from: v, preset: "" })} label="From date" testId="eip-from" clearable={false} /></label>
          <label>To Date<DatePopup value={p.to || ""} onChange={v => set({ to: v, preset: "" })} label="To date" testId="eip-to" clearable={false} /></label>
        </div>
        <div className="eip-row">
          <label>From State<select value={p.fromState} onChange={e => set({ fromState: e.target.value })} data-testid="eip-from-state"><option value="">Select State</option>{US_STATES.map(s => <option key={s}>{s}</option>)}</select></label>
          <label>To State<select value={p.toState} onChange={e => set({ toState: e.target.value })} data-testid="eip-to-state"><option value="">Select State</option>{US_STATES.map(s => <option key={s}>{s}</option>)}</select></label>
          <label>Priority<select value={p.priority} onChange={e => set({ priority: e.target.value })} data-testid="eip-priority"><option value="all">ALL</option><option value="none">No Priority</option>{priorities.map(n => <option key={n.number} value={n.number}>{n.number} · {n.label}</option>)}</select></label>
          <label>Lead Source<select value={p.leadSource} onChange={e => set({ leadSource: e.target.value })} data-testid="eip-source"><option value="">ALL</option>{sources.map(s => <option key={s.label} value={s.label}>{s.label}{s.hidden ? " (hidden)" : ""}</option>)}</select></label>
          {reps && reps.length > 0 && <label>Rep<select value={p.repId} onChange={e => set({ repId: e.target.value })} data-testid="eip-rep"><option value="">ALL</option>{reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
        </div>
        <div className="fu-box">
          <fieldset className="fu-col"><legend>Type of Estimate</legend>
            {TYPES.map(([k, l]) => <label key={k} className="fu-opt"><input type="radio" name="eip-type" checked={p.type === k} onChange={() => set({ type: k })} data-testid={`eip-type-${k}`} /><span className="fu-label">{l}</span></label>)}
          </fieldset>
          <fieldset className="fu-col"><legend>Sort By</legend>
            {SORTS.map(([k, l]) => <label key={k} className="fu-opt"><input type="radio" name="eip-sort" checked={p.sort === k} onChange={() => set({ sort: k })} data-testid={`eip-sort-${k}`} /><span className="fu-label">{l}</span></label>)}
          </fieldset>
        </div>
        <div className="page-actions"><button type="submit" className="btn btn-primary" data-testid="eip-submit">Submit</button><a className="btn" href="/user-menu" data-testid="eip-exit">Exit</a></div>
      </form>
      {msg && <p className="status-msg error">{msg}</p>}
      {rows && <section className="results" data-testid="eip-results"><h2 className="results-title">Results <small>({rows.length}{p.from && p.to && !p.preset ? ` · ${crmDate(p.from)} – ${crmDate(p.to)}` : ""})</small></h2><JobTable rows={rows} labels={priorities} testId="estimates-list" showSource /></section>}
    </MenuCard>
  );
}
