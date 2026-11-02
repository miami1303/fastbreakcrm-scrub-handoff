// Customer-facing documents for Fastbreak CRM.
//
// Source of truth (provided by Owner, 2026-10-23):
//   - Customer quote  = "Auto Transport Job Order" template (template-A.docx).
//   - CC authorization = "Credit Card Authorization Form" template (template-B.docx).
// All company contact info comes from company_settings (Admin > Maintenance > Company
// Settings) and the lead's rep (Maintenance > Users); none is hard-coded here.
// Rendering goes through the shared layout in lib/templates (see docs/adding-email-templates.md).
//
// Output is email-safe HTML: table layout + inline styles only (no flex/grid/classes),
// with absolute image URLs, so it renders the same in Gmail/Outlook and on the page.

import { nameLines, phoneLines } from "./contact-display.ts";
import { phoneForField } from "./phone-format.ts";
import { qtyOf } from "./pricing.ts";
import { customerVehiclePriceText } from "./vehicle-pricing.ts";
import { customerVehicleBlocks, savedChargeLines, type CustomerVehicleBlock } from "./vehicle-charges.ts";
import { extraChargesFrom } from "./extra-charges.ts";
import { normalizeCardType } from "./card-type.ts";
import { formatCents, toCents } from "./money.ts";
import { DEFAULT_COMPANY, websiteHref, type CompanyInfo } from "./templates/company.ts";
import { FONT, SERIF, documentShell, escapeHtml, esignLinkRow, paymentBlock, renderLayoutBody, repBlock } from "./templates/layout.ts";

export { escapeHtml, esignLinkRow };

export type QuoteEstimate = {
  job_number?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  pickup_address?: string | null;
  pickup_zip?: string | null;
  pickup_contact?: string | null;
  pickup_phone1?: string | null;
  pickup_phone2?: string | null;
  pickup_phone3?: string | null;
  pickup_phone1_label?: string | null;
  pickup_phone2_label?: string | null;
  pickup_phone3_label?: string | null;
  delivery_address?: string | null;
  delivery_zip?: string | null;
  delivery_contact?: string | null;
  delivery_phone1?: string | null;
  delivery_phone2?: string | null;
  delivery_phone3?: string | null;
  delivery_phone1_label?: string | null;
  delivery_phone2_label?: string | null;
  delivery_phone3_label?: string | null;
  primary_date?: string | null;
  backup_date?: string | null;
  /** Carrier pickup time "HH:MM" (CT), set from the time buttons under Carrier Info. */
  pickup_time?: string | null;
  created_at?: string | null;
  /** Printed in the middle of the quote (between addresses and vehicles) when filled. */
  extra_stop_notes?: string | null;
  /** Rich Extra Stop / Notes (already sanitized by lib/templates/sanitize on save and in docInput). */
  extra_stop_html?: string | null;
  /** Shared shipment remarks (plain text), printed as "Remarks" under Vehicles when filled. */
  shipment_remarks?: string | null;
  /** Legacy job-level FLEX (no UI any more; FLEX is per vehicle now). Still honored if set. */
  flex?: boolean | null;
};

/**
 * Vehicle row Remarks cell. FLEX, ASAP, INOP and Enclosed print here (quote, e-sign, customer page, print).
 * One flag: "FLEX" / "ASAP" / "INOP" / "Enclosed", or "<flag> - <remark>". Several: joined with " - "
 * in that order ("FLEX - ASAP - INOP - Enclosed - <remark>"). They are not exclusive.
 * INOP = the vehicle's Run is No; Enclosed = its Enclosed is Yes. A remark with no flag is unchanged.
 */
export function vehicleRemarkTags(flex: boolean | null | undefined, asap?: boolean | null, inop?: boolean | null, enclosed?: boolean | null, expedited?: boolean | null): string[] {
  return [flex ? "FLEX" : "", asap ? "ASAP" : "", inop ? "INOP" : "", enclosed ? "Enclosed" : "", expedited ? "EXPEDITED" : ""].filter(Boolean);
}
export function vehicleRemarkCell(remark: string | null | undefined, flex: boolean | null | undefined, asap?: boolean | null, inop?: boolean | null, enclosed?: boolean | null, expedited?: boolean | null): string {
  const tags = vehicleRemarkTags(flex, asap, inop, enclosed, expedited);
  const r = (remark || "").trim();
  if (!tags.length) return r;
  const head = tags.join(" - ");
  return r ? `${head} - ${r}` : head;
}
/** Same text as vehicleRemarkCell, escaped for HTML, with INOP in red. */
export function vehicleRemarkCellHtml(remark: string | null | undefined, flex: boolean | null | undefined, asap?: boolean | null, inop?: boolean | null, enclosed?: boolean | null, expedited?: boolean | null): string {
  const parts = vehicleRemarkTags(flex, asap, inop, enclosed, expedited).map(t => t === "INOP" ? '<span style="color:#B12E39;font-weight:700;">INOP</span>' : escapeHtml(t));
  const r = (remark || "").trim();
  if (r) parts.push(escapeHtml(r));
  return parts.join(" - ");
}

/**
 * Owner 2026-10-31 (2nd correction): selected toggles print on their OWN line under the vehicle row,
 * each under its column (FLEX / ASAP / EXPEDITED under Year/Make/Model + Type, INOP under Run in red,
 * Enclosed under Enclosed Trailer). The Remarks cell holds ONLY what the rep typed. Enclosed off =
 * open trailer: nothing printed (the column already says No); OPEN is never printed.
 */
type FlagVehicle = { flex?: boolean | null; asap?: boolean | null; is_running?: boolean | null; is_enclosed?: boolean | null; expedited?: boolean | null };
export function vehicleFlagParts(v: FlagVehicle, jobFlex?: boolean | null) {
  return {
    main: [v.flex || jobFlex ? "FLEX" : "", v.asap ? "ASAP" : "", v.expedited ? "EXPEDITED" : ""].filter(Boolean),
    inop: v.is_running === false,
    enclosed: !!v.is_enclosed,
  };
}
export function vehicleFlagLineText(v: FlagVehicle, jobFlex?: boolean | null): string {
  const f = vehicleFlagParts(v, jobFlex);
  return [...f.main, f.inop ? "INOP" : "", f.enclosed ? "Enclosed" : ""].filter(Boolean).join(" · ");
}
export function vehicleFlagLineHtml(v: FlagVehicle, jobFlex?: boolean | null): string {
  const f = vehicleFlagParts(v, jobFlex);
  if (!f.main.length && !f.inop && !f.enclosed) return "";
  const c = `${FONT}font-size:11px;font-weight:bold;letter-spacing:.3px;padding:1px 4px 3px 4px;border-left:1px solid #808080;border-right:1px solid #808080;border-bottom:1px solid #808080;`;
  return `
      <tr data-vehicle-flags="1">
        <td colspan="2" data-flags-main="1" style="${c}color:#26446E;">${f.main.map(escapeHtml).join(" &middot; ")}</td>
        <td data-flags-run="1" style="${c}text-align:center;">${f.inop ? '<span style="color:#B12E39;">INOP</span>' : ""}</td>
        <td data-flags-enclosed="1" style="${c}text-align:center;color:#26446E;">${f.enclosed ? "Enclosed" : ""}</td>
        <td colspan="3" style="${c}"></td>
      </tr>`;
}

export type QuoteVehicle = {
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  vehicle_type?: string | null;
  is_running?: boolean | null;
  is_enclosed?: boolean | null;
  remarks?: string | null;
  color?: string | null;
  qty?: number | string | null;
  /** Legacy per-unit carrier pay (null = not priced). Not the vehicle total. */
  price?: number | string | null;
  /** Per-vehicle deposit / carrier COD / total (migration 20261027010000). Null = not split yet. */
  deposit_amount?: number | string | null;
  cod_amount?: number | string | null;
  total_amount?: number | string | null;
  /** FLEX pricing for this vehicle: "FLEX" in its Remarks cell. */
  flex?: boolean | null;
  /** ASAP: "ASAP" in this vehicle's Remarks cell, same place as FLEX. */
  asap?: boolean | null;
  expedited?: boolean | null;
  /** Per-vehicle Additional charges (migration 20261031190000): [{description, amount, collect}]. */
  extra_charges?: unknown;
  /** Per-vehicle discount: comes off the vehicle price; never printed as a line for the customer. */
  discount_amount?: number | string | null;
};

export type QuotePayment = {
  total_amount?: number | string | null;
  /** Up to 3 optional extra charge lines; only filled ones print. */
  extra_charges?: unknown;
  deposit_amount?: number | string | null;
  cardholder_name?: string | null;
  billing_address?: string | null;
  billing_zip?: string | null;
  card_type?: string | null;
  card_last4?: string | null;
  card_exp?: string | null;
};

export type QuoteRep = { name?: string | null; email?: string | null; phone?: string | null; title?: string | null };

/** Typed e-signature printed on the signature lines of a signed document. */
export type QuoteSignature = { name: string; signedAt: string };

export type QuoteInput = {
  est: QuoteEstimate;
  vehicles: QuoteVehicle[];
  quote: QuotePayment | null;
  /** The lead's rep (made, grabbed, or was assigned the lead). Fills the rep block. */
  rep?: QuoteRep | null;
  /** @deprecated use rep.name */
  repName?: string | null;
  /**
   * Customer payment = sum of all recorded (non-void) payments (Payments tab). Set only for
   * booked documents (booked order / CC form): then Customer Payment and Customer Balance
   * are shown (0 is shown as $0.00). Leave null for an E-Quote, which shows the Total only.
   */
  paidAmount?: number | null;
  /** Counted payments with their vehicle (null = whole job), for Customer Payment per vehicle. */
  paidRows?: { amount: number | string | null; vehicle_index?: number | null }[] | null;
  /** Payment put in but not charged yet (card on file / held / waiting on Stripe). Never part of Customer Payment. */
  pendingAmount?: number | null;
  /** e.g. "Visa ••••9630". */
  pendingLabel?: string | null;
  signature?: QuoteSignature | null;
  /** Links used in emails / the customer page. */
  /** Free Text Email: subject and sanitized HTML body typed by the rep. */
  freeText?: { subject: string; bodyHtml: string } | null;
  /** Payment Link email: the Stripe-hosted payment page and its amount (already formatted). */
  paymentLink?: { url: string; amount: string } | null;
  /**
   * Carrier Info notes (booked jobs), NEWEST first. The newest prints in the Carrier Info box in the
   * middle of the job order; older ones (a carrier cancelled / reassigned) sit behind "See all".
   * Emails pass only the newest (see carrierForEmail).
   */
  carrierNotes?: { body: string; created_at?: string | null }[] | null;
  /** Payment Link email: every way to pay (lib/payment-methods.ts). */
  paymentMethods?: { method: string; via?: "stripe" | "direct"; detail: string | null }[] | null;
  links?: {
    /** Job No. becomes this link (the "reference number" link -> Quote Viewed). */
    jobNumberHref?: string | null;
    /** Red e-sign link at the very bottom of the document. */
    esignHref?: string | null;
    /** Email Center letter with E-sign turned on: red link to the separate e-sign document (/d/<job>/<token>#esign). */
    letterEsign?: { href: string; text: string } | null;
    /** Open-tracking pixel (Email Viewed). */
    trackingPixelUrl?: string | null;
    /** Click tracking: every other http(s) link goes through <clickBase>?u=<url> (lib/templates/tracking.ts). */
    clickBase?: string | null;
    /** Very small "Unsubscribe" link at the very bottom (/u/<token>). */
    optOutHref?: string | null;
    /**
     * Quote letters only: the job-number link opens /v/<token> (a landing page).
     * The view is counted when the customer presses the button there, not when
     * this link is followed. Left unset, the letter uses jobNumberHref.
     */
    quoteLandingHref?: string | null;
  } | null;
  /** Absolute origin used for image URLs, e.g. https://crm.fastbreakcrm.test */
  assetBaseUrl: string;
  /** Lead-only additions to the Terms & Conditions ("Add Notes to Company Policy"). */
  policyNotes?: string[] | null;
  /** Company contact info from company_settings (Admin > Maintenance > Company Settings), read at render/send time. */
  company?: CompanyInfo | null;
};

/** Company info for a render: the admin-edited settings, or the seed defaults if not supplied. */
export const companyOf = (input: { company?: CompanyInfo | null }): CompanyInfo => input.company || DEFAULT_COMPANY;

/** Not stored per job in the CRM; template A shows "Door to Door". Not contact info. */
export const SERVICE_TYPE = "Door to Door";

export const ESIGN_LINK_TEXT = {
  quote: "Click this link to E-sign your auto transport order for service",
  cc: "Click this link to E-sign your credit card authorization form",
} as const;

export { CARD_TYPE_OPTIONS as CARD_TYPES } from "./card-type.ts";

export const QUOTE_TERMS = [
  "Sample terms for the Fastbreak CRM demo. Replace this text with your own company policy in Maintenance > Company Settings before sending documents to customers.",
  "By signing, the customer agrees to the quoted price, deposit, and balance due shown above, and to the company's own terms provided separately.",
];

const CC_TERMS_PARTS = {
  before: "I understand my \u201CDeposit\u201D is ",
  underlined: "governed by the company's refund policy",
  after: ". Replace this sample text with your own card authorization terms.",
};


/** "2026-11-01" (or ISO timestamp) -> "11/01/2026" without timezone shifting. */
export function formatDate(value?: string | null): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : value;
}

/** Template style: "$725.00". Returns "" for missing values. */
export function formatMoney(value?: number | string | null): string {
  const cents = toCents(value);
  return cents === null ? "" : formatCents(cents);
}

/** "14:30" -> "2:30 PM"; "" when not a time. */
export function formatPickupTime(t?: string | null): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(String(t || "").trim());
  if (!m) return "";
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** One pickup day -> that day; a window (primary + backup) -> the window. Carrier pickup time appended when set. */
export function pickupDateText(est: QuoteEstimate): string {
  const p = formatDate(est.primary_date);
  const b = formatDate(est.backup_date);
  const day = p && b && p !== b ? `Between ${p} to ${b}` : p || b;
  const t = formatPickupTime(est.pickup_time);
  return day && t ? `${day} at ${t}` : day;
}

/**
 * Addresses are stored as one string ("street, City, ST 12345"). The template prints the
 * street on one line and "City, ST ZIP" on the next. Appends the ZIP only if it isn't
 * already in the stored address (the New Estimate form already includes it).
 */
export function splitAddress(address?: string | null, zip?: string | null): [string, string] {
  let full = (address || "").trim();
  const z = (zip || "").trim();
  if (z && !full.includes(z)) full = `${full} ${z}`.trim();
  const idx = full.indexOf(",");
  if (idx === -1) return [full, ""];
  const street = full.slice(0, idx).trim();
  const rest = full.slice(idx + 1).trim();
  // Only one comma ("City, ST 12345") means there is no street part.
  if (!rest.includes(",")) return ["", full];
  return [street, rest];
}

export function vehicleLabel(v: QuoteVehicle): string {
  const label = [v.year, v.make, v.model].map(x => (x ?? "").toString().trim()).filter(Boolean).join(" / ");
  const color = (v.color ?? "").toString().trim();
  return color ? `${label} (${color})` : label;
}

const extraLines = (q?: QuotePayment | null) => extraChargesFrom(q?.extra_charges);

/**
 * Per-vehicle rows for the customer (price cell, Additional charges under it, this vehicle's
 * Customer Payment). One vehicle: the cell is the job Total minus the lines printed under it
 * (legacy job-level extra lines keep today's cell, the job Total).
 */
export function customerBlocks(input: Pick<QuoteInput, "vehicles" | "quote" | "paidAmount" | "paidRows">): CustomerVehicleBlock[] {
  const { vehicles, quote } = input;
  const show = input.paidAmount !== null && input.paidAmount !== undefined;
  return customerVehicleBlocks(vehicles, i => {
    if (vehicles.length <= 1) {
      const total = toCents(quote?.total_amount);
      if (total === null) return null;
      const own = savedChargeLines(vehicles[0]?.extra_charges).reduce((t, l) => t + Math.round(l.amount * 100), 0);
      // The discount was already taken off the job Total, so add it back here; the helper takes it off again.
      return total - own + (toCents(vehicles[0]?.discount_amount) ?? 0);
    }
    const text = customerVehiclePriceText(vehicles, i, quote);
    return text ? toCents(text) : null;
  }, { rows: (input.paidRows || []).map(r => ({ amount: r.amount, vehicle_index: r.vehicle_index ?? null })), show });
}

function yesNo(v?: boolean | null) {
  return v ? "Yes" : "No";
}

function signatureCell(text: string, style: string) {
  return `<td style="${style}vertical-align:bottom;padding:0 0 2px 0;font-family:'Brush Script MT','Segoe Script',cursive;font-size:22px;color:#1F3B8C;">${text}</td>`;
}

function signedDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}


const BOX = "border:3px double #000000;";
const CELL = `${FONT}font-size:12px;font-weight:bold;color:#000000;padding:1px 4px;vertical-align:top;`;
const LINK = "color:#0000FF;text-decoration:underline;";

// ---------------------------------------------------------------------------
// Customer quote: "Auto Transport Job Order" (template A). Shows ONLY the total.
// ---------------------------------------------------------------------------

// Distinct subjects so Gmail doesn't thread the quote and the e-sign order together.
export function quoteSubject(est: QuoteEstimate, company: CompanyInfo = DEFAULT_COMPANY): string {
  return `${company.quoteCompanyName} — Your Auto Transport Quote ${est.job_number || ""}`.trim();
}
export function bookedSubject(est: QuoteEstimate, company: CompanyInfo = DEFAULT_COMPANY): string {
  return `${company.quoteCompanyName} — Please E-Sign Your Auto Transport Order ${est.job_number || ""}`.trim();
}

export function buildQuoteHtml(input: QuoteInput): string {
  return documentShell(quoteSubject(input.est, companyOf(input)), buildQuoteBody(input));
}

export function repInfo(input: QuoteInput): { name: string; email: string; phone: string } {
  return {
    name: input.rep?.name || input.repName || "",
    email: input.rep?.email || companyOf(input).companyEmail,
    phone: input.rep?.phone || "",
  };
}

/** Emails carry only the newest (top) carrier note; the customer page can show all. */
export function carrierForEmail<T extends { carrierNotes?: QuoteInput["carrierNotes"] }>(input: T): T {
  return { ...input, carrierNotes: (input.carrierNotes || []).slice(0, 1) };
}

/** Carrier Info box (same band as Extra Stop / Notes): newest note, then a native "See all" for older ones. */
export function carrierInfoHtml(input: Pick<QuoteInput, "carrierNotes">): string {
  const notes = (input.carrierNotes || []).map(n => ({ body: String(n.body || "").trim(), at: n.created_at || null })).filter(n => n.body);
  if (!notes.length) return "";
  const cell = `${FONT}font-size:12px;padding:4px 6px;line-height:1.4;white-space:pre-wrap;word-break:break-word;`;
  const older = notes.slice(1);
  return `<tr><td style="padding:6px 8px 0 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${BOX}" data-carrier-info="1">
      <tr><td style="${FONT}font-size:13px;font-weight:bold;background:#E5E5E5;padding:4px;border-bottom:1px solid #000000;">Carrier Info</td></tr>
      <tr><td data-carrier-latest="1" style="${cell}">${escapeHtml(notes[0].body)}</td></tr>${older.length ? `
      <tr><td style="${FONT}font-size:11.5px;padding:0 6px 4px 6px;"><details data-carrier-all="1"><summary style="cursor:pointer;color:#000080;text-decoration:underline;">See all carrier notes (${notes.length})</summary>
        ${older.map(n => `<div data-carrier-older="1" style="${cell}border-top:1px solid #C0C0C0;color:#555555;">${n.at ? `<b>${escapeHtml(formatDate(n.at))}:</b> ` : ""}${escapeHtml(n.body)}</div>`).join("")}
      </details></td></tr>` : ""}
    </table>
  </td></tr>`;
}
function carrierInfoText(input: Pick<QuoteInput, "carrierNotes">): string[] {
  const top = String(input.carrierNotes?.[0]?.body || "").trim();
  return top ? ["Carrier Info", top, ""] : [];
}

/** Plain-text version of sanitized rich notes: link NAMES only, never the URL. */
function richText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d|tr)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim();
}

/** "Add Notes to Company Policy" entries, appended to this lead's Terms & Conditions. */
function policyHtml(input: QuoteInput): string {
  const notes = (input.policyNotes || []).map(n => String(n || "").trim()).filter(Boolean);
  return notes.length ? notes.map(n => `<p data-policy-note="1" style="margin:6px 0 0 0;font-weight:bold;">${escapeHtml(n)}</p>`).join("") : "";
}

/** Company Policy text for this document. Booked uses policyBooked; quote uses policyQuote.
 *  Blank falls back to the built-in QUOTE_TERMS so existing documents stay unchanged. */
function companyPolicyText(input: QuoteInput): string[] {
  const c = companyOf(input);
  const booked = input.paidAmount != null;
  const raw = booked ? c.policyBooked : c.policyQuote;
  const text = (raw || "").trim();
  if (text) return text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  return QUOTE_TERMS;
}

export function paymentSummary(input: QuoteInput): { paid: string; balance: string } | null {
  // null/undefined = not a booked document (E-Quote): show the Total only.
  if (input.paidAmount === null || input.paidAmount === undefined) return null;
  const paid = toCents(input.paidAmount) ?? 0;
  const total = toCents(input.quote?.total_amount) ?? 0;
  return { paid: formatCents(paid), balance: formatCents(total - paid) };
}

/** Pending (not charged yet) line + balance after it. null when nothing is pending. */
export function pendingSummary(input: QuoteInput): { pending: string; balanceAfter: string; label: string } | null {
  const pendingC = toCents(input.pendingAmount) ?? 0;
  if (!(pendingC > 0)) return null;
  const paid = toCents(input.paidAmount) ?? 0;
  const total = toCents(input.quote?.total_amount) ?? 0;
  return { pending: formatCents(pendingC), balanceAfter: formatCents(total - paid - pendingC), label: (input.pendingLabel || "").trim() };
}

/** Pickup or delivery phones. Line 3 is included only when that number was filled (phoneLines drops blanks). */
function sidePhones(est: QuoteEstimate, side: "pickup" | "delivery") {
  if (side === "pickup") {
    return [
      { label: est.pickup_phone1_label, number: est.pickup_phone1 || est.customer_phone },
      { label: est.pickup_phone2_label, number: est.pickup_phone2 },
      { label: est.pickup_phone3_label, number: est.pickup_phone3 },
    ];
  }
  return [
    { label: est.delivery_phone1_label, number: est.delivery_phone1 },
    { label: est.delivery_phone2_label, number: est.delivery_phone2 },
    { label: est.delivery_phone3_label, number: est.delivery_phone3 },
  ];
}

/** Inner HTML of the job order (no <html>/<body>), for embedding on the e-sign page. */
export function buildQuoteBody(input: QuoteInput): string {
  const { est, vehicles, quote, signature } = input;
  const rep = repInfo(input);
  const payment = paymentSummary(input);
  const pend = pendingSummary(input);
  const [pickupStreet, pickupCity] = splitAddress(est.pickup_address, est.pickup_zip);
  const [deliveryStreet, deliveryCity] = splitAddress(est.delivery_address, est.delivery_zip);
  const total = formatMoney(quote?.total_amount);
  const namesHtml = (customer?: string | null, contact?: string | null) => {
    const lines = nameLines(customer, contact);
    return lines.length ? lines.map(line => `<b>${escapeHtml(line)}</b>`).join("<br>") + "<br>" : "";
  };
  const phonesHtml = (phones: { label?: string | null; number?: string | null }[]) => {
    const lines = phoneLines(phones);
    return lines.length ? lines.map(line => escapeHtml(line)).join("<br>") + "<br>" : "";
  };

  const jobRow = (label: string, value: string, valueStyle = "") =>
    `<tr><td style="${CELL}width:104px;white-space:nowrap;">${label}</td><td style="${CELL}overflow-wrap:anywhere;word-break:break-word;${valueStyle}">${value}</td></tr>`;

  const th = (label: string, width = "") =>
    `<th style="${FONT}font-size:12px;font-weight:bold;background:#F7F0B9;border:1px solid #808080;padding:2px 4px;text-align:center;${width}">${label}</th>`;
  const td = (value: string, extra = "") =>
    `<td style="${FONT}font-size:12px;font-weight:bold;border:1px solid #808080;padding:2px 4px;${extra}">${value}</td>`;

  const blocks = customerBlocks(input);
  const subRow = (label: string, value: string, color = "") =>
    `<td colspan="6" style="${FONT}font-size:12px;font-weight:bold;text-align:right;padding:2px 4px;border:1px solid #808080;${color}">${label}</td><td style="${FONT}font-size:12px;font-weight:bold;text-align:right;padding:2px 4px;border:1px solid #808080;${color}">${value}</td>`;
  const vehicleRows = vehicles.length
    ? vehicles.map((v, i) => `<tr>
        ${td(escapeHtml(vehicleLabel(v)))}
        ${td(escapeHtml(v.vehicle_type || ""), "text-align:center;")}
        ${td(yesNo(v.is_running), "text-align:center;")}
        ${td(yesNo(v.is_enclosed), "text-align:center;")}
        ${td(escapeHtml((v.remarks || "").trim()))}
        ${td(String(qtyOf(v)), "text-align:center;")}
        ${td(blocks[i]?.priceText ?? "", "text-align:right;")}
      </tr>${vehicleFlagLineHtml(v, est.flex)}${(blocks[i]?.extras || []).map(x => `
      <tr data-vehicle-charge="${i + 1}">${subRow(`${escapeHtml(x.description)}:`, formatCents(x.cents))}</tr>`).join("")}${blocks[i]?.paidC != null ? `
      <tr data-vehicle-paid="${i + 1}">${subRow(`Customer Payment (${escapeHtml(vehicleLabel(v))}):`, formatCents(blocks[i].paidC!), "color:#008000;")}</tr>` : ""}`).join("")
    : `<tr>${td("&nbsp;")}${td("")}${td("")}${td("")}${td("")}${td("")}${td("")}</tr>`;

  const company = companyOf(input);
  const body = `
  <tr><td style="padding:8px 8px 0 8px;">
    ${repBlock(company, `
            ${jobRow("Job No.:", input.links?.jobNumberHref ? `<a href="${escapeHtml(input.links.jobNumberHref)}" style="color:#000080;text-decoration:underline;">${escapeHtml(est.job_number || "")}</a>` : escapeHtml(est.job_number || ""), "color:#000080;font-size:15px;")}
            ${jobRow("Customer Rep:", escapeHtml(rep.name))}
            ${jobRow("Direct:", escapeHtml(rep.phone))}
            ${jobRow("Rep. Email:", `<a href="mailto:${escapeHtml(rep.email)}" style="${LINK}">${escapeHtml(rep.email)}</a>`)}
            ${jobRow("Pick-Up Date:", escapeHtml(pickupDateText(est)))}
            ${jobRow("Type of Service:", SERVICE_TYPE)}
            ${jobRow("Estimate Date:", escapeHtml(formatDate(est.created_at)))}`)}
  </td></tr>
  <tr><td style="padding:8px 8px 0 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${BOX}">
      <tr>
        <td width="50%" style="${FONT}font-size:13px;font-weight:bold;background:#E5E5E5;padding:4px;border-bottom:1px solid #000000;border-right:3px double #000000;">Vehicle Pick-Up From</td>
        <td width="50%" style="${FONT}font-size:13px;font-weight:bold;background:#E5E5E5;padding:4px;border-bottom:1px solid #000000;">Vehicle Shipping To</td>
      </tr>
      <tr>
        <td style="${FONT}font-size:12px;vertical-align:top;padding:3px 4px;border-right:3px double #000000;line-height:1.35;">
          ${namesHtml(est.customer_name, est.pickup_contact)}
          Address:&nbsp;&nbsp;${escapeHtml(pickupStreet)}<br>
          ${escapeHtml(pickupCity)}<br>
          ${phonesHtml(sidePhones(est, "pickup"))}
          Email:&nbsp;&nbsp;${est.customer_email ? `<a href="mailto:${escapeHtml(est.customer_email)}" style="${LINK}font-weight:bold;">${escapeHtml(est.customer_email)}</a>` : ""}
        </td>
        <td style="${FONT}font-size:12px;vertical-align:top;padding:3px 4px;line-height:1.35;">
          ${namesHtml(est.customer_name, est.delivery_contact)}
          Address:&nbsp;&nbsp;${escapeHtml(deliveryStreet)}<br>
          ${escapeHtml(deliveryCity)}<br>
          ${phonesHtml(sidePhones(est, "delivery"))}
        </td>
      </tr>
    </table>
  </td></tr>
  ${est.extra_stop_html || est.extra_stop_notes ? `<tr><td style="padding:6px 8px 0 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${BOX}">
      <tr><td style="${FONT}font-size:13px;font-weight:bold;background:#E5E5E5;padding:4px;border-bottom:1px solid #000000;">Extra Stop / Notes</td></tr>
      ${est.extra_stop_html
        ? `<tr><td data-extra-notes="1" style="${FONT}font-size:11.5px;padding:3px 6px;line-height:1.3;">${est.extra_stop_html}</td></tr>`
        : `<tr><td style="${FONT}font-size:12px;padding:4px 6px;line-height:1.4;white-space:pre-wrap;">${escapeHtml(est.extra_stop_notes)}</td></tr>`}
    </table>
  </td></tr>` : ""}
${carrierInfoHtml(input)}  <tr><td style="padding:8px 8px 0 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${BOX}">
      <tr><td colspan="7" style="${FONT}font-size:13px;font-weight:bold;text-align:center;padding:2px;border-bottom:1px solid #808080;">Vehicles</td></tr>
      <tr>
        ${th("Year / Make / Model")}${th("Type")}${th("Run")}${th("Enclosed<br>Trailer")}${th("Remarks")}${th("Qty")}${th("Total<br>Price")}
      </tr>
      ${vehicleRows}${extraLines(quote).map(x => `
      <tr data-extra-charge="1">
        <td colspan="6" style="${FONT}font-size:12px;font-weight:bold;text-align:right;padding:2px 4px;border:1px solid #808080;">${escapeHtml(x.description)}:</td>
        <td style="${FONT}font-size:12px;font-weight:bold;text-align:right;padding:2px 4px;border:1px solid #808080;">${formatMoney(x.amount)}</td>
      </tr>`).join("")}
      <tr>
        <td colspan="6" style="${FONT}font-size:13px;font-weight:bold;text-align:right;padding:2px 4px;border:1px solid #808080;">Total:</td>
        <td style="${FONT}font-size:13px;font-weight:bold;text-align:right;padding:2px 4px;border:1px solid #808080;">${total}</td>
      </tr>${payment ? `
      <tr>
        <td colspan="6" style="${FONT}font-size:13px;font-weight:bold;text-align:right;padding:2px 4px;border:1px solid #808080;color:#008000;">Customer Payment:</td>
        <td style="${FONT}font-size:13px;font-weight:bold;text-align:right;padding:2px 4px;border:1px solid #808080;color:#008000;">${payment.paid}</td>
      </tr>
      <tr>
        <td colspan="6" style="${FONT}font-size:13px;font-weight:bold;text-align:right;padding:2px 4px;border:1px solid #808080;color:#FF0000;">Customer Balance:</td>
        <td style="${FONT}font-size:13px;font-weight:bold;text-align:right;padding:2px 4px;border:1px solid #808080;color:#FF0000;">${payment.balance}</td>
      </tr>` : ""}${pend ? `
      <tr data-pending="1">
        <td colspan="6" style="${FONT}font-size:13px;font-weight:bold;text-align:right;padding:2px 4px;border:1px solid #808080;color:#b45309;">Payment pending (not charged yet)${pend.label ? ` · ${escapeHtml(pend.label)}` : ""}:</td>
        <td style="${FONT}font-size:13px;font-weight:bold;text-align:right;padding:2px 4px;border:1px solid #808080;color:#b45309;">${pend.pending}</td>
      </tr>
      <tr>
        <td colspan="6" style="${FONT}font-size:13px;font-weight:bold;text-align:right;padding:2px 4px;border:1px solid #808080;color:#FF0000;">Balance after pending payment:</td>
        <td style="${FONT}font-size:13px;font-weight:bold;text-align:right;padding:2px 4px;border:1px solid #808080;color:#FF0000;">${pend.balanceAfter}</td>
      </tr>` : ""}
    </table>
  </td></tr>${est.shipment_remarks?.trim() ? `
  <tr><td style="padding:6px 8px 0 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${BOX}" data-remarks="1">
      <tr><td style="${FONT}font-size:12px;line-height:1.3;padding:3px 6px;white-space:pre-wrap;"><b>Remarks:</b> ${escapeHtml(est.shipment_remarks.trim())}</td></tr>
    </table>
  </td></tr>` : ""}
  <tr><td style="padding:8px 8px 0 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${BOX}">
      <tr><td style="${FONT}font-size:14px;font-weight:bold;text-align:center;padding:4px;border-bottom:1px solid #000000;">Understanding Your Quote</td></tr>
      <tr><td data-terms="1" style="${SERIF}font-size:11px;line-height:1.22;color:#000000;padding:4px 6px;">
        ${companyPolicyText(input).map(p => `<p style="margin:0 0 6px 0;">${escapeHtml(p)}</p>`).join("")}${policyHtml(input)}
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:${signature ? "4px" : "20px"} 8px 2px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
      ${signature ? `<tr>${signatureCell(`<span style="${FONT}font-size:14px;color:#000000;">${escapeHtml(signature.name)}</span>`, "")}<td></td>${signatureCell(escapeHtml(signature.name), "")}<td></td>${signatureCell(`<span style="${FONT}font-size:14px;color:#000000;">${signedDate(signature.signedAt)}</span>`, "")}</tr>` : ""}
      <tr>
        <td width="36%" style="${FONT}font-size:13px;border-top:1px solid #000000;padding-top:3px;">Customer Name</td>
        <td width="4%"></td>
        <td width="38%" style="${FONT}font-size:13px;border-top:1px solid #000000;padding-top:3px;">Customer Signature</td>
        <td width="4%"></td>
        <td width="18%" style="${FONT}font-size:13px;border-top:1px solid #000000;padding-top:3px;">Date</td>
      </tr>
    </table>
  </td></tr>
`;
  return renderLayoutBody({
    title: "Auto Transport Job Order",
    titleStyle: "bar",
    company, rep, assetBaseUrl: input.assetBaseUrl, bodyHtml: body, signature: "compact",
    esign: input.links?.esignHref ? { href: input.links.esignHref, bottomText: ESIGN_LINK_TEXT.quote, topLine: true } : null,
    trackingPixelUrl: input.links?.trackingPixelUrl,
    optOutHref: input.links?.optOutHref,
  });
}

export function buildQuoteText(input: QuoteInput): string {
  const { est, vehicles, quote } = input;
  const company = companyOf(input);
  const rep = repInfo(input);
  const payment = paymentSummary(input);
  const pend = pendingSummary(input);
  const blocks = customerBlocks(input);
  const [ps, pc] = splitAddress(est.pickup_address, est.pickup_zip);
  const [ds, dc] = splitAddress(est.delivery_address, est.delivery_zip);
  const total = formatMoney(quote?.total_amount);
  const lines = [
    "Auto Transport Job Order",
    "",
    company.quoteCompanyName,
    company.address,
    `Call ${company.mainPhone}`,
    `US DOT: ${company.usDot}  ICC MC: ${company.iccMc}`,
    websiteHref(company.website),
    "",
    `Job No.: ${est.job_number || ""}`,
    `Customer Rep: ${rep.name}`,
    `Direct: ${rep.phone}`,
    `Rep. Email: ${rep.email}`,
    `Pick-Up Date: ${pickupDateText(est)}`,
    `Type of Service: ${SERVICE_TYPE}`,
    `Estimate Date: ${formatDate(est.created_at)}`,
    "",
    "Vehicle Pick-Up From",
    ...nameLines(est.customer_name, est.pickup_contact),
    `Address: ${ps}`,
    pc,
    ...phoneLines(sidePhones(est, "pickup")),
    `Email: ${est.customer_email || ""}`,
    "",
    "Vehicle Shipping To",
    ...nameLines(est.customer_name, est.delivery_contact),
    `Address: ${ds}`,
    dc,
    ...phoneLines(sidePhones(est, "delivery")),
    "",
    "Vehicles",
    "Year / Make / Model | Type | Run | Enclosed Trailer | Remarks | Qty | Total Price",
    ...vehicles.flatMap((v, i) => [
      `${vehicleLabel(v)} | ${v.vehicle_type || ""} | ${yesNo(v.is_running)} | ${yesNo(v.is_enclosed)} | ${(v.remarks || "").trim()} | ${qtyOf(v)} | ${blocks[i]?.priceText ?? ""}`,
      ...(vehicleFlagLineText(v, est.flex) ? [`  ${vehicleFlagLineText(v, est.flex)}`] : []),
      ...(blocks[i]?.extras || []).map(x => `  ${x.description}: ${formatCents(x.cents)}`),
      ...(blocks[i]?.paidC != null ? [`  Customer Payment (${vehicleLabel(v)}): ${formatCents(blocks[i].paidC!)}`] : []),
    ]),
    ...extraLines(quote).map(x => `${x.description}: ${formatMoney(x.amount)}`),
    ...(est.extra_stop_html || est.extra_stop_notes ? ["Extra Stop / Notes", est.extra_stop_html ? richText(est.extra_stop_html) : est.extra_stop_notes, ""] : []),
    ...carrierInfoText(input),
    `Total: ${total}`,
    ...(payment ? [`Customer Payment: ${payment.paid}`, `Customer Balance: ${payment.balance}`] : []),
    ...(pend ? [`Payment pending (not charged yet)${pend.label ? ` · ${pend.label}` : ""}: ${pend.pending}`, `Balance after pending payment: ${pend.balanceAfter}`] : []),
    ...(est.shipment_remarks?.trim() ? ["", `Remarks: ${est.shipment_remarks.trim()}`] : []),
    "",
    "Understanding Your Quote",
    ...companyPolicyText(input).flatMap(p => [p, ""]),
    ...(input.policyNotes || []).flatMap(p => [p, ""]),
    "_____________________________  ________________________________  ____________",
    "Customer Name                  Customer Signature                Date",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CC authorization (template B). For a BOOKED job: shows the customer payment
// (deposit) entered in the job's payment section. Only the card's last 4 digits
// are ever stored or shown.
// ---------------------------------------------------------------------------

export function ccSubject(est: QuoteEstimate, company: CompanyInfo = DEFAULT_COMPANY): string {
  return `${company.quoteCompanyName} — Credit Card Authorization Form ${est.job_number || ""}`.trim();
}

export function maskedCard(last4?: string | null): string {
  return last4 ? `XXXX XXXX XXXX ${last4}` : "";
}

export function billingZip(q: QuotePayment | null): string {
  if (!q) return "";
  if (q.billing_zip) return q.billing_zip;
  const m = /(\d{5})(?:-\d{4})?\s*$/.exec(q.billing_address || "");
  return m ? m[1] : "";
}

export function buildCcAuthHtml(input: QuoteInput): string {
  return documentShell(ccSubject(input.est, companyOf(input)), buildCcAuthBody(input));
}

/** CC amount = customer payment (deposit) entered in the payment form; blank until then. */
function ccAmount(input: QuoteInput): string {
  const paid = toCents(input.paidAmount);
  return paid !== null && paid > 0 ? formatCents(paid).replace("$", "") : "";
}

/** Last 4 only, written the way the CC form shows it: xxxx-xxxx-xxxx-1234. */
export function ccLast4Display(last4?: string | null): string {
  return `xxxx-xxxx-xxxx-${last4 || ""}`;
}

/**
 * Inner HTML of the customer CC authorization form.
 * Layout: Owner's preferred reference (centered header, top e-sign line, label: value list).
 * Wording: Owner's template B only. Card number is always masked to the last 4.
 */
export function buildCcAuthBody(input: QuoteInput): string {
  const { est, quote, signature } = input;
  const company = companyOf(input);
  const rep = repInfo(input);
  const amount = ccAmount(input);
  const ccPayment = paymentSummary(input);
  const cardholder = quote?.cardholder_name || "";
  const authName = cardholder || est.customer_name || "";
  const esign = input.links?.esignHref || null;
  const line = (label: string, value: string) =>
    `<tr><td style="${FONT}font-size:13px;line-height:1.5;padding:0;">${label} <strong>${value}</strong></td></tr>`;
  const blank = (value: string, minWidth: number) =>
    value ? `<strong>${value}</strong>` : `<span style="display:inline-block;min-width:${minWidth}px;border-bottom:1px solid #000000;">&nbsp;</span>`;
  const jobNo = est.job_number
    ? (input.links?.jobNumberHref ? `<a href="${escapeHtml(input.links.jobNumberHref)}" style="color:#000000;">${escapeHtml(est.job_number)}</a>` : escapeHtml(est.job_number))
    : "";
  // Card type only when set (rep's choice or the prefix detection); blank -> no label, no value.
  const cardType = normalizeCardType(quote?.card_type);

  const body = `
  <tr><td style="${FONT}font-size:13px;font-weight:bold;padding:0 0 4px;">Credit Card Information</td></tr>
  <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
    ${line("Job #:", jobNo)}
    ${line("Customer Name on the Contract:", escapeHtml(est.customer_name || ""))}
    ${cardType ? line("Card Type:", escapeHtml(cardType)) : ""}
    ${line("Last 4 of the Credit Card:", escapeHtml(ccLast4Display(quote?.card_last4)))}
    ${line("Cardholder Name (as shown on card):", escapeHtml(cardholder))}
    ${line("Billing Address:", escapeHtml(quote?.billing_address || ""))}
    ${line("Cardholder ZIP Code (from credit card billing address):", escapeHtml(billingZip(quote)))}
    ${line("Expiration Date (mm/yy):", escapeHtml(quote?.card_exp || ""))}
    ${line("Phone Number:", escapeHtml(phoneForField(est.customer_phone)))}
    ${line("Amount to be charged:", amount ? `$${escapeHtml(amount)}` : "$0.00")}
  </table></td></tr>
  ${ccPayment ? `<tr><td align="right" style="padding:8px 0 0 0;">${paymentBlock(formatMoney(quote?.total_amount), ccPayment.paid, ccPayment.balance)}</td></tr>` : ""}
  <tr><td style="${FONT}font-size:13px;font-weight:bold;line-height:1.45;padding:14px 0 0 0;">
    I ${blank(escapeHtml(authName), 160)}, authorize <u>${escapeHtml(company.ccCompanyName)}</u> to charge my credit card above for agreed upon reservation of my vehicle transportation in the amount of $&nbsp;${blank(escapeHtml(amount), 60)}
  </td></tr>
  <tr><td data-terms="1" style="${FONT}font-size:12px;line-height:1.45;padding:12px 0 0 0;">
    ${escapeHtml(CC_TERMS_PARTS.before)}<u>${escapeHtml(CC_TERMS_PARTS.underlined)}</u>${escapeHtml(CC_TERMS_PARTS.after)}${policyHtml(input)}
  </td></tr>
  <tr><td style="padding:${signature ? "22px" : "46px"} 0 4px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
      ${signature ? `<tr>${signatureCell(escapeHtml(signature.name), "padding-left:32px;")}<td></td>${signatureCell(`<span style="${SERIF}font-size:15px;color:#000000;padding-left:32px;">${signedDate(signature.signedAt)}</span>`, "")}<td></td></tr>` : ""}
      <tr>
        <td width="36%" style="${FONT}font-size:13px;border-top:1px solid #000000;padding:3px 0 0 32px;">Customer Signature</td>
        <td width="2%"></td>
        <td width="36%" style="${FONT}font-size:13px;border-top:1px solid #000000;padding:3px 0 0 32px;">Date</td>
        <td width="26%"></td>
      </tr>
    </table>
  </td></tr>`;
  return renderLayoutBody({
    title: "Credit Card Authorization Form",
    titleStyle: "underline",
    header: "centered",
    company, rep, assetBaseUrl: input.assetBaseUrl, bodyHtml: body, signature: "compact",
    // Always show both red e-sign lines on the CC form; they link once the form is sent.
    esign: signature ? null : { href: esign, bottomText: ESIGN_LINK_TEXT.cc, topLine: true },
    trackingPixelUrl: input.links?.trackingPixelUrl,
    optOutHref: input.links?.optOutHref,
  });
}

export function buildCcAuthText(input: QuoteInput): string {
  const { est, quote } = input;
  const rep = repInfo(input);
  const cardType = normalizeCardType(quote?.card_type);
  const amount = ccAmount(input);
  const company = companyOf(input);
  return [
    company.ccCompanyName,
    company.address,
    `Call ${company.mainPhone}`,
    `Email: ${rep.email}   ${company.website}`,
    "",
    "PLEASE ELECTRONICALLY SIGN THIS DOCUMENT.",
    input.links?.esignHref || "",
    "",
    "Credit Card Authorization Form",
    "Credit Card Information",
    `Job #: ${est.job_number || ""}`,
    `Customer Name on the Contract: ${est.customer_name || ""}`,
    ...(cardType ? [`Card Type: ${cardType}`] : []),
    `Last 4 of the Credit Card: ${ccLast4Display(quote?.card_last4)}`,
    `Cardholder Name (as shown on card): ${quote?.cardholder_name || ""}`,
    `Billing Address: ${quote?.billing_address || ""}`,
    `Cardholder ZIP Code (from credit card billing address): ${billingZip(quote)}`,
    `Expiration Date (mm/yy): ${quote?.card_exp || ""}`,
    `Phone Number: ${phoneForField(est.customer_phone)}`,
    `Amount to be charged: $${amount || "0.00"}`,
    "",
    `I ${quote?.cardholder_name || est.customer_name || "____________"}, authorize ${company.ccCompanyName} to charge my credit card above for agreed upon reservation of my vehicle transportation in the amount of $ ${amount}`,
    "",
    `${CC_TERMS_PARTS.before}${CC_TERMS_PARTS.underlined}${CC_TERMS_PARTS.after}`,
    ...(input.policyNotes || []),
    "",
    "________________________________   ________________________________",
    "Customer Signature                 Date",
    "",
    `${ESIGN_LINK_TEXT.cc}: ${input.links?.esignHref || ""}`,
  ].join("\n");
}
