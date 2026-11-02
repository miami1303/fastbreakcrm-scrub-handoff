"use client";

import { useEffect, useState } from "react";
import { insertQuickNote } from "@/lib/quick-notes";
import { remarkStamp } from "@/lib/crm-time";
import { NOTE_INPUT_ROWS, latestLimit, showViewAll, type NoteKind } from "@/lib/note-kinds";

export type NoteEntry = { id: string; created_at: string; author_name: string | null; body: string; kind: string };

/**
 * One note section on the lead (old-CRM layout): "Title:" with the Quick Notes link beside it, a
 * big box below, then a bordered table of the latest entries (3; rep/carrier per lib/note-kinds) (date/time + rep | text) and a
 * centered "View all notes" link (only when there is more than one entry) that opens every entry of this lead, newest first.
 * Every entry is its own append-only row. Corrections = a new entry.
 */
export default function NotesSection({ kind, title, hint, notes, quickNotes, onAdd, footer }: {
  kind: string; title: string; hint?: string; notes: NoteEntry[]; quickNotes?: string[];
  onAdd: (body: string) => Promise<boolean>; footer?: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const [qnOpen, setQnOpen] = useState(false);
  const mine = notes.filter(n => n.kind === kind).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const add = async (body: string) => {
    if (!body.trim()) return;
    setBusy(true);
    const ok = await onAdd(body.trim());
    setBusy(false);
    if (ok) setText("");
  };
  useEffect(() => {
    if (!all) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAll(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [all]);
  const goBack = (where: string) => <button type="button" className="link-btn small" onClick={() => setAll(false)} data-testid={`notes-go-back-${where}`}>Go Back</button>;
  return (
    <section className="note-section" data-testid={`notes-${kind}`}>
      <header className="note-head">
        <h3 className="section-title" style={{ margin: 0 }}>{title}:</h3>
        {quickNotes && quickNotes.length > 0 && (
          <span className="qn-wrap">
            <button type="button" className="link-btn small" onClick={() => setQnOpen(o => !o)} aria-expanded={qnOpen} data-testid={`quick-notes-${kind}`}>Quick Notes</button>
            {qnOpen && (
              <span className="qn-menu" role="menu" data-testid={`quick-notes-menu-${kind}`}>
                {quickNotes.map(q => <button key={q} type="button" role="menuitem" onClick={() => { setText(t => insertQuickNote(t, q)); setQnOpen(false); }} data-testid="quick-note-opt">{q}</button>)}
              </span>
            )}
          </span>
        )}
      </header>
      {hint && <p className="muted" style={{ margin: "2px 0 8px", fontSize: 12 }}>{hint}</p>}
      <div className="note-add">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={NOTE_INPUT_ROWS[kind as NoteKind] ?? 2} className={kind === "rep" || kind === "carrier" ? "note-big" : undefined} placeholder="Add an entry…" data-testid={`note-input-${kind}`} />
        <div className="note-add-actions">
          <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => add(text)} data-testid={`add-note-${kind}`}>Add</button>
        </div>
      </div>
      <table className="remarks-table" data-testid={`notes-latest-${kind}`}>
        <tbody className="note-list">
          {mine.slice(0, latestLimit(kind)).map(n => (
            <tr key={n.id}><td className="rm-meta"><span>{remarkStamp(n.created_at)}</span><b>{n.author_name || "—"}</b></td><td className="rm-body">{n.body}</td></tr>
          ))}
          {mine.length === 0 && <tr><td colSpan={2} className="muted" style={{ fontSize: 12 }}>No entries yet.</td></tr>}
        </tbody>
      </table>
      <div className="note-foot">
        {showViewAll(mine.length) && <button type="button" className="link-btn small" onClick={() => setAll(true)} data-testid={`see-all-${kind}`}>View all notes ({mine.length})</button>}
        {footer}
      </div>
      {all && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={() => setAll(false)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()} data-testid={`all-notes-${kind}`}>
            <div className="rm-all-bar">{goBack("top")}<h3 className="section-title" style={{ margin: 0 }}>{title} — all ({mine.length})</h3><span /></div>
            <div className="table-scroll"><table className="remarks-table full">
              <thead><tr><th>Date/Time</th><th>Rep</th><th>Remark</th></tr></thead>
              <tbody>{mine.map(n => <tr key={n.id} data-testid="all-note-row"><td className="nowrap">{remarkStamp(n.created_at)}</td><td>{n.author_name || "—"}</td><td className="rm-body">{n.body}</td></tr>)}</tbody>
            </table></div>
            <div className="rm-all-bar bottom">{goBack("bottom")}</div>
          </div>
        </div>
      )}
    </section>
  );
}
