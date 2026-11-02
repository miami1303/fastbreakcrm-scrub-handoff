import test from "node:test";
import assert from "node:assert/strict";
import { gmailBlock, mailMode, sender, DEFAULT_FROM_ADDRESS, DEFAULT_FROM_NAME } from "../lib/mailer.ts";

test("real sending is OFF until configured (falls back to copy + mailto)", () => {
  assert.equal(mailMode({}), null);
  assert.equal(mailMode({ SMTP_HOST: "  " }), null);
});
test("whichever is configured is used; SMTP first; EMAIL_TRANSPORT picks", () => {
  assert.equal(mailMode({ SMTP_HOST: "smtp.example.test" }), "smtp");
  assert.equal(mailMode({ RESEND_API_KEY: "x" }), "resend");
  assert.equal(mailMode({ SMTP_HOST: "h", RESEND_API_KEY: "x" }), "smtp");
  assert.equal(mailMode({ SMTP_HOST: "h", RESEND_API_KEY: "x", EMAIL_TRANSPORT: "resend" }), "resend");
  assert.equal(mailMode({ RESEND_API_KEY: "x", EMAIL_TRANSPORT: "smtp" }), "resend");
});
test("sender: From and Reply-To are support@fastbreakcrm.test (never the rep, never Gmail)", () => {
  assert.deepEqual(sender({}, null, {}), { address: DEFAULT_FROM_ADDRESS, name: DEFAULT_FROM_NAME, replyTo: DEFAULT_FROM_ADDRESS });
  assert.equal(DEFAULT_FROM_ADDRESS, "support@fastbreakcrm.test");
  assert.equal(DEFAULT_FROM_NAME, "Fastbreak CRM");
  const company = { companyEmail: "owner@gmail.com", emailFromName: "Fastbreak CRM", emailSendAs: "rep" };
  assert.deepEqual(sender(company, "rep@gmail.com", {}), { address: "support@fastbreakcrm.test", name: "Fastbreak CRM", replyTo: "support@fastbreakcrm.test" });
  assert.equal(sender(company, "rep@fastbreakcrm.test", {}).replyTo, "support@fastbreakcrm.test", "Reply-To info@, not the rep");
  assert.equal(sender(company, null, { EMAIL_FROM_ADDRESS: "crm@fastbreakcrm.test" }).address, "crm@fastbreakcrm.test");
  assert.equal(sender(company, null, { EMAIL_REPLY_TO: "support@fastbreakcrm.test" }).replyTo, "support@fastbreakcrm.test");
});
test("never Gmail: Gmail SMTP host or Gmail From is refused; your mail host is fine", () => {
  assert.match(gmailBlock("support@fastbreakcrm.test", { SMTP_HOST: "smtp.gmail.com" }), /Gmail SMTP is not allowed/);
  assert.match(gmailBlock("someone@gmail.com", { SMTP_HOST: "smtp.example.test" }), /never a Gmail address/);
  assert.equal(gmailBlock("support@fastbreakcrm.test", { SMTP_HOST: "smtp.example.test", SMTP_PORT: "465" }), null);
});
