"use client";

// Maintenance > Email Center (admin): add, change, preview, turn off, or delete the customer
// email templates reps send from the hover Email Center. Merge fields are filled at send from the
// lead (customer, job #, route, dates) and the ASSIGNED rep (name, title, direct line).
import { useCallback, useEffect, useState } from "react";
import { deleteTemplate, listTemplatesAdmin, previewTemplateDraft, saveTemplate, setTemplateOptions, type TemplateDraft } from "@/app/actions/email-templates";
import { TEMPLATE_ESIGN_OPTIONS, type EmailTemplateRow, type TemplateEsign } from "@/lib/templates/email-templates";
import { MERGE_FIELDS } from "@/lib/templates/merge-fields";
import RichEditor from "@/app/components/RichEditor";

const blank: TemplateDraft = { id: null, name: "", subject: "", body_html: "", is_active: true, sort_order: 100, opens_quote: false, esign: "none" };

export default function EmailCenterForm() {
  const [rows, setRows] = useState<EmailTemplateRow[] | null>(null);
  const [migrated, setMigrated] = useState(true);
  const [editing, setEditing] = useState<TemplateDraft | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const apply = async (ids: string[], patch: { opens_quote?: boolean; esign?: TemplateEsign }, what: string) => {
    if (!ids.length) { setMsg({ text: "Tick one or more templates first (or use the All box).", error: true }); return; }
    setBusy(true); setMsg(null);
    const r = await setTemplateOptions(ids, patch);
    setBusy(false);
    if (r.ok) { setMsg({ text: `${what} on ${r.updated} template${r.updated === 1 ? "" : "s"}.` }); await load(); } else setMsg({ text: r.error, error: true });
  };
  const load = useCallback(async () => {
    const r = await listTemplatesAdmin();
    if (r.ok) { setRows(r.templates); setMigrated(r.migrated); } else setMsg({ text: r.error, error: true });
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="card" data-testid="email-center-form">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <h3 className="section-title" style={{ margin: 0 }}>Email Center templates</h3>
        <button type="button" className="btn btn-primary" onClick={() => { setMsg(null); setEditing({ ...blank, sort_order: ((rows || []).reduce((m, r) => Math.max(m, r.sort_order), 0) + 10) }); }} data-testid="add-template">Add template</button>
      </div>
      <p className="muted small">Active templates show when a rep hovers the customer&#39;s email. Each one uses the branded letter layout: logo, the clickable job number (FB#####), and the assigned rep&#39;s signature. Customer and rep details fill in automatically from the lead. Per template you choose whether the job number links to the <b>quote page</b> (counts as Quote viewed) or the customer order page, and whether a red <b>e-sign link</b> (Order for Service or CC Authorization Form) is added. Use the boxes in the table for one template, or tick several (or All) and use the buttons.</p>
      {!migrated && <p className="status-msg error" role="status">The email_templates table is not in the database yet; showing the built-in letters (read-only until the migration runs).</p>}
      {msg && <p className={`status-msg${msg.error ? " error" : ""}`} role="status">{msg.text}</p>}
      <div className="btn-row" style={{ alignItems: "center", flexWrap: "wrap", gap: 8, margin: "8px 0" }} data-testid="tpl-bulk">
        <span className="muted small">{picked.size ? `${picked.size} selected:` : "Tick templates, then:"}</span>
        <button type="button" className="btn" disabled={busy || !migrated} onClick={() => apply([...picked], { opens_quote: true }, "Job # now links to the quote page")} data-testid="bulk-quote-on">Link job # to quote</button>
        <button type="button" className="btn" disabled={busy || !migrated} onClick={() => apply([...picked], { opens_quote: false }, "Job # now links to the order page")} data-testid="bulk-quote-off">Link job # to order page</button>
        {TEMPLATE_ESIGN_OPTIONS.map(o => (
          <button key={o.value} type="button" className="btn" disabled={busy || !migrated} onClick={() => apply([...picked], { esign: o.value }, o.label)} data-testid={`bulk-esign-${o.value}`}>{o.value === "none" ? "Remove e-sign" : `Add ${o.label}`}</button>
        ))}
      </div>
      <table className="mini-table" data-testid="templates-table">
        <thead><tr>
          <th><input type="checkbox" aria-label="Select all templates" checked={!!rows?.length && picked.size === rows.length} onChange={e => setPicked(e.target.checked ? new Set((rows || []).map(r => r.id)) : new Set())} data-testid="tpl-pick-all" /></th>
          <th>#</th><th>Name</th><th>Subject</th><th title="Where the clickable job number (FB#####) button goes">Job # links to</th><th title="Red e-sign link in the letter">E-sign</th><th>Active</th><th></th>
        </tr></thead>
        <tbody>
          {(rows || []).map(t => (
            <tr key={t.id} style={t.is_active ? undefined : { opacity: 0.55 }} data-testid="template-row">
              <td><input type="checkbox" aria-label={`Select ${t.name}`} checked={picked.has(t.id)} onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n; })} data-testid="tpl-pick" /></td>
              <td>{t.sort_order}</td><td><b>{t.name}</b></td><td>{t.subject}</td>
              <td><label style={{ fontWeight: 600, whiteSpace: "nowrap" }}><input type="checkbox" disabled={busy || !migrated} checked={t.opens_quote} onChange={e => apply([t.id], { opens_quote: e.target.checked }, e.target.checked ? "Job # now links to the quote page" : "Job # now links to the order page")} data-testid="row-quote" /> {t.opens_quote ? "Quote page" : "Order page"}</label></td>
              <td><select value={t.esign} disabled={busy || !migrated} onChange={e => apply([t.id], { esign: e.target.value as TemplateEsign }, TEMPLATE_ESIGN_OPTIONS.find(o => o.value === e.target.value)?.label || "Saved")} data-testid="row-esign">
                {TEMPLATE_ESIGN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select></td>
              <td>{t.is_active ? "Yes" : "No"}</td>
              <td><button type="button" className="btn" onClick={() => { setMsg(null); setEditing({ id: t.id, name: t.name, subject: t.subject, body_html: t.body_html, is_active: t.is_active, sort_order: t.sort_order, opens_quote: t.opens_quote, esign: t.esign }); }} data-testid="edit-template">Edit</button></td>
            </tr>
          ))}
          {rows && !rows.length && <tr><td colSpan={8}>No templates yet.</td></tr>}
        </tbody>
      </table>
      {editing && <TemplateEditor draft={editing} onClose={() => setEditing(null)} onDone={async text => { setEditing(null); setMsg({ text }); await load(); }} />}
    </div>
  );
}

function TemplateEditor({ draft, onClose, onDone }: { draft: TemplateDraft; onClose: () => void; onDone: (text: string) => void }) {
  const [v, setV] = useState(draft);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ html: string; subject: string } | null>(null);
  const saved = !!draft.id && !draft.id.startsWith("seed:");
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit email template">
      <form className="modal modal-wide" data-testid="template-editor" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError("");
        const r = await saveTemplate(v);
        setBusy(false);
        if (r.ok) onDone(`Template “${r.template.name}” saved.`); else setError(r.error);
      }}>
        <h3 className="section-title" style={{ marginTop: 0 }}>{draft.id ? `Edit template — ${draft.name}` : "New template"}</h3>
        <div className="grid-2">
          <label className="field">Name (shown in the Email Center)<input value={v.name} onChange={e => setV({ ...v, name: e.target.value })} required maxLength={120} data-testid="tpl-name" /></label>
          <label className="field">Menu order<input type="number" min={0} max={9999} value={v.sort_order} onChange={e => setV({ ...v, sort_order: Number(e.target.value) })} data-testid="tpl-order" /></label>
        </div>
        <label className="field">Subject (merge fields work here too)<input value={v.subject} onChange={e => setV({ ...v, subject: e.target.value })} required maxLength={200} data-testid="tpl-subject" /></label>
        <p className="muted" style={{ fontSize: 12, margin: "6px 0 2px" }}>Click a field to insert it at the cursor. The job-number button and the rep&#39;s signature are added below the body automatically.</p>
        <RichEditor initialHtml={draft.body_html} onChange={html => setV(x => ({ ...x, body_html: html }))} images full testId="tpl-editor" minHeight={260} mergeFields={MERGE_FIELDS} />
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", margin: "8px 0 12px", fontSize: 13, fontWeight: 600 }}>
          <label><input type="checkbox" checked={v.is_active} onChange={e => setV({ ...v, is_active: e.target.checked })} data-testid="tpl-active" /> Active (shows in the Email Center)</label>
          <label title="On: the job number opens the quote landing page and counts as Quote viewed. Off: it opens the customer order (Carrier Info box)."><input type="checkbox" checked={v.opens_quote} onChange={e => setV({ ...v, opens_quote: e.target.checked })} data-testid="tpl-quote" /> Link job # button to the quote page</label>
          <label title="Adds a red e-sign link above the job number. It opens the same signable document as the E-Sign / CC Form buttons (same deposit rules and Signed alerts).">E-sign link{" "}
            <select value={v.esign || "none"} onChange={e => setV({ ...v, esign: e.target.value as TemplateEsign })} data-testid="tpl-esign">
              {TEMPLATE_ESIGN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>
        {v.esign && v.esign !== "none" && <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>Sending needs Save Charges done{v.esign === "cc" ? " and a recorded deposit" : " (and a recorded deposit once the job is booked)"}, the same as the {v.esign === "cc" ? "CC Form" : "E-Sign"} button.</p>}
        {error && <p className="status-msg error" role="alert">{error}</p>}
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="tpl-save">{busy ? "Saving…" : "Save"}</button>
          <button type="button" className="btn" disabled={busy} data-testid="tpl-preview" onClick={async () => {
            setError(""); const r = await previewTemplateDraft(v); if (r.ok) setPreview(r); else setError(r.error);
          }}>Preview</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {saved && <button type="button" className="btn btn-danger" style={{ marginLeft: "auto" }} disabled={busy} data-testid="tpl-delete" onClick={async () => {
            if (!window.confirm(`Delete “${draft.name}”? Emails already sent keep their copy. To keep it but hide it, uncheck Active instead.`)) return;
            setBusy(true); const r = await deleteTemplate(draft.id!); setBusy(false);
            if (r.ok) onDone("Template deleted."); else setError(r.error);
          }}>Delete</button>}
        </div>
      </form>
      {preview && (
        <div className="modal-backdrop" style={{ zIndex: 90 }} onClick={() => setPreview(null)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()} data-testid="tpl-preview-modal">
            <h3 style={{ margin: "0 0 2px" }}>Preview · {preview.subject}</h3>
            <p className="muted" style={{ margin: "0 0 10px", fontSize: 12 }}>Sample customer (Jane Sample, FB000000) and you as the rep. Not sent.</p>
            <iframe title="Template preview" sandbox="" srcDoc={preview.html} style={{ width: "100%", height: 600, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />
            <div style={{ textAlign: "right", marginTop: 10 }}><button type="button" className="btn" onClick={() => setPreview(null)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
