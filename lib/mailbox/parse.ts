// Pure helpers for the info@ Inbox (no IMAP / DB): tested in tests/info-inbox.test.mjs.

/** IMAP settings: IMAP_* first, else your mail host SMTP mailbox (same info@ user + password). */
export function imapConfig(env: NodeJS.ProcessEnv = process.env) {
  const user = (env.IMAP_USER || env.SMTP_USER || "").trim();
  const pass = env.IMAP_PASS || env.SMTP_PASS || "";
  const smtpHost = (env.SMTP_HOST || "").trim().toLowerCase();
  const host = (env.IMAP_HOST || (/^smtp\./i.test(smtpHost) ? smtpHost.replace(/^smtp\./i, "imap.") : "")).trim();
  const port = Number(env.IMAP_PORT || 993);
  if (!host || !user || !pass) return null;
  return { host, port, secure: port === 993 || env.IMAP_SECURE === "true", auth: { user, pass } };
}

export function snippetOf(text: string | null | undefined, max = 180) {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function replySubject(subject: string | null | undefined) {
  const s = (subject || "").trim();
  return /^re:/i.test(s) ? s : `Re: ${s}`.trim();
}
export function forwardSubject(subject: string | null | undefined) {
  const s = (subject || "").trim();
  return /^(fwd?|fw):/i.test(s) ? s : `Fwd: ${s}`.trim();
}

/** References chain for a reply: original References + original Message-ID (deduped, capped). */
export function replyReferences(refs: string | null | undefined, messageId: string | null | undefined) {
  const ids = `${refs || ""} ${messageId || ""}`.match(/<[^<>\s]+>/g) || [];
  return [...new Set(ids)].slice(-20).join(" ");
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export const escapeHtml = esc;

/** Plain text typed in the CRM -> simple HTML paragraph block. */
export function textToHtml(text: string) {
  return `<div style="font:14px/1.5 Arial,Helvetica,sans-serif;white-space:pre-wrap">${esc(text)}</div>`;
}

export type QuotedSource = { from_name?: string | null; from_address?: string | null; to_text?: string | null; subject?: string | null; sent_at?: string | null; text_body?: string | null };

export function quotedHeader(m: QuotedSource, stamp: string) {
  const who = m.from_name ? `${m.from_name} <${m.from_address || ""}>` : m.from_address || "";
  return { who, line: `On ${stamp}, ${who} wrote:` };
}

/** Reply / forward bodies: the staff text on top, the original below (text + HTML). */
export function composeBody(mode: "reply" | "forward", typed: string, m: QuotedSource, stamp: string) {
  const { who, line } = quotedHeader(m, stamp);
  const orig = (m.text_body || "").trim();
  if (mode === "reply") {
    const quoted = orig.split("\n").map(l => `> ${l}`).join("\n");
    return {
      text: `${typed}\n\n${line}\n${quoted}`,
      html: `${textToHtml(typed)}<br><div style="color:#555">${esc(line)}</div><blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex;color:#555;white-space:pre-wrap">${esc(orig)}</blockquote>`,
    };
  }
  const head = [`---------- Forwarded message ---------`, `From: ${who}`, `Date: ${stamp}`, `Subject: ${m.subject || ""}`, `To: ${m.to_text || ""}`].join("\n");
  return {
    text: `${typed}\n\n${head}\n\n${orig}`,
    html: `${textToHtml(typed)}<br><div style="color:#555;white-space:pre-wrap">${esc(head)}</div><br><div style="white-space:pre-wrap">${esc(orig)}</div>`,
  };
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
/** "a@x.com, b@y.com" -> valid, deduped list (max 10). */
export function parseRecipients(input: string) {
  const list = (input || "").split(/[,;]+/).map(s => (s.match(/<([^<>]+)>/)?.[1] ?? s).trim().toLowerCase()).filter(Boolean);
  const bad = list.filter(e => !EMAIL_RE.test(e));
  return { ok: bad.length === 0 && list.length > 0 && list.length <= 10, emails: [...new Set(list)], bad };
}

/** Our own sends / bounces should never become "new mail" banners. */
export function isOwnAddress(addr: string | null | undefined, own: string) {
  return !!addr && addr.trim().toLowerCase() === own.trim().toLowerCase();
}
