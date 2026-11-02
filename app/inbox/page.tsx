"use client";

// INBOX: support@fastbreakcrm.test inside the CRM (your mail host IMAP). Opening a message marks it
// checked (clears the header banner). Reply / Reply all / Forward send From info@; Delete moves it to
// the mailbox Trash. your mail host webmail shows the same mailbox.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import MenuCard from "@/app/components/MenuCard";
import { crmStamp } from "@/lib/crm-time";
import { deleteMessage, listInbox, markAllChecked, openMessage, sendInboxMail, type InboxMessage, type InboxRow } from "@/app/actions/inbox";

type Compose = { mode: "reply" | "replyAll" | "forward"; to: string; cc: string; body: string };
const OWN = "support@fastbreakcrm.test";

function emailsIn(s: string | null | undefined) { return (s || "").match(/[^\s<>,;"]+@[^\s<>,;"]+/g) || []; }

export default function InboxPage() {
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [meta, setMeta] = useState<{ configured: boolean; syncedAt: string | null; syncError: string | null }>({ configured: true, syncedAt: null, syncError: null });
  const [q, setQ] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [msg, setMsg] = useState<InboxMessage | null>(null);
  const [compose, setCompose] = useState<Compose | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async (refresh = false) => {
    if (refresh) setBusy(true);
    const r = await listInbox({ refresh, q, unreadOnly });
    if (refresh) setBusy(false);
    if (!r.ok) { setNote(r.error); setRows([]); return; }
    setRows(r.rows); setMeta({ configured: r.configured, syncedAt: r.syncedAt, syncError: r.syncError });
  }, [q, unreadOnly]);

  useEffect(() => { load(false); const t = setInterval(() => { if (!document.hidden) load(false); }, 60_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { // open ?m=<id> from the banner
    const id = new URLSearchParams(window.location.search).get("m");
    if (id) open(id);
  }, []);

  async function open(id: string) {
    setCompose(null); setNote("");
    const r = await openMessage(id);
    if (!r.ok) { setNote(r.error); return; }
    setMsg(r.message);
    setRows(rs => rs?.map(x => x.id === id ? { ...x, opened_at: r.message.opened_at } : x) || rs);
    window.dispatchEvent(new Event("crm-inbox-changed"));
  }

  function startCompose(mode: Compose["mode"]) {
    if (!msg) return;
    const replyTo = msg.reply_to || msg.from_address || "";
    if (mode === "forward") return setCompose({ mode, to: "", cc: "", body: "" });
    if (mode === "reply") return setCompose({ mode, to: replyTo, cc: "", body: "" });
    const others = [...emailsIn(msg.to_text), ...emailsIn(msg.cc_text)].map(e => e.toLowerCase()).filter(e => e !== OWN && e !== replyTo.toLowerCase());
    setCompose({ mode, to: replyTo, cc: [...new Set(others)].join(", "), body: "" });
  }

  async function send() {
    if (!msg || !compose) return;
    setBusy(true);
    const r = await sendInboxMail(msg.id, compose);
    setBusy(false);
    if (!r.ok) { setNote(r.error); return; }
    setNote(`Sent to ${r.to}.`); setCompose(null); load(false);
  }

  async function del(id: string) {
    if (!confirm("Delete this email? It moves to the mailbox Trash (also in your mail host webmail).")) return;
    setBusy(true);
    const r = await deleteMessage(id);
    setBusy(false);
    if (!r.ok) { setNote(r.error); return; }
    setNote("Deleted (moved to Trash)."); setMsg(null); setRows(rs => rs?.filter(x => x.id !== id) || rs);
    window.dispatchEvent(new Event("crm-inbox-changed"));
  }

  async function checkAll() {
    const r = await markAllChecked();
    if (r.ok) { setNote(`${r.count} marked checked.`); load(false); window.dispatchEvent(new Event("crm-inbox-changed")); }
  }

  const unread = rows?.filter(r => !r.opened_at).length || 0;
  return (
    <MenuCard title="Email Inbox — support@fastbreakcrm.test" wide testId="inbox-page"
      right={<button type="button" className="btn btn-sm" disabled={busy} onClick={() => load(true)} data-testid="inbox-refresh">{busy ? "…" : "Refresh"}</button>}>
      {!meta.configured && <p className="error-text">Email Inbox is not connected: set IMAP (or SMTP) user + password for info@ in Vercel.</p>}
      {meta.syncError && <p className="error-text small" data-testid="inbox-sync-error">Last sync error: {meta.syncError}</p>}
      {note && <p className="muted" data-testid="inbox-note">{note}</p>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <input type="search" placeholder="Search from / subject" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") load(false); }} data-testid="inbox-search" />
        <label className="small"><input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} /> New only</label>
        <span className="muted small">{unread} new · synced {meta.syncedAt ? crmStamp(meta.syncedAt) : "never"}</span>
        {unread > 0 && <button type="button" className="btn btn-sm" onClick={checkAll} data-testid="inbox-check-all">Mark all checked</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: msg ? "minmax(280px, 38%) 1fr" : "1fr", gap: 12 }}>
        <table className="mini-table" data-testid="inbox-table"><thead><tr><th>From</th><th>Subject</th><th>Received</th></tr></thead><tbody>
          {(rows || []).map(r => (
            <tr key={r.id} onClick={() => open(r.id)} style={{ cursor: "pointer", fontWeight: r.opened_at ? 400 : 700, background: msg?.id === r.id ? "#e6eef7" : undefined }} data-testid="inbox-row">
              <td>{!r.opened_at && <span title="New" style={{ color: "var(--brand-red)" }}>● </span>}{r.from_name || r.from_address}{r.job_number && <div className="small muted">Job {r.job_number}</div>}</td>
              <td>{r.subject}{r.has_attachments && " 📎"}{r.replied_at && <span className="small muted"> · replied</span>}<div className="small muted">{r.snippet}</div></td>
              <td className="small">{crmStamp(r.sent_at)}</td>
            </tr>))}
          {rows && rows.length === 0 && <tr><td colSpan={3} className="muted">No email.</td></tr>}
          {!rows && <tr><td colSpan={3} className="muted">Loading…</td></tr>}
        </tbody></table>
        {msg && (
          <section data-testid="inbox-message" style={{ border: "1px solid #c9d6e4", borderRadius: 8, padding: 12, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => startCompose("reply")} data-testid="inbox-reply">Reply</button>
              <button type="button" className="btn btn-sm" onClick={() => startCompose("replyAll")} data-testid="inbox-reply-all">Reply all</button>
              <button type="button" className="btn btn-sm" onClick={() => startCompose("forward")} data-testid="inbox-forward">Forward</button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => del(msg.id)} data-testid="inbox-delete">Delete</button>
              <button type="button" className="btn btn-sm" onClick={() => { setMsg(null); setCompose(null); }}>Close</button>
            </div>
            <h2 style={{ margin: "4px 0" }}>{msg.subject}</h2>
            <div className="small"><b>From:</b> {msg.from_name} &lt;{msg.from_address}&gt;</div>
            <div className="small"><b>To:</b> {msg.to_text}{msg.cc_text && <> · <b>Cc:</b> {msg.cc_text}</>}</div>
            <div className="small muted">{crmStamp(msg.sent_at)}{msg.estimate_id && <> · <Link href={`/estimates/${msg.estimate_id}`} target="_blank" rel="noopener" data-newtab className="job-link">Job {msg.job_number || "lead"}</Link></>}</div>
            {msg.attachments?.length > 0 && <div className="small">📎 {msg.attachments.map(a => a.filename).join(", ")} <span className="muted">(open in webmail to download; Forward includes them)</span></div>}
            {compose && (
              <div style={{ margin: "10px 0", padding: 8, background: "#f4f8fc", borderRadius: 6 }} data-testid="inbox-compose">
                <div className="small"><b>{compose.mode === "forward" ? "Forward" : compose.mode === "replyAll" ? "Reply all" : "Reply"}</b> from info@</div>
                <label className="small">To <input style={{ width: "100%" }} value={compose.to} onChange={e => setCompose({ ...compose, to: e.target.value })} data-testid="inbox-to" /></label>
                <label className="small">Cc <input style={{ width: "100%" }} value={compose.cc} onChange={e => setCompose({ ...compose, cc: e.target.value })} /></label>
                <textarea rows={7} style={{ width: "100%" }} value={compose.body} onChange={e => setCompose({ ...compose, body: e.target.value })} placeholder="Type your message (the original is quoted below it)" data-testid="inbox-body" />
                <button type="button" className="btn btn-sm" disabled={busy} onClick={send} data-testid="inbox-send">{busy ? "Sending…" : "Send"}</button>{" "}
                <button type="button" className="btn btn-sm" onClick={() => setCompose(null)}>Cancel</button>
              </div>
            )}
            {msg.html_body
              ? <iframe title="Email" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={`<base target="_blank">${msg.html_body}`} style={{ width: "100%", height: 520, border: "1px solid #eee", background: "#fff" }} data-testid="inbox-html" />
              : <pre style={{ whiteSpace: "pre-wrap", font: "14px/1.5 Arial,Helvetica,sans-serif" }}>{msg.text_body}</pre>}
          </section>
        )}
      </div>
      <p className="muted small">Same mailbox as your mail host webmail. Opening an email here marks it checked (clears the banner). Delete moves it to Trash.</p>
    </MenuCard>
  );
}
