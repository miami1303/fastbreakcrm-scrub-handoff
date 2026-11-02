// Maintenance > Email Center: customer letter templates stored in public.email_templates.
// Pure (no database): row shape, merge-field list, seeds, and the TemplateDef built from a row.
// The 8 letters in customer-messages.ts are the seeds and the fallback when the table is empty.
import { isCustomerMessageKind, isQuoteMessageKind } from "../crm-constants.ts";
import { fillMerge } from "../customer-email-views.ts";
import { CUSTOMER_LETTERS, letterBodyToHtml, letterFields, letterHtmlFromBody, letterTextFromBody } from "./customer-messages.ts";
import { sanitizeRichHtml, htmlToText } from "./sanitize.ts";
import type { TemplateDef } from "./registry.ts";

export type EmailTemplateRow = {
  id: string;
  key: string;
  name: string;
  subject: string;
  body_html: string;
  kind: "letter" | "free";
  is_active: boolean;
  sort_order: number;
  /** Job-number button opens the quote landing page ("Quote viewed") instead of the tracked document. */
  opens_quote: boolean;
  /** Red e-sign link in the letter: none, the Auto Transport Order (booked_esign) or the CC Authorization Form (cc_form). */
  esign: TemplateEsign;
};

export type TemplateEsign = "none" | "order" | "cc";
export const TEMPLATE_ESIGN_OPTIONS: { value: TemplateEsign; label: string }[] = [
  { value: "none", label: "No e-sign" },
  { value: "order", label: "E-sign Order for Service" },
  { value: "cc", label: "E-sign CC Authorization Form" },
];
/** crm_emails.kind of the signable document a template's e-sign link opens. */
export function esignKindFor(e: TemplateEsign | null | undefined): "booked_esign" | "cc_form" | null {
  return e === "order" ? "booked_esign" : e === "cc" ? "cc_form" : null;
}
export function cleanEsign(v: unknown): TemplateEsign {
  return v === "order" || v === "cc" ? v : "none";
}

import { MERGE_FIELDS, MERGE_FIELD_KEYS } from "./merge-fields.ts";
export { MERGE_FIELDS, MERGE_FIELD_KEYS };

/** {fields} used in a template that are not known merge fields (shown as a warning in Maintenance). */
export function unknownMergeFields(...parts: string[]): string[] {
  const out = new Set<string>();
  for (const p of parts) for (const m of p.matchAll(/\{([a-z0-9_]+)\}/gi)) if (!MERGE_FIELD_KEYS.includes(m[1]) && m[1] !== "job_link" && m[1] !== "fax") out.add(m[1]);
  return [...out];
}

/** Seed rows (same content as the migration seed). All default to direct link (opens_quote false). Quote kinds stay off because eSign already provides its own landing. Only pickup confirmed is forced to landing in messageLinks. */
export const SEED_TEMPLATES: EmailTemplateRow[] = CUSTOMER_LETTERS.map((l, i) => ({
  id: `seed:${l.key}`, key: l.key, name: l.title, subject: l.subject, body_html: letterBodyToHtml(l.body),
  kind: "letter", is_active: true, sort_order: (i + 1) * 10, opens_quote: false, esign: "none",
}));

/** Active rows in menu order; the code seeds when the table is empty or unreachable. */
export function activeTemplates(rows: EmailTemplateRow[] | null | undefined): EmailTemplateRow[] {
  const list = (rows && rows.length ? rows : SEED_TEMPLATES).filter(r => r.is_active);
  return [...list].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/**
 * crm_emails.kind for a send. Seeded letters keep their own kind (history labels, Quote-viewed
 * tracking). Templates added in Maintenance log as custom_letter / custom_quote.
 */
export function sendKindFor(row: Pick<EmailTemplateRow, "key" | "opens_quote">): string {
  if (isCustomerMessageKind(row.key)) return row.key;
  return row.opens_quote ? "custom_quote" : "custom_letter";
}

/** "My Template!" -> "my_template" (unique key for a new row). */
export function slugKey(name: string): string {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "template";
}

export function cleanTemplateBody(html: string): string {
  return sanitizeRichHtml(html, { images: true });
}

/** TemplateDef for one row: same branded letter layout, job-number button, and rep signature as the seeds. */
export function rowTemplate(row: EmailTemplateRow): TemplateDef {
  const letter = { key: row.key as never, title: row.name, subject: row.subject, body: "" };
  const body = cleanTemplateBody(row.body_html);
  const quote = row.opens_quote;
  return {
    key: sendKindFor(row),
    title: row.name,
    titleStyle: "none",
    flags: { esign: false, showPayment: false },
    signature: "compact",
    subject: input => fillMerge(row.subject, letterFields(input)).replace(/[\r\n]+/g, " ").trim(),
    rows: input => letterHtmlFromBody(letter, body, input, quote),
    text: input => letterTextFromBody(letter, htmlToText(body), input, quote),
  };
}
