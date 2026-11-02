import test from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { messageId, plainTextPart, unsubscribeHeaders } from "../lib/mail-parts.ts";
import { mailHeaders, smtpMessage } from "../lib/mailer.ts";
import { DEFAULT_COMPANY } from "../lib/templates/company.ts";

const SITE = "https://crm.fastbreakcrm.test";
const TOK = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

test("List-Unsubscribe: https /u/<token> + mailto, and one-click POST", () => {
  assert.deepEqual(unsubscribeHeaders(`${SITE}/u/${TOK}`), {
    "List-Unsubscribe": `<${SITE}/u/${TOK}>, <mailto:support@fastbreakcrm.test?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });
});
test("Message-ID is on @fastbreakcrm.test", () => {
  assert.match(messageId("support@fastbreakcrm.test", "ab12-cd"), /^<ab12cd\.[a-z0-9]+@fastbreakcrm\.test>$/);
  assert.match(messageId("bad", "x"), /@fastbreakcrm\.test>$/);
});
test("plain-text part: content + link + company contact + opt-out", () => {
  const t = plainTextPart({ text: "Your quote\n\n\n\nTotal: $1,295.00", link: { label: "Job No. FB400001", url: `${SITE}/d/FB400001/${TOK}` }, company: DEFAULT_COMPANY, unsubscribeUrl: `${SITE}/u/${TOK}` });
  assert.ok(t.startsWith("Your quote\n\nTotal: $1,295.00"));
  assert.ok(t.includes(`Job No. FB400001: ${SITE}/d/FB400001/${TOK}`));
  for (const v of [DEFAULT_COMPANY.quoteCompanyName, `Phone: ${DEFAULT_COMPANY.mainPhone}`, `Email: ${DEFAULT_COMPANY.companyEmail}`]) assert.ok(t.includes(v), v);
  assert.ok(t.includes(`Opt out / Unsubscribe: ${SITE}/u/${TOK}`));
  // link already in the text: not repeated
  const t2 = plainTextPart({ text: `See ${SITE}/d/x`, link: { label: "L", url: `${SITE}/d/x` }, company: DEFAULT_COMPANY });
  assert.equal(t2.split(`${SITE}/d/x`).length, 2);
});
test("SMTP message: multipart/alternative, List-Unsubscribe(+Post), Message-ID, Date; HTML untouched", async () => {
  const mail = {
    from: { name: "Fastbreak CRM", address: "support@fastbreakcrm.test" }, to: "customer@example.test", replyTo: "support@fastbreakcrm.test",
    subject: "Fastbreak CRM — Your Auto Transport Quote FB400001",
    html: `<html><body><p>Quote</p><img src="${SITE}/api/email/open/${TOK}"></body></html>`,
    text: plainTextPart({ text: "Quote", link: { label: "Job No. FB400001", url: `${SITE}/d/FB400001/${TOK}` }, company: DEFAULT_COMPANY, unsubscribeUrl: `${SITE}/u/${TOK}` }),
    unsubscribeUrl: `${SITE}/u/${TOK}`,
  };
  const h = mailHeaders(mail, new Date("2026-10-23T23:00:00Z"));
  const info = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" }).sendMail(smtpMessage(mail, h));
  const raw = info.message.toString();
  const head = raw.slice(0, raw.indexOf("\n\n")).replace(/\n\s+/g, " ");
  assert.match(head, /^Content-Type: multipart\/alternative;/m);
  assert.match(head, new RegExp(`^List-Unsubscribe: <${SITE}/u/${TOK}>, <mailto:support@fastbreakcrm\\.test\\?subject=unsubscribe>$`, "m"));
  assert.match(head, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
  assert.match(head, /^Message-ID: <[a-f0-9]+\.[a-z0-9]+@fastbreakcrm\.test>$/m);
  assert.match(head, /^Date: Fri, 23 Oct 2026 23:00:00 \+0000$/m);
  assert.match(raw, /Content-Type: text\/plain/);
  assert.match(raw, /Content-Type: text\/html/);
  assert.equal(smtpMessage(mail, h).html, mail.html, "HTML (and its tracking pixel) unchanged");
});
test("no unsubscribe URL -> no List-Unsubscribe headers (auto-reply suppression only)", () => {
  assert.deepEqual(mailHeaders({ from: { name: "x", address: "support@fastbreakcrm.test" } }).headers, { "X-Auto-Response-Suppress": "OOF, AutoReply" });
});

test("logo is inlined as a CID attachment in every template; snapshot HTML keeps the https URL", async () => {
  const { renderTemplate, TEMPLATES } = await import("../lib/templates/registry.ts");
  const { EMAIL_LOGO_CID, EMAIL_LOGO_PNG_BASE64 } = await import("../lib/email-logo.ts");
  assert.ok(Buffer.from(EMAIL_LOGO_PNG_BASE64, "base64").length < 50_000, "logo PNG < 50 KB");
  const input = {
    est: { job_number: "FB400001", customer_name: "Sam Rep", customer_email: "c@example.test" },
    vehicles: [{ year: 2026, make: "Mercedes", model: "550" }], quote: { total_amount: 1295, deposit_amount: 295, cod_amount: 1000 },
    assetBaseUrl: SITE, freeText: { subject: "Hello", bodyHtml: "<p>Hi</p>" },
    links: { trackingPixelUrl: `${SITE}/api/email/open/${TOK}`, optOutHref: `${SITE}/u/${TOK}` },
  };
  for (const key of Object.keys(TEMPLATES)) {
    const { html, subject } = renderTemplate(key, input);
    assert.match(html, new RegExp(`src="${SITE}/brand/fastbreak-logo\\.png"`), `${key}: snapshot keeps https logo`);
    const mail = { from: { name: "Fastbreak CRM", address: "support@fastbreakcrm.test" }, to: "c@example.test", subject, html, text: "t", unsubscribeUrl: `${SITE}/u/${TOK}` };
    const msg = smtpMessage(mail, mailHeaders(mail));
    assert.ok(!msg.html.includes("/brand/fastbreak-logo.png"), `${key}: no remote logo left`);
    assert.match(msg.html, new RegExp(`<img src="cid:${EMAIL_LOGO_CID}"[^>]*width="\\d+"[^>]*alt="Fastbreak CRM"`), `${key}: img src=cid: with width + alt`);
    assert.ok(msg.html.includes(`/api/email/open/${TOK}`), `${key}: tracking pixel untouched`);
    const raw = (await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" }).sendMail(msg)).message.toString();
    assert.match(raw, /Content-Type: multipart\/related/, `${key}: related part`);
    assert.match(raw, new RegExp(`Content-ID: <${EMAIL_LOGO_CID}>`), `${key}: Content-ID`);
    assert.match(raw, /Content-Disposition: inline; filename=fastbreak-logo\.png/, `${key}: inline`);
    assert.match(raw, /Content-Type: image\/png/, `${key}: image/png`);
  }
});
