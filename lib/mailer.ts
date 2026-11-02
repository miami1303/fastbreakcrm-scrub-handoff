import { randomBytes } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { messageId, unsubscribeHeaders } from "./mail-parts.ts";
import { EMAIL_LOGO_CID, EMAIL_LOGO_FILENAME, EMAIL_LOGO_PNG_BASE64 } from "./email-logo.ts";
import { LOGO_PATH } from "./brand.ts";

/**
 * Inline the logo: every <img src=".../brand/fastbreak-logo.png"> becomes src="cid:..."
 * with the small PNG attached inline (shows even when the mail client blocks remote images).
 * width/alt/style are untouched. The logged html_snapshot keeps the https URL.
 */
export function inlineLogo(html: string) {
  const re = new RegExp(`src="[^"]*${LOGO_PATH.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"`, "g");
  if (!re.test(html)) return { html, attachments: [] as { filename: string; content: Buffer; cid: string; contentType: string; contentDisposition: "inline" }[] };
  return {
    html: html.replace(re, `src="cid:${EMAIL_LOGO_CID}"`),
    attachments: [{ filename: EMAIL_LOGO_FILENAME, content: Buffer.from(EMAIL_LOGO_PNG_BASE64, "base64"), cid: EMAIL_LOGO_CID, contentType: "image/png", contentDisposition: "inline" as const }],
  };
}

/**
 * Real email sending: OFF until configured. Owner (2026-10-23): every CRM email goes out FROM
 * support@fastbreakcrm.test with Reply-To info@, through your mail host:
 *   SMTP_HOST=smtp.example.test  SMTP_PORT=465 (SSL; SMTP_SECURE defaults to true on 465)
 *   SMTP_USER=support@fastbreakcrm.test  SMTP_PASS=<mailbox password>
 *   EMAIL_FROM_ADDRESS / EMAIL_REPLY_TO (optional; both default to info@)  EMAIL_FROM_NAME
 * Resend (RESEND_API_KEY) stays available; EMAIL_TRANSPORT=smtp|resend picks one when both are set.
 * Nothing set -> the CRM keeps the copy + mailto behaviour (the rep's own mail app).
 * NEVER Gmail: a Gmail SMTP host or a Gmail From address is refused (see gmailBlock).
 */
export type MailMode = "smtp" | "resend";
export const DEFAULT_FROM_ADDRESS = "support@fastbreakcrm.test";
export const DEFAULT_FROM_NAME = "Fastbreak CRM";

export function mailMode(env: NodeJS.ProcessEnv = process.env): MailMode | null {
  const smtp = !!env.SMTP_HOST?.trim();
  const resend = !!env.RESEND_API_KEY?.trim();
  const pick = env.EMAIL_TRANSPORT?.trim().toLowerCase();
  if (pick === "resend" && resend) return "resend";
  if (pick === "smtp" && smtp) return "smtp";
  return smtp ? "smtp" : resend ? "resend" : null;
}

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase().trim() || "";
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

/**
 * From = EMAIL_FROM_ADDRESS, else support@fastbreakcrm.test (Company Settings can no
 * longer change the sending address, and "send as rep" is off: Owner wants info@ only).
 * Reply-To = EMAIL_REPLY_TO, else the From address. The rep is still CC'd on customer emails.
 */
export function sender(
  company: { companyEmail?: string | null; emailFromName?: string | null; emailSendAs?: string | null },
  _repEmail?: string | null,
  env: NodeJS.ProcessEnv = process.env,
) {
  const fromEnv = env.EMAIL_FROM_ADDRESS?.trim() || "";
  const address = EMAIL_RE.test(fromEnv) ? fromEnv : DEFAULT_FROM_ADDRESS;
  const name = env.EMAIL_FROM_NAME?.trim() || company.emailFromName?.trim() || DEFAULT_FROM_NAME;
  const rt = env.EMAIL_REPLY_TO?.trim() || "";
  return { address, name, replyTo: EMAIL_RE.test(rt) ? rt : address };
}

/** Refuse Gmail as the sending path (customer email must never come from Gmail). */
export function gmailBlock(fromAddress: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const host = (env.SMTP_HOST || "").trim().toLowerCase();
  if (mailMode(env) === "smtp" && /(^|\.)(gmail|googlemail)\.com$/.test(host)) return "Gmail SMTP is not allowed: send through smtp.example.test as support@fastbreakcrm.test.";
  if (/@(gmail|googlemail)\.com$/i.test(fromAddress.trim())) return "Emails must be sent from support@fastbreakcrm.test, never a Gmail address.";
  return null;
}

export type OutgoingMail = {
  from: { name: string; address: string };
  to: string; cc?: string | null; replyTo?: string | null;
  subject: string; html: string; text: string;
  /** Customer's /u/<token> page: adds List-Unsubscribe + one-click List-Unsubscribe-Post. */
  unsubscribeUrl?: string | null;
  /** Threading for Inbox replies (Message-ID of the message being answered / its chain). */
  inReplyTo?: string | null;
  references?: string | null;
  /** Extra files (Inbox forward keeps the original attachments). SMTP only. */
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
};

/**
 * Asks the customer's mail server NOT to send out-of-office / auto-replies to CRM emails
 * (honored by Exchange / Outlook / Microsoft 365). Gmail's vacation responder already skips
 * mail with List-Unsubscribe. Deliberately NOT "Precedence: bulk" or "Auto-Submitted" (those can
 * push a one-to-one rep email toward Promotions / spam). Plain header: your mail host SMTP passes it through.
 */
export const AUTO_REPLY_HEADERS: Record<string, string> = { "X-Auto-Response-Suppress": "OOF, AutoReply" };

/** Deliverability headers: Message-ID on the sending domain, Date, List-Unsubscribe (+ one-click), auto-reply suppression. */
export function mailHeaders(m: Pick<OutgoingMail, "from" | "unsubscribeUrl">, now = new Date()) {
  return {
    messageId: messageId(m.from.address, randomBytes(12).toString("hex"), now.getTime()),
    date: now,
    headers: { ...AUTO_REPLY_HEADERS, ...(m.unsubscribeUrl ? unsubscribeHeaders(m.unsubscribeUrl) : {}) },
  };
}
export type SendResult = { ok: true; mode: MailMode; id: string } | { ok: false; mode: MailMode; error: string };

/** The exact nodemailer message (html + text = multipart/alternative). Exported for tests. */
export function smtpMessage(m: OutgoingMail, h: ReturnType<typeof mailHeaders>) {
  const cc = clean(m.cc), replyTo = clean(m.replyTo);
  const logo = inlineLogo(m.html);
  return {
    from: { name: clean(m.from.name), address: clean(m.from.address) },
    to: clean(m.to), cc: cc || undefined, replyTo: replyTo || undefined,
    subject: clean(m.subject), html: logo.html, text: m.text, attachments: [...logo.attachments, ...(m.attachments || [])],
    messageId: h.messageId, date: h.date, headers: h.headers,
    ...(clean(m.inReplyTo) ? { inReplyTo: clean(m.inReplyTo) } : {}),
    ...(clean(m.references) ? { references: clean(m.references) } : {}),
  };
}

let transport: Transporter | null = null;
function smtp() {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT || 465); // your mail host SMTP: 465 SSL
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined,
    connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  return transport;
}

const clean = (s: string | null | undefined) => (s || "").replace(/[\r\n]/g, " ").trim();

export async function sendMail(m: OutgoingMail): Promise<SendResult | null> {
  const mode = mailMode();
  if (!mode) return null;
  const to = clean(m.to), cc = clean(m.cc), replyTo = clean(m.replyTo);
  const blocked = gmailBlock(m.from.address);
  if (blocked) return { ok: false, mode, error: blocked };
  const h = mailHeaders(m);
  try {
    if (mode === "smtp") {
      const info = await smtp().sendMail(smtpMessage(m, h));
      return { ok: true, mode, id: String(info.messageId || "") };
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${clean(m.from.name).replace(/[<>"]/g, "")} <${clean(m.from.address)}>`,
        to: [to], ...(cc ? { cc: [cc] } : {}), ...(replyTo ? { reply_to: replyTo } : {}),
        subject: clean(m.subject), html: m.html, text: m.text,
        headers: { "Message-ID": h.messageId, Date: h.date.toUTCString(), ...h.headers,
          ...(clean(m.inReplyTo) ? { "In-Reply-To": clean(m.inReplyTo) } : {}), ...(clean(m.references) ? { References: clean(m.references) } : {}) },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, mode, error: body.message || `Resend error ${res.status}` };
    return { ok: true, mode, id: body.id || "" };
  } catch (e) {
    return { ok: false, mode, error: e instanceof Error ? e.message : "Send failed" };
  }
}
