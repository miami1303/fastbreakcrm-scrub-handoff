// Customer letters. The wording is the owner's draft (CRM-email-templates-draft.md)
// and is NOT approved yet. Edit the strings below; {merge_fields} are filled at send.
// "Hi, let's chat!" is not in that file. It was written here so the rep has a
// one-click follow-up after Quote viewed. Nothing in this file sends mail.
//
// Office phone, email, website, and DOT/MC come from Company Settings.
// The rep has no title column; {rep_title} is "Transport Coordinator" until one exists.
// No fax line (Owner 2026-10-31: the old fax was wrong; office calls go to the main number).
// {reservation_link} is the quote landing page. There is no separate booking URL.
import { BRAND } from "../brand.ts";
import { isQuoteMessageKind, type CustomerMessageKind } from "../crm-constants.ts";
import { CARRIER_EMAIL_LINK, OTHER_JOB_LINE, QUOTE_EMAIL_LINK, fillMerge, isPickupConfirm } from "../customer-email-views.ts";
import { companyOf, pickupDateText, repInfo, splitAddress, type QuoteInput } from "../quote-template.ts";
import { websiteHref } from "./company.ts";
import { FONT, escapeHtml } from "./layout.ts";
import type { TemplateDef } from "./registry.ts";

/** Placeholder until crm_reps has a title. Shown in the letter, not stored. */
export const DEFAULT_REP_TITLE = "Transport Coordinator";
/** From the unapproved draft. Not in Company Settings. */
export const DRAFT_FAX = "";

export const CUSTOMER_MESSAGE_SIGNATURE = `Sincerely,
{rep_name}
{rep_title}
{company_name}
Office: {office_phone}
Direct: {rep_direct_line}
{company_email}
{website}
US DOT: {us_dot}  MC: {mc}`;

export type Letter = { key: CustomerMessageKind; title: string; subject: string; body: string };

export const CUSTOMER_LETTERS: Letter[] = [
  {
    key: "request_received",
    title: "Request received",
    subject: "We received your auto transport request",
    body: `Dear {customer_name},

Thank you for your auto transport request with {company_name}! We have received your information, and one of our transport coordinators will contact you shortly with your quote. If you would like to speak with someone right away, call us at {office_phone} or reply to this email.

We look forward to helping you.`,
  },
  {
    key: "company_intro",
    title: "Company intro",
    subject: "Why customers choose {company_name}",
    body: `Dear {customer_name},

At {company_name}, we make shipping your vehicle seamless and stress-free. With access to a vast network of over 40 terminals and hundreds of trusted national carriers, we ensure safe and timely vehicle delivery from start to finish.

Our team of highly experienced auto transport coordinators handles the entire process door-to-door, providing expert guidance every step of the way. With years of industry experience and some of the most competitive rates among reputable carriers, we are committed to delivering exceptional service and value.

Our goal is not just to earn your business today, but to be your trusted auto transport provider for years to come. Contact us today to book your shipment or get answers to any questions you may have.`,
  },
  {
    key: "ready_to_book",
    title: "Ready to book",
    subject: "Your auto transport quote - ready to reserve (Job {job_number})",
    body: `Dear {customer_name},

We appreciate your request for service with {company_name}. Your shipment to {delivery_state} is ready to be scheduled under job number {job_number}.

To lock in your guaranteed price and secure your transport dates, reserve online using the secure link below, or call me directly to book. The deposit shown on your quote reserves your spot, and the remaining balance is due upon delivery of your vehicle.

Reserve Online Now: {reservation_link}

Or call me directly: {rep_direct_line}

Once you make your reservation, you will receive a confirmation email and a receipt for your deposit.

Important: if you have not already, please send your pickup and delivery addresses. If you do not have the full addresses yet, just confirm the zip codes and write "TBD" for now.

We look forward to providing you with a seamless, stress-free transport experience.`,
  },
  {
    key: "flex_pricing",
    title: "FLEX pricing",
    subject: "Save on your auto transport with FLEX pricing",
    body: `Dear {customer_name},

Why pay premium pricing if there is no rush to ship your vehicle?

At {company_name}, we offer exclusive FLEX Pricing, a smart, cost-effective option for customers with flexible pickup dates. If you can provide a pickup window of 1-10 days, or book at least 30 days in advance, we will secure some of the lowest rates in the industry without sacrificing service or reliability.

Price Match Guarantee: already have a quote? We will match or beat any rate from a reputable, licensed carrier. Just send us the written estimate.

Ready to lock in your savings? Reply with your preferred pickup dates or let us know how flexible your schedule is, and we will handle the rest.

Looking forward to assisting you!`,
  },
  {
    key: "honest_followup",
    title: "Honest quote follow-up",
    subject: "A quick note about your auto transport quote",
    body: `Dear {customer_name},

I wanted to take a moment to share something important as you explore your auto transport options. A lot of companies advertise ultra-low rates just to get your business, but what they do not always mention is that those prices often will not get your vehicle picked up. It can lead to unexpected delays or last-minute price increases when a carrier declines the job.

At {company_name}, we like to keep things simple and upfront. We work directly with our trusted network of carriers and give you a clear, honest quote designed to secure your vehicle's pickup and delivery as promised, with no hidden fees, no surprises, and no unnecessary stress.

If you would like help with your transport or just have questions, reach out by phone, text, or reply to this email. We are here to make things easy for you!`,
  },
  {
    key: "booked_scheduled",
    title: "Booked - you're scheduled",
    subject: "You're scheduled! Job {job_number}",
    body: `Dear {customer_name},

Thank you for choosing {company_name} for your transportation needs!

You are now scheduled for pickup from {pickup_city_state_zip} to {delivery_city_state_zip}, with the first available pickup date being {pickup_date}. We will confirm your pickup date and time of arrival within 24 to 48 hours before your confirmed pickup date. Please contact us directly if you have any questions or changes.

Thanks again and welcome aboard!`,
  },
  {
    key: "pickup_confirmed",
    title: "Pickup confirmed",
    subject: "Your pickup is confirmed for {pickup_date} (Job {job_number})",
    body: `Dear {customer_name},

Your vehicle pickup is confirmed for {pickup_date}. Click the job number below to view your carrier contact information.

The driver will call you with an arrival time as they approach. Contact us anytime if you need help.

Thank you for choosing {company_name}.`,
  },
  {
    // Not in the owner's draft. Short follow-up the rep sends after Quote viewed.
    key: "hi_lets_chat",
    title: "Hi, let's chat!",
    subject: "Hi, let's chat! (Job {job_number})",
    body: `Dear {customer_name},

Hi, let's chat. I saw that you looked at your quote for job {job_number}, and I am here if you want to talk it through.

You can call me directly at {rep_direct_line}, or open your quote with the job-number button below. If you are ready to reserve, use this link: {reservation_link}`,
  },
];

/** "street, City, ST ZIP" -> "City, ST ZIP" (the whole line when there is no street). */
export function placeLine(address?: string | null, zip?: string | null): string {
  const [street, rest] = splitAddress(address, zip);
  return rest || street;
}

/** Two-letter state from "City, ST ZIP". */
export function stateCode(address?: string | null, zip?: string | null): string {
  const line = placeLine(address, zip);
  const m = /,\s*([A-Za-z]{2})\b/.exec(line);
  return m ? m[1].toUpperCase() : "";
}

export function letterFields(input: QuoteInput): Record<string, string> {
  const company = companyOf(input);
  const rep = repInfo(input);
  const landing = input.links?.quoteLandingHref || "";
  const doc = input.links?.jobNumberHref || "";
  return {
    customer_name: input.est.customer_name || "",
    job_number: input.est.job_number || "",
    job_link: landing || doc,
    pickup_city_state_zip: placeLine(input.est.pickup_address, input.est.pickup_zip),
    delivery_city_state_zip: placeLine(input.est.delivery_address, input.est.delivery_zip),
    delivery_state: stateCode(input.est.delivery_address, input.est.delivery_zip),
    pickup_date: pickupDateText(input.est),
    reservation_link: landing || doc,
    rep_name: rep.name || "",
    rep_title: (input.rep?.title || "").trim() || DEFAULT_REP_TITLE,
    rep_direct_line: (rep.phone || "").trim() || company.mainPhone,
    office_phone: company.mainPhone,
    company_name: company.quoteCompanyName,
    company_email: company.companyEmail,
    website: websiteHref(company.website),
    us_dot: company.usDot,
    mc: company.iccMc,
    fax: DRAFT_FAX,
  };
}

function linkify(text: string): string {
  return escapeHtml(text)
    .replace(/https?:\/\/[^\s&<]+/g, url => `<a href="${url}">${url}</a>`)
    .replace(/\n/g, "<br>");
}

/** Blank-line paragraphs as tight <p> blocks (8px apart) instead of <br><br> (a full empty line). */
const P = "margin:0 0 8px;";
function paragraphs(text: string): string {
  return text.split(/\n\s*\n/).map(t => t.trim()).filter(Boolean).map(t => `<p style="${P}">${linkify(t)}</p>`).join("");
}

function letterParts(letter: Letter, input: QuoteInput, quoteOverride?: boolean) {
  const fields = letterFields(input);
  const quote = quoteOverride ?? isQuoteMessageKind(letter.key);
  const pickup = isPickupConfirm(letter.key);
  const useLanding = pickup;
  // Every letter's job number is a real link. Pickup confirmed opens the landing page.
  // All others (including quote kinds) open the customer order directly.
  const href = useLanding ? (input.links?.quoteLandingHref || input.links?.jobNumberHref || "") : (input.links?.jobNumberHref || "");
  const jobTemplate = pickup ? CARRIER_EMAIL_LINK : (quote ? QUOTE_EMAIL_LINK : OTHER_JOB_LINE);
  const jobText = fillMerge(jobTemplate, fields);
  const body = fillMerge(letter.body, fields);
  const signature = fillMerge(CUSTOMER_MESSAGE_SIGNATURE, fields);
  return { fields, quote, href, jobText, body, signature };
}

/** A letter whose body is already HTML (Maintenance > Email Center). Merge values are escaped. */
export function letterHtmlFromBody(letter: Letter, bodyHtml: string, input: QuoteInput, quote: boolean): string {
  const { href, jobText, signature, fields } = letterParts(letter, input, quote);
  return letterShell(fillMergeHtml(bodyHtml, fields), href, jobText, signature, input.links?.letterEsign || null);
}

export function letterTextFromBody(letter: Letter, bodyText: string, input: QuoteInput, quote: boolean): string {
  const { href, jobText, signature, fields } = letterParts(letter, input, quote);
  const es = input.links?.letterEsign;
  return [fillMerge(bodyText, fields), ...(es ? [`${es.text}\n${es.href}`] : []), href ? `${jobText}\n${href}` : jobText, signature].join("\n\n");
}

/** Merge into HTML: values are escaped; URL values become links. */
export function fillMergeHtml(html: string, fields: Record<string, string>): string {
  return html.replace(/\{([a-z0-9_]+)\}/gi, (raw, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) return raw;
    const v = String(fields[key] ?? "");
    return /^https?:\/\/\S+$/.test(v) ? `<a href="${escapeHtml(v)}">${escapeHtml(v)}</a>` : escapeHtml(v);
  });
}

/** Red e-sign link (same red as the documents' e-sign link) placed above the job-number button. */
export function letterEsignHtml(es: { href: string; text: string } | null | undefined): string {
  if (!es?.href) return "";
  return `<p style="${P}"><a href="${escapeHtml(es.href)}" data-esign-link="1" style="${FONT}color:${BRAND.red};font-size:15px;font-weight:bold;text-decoration:underline;">${escapeHtml(es.text)}</a></p>`;
}

function letterShell(bodyHtml: string, href: string, jobText: string, signature: string, esign: { href: string; text: string } | null = null): string {
  const job = href
    ? `<a href="${escapeHtml(href)}" data-quote-landing="1" style="${FONT}display:inline-block;background:${BRAND.blue};color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;padding:8px 14px;">${escapeHtml(jobText)}</a>`
    : escapeHtml(jobText);
  return `<tr><td style="${FONT}font-size:13px;line-height:1.4;color:#172033;padding:8px 8px 0 8px;">
    ${bodyHtml}${letterEsignHtml(esign)}<p style="${P}">${job}</p><p style="margin:0;">${linkify(signature)}</p>
  </td></tr>`;
}

/** Plain-text letter body -> the tight <p> HTML the editor stores (seed rows). */
export function letterBodyToHtml(text: string): string {
  return paragraphs(text);
}

function letterHtml(letter: Letter, input: QuoteInput): string {
  const { href, jobText, body, signature } = letterParts(letter, input);
  const job = href
    ? `<a href="${escapeHtml(href)}" data-quote-landing="1" style="${FONT}display:inline-block;background:${BRAND.blue};color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;padding:8px 14px;">${escapeHtml(jobText)}</a>`
    : escapeHtml(jobText);
  return `<tr><td style="${FONT}font-size:13px;line-height:1.4;color:#172033;padding:8px 8px 0 8px;">
    ${paragraphs(body)}<p style="${P}">${job}</p><p style="margin:0;">${linkify(signature)}</p>
  </td></tr>`;
}

function letterText(letter: Letter, input: QuoteInput): string {
  const { href, jobText, body, signature } = letterParts(letter, input);
  return [body, href ? `${jobText}\n${href}` : jobText, signature].join("\n\n");
}

export function customerMessageTemplate(letter: Letter): TemplateDef {
  return {
    key: letter.key,
    title: letter.title,
    titleStyle: "none",
    flags: { esign: false, showPayment: false },
    // The letter carries its own full signature, so the layout's rep line is the one-line version.
    signature: "compact",
    subject: input => fillMerge(letter.subject, letterFields(input)),
    rows: input => letterHtml(letter, input),
    text: input => letterText(letter, input),
  };
}

export const customerMessageTemplates: TemplateDef[] = CUSTOMER_LETTERS.map(customerMessageTemplate);
