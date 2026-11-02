// FREE TEXT EMAIL: the rep types a subject and body; it goes out in the shared branded
// layout (logo header + Call line, rep signature, footer, opt-out link, open tracking).
import { FONT } from "./layout.ts";
import { htmlToText, sanitizeRichHtml } from "./sanitize.ts";
import type { QuoteInput } from "../quote-template.ts";
import type { TemplateDef } from "./registry.ts";

/** Free Text body: rich text + https images. */
export const sanitizeEmailHtml = (html: string) => sanitizeRichHtml(html, { images: true });
export { htmlToText };

export const freeTextTemplate: TemplateDef = {
  key: "free_text",
  title: "Free Text",
  titleStyle: "none",
  flags: { esign: false, showPayment: false },
  subject: (i: QuoteInput) => (i.freeText?.subject || "").trim() || `Job ${i.est.job_number || ""}`.trim(),
  rows: (i: QuoteInput) => `
  <tr><td data-free-text-body="1" style="${FONT}font-size:13px;line-height:1.4;color:#172033;padding:8px 8px 2px 8px;">${sanitizeEmailHtml(i.freeText?.bodyHtml || "")}</td></tr>`,
  text: (i: QuoteInput) => htmlToText(sanitizeEmailHtml(i.freeText?.bodyHtml || "")),
};
