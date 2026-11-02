"use client";

// ASSIGN NEW ESTIMATES (admin): two side-by-side panels. LEFT Web Leads (website intake,
// source "Web Lead"), RIGHT Bought Leads (source "Purchased Lead"); oldest job number first.
// Click a lead, pick the representative, Save: the lead goes to that rep (their leads and
// Follow-Up) and leaves the panel; an audit line is written. Leads sent to the pool by hand
// with any other source are listed under "Other unassigned" so nothing is hidden.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { assignLead, listUnassigned } from "@/app/actions/leads";
import { crmStamp } from "@/lib/crm-time";
import { formatPriority } from "@/lib/follow-up-domain";

type Data = Extract<Awaited<ReturnType<typeof listUnassigned>>, { ok: true }>;
type Lead = Data["leads"][number];

function Panel({ title, testId, empty, leads, selected, onSelect, priorityText }: { title: string; testId: string; empty: string; leads: Lead[]; selected: string; onSelect: (id: string) => void; priorityText: (n: number | null) => string }) {
  return (
    <section className="as-panel" data-testid={testId}>
      <h2 className="as-title">{title} <small>({leads.length})</small></h2>
      {leads.length === 0 ? <p className="muted as-empty" data-testid={`${testId}-empty`}>{empty}</p> : (
        <ul className="as-list">
          {leads.map(l => (
            <li key={l.id}>
              <button type="button" className={`as-lead${selected === l.id ? " sel" : ""}`} aria-pressed={selected === l.id} onClick={() => onSelect(l.id)} data-testid="as-lead" data-job={l.job_number || ""}>
                <span className="as-top"><b>{l.job_number}</b><span className="muted">{crmStamp(l.created_at)}</span></span>
                <span className="as-name">{l.customer_name || "—"}</span>
                <span className="muted as-route">{[l.pickup_address, l.delivery_address].filter(Boolean).join(" → ")}{l.vehicles ? ` · ${l.vehicles}` : ""}</span>
                <span className="muted">{priorityText(l.priority)}</span>
                {l.intake_notice_error && <span className="as-mail-miss" role="alert">{l.intake_notice_error}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AssignEstimatesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState("");
  const [rep, setRep] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const r = await listUnassigned();
    if (r.ok) { setData(r); setError(""); } else setError(r.error);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!selected || !rep) return;
    setSaving(true);
    const lead = data?.leads.find(l => l.id === selected);
    const r = await assignLead(selected, rep);
    setSaving(false);
    if (!r.ok) { setError(r.error); return; }
    setMsg(`${lead?.job_number || "Lead"} assigned to ${data?.reps.find(x => x.id === rep)?.name || "rep"}.`);
    // Drop it from the panel right away (the reload below confirms from the server).
    setData(d => d ? { ...d, leads: d.leads.filter(l => l.id !== selected) } : d);
    setSelected(""); setRep("");
    window.dispatchEvent(new Event("crm:refresh-banners"));
    load();
  }

  const priorityText = (n: number | null) => formatPriority(data?.priorities || [], n, "status");
  const by = (p: Lead["panel"]) => (data?.leads || []).filter(l => l.panel === p);
  const other = by("other");
  const sel = data?.leads.find(l => l.id === selected);
  return (
    <main className="app-shell menu-shell">
      <section className="menu-card page-card wide" data-testid="assign-page">
        <div className="page-bar"><span className="page-bar-side" /><h1>Assign New Estimates</h1><span className="page-bar-side end"><Link href="/user-menu" className="page-exit" data-testid="page-exit">Exit</Link></span></div>
        {error && <p className="status-msg error" role="alert">{error}</p>}
        {msg && <p className="status-msg" data-testid="as-msg">{msg}</p>}
        {!data ? <p className="muted">Loading…</p> : <>
          <div className="as-grid">
            <Panel title="Web Leads" testId="as-web" empty="No unassigned web leads." leads={by("web")} selected={selected} onSelect={setSelected} priorityText={priorityText} />
            <Panel title="Bought Leads" testId="as-bought" empty="No unassigned bought leads." leads={by("bought")} selected={selected} onSelect={setSelected} priorityText={priorityText} />
          </div>
          {other.length > 0 && <Panel title="Other unassigned (sent to the pool by hand)" testId="as-other" empty="" leads={other} selected={selected} onSelect={setSelected} priorityText={priorityText} />}
          <div className="as-bar" data-testid="as-bar">
            <span className="as-sel">{sel ? <>Selected: <b data-testid="as-selected">{sel.job_number}</b> {sel.customer_name}</> : <span className="muted">Click a lead to select it.</span>}</span>
            <label>Representative{" "}
              <select value={rep} onChange={e => setRep(e.target.value)} data-testid="as-rep" aria-label="Representative">
                <option value="">Pick a rep…</option>
                {data.reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-primary" disabled={!selected || !rep || saving} onClick={save} data-testid="as-save">{saving ? "Saving…" : "Save"}</button>
          </div>
        </>}
      </section>
    </main>
  );
}
