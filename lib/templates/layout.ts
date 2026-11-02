// Shared branded layout for every customer document and email (quote, booked quote,
// CC authorization form, and any future template). Email-client safe: tables, inline
// styles, absolute image URLs, no external CSS or scripts.
import { BRAND, LOGO_PATH } from "../brand.ts";
import { websiteHref, websiteLabel, type CompanyInfo } from "./company.ts";

export const FONT = "font-family:Arial,Helvetica,sans-serif;";
export const SERIF = "font-family:'Times New Roman',Times,serif;";

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type LayoutRep = { name: string; email: string; phone: string };

export type LayoutOptions = {
  /** Document title (HTML <title>, and the title bar unless titleStyle is "none"). */
  title: string;
  /** "bar" = blue title bar under the header (quote); "underline" = bold underlined title (CC form); "none" = body renders its own. */
  titleStyle?: "bar" | "underline" | "none";
  /** "split" = logo left / Call line right (default); "centered" = centered logo + company block (CC form). */
  header?: "split" | "centered";
  company: CompanyInfo;
  rep?: LayoutRep | null;
  /** Absolute origin for images, e.g. https://crm.fastbreakcrm.test */
  assetBaseUrl: string;
  bodyHtml: string;
  /** E-sign link(s). Omit to turn e-sign off. */
  esign?: { href?: string | null; bottomText: string; topLine?: boolean } | null;
  trackingPixelUrl?: string | null;
  /** Very small "Opt out / Unsubscribe" link at the very bottom. */
  optOutHref?: string | null;
  footer?: boolean;
  /** Rep signature under the body (default on). */
  signature?: boolean | "compact";
};

const WIDTH = 640;

export function logoUrl(assetBaseUrl: string) {
  return `${assetBaseUrl.replace(/\/$/, "")}${LOGO_PATH}`;
}

/** Logo left, "Call <phone>" right (the approved quote header). */
export function splitHeader(o: LayoutOptions): string {
  return `<tr><td style="padding:0 0 4px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
      <tr>
        <td style="vertical-align:middle;padding:0 0 0 4px;"><img src="${escapeHtml(logoUrl(o.assetBaseUrl))}" width="112" class="fb-logo" alt="${escapeHtml(o.company.quoteCompanyName)}" style="display:block;width:112px;height:auto;border:0;"></td>
        <td class="fb-call" style="vertical-align:middle;text-align:right;padding:0 6px 0 0;${FONT}font-size:22px;font-weight:bold;color:${BRAND.blue};white-space:nowrap;">Call <span style="color:${BRAND.red};">${escapeHtml(o.company.mainPhone)}</span></td>
      </tr>
    </table>
  </td></tr>`;
}

/** Centered logo + legal name + address / Call / email / website (CC form). */
export function centeredHeader(o: LayoutOptions): string {
  const c = o.company;
  const email = o.rep?.email || c.companyEmail;
  return `<tr><td align="center" style="padding:10px 0 6px;">
    <img src="${escapeHtml(logoUrl(o.assetBaseUrl))}" width="160" alt="${escapeHtml(c.quoteCompanyName)}" style="display:block;width:160px;height:auto;border:0;margin:0 auto;">
  </td></tr>
  <tr><td style="${FONT}font-size:17px;font-weight:bold;text-align:center;padding:2px 0;">${escapeHtml(c.ccCompanyName)}</td></tr>
  <tr><td style="${FONT}font-size:12px;line-height:1.45;text-align:center;">
    ${escapeHtml(c.address)}<br>
    Call <b style="color:${BRAND.red};">${escapeHtml(c.mainPhone)}</b>${o.rep?.phone ? ` &nbsp;|&nbsp; Direct: ${escapeHtml(o.rep.phone)}` : ""}<br>
    Email: <a href="mailto:${escapeHtml(email)}" style="color:${BRAND.blue};">${escapeHtml(email)}</a> &nbsp;|&nbsp; <a href="${escapeHtml(websiteHref(c.website))}" style="color:${BRAND.blue};">${escapeHtml(websiteLabel(c.website))}</a>
  </td></tr>`;
}

/** Red e-sign link row (same style for every template). */
export function esignLinkRow(href: string | null | undefined, text: string): string {
  const style = `${FONT}font-size:15px;font-weight:bold;color:${BRAND.red};text-decoration:underline;`;
  return `<tr><td style="padding:5px 8px 2px 8px;text-align:center;">${href
    ? `<a href="${escapeHtml(href)}" data-esign-link="1" style="${style}">${escapeHtml(text)}</a>`
    : `<span style="${style}">${escapeHtml(text)}</span>`}</td></tr>`;
}

/** "PLEASE ELECTRONICALLY SIGN THIS DOCUMENT." with the red link in the middle. */
export function esignTopLine(href?: string | null): string {
  const inner = href
    ? `<a href="${escapeHtml(href)}" data-esign-link="1" style="color:${BRAND.red};text-decoration:underline;">ELECTRONICALLY SIGN</a>`
    : `<span style="color:${BRAND.red};text-decoration:underline;">ELECTRONICALLY SIGN</span>`;
  return `<tr><td style="${FONT}font-size:13px;font-weight:bold;text-align:center;padding:5px 0 5px;">PLEASE ${inner} THIS DOCUMENT.</td></tr>`;
}

/** Right-aligned Total (black) / Customer Payment (green) / Customer Balance (red) block. */
export function paymentBlock(total: string, paid: string, balance: string): string {
  const cell = (v: string, color: string, extra = "") => `<td style="${FONT}font-size:13px;font-weight:bold;text-align:right;padding:2px 8px;color:${color};${extra}">${v}</td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right" style="border-collapse:collapse;">
      <tr>${cell("Total:", "#000000")}${cell(total, "#000000", "min-width:90px;")}</tr>
      <tr>${cell("Customer Payment:", "#008000")}${cell(paid, "#008000")}</tr>
      <tr>${cell("Customer Balance:", "#FF0000")}${cell(balance, "#FF0000")}</tr>
    </table>`;
}

/** Company + rep block (left: company, right: rows supplied by the template). */
export function repBlock(company: CompanyInfo, rows: string): string {
  const line = (v: string, size = 13, pad = "2px 0") => `<div style="${FONT}font-size:${size}px;font-weight:bold;color:#000000;padding:${pad};">${v}</div>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:3px double #000000;">
      <tr>
        <td width="50%" class="fb-stack fb-left" style="vertical-align:top;padding:4px;border-right:3px double #000000;overflow-wrap:anywhere;word-break:break-word;">
          ${line(escapeHtml(company.quoteCompanyName), 15, "2px 0 6px")}
          ${line(escapeHtml(company.address))}
          ${line(`Call ${escapeHtml(company.mainPhone)}`)}
          ${company.usDot || company.iccMc ? line(`US DOT: ${escapeHtml(company.usDot)}&nbsp;&nbsp;ICC MC: ${escapeHtml(company.iccMc)}`) : ""}
          ${line(`<a href="${escapeHtml(websiteHref(company.website))}" style="color:#0000FF;text-decoration:underline;">${escapeHtml(websiteHref(company.website))}</a>`)}
        </td>
        <td width="50%" class="fb-stack" style="vertical-align:top;padding:2px;overflow-wrap:anywhere;word-break:break-word;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${rows}</table>
        </td>
      </tr>
    </table>`;
}

/**
 * Automatic rep signature under the body of every template: full name, email, phone from the
 * rep's profile (Maintenance). Blank phone -> company main number; blank email -> company email.
 * The footer right under it carries the company name / website.
 */
export function signatureRow(company: CompanyInfo, rep?: LayoutRep | null, compact = false): string {
  const name = (rep?.name || "").trim();
  if (!name) return "";
  const email = (rep?.email || "").trim() || company.companyEmail;
  const phone = (rep?.phone || "").trim() || company.mainPhone;
  if (compact) {
    // One line on the one-page documents (quote / booked order / CC form).
    return `<tr><td data-rep-signature="1" style="${FONT}font-size:11px;line-height:1.3;color:#000000;padding:4px 8px 0 8px;">
    <b style="color:${BRAND.blue};">${escapeHtml(name)}</b> &middot; <a href="mailto:${escapeHtml(email)}" style="color:${BRAND.blue};">${escapeHtml(email)}</a> &middot; ${escapeHtml(phone)}
  </td></tr>`;
  }
  return `<tr><td data-rep-signature="1" style="${FONT}font-size:12px;line-height:1.4;color:#000000;padding:8px 8px 2px 8px;">
    <b style="font-size:13px;color:${BRAND.blue};">${escapeHtml(name)}</b><br>
    <a href="mailto:${escapeHtml(email)}" style="color:${BRAND.blue};">${escapeHtml(email)}</a><br>
    ${escapeHtml(phone)}
  </td></tr>`;
}

export function footer(company: CompanyInfo, rep?: LayoutRep | null): string {
  const email = rep?.email || company.companyEmail;
  return `<tr><td style="padding:6px 8px 0 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border-top:2px solid ${BRAND.blue};">
    <tr><td style="${FONT}font-size:11px;color:${BRAND.gray};text-align:center;padding:4px 0 0 0;line-height:1.4;">
      ${escapeHtml(company.quoteCompanyName)} &middot; ${escapeHtml(company.address)} &middot; Call ${escapeHtml(company.mainPhone)}<br>
      <a href="mailto:${escapeHtml(email)}" style="color:${BRAND.blue};">${escapeHtml(email)}</a> &middot; <a href="${escapeHtml(websiteHref(company.website))}" style="color:${BRAND.blue};">${escapeHtml(websiteLabel(company.website))}</a>
    </td></tr></table></td></tr>`;
}

/** Tiny opt-out link, last line of every customer email / document. */
export function optOutRow(href: string): string {
  return `<tr><td style="${FONT}font-size:9px;color:#9AA0A6;text-align:center;padding:6px 0 0 0;"><a href="${escapeHtml(href)}" data-optout="1" style="color:#9AA0A6;text-decoration:underline;">Opt out / Unsubscribe</a></td></tr>`;
}

function pixelRow(url?: string | null) {
  return url ? `<tr><td><img src="${escapeHtml(url)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;"></td></tr>` : "";
}

/** Inner HTML (one 640px table) — embed on the e-sign page or wrap with documentShell for email. */
export function renderLayoutBody(o: LayoutOptions): string {
  const header = o.header === "centered" ? centeredHeader(o) : splitHeader(o);
  const topLine = o.esign?.topLine ? esignTopLine(o.esign.href) : "";
  const title = o.titleStyle === "none" ? ""
    : o.titleStyle === "underline"
      ? `<tr><td style="${FONT}font-size:15px;font-weight:bold;text-align:center;text-decoration:underline;padding:0 0 12px;">${escapeHtml(o.title)}</td></tr>`
      : `<tr><td style="${FONT}background:#369FE4;color:#FFFFFF;font-size:16px;font-weight:bold;text-align:center;padding:4px;">${escapeHtml(o.title)}</td></tr>`;
  return `
<table role="presentation" width="${WIDTH}" class="fb-doc" cellpadding="0" cellspacing="0" border="0" align="center" style="width:${WIDTH}px;max-width:100%;border-collapse:collapse;">
  ${header}
  ${topLine}
  ${title}
  ${o.bodyHtml}
  ${o.esign ? esignLinkRow(o.esign.href, o.esign.bottomText) : ""}
  ${o.signature === false ? "" : signatureRow(o.company, o.rep, o.signature === "compact")}
  ${o.footer === false ? "" : footer(o.company, o.rep)}
  ${o.optOutHref ? optOutRow(o.optOutHref) : ""}
  ${pixelRow(o.trackingPixelUrl)}
</table>`;
}

// Phones: emails stay <style>-free (email-safe rule), so long words (website, email) wrap inline
// and nothing scrolls sideways. On the customer page, globals.css (.doc-sheet .fb-*) also stacks
// the company/rep box under 520px. Desktop and print are unchanged.
export function documentShell(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:4px;background:#ffffff;">
${inner}
</body></html>`;
}

export function renderLayoutHtml(o: LayoutOptions): string {
  return documentShell(o.title, renderLayoutBody(o));
}
