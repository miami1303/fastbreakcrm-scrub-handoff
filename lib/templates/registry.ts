import { linkJobNumbers } from "./job-link.ts";
// Template registry: every customer document / email goes through renderLayoutBody
// (lib/templates/layout.ts) so it gets the same logo header, Call line, brand colors,
// rep info, red e-sign link and footer. A new template supplies only its title, its
// body rows, and flags. See docs/adding-email-templates.md.
import { bookedSubject, buildCcAuthBody, buildCcAuthText, buildQuoteBody, buildQuoteText, ccSubject, companyOf, paymentSummary, quoteSubject, repInfo, type QuoteInput } from "../quote-template.ts";
import { documentShell, renderLayoutBody } from "./layout.ts";
import { customerMessageTemplates } from "./customer-messages.ts";
import { exampleTemplate } from "./example.ts";
import { applyTracking } from "./tracking.ts";
import { freeTextTemplate } from "./free-text.ts";
import { paymentLinkTemplate } from "./payment-link.ts";
import { carrierConfirmTemplate } from "./carrier-confirm.ts";

export type TemplateFlags = {
  /** Show the red e-sign link(s) (customer signs on the /d/<token> page). */
  esign: boolean;
  /** Booked documents: Total / Customer Payment (green) / Customer Balance (red). */
  showPayment: boolean;
};

export type TemplateDef = {
  key: string;
  title: string;
  /** Title look in the shared layout (default "bar"). */
  titleStyle?: "bar" | "underline" | "none";
  flags: TemplateFlags;
  subject: (input: QuoteInput) => string;
  /** Full inner body. Simple templates use `rows` instead and get the shared layout automatically. */
  body?: (input: QuoteInput) => string;
  /** Body content as <tr> rows inside the shared 640px table (simple templates). */
  rows?: (input: QuoteInput) => string;
  esignText?: string;
  /** Rep signature under the body: default full block; "compact" = one line. */
  signature?: boolean | "compact";
  text?: (input: QuoteInput) => string;
};

// The three customer documents (they already render through the shared layout).
const quote: TemplateDef = {
  key: "e_quote", title: "Auto Transport Job Order", flags: { esign: false, showPayment: true },
  subject: i => quoteSubject(i.est, companyOf(i)), body: buildQuoteBody, text: buildQuoteText,
};
const booked: TemplateDef = {
  key: "booked_esign", title: "Auto Transport Job Order", flags: { esign: true, showPayment: true },
  subject: i => bookedSubject(i.est, companyOf(i)), body: buildQuoteBody, text: buildQuoteText,
};
const cc: TemplateDef = {
  key: "cc_form", title: "Credit Card Authorization Form", flags: { esign: true, showPayment: true },
  subject: i => ccSubject(i.est, companyOf(i)), body: buildCcAuthBody, text: buildCcAuthText,
};

export const TEMPLATES: Record<string, TemplateDef> = {
  [quote.key]: quote,
  [booked.key]: booked,
  [cc.key]: cc,
  [freeTextTemplate.key]: freeTextTemplate,
  [paymentLinkTemplate.key]: paymentLinkTemplate,
  [carrierConfirmTemplate.key]: carrierConfirmTemplate,
  [exampleTemplate.key]: exampleTemplate,
  ...Object.fromEntries(customerMessageTemplates.map(t => [t.key, t])),
};

export function getTemplate(key: string): TemplateDef {
  const t = TEMPLATES[key];
  if (!t) throw new Error(`Unknown template: ${key}`);
  return t;
}

/** Render a registered template. Applies the flags (payment block, e-sign link) for you. */
export function renderTemplate(key: string, raw: QuoteInput): { subject: string; bodyHtml: string; html: string; text: string } {
  return renderTemplateDef(getTemplate(key), raw);
}

/** Render any TemplateDef (registered or built from a Maintenance > Email Center row). */
export function renderTemplateDef(t: TemplateDef, raw: QuoteInput): { subject: string; bodyHtml: string; html: string; text: string } {
  const input: QuoteInput = {
    ...raw,
    // null = no payment recorded yet: Total only (never a "$0.00" Customer Payment).
    paidAmount: t.flags.showPayment ? raw.paidAmount ?? null : null,
    links: { ...(raw.links || {}), esignHref: t.flags.esign ? raw.links?.esignHref ?? null : null },
  };
  const subject = t.subject(input);
  const untracked = t.body
    ? t.body(input)
    : renderLayoutBody({
        title: t.title, titleStyle: t.titleStyle, company: companyOf(input), rep: repInfo(input), assetBaseUrl: input.assetBaseUrl,
        bodyHtml: t.rows ? t.rows(input) : "",
        esign: t.flags.esign ? { href: input.links?.esignHref, bottomText: t.esignText || "Click this link to E-sign" } : null,
        trackingPixelUrl: input.links?.trackingPixelUrl,
        optOutHref: input.links?.optOutHref,
        signature: t.signature,
      });
  // Tracking is applied here for EVERY template (pixel + tracked links), so none can miss it.
  const linked = linkJobNumbers(untracked, input.est.job_number, input.links?.quoteLandingHref || input.links?.jobNumberHref);
  const bodyHtml = applyTracking(linked, input.links);
  return { subject, bodyHtml, html: documentShell(subject, bodyHtml), text: t.text ? t.text(input) : subject };
}

export { paymentSummary };
