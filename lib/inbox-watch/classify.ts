// In-CRM inbox watch (Owner 2026-10-31). PURE: no network, no database. Decides what an email means.
// Only Fast Break mail can ever act on the CRM. Unrelated side-business mail payments are ignored
// before anything else runs, so crystal mail can never raise a banner or record a payment.
//
//   classifyEmail(msg) -> { kind: "ignore" | "carrier_payment" | "customer_payment" | "cd_pickup" | "cd_delivered", ... }
//
// TODO(samples): Central Dispatch + Zelle/Stripe wording below is a best guess from common notices.
// Paste real (redacted) samples into tests/inbox-watch.test.mjs and tune the patterns when they arrive.

export type InboxMessage = {
  id: string;
  from: string;         // raw From header, e.g. "Central Dispatch <noreply@centraldispatch.com>"
  to?: string;          // raw To / Delivered-To header(s)
  subject: string;
  body: string;         // plain text (HTML already stripped)
  labels?: string[];    // Gmail label names / ids
};

export type InboxKind = "ignore" | "carrier_payment" | "customer_payment" | "cd_pickup" | "cd_delivered";
export type Classified = {
  kind: InboxKind;
  reason: string;
  jobNumber: string;          // "FB400123" or ""
  amountCents: number | null;
  method: string;             // "Zelle" | "Credit Card" | "Stripe" | "ACH" | ...
  charged: boolean | null;    // true = money actually moved, false = failed/pending, null = unknown
  customerEmail: string;      // payer email if found (never a FB / processor address)
  customerName: string;       // payer name if found
  reference: string;          // processor confirmation (pi_..., Zelle conf #) if found
};

/** Fast Break mailbox(es). Mail must be to/from one of these (or a FB domain) to count. */
export const COMPANY_ADDRESSES = ["support@fastbreakcrm.test"];
export const COMPANY_DOMAINS = ["fastbreakcrm.test"];
/** Words that mark Fast Break (company name on Stripe / Zelle notices). */
const COMPANY_WORDS = /fast\s*break/i;

/** Unrelated side-business mail. Any hit = ignore, no matter what else the mail says. Extend via env INBOX_IGNORE_WORDS. */
export const CRYSTAL_WORDS = ["crystal", "crystals", "gemstone", "gem stone", "quartz", "amethyst"];
export const CRYSTAL_LABELS = ["crystal", "crystals"];

/** Central Dispatch senders. */
export const CD_SENDER_RE = /@(?:[\w-]+\.)*centraldispatch\.com\b|central\s*dispatch/i;

/** Payment processors / bank notice senders we trust for "payment" mail. */
const PAYMENT_SENDER_RE = /@(?:[\w-]+\.)*(stripe\.com|zellepay\.com|chase\.com|bankofamerica\.com|wellsfargo\.com|usbank\.com|paypal\.com|venmo\.com|intuit\.com)\b|zelle/i;
const PAYMENT_WORDS = /\b(payment|paid|received|deposit(?:ed)?|sent you|zelle|charge|succeeded|transfer)\b/i;

const lc = (s: unknown) => String(s ?? "").toLowerCase();
const addrs = (s: string) => (lc(s).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []);

export function extraIgnoreWords(env = (typeof process !== "undefined" ? process.env.INBOX_IGNORE_WORDS : "") || ""): string[] {
  return env.split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
}

/** True when the mail belongs to Unrelated side-business mail (or any configured ignore word / label). */
export function isCrystalMail(m: InboxMessage, extra: string[] = extraIgnoreWords()): boolean {
  const hay = lc(`${m.from}\n${m.to || ""}\n${m.subject}\n${m.body}`);
  if ([...CRYSTAL_WORDS, ...extra].some(w => hay.includes(w))) return true;
  return (m.labels || []).some(l => CRYSTAL_LABELS.includes(lc(l)) || extra.includes(lc(l)));
}

/** Mail that is to/from Fast Break (mailbox, domain, or FB named in the text). */
export function isFastBreakMail(m: InboxMessage): boolean {
  const all = [...addrs(m.from), ...addrs(m.to || "")];
  if (all.some(a => COMPANY_ADDRESSES.includes(a) || COMPANY_DOMAINS.some(d => a.endsWith(`@${d}`)))) return true;
  return COMPANY_WORDS.test(`${m.subject}\n${m.body}`);
}

/** "FB400123", "FB-400123", "Job # 400123", "Load ID: FB 400123" -> "FB400123". "" if none. */
export function extractJobNumber(text: string): string {
  const s = String(text || "");
  const da = /\bFB[\s#:-]*(\d{4,12})\b/i.exec(s);
  if (da) return `FB${da[1]}`;
  const job = /\b(?:job|order|load|shipment)\s*(?:id|no\.?|number|#)?\s*[:#]?\s*(\d{6,12})\b/i.exec(s);
  return job ? `FB${job[1]}` : "";
}

/** First money amount, "$1,234.56" / "USD 100" / "100.00 USD" -> cents. */
export function extractAmountCents(text: string): number | null {
  const s = String(text || "");
  const m = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/.exec(s)
    || /\bUSD\s?(\d+(?:,\d{3})*(?:\.\d{2})?)\b/i.exec(s)
    || /\b(\d+(?:,\d{3})*\.\d{2})\s?USD\b/i.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function detectMethod(m: InboxMessage): string {
  const h = lc(`${m.from} ${m.subject} ${m.body}`);
  if (h.includes("zelle")) return "Zelle";
  if (h.includes("stripe")) return "Credit Card";
  if (/\bach\b|bank transfer/.test(h)) return "ACH";
  if (h.includes("paypal")) return "PayPal";
  if (h.includes("venmo")) return "Venmo";
  if (/\bcheck\b/.test(h)) return "Check";
  return "Other";
}

function detectCharged(text: string): boolean | null {
  const h = lc(text);
  if (/\b(failed|declined|unsuccessful|requires action|canceled|cancelled|pending|scheduled)\b/.test(h)) return false;
  if (/\b(succeeded|successful|received|deposited|completed|sent you|you received|was paid|payment of)\b/.test(h)) return true;
  return null;
}

function payer(m: InboxMessage): { email: string; name: string } {
  const text = `${m.subject}\n${m.body}`;
  const email = addrs(text).find(a => !COMPANY_ADDRESSES.includes(a) && !COMPANY_DOMAINS.some(d => a.endsWith(`@${d}`)) && !PAYMENT_SENDER_RE.test(a)) || "";
  const nm = /\b(?:from|customer|payer|sender|billed to|name)\s*[:\-]?\s*([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){1,3})/.exec(text)
    || /\b([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){1,3})\s+sent you\b/.exec(text);
  return { email, name: nm ? nm[1].trim() : "" };
}

function reference(text: string): string {
  const pi = /\b(pi_[A-Za-z0-9]{8,})\b/.exec(text);
  if (pi) return pi[1];
  const conf = /\b(?:confirmation|transaction|reference)\s*(?:id|no\.?|number|#|code)?\s*[:#]?\s*([A-Z0-9]{6,})\b/i.exec(text);
  return conf ? conf[1] : "";
}

/** Carrier payment = says carrier (or MC / DOT number, or the CRM's own "carrier owes" words) in subject/body. */
const CARRIER_RE = /\bcarrier\b|\bMC\s*#?\s*\d{4,}|\bUS\s*DOT\s*#?\s*\d{4,}|\bDOT\s*#\s*\d{4,}|\btrucking\b|\btransport(?:ation)?\s+(?:llc|inc)\b/i;

const PICKUP_RE = /\b(picked\s*up|pick[\s-]*up\s+(?:confirmed|complete[d]?)|has been picked up|marked as picked up|vehicle\(s\)? picked up)\b/i;
const DELIVERED_RE = /\b(delivered|delivery\s+(?:confirmed|complete[d]?)|has been delivered|marked as delivered)\b/i;

const base = (kind: InboxKind, reason: string): Classified => ({ kind, reason, jobNumber: "", amountCents: null, method: "", charged: null, customerEmail: "", customerName: "", reference: "" });

export function classifyEmail(m: InboxMessage, extraIgnore: string[] = extraIgnoreWords()): Classified {
  // 1) Crystal company first: never act on it.
  if (isCrystalMail(m, extraIgnore)) return base("ignore", "crystal company mail");
  const text = `${m.subject}\n${m.body}`;
  const job = extractJobNumber(text);

  // 2) Central Dispatch pickup / delivered.
  if (CD_SENDER_RE.test(m.from)) {
    const subj = m.subject || "";
    // Subject decides first (body of a pickup mail may mention "delivery"), then body.
    const kind: InboxKind | null = PICKUP_RE.test(subj) ? "cd_pickup" : DELIVERED_RE.test(subj) ? "cd_delivered"
      : PICKUP_RE.test(m.body) ? "cd_pickup" : DELIVERED_RE.test(m.body) ? "cd_delivered" : null;
    if (!kind) return base("ignore", "central dispatch mail that is not pickup/delivered");
    return { ...base(kind, "central dispatch"), jobNumber: job };
  }

  // 3) Payments: Fast Break only.
  if (!isFastBreakMail(m)) return base("ignore", "not fast break mail");
  if (!PAYMENT_WORDS.test(text) || !(PAYMENT_SENDER_RE.test(m.from) || /payment/i.test(m.subject))) return base("ignore", "not a payment notice");
  const amountCents = extractAmountCents(text);
  if (!amountCents) return base("ignore", "payment notice without an amount");
  const p = payer(m);
  const out: Classified = {
    ...base(CARRIER_RE.test(text) ? "carrier_payment" : "customer_payment", "fast break payment"),
    jobNumber: job, amountCents, method: detectMethod(m), charged: detectCharged(text),
    customerEmail: p.email, customerName: p.name, reference: reference(text),
  };
  return out;
}

/** Gmail search query used by the poller: FB payment senders + Central Dispatch, never crystal words. */
export function gmailQuery(newerThanDays = 2, extra: string[] = extraIgnoreWords()): string {
  const neg = [...CRYSTAL_WORDS.filter(w => !w.includes(" ")), ...extra.filter(w => !w.includes(" "))].map(w => `-${w}`).join(" ");
  return `newer_than:${newerThanDays}d {from:centraldispatch.com from:stripe.com from:zellepay.com zelle subject:payment} ${neg}`.trim();
}
