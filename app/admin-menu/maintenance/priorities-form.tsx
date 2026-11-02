"use client";

// Maintenance > Priorities (admin): the company's own numbers and labels.
// Add, rename, or remove. Saving an empty list is allowed. Removing a label does not
// change a lead that already has that number.
import { useEffect, useState } from "react";
import { getPriorityLabels, savePriorityLabels } from "@/app/actions/settings";
import { PRIORITY_MAX, PRIORITY_MIN, type PriorityLabel } from "@/lib/follow-up-domain";

const NUMBERS = Array.from({ length: PRIORITY_MAX - PRIORITY_MIN + 1 }, (_, i) => PRIORITY_MIN + i);

export default function PrioritiesForm() {
  const [list, setList] = useState<PriorityLabel[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [number, setNumber] = useState(String(PRIORITY_MIN));
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => {
    getPriorityLabels().then(r => {
      if (!r.ok) { setMsg({ text: r.error, error: true }); setList([]); return; }
      setMissing(r.missing);
      setList(r.labels);
      const free = NUMBERS.find(n => !r.labels.some(row => row.number === n));
      if (free) setNumber(String(free));
    });
  }, []);
  if (!list) return <div className="card">{msg ? <p className="status-msg error">{msg.text}</p> : "Loading…"}</div>;
  if (missing) {
    return (
      <div className="card" data-testid="priorities-form">
        <h3 className="section-title">Priorities</h3>
        <p className="status-msg error">Priority labels aren&apos;t in the database yet. Apply migration 20261027120000_priority_labels.sql, then reload this page.</p>
      </div>
    );
  }
  const used = new Set(list.map(r => r.number));
  async function save(next = list!) {
    const r = await savePriorityLabels(next);
    if (r.ok) { setList(r.labels); setMsg({ text: r.labels.length ? "Priorities saved." : "Priorities cleared. New leads stay blank." }); }
    else setMsg({ text: r.error, error: true });
  }
  return (
    <div className="card" data-testid="priorities-form">
      <h3 className="section-title">Priorities</h3>
      <p className="muted small">Each company sets its own priority numbers and labels. A new company starts with none, and a lead stays blank until someone picks one. Rename a label here, or remove it. A lead that already has that number keeps the number.</p>
      {list.length === 0 && <p className="muted" data-testid="priorities-empty">No priorities yet.</p>}
      {list.length > 0 && (
        <table className="mini-table"><thead><tr><th>Number</th><th>Label</th><th></th></tr></thead><tbody>
          {list.map(row => (
            <tr key={row.number} data-testid="pr-row">
              <td>{row.number}</td>
              <td><input value={row.label} maxLength={60} aria-label={`Priority ${row.number} label`} data-testid="pr-label" onChange={e => setList(cur => cur!.map(r => r.number === row.number ? { ...r, label: e.target.value } : r))} /></td>
              <td><button type="button" className="link-btn" data-testid="pr-remove" onClick={() => setList(cur => cur!.filter(r => r.number !== row.number))}>Remove</button></td>
            </tr>
          ))}
        </tbody></table>
      )}
      <div className="btn-row" style={{ marginTop: 10 }}>
          <label>Number{" "}
            <select value={number} onChange={e => setNumber(e.target.value)} aria-label="Priority number" data-testid="pr-number">
              {NUMBERS.map(n => <option key={n} value={n}>{n}{used.has(n) ? " (rename)" : ""}</option>)}
            </select>
          </label>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label" maxLength={60} aria-label="Priority label" data-testid="pr-new-label" />
          <button type="button" className="btn" disabled={!label.trim()} data-testid="pr-add" onClick={() => {
            const n = Number(number);
            if (!NUMBERS.includes(n) || !label.trim()) return;
            const next = used.has(n)
              ? list.map(r => r.number === n ? { ...r, label: label.trim() } : r)
              : [...list, { number: n, label: label.trim() }].sort((a, b) => a.number - b.number);
            setList(next);
            setLabel("");
          }}>{used.has(Number(number)) ? "Rename" : "Add"}</button>
        </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-primary" onClick={() => save()} data-testid="pr-save">Save</button>
      </div>
      {msg && <p className={`status-msg${msg.error ? " error" : ""}`} data-testid="pr-msg">{msg.text}</p>}
    </div>
  );
}
