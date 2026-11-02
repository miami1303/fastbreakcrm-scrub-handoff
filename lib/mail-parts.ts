// Deliverability parts for every outgoing CRM email (pure: unit tested in tests/mail-parts.test.mjs).
//  - plain-text alternative (multipart/alternative) built from the same content, with the
//    document / e-sign link and the company contact block
//  - List-Unsubscribe (https one-click + mailto) and List-Unsubscribe-Post (RFC 8058)
//  - Message-ID on the sending domain and an explicit Date
// The HTML part and the tracking (pixel / tracked links) are not touched here.
import type { CompanyInfo } from "./templates/company.ts";

export const UNSUBSCRIBE_MAILBOX = "support@fastbreakcrm.test";
export const MESSAGE_ID_DOMAIN = "fastbreakcrm.test";

const domainOf = (email: string) => (email.split("@")[1] || "").toLowerCase().trim();

/** <random.time@fastbreakcrm.test> (the From domain when it is another valid domain). */
export function messageId(fromAddress: string, random: string, now = Date.now()): string {
  const d = domainOf(fromAddress);
  const domain = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : MESSAGE_ID_DOMAIN;
  return `<${random.replace(/[^A-Za-z0-9]/g, "")}.${now.toString(36)}@${domain}>`;
}

/** List-Unsubscribe + one-click POST headers for the customer's /u/<token> link. */
export function unsubscribeHeaders(unsubscribeUrl: string, mailbox = UNSUBSCRIBE_MAILBOX): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:${mailbox}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

const websiteUrl = (w: string) => (w && !/^https?:\/\//i.test(w) ? `https://${w}` : w);

/**
 * Plain-text alternative: the template's text, plus the link (if the text doesn't already have
 * it), the company contact block, and the unsubscribe line.
 */
export function plainTextPart(o: {
  text: string; link?: { label: string; url: string } | null; company: CompanyInfo; unsubscribeUrl?: string | null;
}): string {
  const c = o.company;
  const parts = [o.text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim()];
  if (o.link?.url && !parts[0].includes(o.link.url)) parts.push(`${o.link.label}: ${o.link.url}`);
  parts.push([
    "--",
    c.quoteCompanyName,
    c.address,
    `Phone: ${c.mainPhone}`,
    `Email: ${c.companyEmail}`,
    websiteUrl(c.website),
  ].filter(Boolean).join("\n"));
  if (o.unsubscribeUrl) parts.push(`Opt out / Unsubscribe: ${o.unsubscribeUrl}`);
  return parts.filter(Boolean).join("\n\n") + "\n";
}
