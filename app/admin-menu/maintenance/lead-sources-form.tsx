"use client";

// Maintenance > Lead Sources (admin): add, rename or hide the Lead Source options reps pick on
// the Entry Form. Hidden options stay on leads that already use them. Rep-side only.
import { useEffect, useState } from "react";
import { getSettings, saveLeadSources } from "@/app/actions/settings";
import type { LeadSourceOption } from "@/lib/lead-sources";

export default function LeadSourcesForm() {
  const [list, setList] = useState<LeadSourceOption[] | null>(null);
  const [add, setAdd] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => { getSettings().then(r => { if (r.ok) setList(r.leadSources); else setMsg({ text: r.error, error: true }); }); }, []);
  if (!list) return <div className="card">{msg ? <p className="status-msg error">{msg.text}</p> : "Loading…"}</div>;
  const up = (i: number, p: Partial<LeadSourceOption>) => setList(l => l!.map((o, j) => (j === i ? { ...o, ...p } : o)));
  async function save() {
    const r = await saveLeadSources(list!);
    if (r.ok) { setList(r.leadSources); setMsg({ text: "Lead Sources saved." }); } else setMsg({ text: r.error, error: true });
  }
  return (
    <div className="card" data-testid="lead-sources-form">
      <h3 className="section-title">Lead Sources</h3>
      <p className="muted small">Reps must pick one on the Entry Form. Rename an option here, or hide it so reps can no longer pick it (leads that already have it keep it). Website intake leads are set to “Web Lead” automatically.</p>
      <table className="mini-table"><thead><tr><th>#</th><th>Lead Source</th><th>Hidden</th><th></th></tr></thead><tbody>
        {list.map((o, i) => (
          <tr key={i} data-testid="ls-row">
            <td>{i + 1}</td>
            <td><input value={o.label} onChange={e => up(i, { label: e.target.value })} maxLength={60} aria-label={`Lead Source ${i + 1}`} data-testid="ls-label" /></td>
            <td className="c"><input type="checkbox" checked={!!o.hidden} onChange={e => up(i, { hidden: e.target.checked })} aria-label={`Hide ${o.label}`} data-testid="ls-hidden" /></td>
            <td><button type="button" className="link-btn" disabled={i === 0} onClick={() => setList(l => { const n = [...l!]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })} aria-label="Move up">↑</button></td>
          </tr>
        ))}
      </tbody></table>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <input value={add} onChange={e => setAdd(e.target.value)} placeholder="New Lead Source" maxLength={60} data-testid="ls-new" />
        <button type="button" className="btn" disabled={!add.trim()} onClick={() => { setList(l => [...l!, { label: add.trim() }]); setAdd(""); }} data-testid="ls-add">Add</button>
        <button type="button" className="btn btn-primary" onClick={save} data-testid="ls-save">Save</button>
      </div>
      {msg && <p className={`status-msg${msg.error ? " error" : ""}`} data-testid="ls-msg">{msg.text}</p>}
    </div>
  );
}
