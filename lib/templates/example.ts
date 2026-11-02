// EXAMPLE template: copy this file to add a new email/document. It only supplies a
// title, body rows and flags; the shared layout adds the logo header, Call line,
// brand colors, footer, and (when flags.esign) the red e-sign link.
import { companyOf, formatMoney, repInfo, type QuoteInput } from "../quote-template.ts";
import { FONT, escapeHtml, paymentBlock } from "./layout.ts";
import type { TemplateDef } from "./registry.ts";

export const exampleTemplate: TemplateDef = {
  key: "example_notice",
  title: "Order Update",
  flags: { esign: false, showPayment: true },
  subject: i => `${companyOf(i).quoteCompanyName} — Order Update ${i.est.job_number || ""}`.trim(),
  rows: (i: QuoteInput) => {
    const rep = repInfo(i);
    const paid = i.paidAmount ?? 0;
    const total = Number(i.quote?.total_amount || 0);
    return `
  <tr><td style="${FONT}font-size:14px;line-height:1.5;padding:14px 8px 0 8px;">
    Hello ${escapeHtml(i.est.customer_name || "")},<br><br>
    This is an update for job <b>${escapeHtml(i.est.job_number || "")}</b>. Your rep is ${escapeHtml(rep.name)} (${escapeHtml(rep.email)}).
  </td></tr>
  <tr><td align="right" style="padding:12px 8px 0 8px;">${paymentBlock(formatMoney(total), formatMoney(paid), formatMoney(total - paid))}</td></tr>`;
  },
  text: i => `Order update for job ${i.est.job_number || ""}`,
};
