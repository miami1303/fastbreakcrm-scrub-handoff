// PAYMENT LINK EMAIL: the Stripe-hosted payment page sent from the Payments tab. Goes out in the
// shared branded layout (logo + Call line, rep signature, footer, opt-out, open/click tracking)
// and is logged in crm_emails (kind 'payment_link') so it shows in the Email Center.
import { BRAND } from "../brand.ts";
import { companyOf, formatMoney, type QuoteInput } from "../quote-template.ts";
import { FONT, escapeHtml, paymentBlock } from "./layout.ts";
import type { TemplateDef } from "./registry.ts";

export const paymentLinkSubject = (i: QuoteInput) =>
  `Payment link for job ${i.est.job_number || "your job"} — ${companyOf(i).quoteCompanyName}`;

/** "Ways to pay": the Stripe methods (all on the one secure link) and Zelle (direct to Fast Break). */
function methods(i: QuoteInput): string {
  const list = i.paymentMethods || [];
  if (!list.length) return "";
  const phone = escapeHtml(companyOf(i).mainPhone);
  const stripe = list.filter(m => m.via !== "direct").map(m => escapeHtml(m.method)).join(" &middot; ");
  const direct = list.filter(m => m.via === "direct");
  const cell = `${FONT}font-size:12px;color:#172033;padding:2px 0;vertical-align:top;`;
  const label = `${FONT}font-size:12px;font-weight:bold;color:#172033;padding:2px 8px 2px 0;white-space:nowrap;vertical-align:top;`;
  const rows = [
    stripe ? `<tr><td style="${label}">Pay online</td><td style="${cell}">${stripe} &mdash; all on the secure Stripe link above</td></tr>` : "",
    ...direct.map(m => `<tr><td style="${label}">${escapeHtml(m.method)}</td><td data-zelle="1" style="${cell}">${m.detail ? escapeHtml(m.detail) : `call ${phone} for details`}. Put job ${escapeHtml(i.est.job_number || "")} in the memo.</td></tr>`),
  ].join("");
  return `
  <tr><td data-payment-methods="1" style="padding:2px 8px 0 8px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #D5DCE3;width:100%;">
      <tr><td style="${FONT}font-size:12px;font-weight:bold;color:#ffffff;background:${BRAND.blue};padding:3px 8px;">Ways to pay</td></tr>
      <tr><td style="padding:4px 8px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${rows}</table></td></tr>
    </table>
  </td></tr>`;
}

/** Same Total / Customer Payment / Customer Balance block as the booked order and CC form (same 8px side margin). */
function summary(i: QuoteInput): string {
  const total = Number(i.quote?.total_amount || 0);
  if (!(total > 0) || i.paidAmount === null || i.paidAmount === undefined) return "";
  const paid = Number(i.paidAmount) || 0;
  return `
  <tr><td data-payment-summary="1" align="right" style="padding:2px 8px 0 8px;">${paymentBlock(formatMoney(total), formatMoney(paid), formatMoney(total - paid))}</td></tr>`;
}

export const paymentLinkTemplate: TemplateDef = {
  key: "payment_link",
  title: "Payment Link",
  titleStyle: "none",
  flags: { esign: false, showPayment: true },
  signature: "compact",
  subject: paymentLinkSubject,
  rows: (i: QuoteInput) => {
    const url = i.paymentLink?.url || "";
    const amount = i.paymentLink?.amount || "";
    const job = escapeHtml(i.est.job_number || "your job");
    return `
  <tr><td data-payment-link-body="1" style="${FONT}font-size:13px;line-height:1.4;color:#172033;padding:8px 8px 2px 8px;">
    <p style="margin:0 0 8px;">Dear ${escapeHtml(i.est.customer_name || "Customer")},</p>
    <p style="margin:0 0 8px;">Here is the secure payment link${amount ? ` for <b>${escapeHtml(amount)}</b>` : ""} for job <b>${job}</b>. Pay online on Stripe's secure page, or by Zelle (see Ways to pay).</p>
    ${url ? `<p style="margin:0 0 8px;"><a href="${escapeHtml(url)}" data-payment-link="1" style="${FONT}display:inline-block;background:${BRAND.red};color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;padding:8px 14px;">Pay${amount ? ` ${escapeHtml(amount)}` : ""} securely</a></p>
    <p style="margin:0 0 4px;font-size:11px;color:#5F6B7A;word-break:break-all;">${escapeHtml(url)}</p>` : ""}
  </td></tr>${methods(i)}${summary(i)}`;
  },
  text: (i: QuoteInput) => {
    const amount = i.paymentLink?.amount ? ` for ${i.paymentLink.amount}` : "";
    return `Dear ${i.est.customer_name || "Customer"},\n\nHere is the secure payment link${amount} for job ${i.est.job_number || "your job"}: ${i.paymentLink?.url || ""}\n\nPay online on Stripe's secure page${i.paymentMethods?.some(m => m.via === "direct") ? `, or Zelle: ${i.paymentMethods.filter(m => m.via === "direct").map(m => m.detail).join("; ")} (memo ${i.est.job_number || ""})` : ""}.`;
  },
};
