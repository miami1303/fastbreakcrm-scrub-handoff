"use client";

// Email Center (hover the customer's email): every customer email template (the customer
// letters, Payment Link, then CC Form, E-Quote / E-Sign and Free Text last) + Previous Emails history,
// the Free Text composer, and read-only snapshots of sent emails.
import { useEffect, useState } from "react";
import type { loadLead } from "@/app/actions/leads";
import { emailSnapshot, previewCustomerMessage, previewFreeText, sendFreeText } from "@/app/actions/email";
import { listActiveTemplates } from "@/app/actions/email-templates";
import { CUSTOMER_MESSAGE_KINDS, CUSTOMER_MESSAGE_LABEL, emailKindLabel, type EmailKind } from "@/lib/crm-constants";
import RichEditor from "@/app/components/RichEditor";
import { carrierTextSetup, textCarrierAssigned } from "@/app/actions/ops";
import { PaymentLinkBox } from "@/app/components/PaymentLinkBox";

const OPTED_OUT = "Customer opted out of email";

type Lead = Extract<Awaited<ReturnType<typeof loadLead>>, { ok: true }>;
type Email = Lead["emails"][number];
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
/** Copies the newest sent quote / e-sign link (that email's own tracked token). No URL shown. */
function CopyLinkButton({ link }: { link: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="ec-opt ec-copy-link" data-testid="copy-customer-link" title="Copies the customer's link from the latest quote / e-sign email (views stay tracked)"
      onClick={async () => { try { await navigator.clipboard.writeText(link); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* clipboard blocked */ } }}>
      {done ? "Copied ✓" : "Copy customer link"}
    </button>
  );
}

export const seqLabel = (n: number | null | undefined) => (n ? String(n).padStart(3, "0") : "—");

export function EmailCenter({ lead, booked = lead.est.status === "booked", onSend, onSendCustomer, onFreeText, onSnapshot, onPaymentLinkSent, filter = "all", onFilter, templatesOnly = false }: {
  lead: Lead; booked?: boolean; onSend: (kind: EmailKind) => void; onSendCustomer: (templateKey: string, name: string) => void;
  onFreeText: () => void; onSnapshot: (m: Email) => void; onPaymentLinkSent?: (message: string, emailed: boolean) => void;
  filter?: "all" | "esign"; onFilter?: (f: "all" | "esign") => void; templatesOnly?: boolean;
}) {
  const optedOut = !!lead.block;
  const [preview, setPreview] = useState<{ key: string; name: string } | null>(null);
  // Active templates from Maintenance > Email Center (code seeds until the list loads / if empty).
  const [templates, setTemplates] = useState(() => CUSTOMER_MESSAGE_KINDS.map(k => ({ id: `seed:${k}`, key: k as string, name: CUSTOMER_MESSAGE_LABEL[k] })));
  useEffect(() => { listActiveTemplates().then(r => { if (r.ok) setTemplates(r.templates); }).catch(() => {}); }, []);
  const rows = filter === "esign" ? lead.emails.filter(m => m.kind === "cc_form" || m.kind === "booked_esign") : lead.emails;
  return (
    <span className={`email-center ${templatesOnly ? "ec-templates" : "ec-wide"}`} data-testid="email-center">
      <span className="ec-title">EMAIL CENTER</span>
      <span className="ec-list" data-testid="ec-templates">
        {templates.map(t => (
          <span className="ec-row" data-testid="ec-template" key={t.key}>
            <button type="button" className="ec-name link-btn" onClick={() => setPreview({ key: t.key, name: t.name })} title="Preview with this customer's details" data-testid={`preview-${t.key}`}>{t.name}</button>
            <span className="ec-opts">
              <button type="button" className="ec-opt" onClick={() => onSendCustomer(t.key, t.name)} disabled={optedOut} title={optedOut ? OPTED_OUT : undefined} data-testid={`send-${t.key}`}>Send</button>
            </span>
          </span>
        ))}
        <span className="ec-row" data-testid="ec-template">
          <span className="ec-name">Payment Link</span>
          <span className="ec-opts">
            <PaymentLinkBox compact estimateId={lead.est.id} totalAmount={lead.quote?.total_amount ?? lead.est.total_amount} depositAmount={lead.quote?.deposit_amount ?? lead.est.deposit_amount}
              payments={lead.payments} stripeOn={lead.autoCharge.stripeConnected} optedOut={optedOut} hasEmail={!!lead.est.customer_email} hasPhone={!!lead.est.customer_phone} onSent={onPaymentLinkSent} />
          </span>
        </span>
        {/* CC form, contract (Auto Transport Order) and Free Text always sit last. */}
        <span className="ec-row" data-testid="ec-template">
          <span className="ec-name">Credit Card Authorization Form</span>
          <span className="ec-opts"><button type="button" className="ec-opt" onClick={() => onSend("cc_form")} disabled={optedOut} title={optedOut ? OPTED_OUT : undefined} data-testid="send-cc_form">Send with E-sign</button></span>
        </span>
        <span className="ec-row" data-testid="ec-template">
          <span className="ec-name">Auto Transport Order for Service</span>
          <span className="ec-opts">
            <button type="button" className="ec-opt" onClick={() => onSend("e_quote")} disabled={optedOut} data-testid="send-e_quote" title={optedOut ? OPTED_OUT : "Total only, no e-sign"}>E-Quote</button>
            <button type="button" className="ec-opt" onClick={() => onSend("booked_esign")} disabled={optedOut} data-testid="send-booked_esign" title={optedOut ? OPTED_OUT : "Deposit + balance, with e-sign (any status)"}>E-Sign</button>
          </span>
        </span>
        <span className="ec-row" data-testid="ec-template">
          <span className="ec-name">Carrier Confirmation</span>
          <span className="ec-opts"><button type="button" className="ec-opt" onClick={() => onSend("carrier_confirm")} disabled={optedOut || !booked} data-testid="send-carrier_confirm"
            title={optedOut ? OPTED_OUT : !booked ? "Book the job first" : "Newest Carrier Info + tracked job-number link (time, date, IP). No e-sign."}>Email</button>
            <CarrierTextButton estimateId={lead.est.id} booked={booked} hasPhone={!!lead.est.customer_phone} hasCarrier={lead.notes.some(n => n.kind === "carrier")} /></span>
        </span>
        <span className="ec-row" data-testid="ec-template">
          <span className="ec-name">Free Text Email</span>
          <span className="ec-opts"><button type="button" className="ec-opt" onClick={onFreeText} disabled={optedOut} title={optedOut ? OPTED_OUT : undefined} data-testid="open-free-text">Compose</button></span>
        </span>
      </span>
      {lead.customerLink && <CopyLinkButton link={lead.customerLink} />}
      {!templatesOnly && <><span className="ec-title" style={{ marginTop: 4 }}>
        PREVIOUS EMAILS{filter === "esign" && <> · E-SIGN ONLY <button type="button" className="link-btn" style={{ fontSize: 10 }} onClick={() => onFilter?.("all")} data-testid="ec-show-all">Show all</button></>}
      </span>
      <PreviousEmails emails={rows} onSnapshot={onSnapshot} testId="ec-history" /></>}
      {preview && <TemplatePreviewModal estimateId={lead.est.id} kind={preview.key} name={preview.name} onClose={() => setPreview(null)} />}
    </span>
  );
}

/** Append-only history (newest first). Same table in the Email Center and the lead page card. */
export function PreviousEmails({ emails, onSnapshot, testId = "previous-emails", optOut = false }: { emails: Email[]; onSnapshot: (m: Email) => void; testId?: string; optOut?: boolean }) {
  if (!emails.length) return <span className="muted" style={{ display: "block", margin: "2px 6px", fontSize: 12 }}>No emails sent yet.</span>;
  return (
    <span className="ec-scroll"><table className="mini-table prev-emails" data-testid={testId}><thead><tr>
      <th>#</th><th>Sent</th><th>Emailed To</th><th>Subject</th><th>Text</th><th>E-sign Details</th><th>Viewed</th>{optOut && <th>Opt-out</th>}
    </tr></thead><tbody>
      {emails.map(m => (
        <tr key={m.id} data-testid="prev-email-row" data-kind={m.kind}>
          <td className="seq">{seqLabel(m.seq)}</td>
          <td style={{ whiteSpace: "nowrap" }}>{fmt(m.created_at)}<br /><b className="rep-under">{(m.sent_by_name || "").toUpperCase()}</b></td>
          <td>{m.sent_to}{m.sent_cc ? <><br /><small className="muted">cc {m.sent_cc}</small></> : null}</td>
          <td>{m.has_snapshot
            ? <button type="button" className="link-btn ec-subject" onClick={() => onSnapshot(m)} title="Preview this email as the customer got it" data-testid="subject-link">{m.subject}</button>
            : <span title="Sent before previews were stored">{m.subject}</span>}<br /><small className="muted">{emailKindLabel(m.kind)}</small></td>
          <td>{m.has_snapshot ? <button type="button" className="link-btn" onClick={() => onSnapshot(m)} data-testid="snapshot-link">Text</button> : <small className="muted">—</small>}</td>
          <td data-testid="esign-details">{m.kind === "cc_form" || m.kind === "booked_esign"
            ? m.signed_at
              ? <span style={{ color: "var(--brand-success)" }}><b>Signed</b> {fmt(m.signed_at)}<br />{m.signer_name}{m.signer_email ? ` · ${m.signer_email}` : ""}{m.signed_ip ? <><br />IP {m.signed_ip}</> : null}</span>
              : <span className="muted">Pending</span>
            : <span className="muted">n/a</span>}</td>
          <td data-testid="viewed-details">
            {m.opened_at ? <div>Email opened {fmt(m.opened_at)}</div> : null}
            {m.quote_viewed_at ? <div>Quote viewed {fmt(m.quote_viewed_at)}</div> : null}
            {!m.opened_at && !m.quote_viewed_at ? <span className="muted">—</span> : null}
          </td>
          {optOut && <td data-testid="email-optout">{m.optout.map((o, i) => <div key={i} style={{ color: o.event === "unsubscribed" ? "#C62828" : "var(--muted)", fontSize: 11 }}>{o.event === "unsubscribed" ? `Opted out · Block ${o.block_id} · ${fmt(o.at)}${o.ip ? ` · ${o.ip}` : ""}` : `Block ${o.block_id} removed by ${o.by || "admin"} · ${fmt(o.at)}`}</div>)}</td>}
        </tr>
      ))}
    </tbody></table></span>
  );
}

/** Preview of a customer letter filled in with this lead's CRM fields. Nothing is sent. */
function TemplatePreviewModal({ estimateId, kind, name, onClose }: { estimateId: string; kind: string; name: string; onClose: () => void }) {
  const [state, setState] = useState<{ html?: string; subject?: string; error?: string }>({});
  useEffect(() => { previewCustomerMessage(estimateId, kind).then(r => setState(r.ok ? { html: r.html, subject: r.subject } : { error: r.error })); }, [estimateId, kind]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()} data-testid="template-preview-modal">
        <h3 style={{ margin: "0 0 2px" }}>Preview · {state.subject || name}</h3>
        <p className="muted" style={{ margin: "0 0 10px", fontSize: 12 }}>Filled in with this job&apos;s details. Not sent.</p>
        {state.error && <p className="error-text">{state.error}</p>}
        {!state.html && !state.error && <p className="muted">Loading…</p>}
        {state.html && <iframe title="Email preview" sandbox="" srcDoc={state.html} data-testid="template-preview-frame" style={{ width: "100%", height: 620, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />}
        <div style={{ textAlign: "right", marginTop: 10 }}><button type="button" className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

export function SnapshotModal({ estimateId, email, onClose }: { estimateId: string; email: Email; onClose: () => void }) {
  const [state, setState] = useState<{ html?: string; error?: string }>({});
  useEffect(() => { emailSnapshot(estimateId, email.id).then(r => setState(r.ok ? { html: r.html } : { error: r.error })); }, [estimateId, email.id]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()} data-testid="snapshot-modal">
        <h3 style={{ margin: "0 0 2px" }}>#{seqLabel(email.seq)} · {email.subject}</h3>
        <p className="muted" style={{ margin: "0 0 10px", fontSize: 12 }}>Exact copy as sent {fmt(email.created_at)} by {email.sent_by_name} to {email.sent_to}. Read-only.</p>
        {state.error && <p className="error-text">{state.error}</p>}
        {state.html && <iframe title="Sent email" sandbox="" srcDoc={state.html} data-testid="snapshot-frame" style={{ width: "100%", height: 620, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />}
        <div style={{ textAlign: "right", marginTop: 10 }}><button type="button" className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

export type FreeTextSent = Extract<Awaited<ReturnType<typeof sendFreeText>>, { ok: true }>;

export function FreeTextComposer({ lead, onClose, onSent, onError }: { lead: Lead; onClose: () => void; onSent: (r: FreeTextSent) => void; onError: (msg: string) => void }) {
  const repName = lead.rep?.name || lead.staff.name;
  const repEmail = lead.rep?.email || lead.company.companyEmail;
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [cc, setCc] = useState(true);
  const [quoteLink, setQuoteLink] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // What the customer will see (logo header, body, rep signature, footer), on demand.
  async function openPreview() {
    const r = await previewFreeText(lead.est.id, { subject, bodyHtml: body, cc, includeQuoteLink: quoteLink });
    if (!r.ok) return onError(r.error);
    setPreview(r.html);
  }

  async function send() {
    setBusy(true);
    const r = await sendFreeText(lead.est.id, { subject, bodyHtml: body, cc, includeQuoteLink: quoteLink });
    setBusy(false);
    if (!r.ok) return onError(r.error);
    onSent(r);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide" data-testid="free-text-composer">
        <div className="ft-head">Free Text</div>
        <table className="ft-meta"><tbody>
          <tr><th>Customer</th><td>{lead.est.customer_name}</td><th>Email To</th><td data-testid="ft-to">{lead.est.customer_email}</td><th>Job #</th><td className="job">{lead.est.job_number}</td></tr>
          <tr><th>Sender</th><td>{repName}</td><th>Email From</th><td data-testid="ft-from">{repEmail}</td><td colSpan={2}><label className="ft-cc"><input type="checkbox" checked={cc} onChange={e => setCc(e.target.checked)} data-testid="ft-cc" /> CC {repEmail}</label></td></tr>
          <tr><th>Subject</th><td colSpan={5}><input value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} className="ft-subject" data-testid="ft-subject" placeholder="Subject" /></td></tr>
        </tbody></table>
        <RichEditor onChange={setBody} images testId="ft-editor" minHeight={240} />
        <label className="ft-cc" style={{ marginTop: 8 }}><input type="checkbox" checked={quoteLink} onChange={e => setQuoteLink(e.target.checked)} data-testid="ft-quote-link" /> Include link to view your quote</label>
        <div className="ft-actions">
          <button type="button" className="btn btn-primary" onClick={send} disabled={busy} data-testid="ft-send">{busy ? "Sending…" : "Send Email"}</button>
          <button type="button" className="btn" onClick={openPreview} data-testid="ft-preview-btn">Preview</button>
          <button type="button" className="btn" onClick={onClose} data-testid="ft-exit">Exit</button>
        </div>
      </div>
      {preview !== null && (
        <div className="modal-backdrop" style={{ zIndex: 90 }} onClick={() => setPreview(null)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()} data-testid="ft-preview-modal">
            <h3 style={{ margin: "0 0 2px" }}>Preview · {subject || "(no subject)"}</h3>
            <p className="muted" style={{ margin: "0 0 10px", fontSize: 12 }}>What {lead.est.customer_name || "the customer"} will see.</p>
            <iframe title="Preview" sandbox="" srcDoc={preview} data-testid="ft-preview" style={{ width: "100%", height: 560, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />
            <div style={{ textAlign: "right", marginTop: 10 }}><button type="button" className="btn" onClick={() => setPreview(null)} data-testid="ft-preview-close">Close preview</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Carrier-assigned text (Owner 2026-10-31): texts the newest Carrier Info + pickup date/time, from Fastbreak CRM. */
function CarrierTextButton({ estimateId, booked, hasPhone, hasCarrier }: { estimateId: string; booked: boolean; hasPhone: boolean; hasCarrier: boolean }) {
  const [sms, setSms] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => { carrierTextSetup().then(r => setSms(r.sms)).catch(() => setSms(false)); }, []);
  const blocked = sms === false ? "Texting is not set up yet (SMS API pending)." : !booked ? "Book the job first" : !hasCarrier ? "Add Carrier Info under Vehicles first" : !hasPhone ? "Add the customer's phone first" : "";
  return (
    <>
      <button type="button" className="ec-opt" disabled={!!blocked || busy || sms === null} title={blocked || "Text the customer the newest Carrier Info + pickup date"} data-testid="text-carrier"
        onClick={async () => { setBusy(true); const r = await textCarrierAssigned(estimateId); setBusy(false); setNote(r.ok ? r.message : r.error); }}>
        {sms === false ? "💬 Text (API pending)" : "💬 Text"}
      </button>
      {note && <small className="muted" data-testid="text-carrier-msg">{note}</small>}
    </>
  );
}
