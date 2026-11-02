// CARRIER CONFIRMATION EMAIL (Owner 2026-10-31, until the Central Dispatch API): tells the customer
// their carrier is assigned. Like the E-Sign contract, the customer clicks the job number to open the
// job order (/d/<job>/<token>), and that click plus the pixel open are stamped with time, date and IP
// (crm_email_events). No e-signature. Only the NEWEST carrier note goes in the email.
import { BRAND } from "../brand.ts";
import { carrierInfoHtml, companyOf, formatDate, type QuoteInput } from "../quote-template.ts";
import { FONT, escapeHtml } from "./layout.ts";
import type { TemplateDef } from "./registry.ts";

export const carrierConfirmSubject = (i: QuoteInput) =>
  `Carrier confirmed for job ${i.est.job_number || "your job"} — ${companyOf(i).quoteCompanyName}`;

export function carrierConfirmText(i: QuoteInput): string {
  const top = String(i.carrierNotes?.[0]?.body || "").trim();
  return [
    `Dear ${i.est.customer_name || "Customer"},`,
    "",
    `A carrier is confirmed for your vehicle shipment, job ${i.est.job_number || ""}.`,
    ...(top ? ["", "Carrier Info", top] : []),
    ...(i.est.primary_date ? ["", `Pick-up date: ${formatDate(i.est.primary_date)}`] : []),
    "",
    "Open your job number link to view your job order.",
  ].join("\n");
}

export const carrierConfirmTemplate: TemplateDef = {
  key: "carrier_confirm",
  title: "Carrier Confirmation",
  titleStyle: "none",
  flags: { esign: false, showPayment: false },
  signature: "compact",
  subject: carrierConfirmSubject,
  text: carrierConfirmText,
  rows: (raw: QuoteInput) => {
    const i = { ...raw, carrierNotes: (raw.carrierNotes || []).slice(0, 1) };
    const job = escapeHtml(i.est.job_number || "your job");
    const href = i.links?.jobNumberHref || "";
    const jobLink = href ? `<a href="${escapeHtml(href)}" data-job-link="1" style="color:#000080;font-weight:bold;text-decoration:underline;">${job}</a>` : `<b>${job}</b>`;
    return `
  <tr><td data-carrier-confirm-body="1" style="${FONT}font-size:14px;line-height:1.5;color:#172033;padding:12px 8px 4px 8px;">
    <p style="margin:0 0 10px;">Dear ${escapeHtml(i.est.customer_name || "Customer")},</p>
    <p style="margin:0 0 10px;">Good news — a carrier is confirmed for your shipment, job ${jobLink}.</p>
    ${i.est.primary_date ? `<p style="margin:0 0 4px;">Pick-up date: <b>${escapeHtml(formatDate(i.est.primary_date))}</b></p>` : ""}
  </td></tr>${carrierInfoHtml(i)}
  ${href ? `<tr><td style="${FONT}padding:12px 8px 4px 8px;"><a href="${escapeHtml(href)}" data-job-button="1" style="${FONT}display:inline-block;background:${BRAND.blue};color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;padding:9px 16px;">View job ${job}</a></td></tr>` : ""}`;
  },
};
