import { test } from "node:test";
import assert from "node:assert/strict";
import { imapConfig, replySubject, forwardSubject, replyReferences, parseRecipients, composeBody, isOwnAddress } from "../lib/mailbox/parse.ts";
import { smtpMessage, mailHeaders } from "../lib/mailer.ts";

test("imapConfig reuses your mail host SMTP mailbox", () => {
  const c = imapConfig({ SMTP_HOST: "smtp.example.test", SMTP_USER: "support@fastbreakcrm.test", SMTP_PASS: "x" });
  assert.equal(c.host, "imap.example.test"); assert.equal(c.port, 993); assert.equal(c.secure, true); assert.equal(c.auth.user, "support@fastbreakcrm.test");
  assert.equal(imapConfig({ SMTP_HOST: "smtp.example.test", SMTP_USER: "a@b.com" }), null);
  assert.equal(imapConfig({ IMAP_HOST: "h", IMAP_USER: "u", IMAP_PASS: "p", IMAP_PORT: "143" }).secure, false);
});
test("subjects + references", () => {
  assert.equal(replySubject("Quote"), "Re: Quote"); assert.equal(replySubject("RE: Quote"), "RE: Quote");
  assert.equal(forwardSubject("Quote"), "Fwd: Quote"); assert.equal(forwardSubject("Fw: x"), "Fw: x");
  assert.equal(replyReferences("<a@x> <b@x>", "<c@x>"), "<a@x> <b@x> <c@x>");
  assert.equal(replyReferences(null, "<c@x>"), "<c@x>");
});
test("recipients", () => {
  assert.deepEqual(parseRecipients("A@x.com, Bob <b@y.com>").emails, ["a@x.com", "b@y.com"]);
  assert.equal(parseRecipients("nope").ok, false); assert.equal(parseRecipients("").ok, false);
});
test("reply body quotes original; forward has header", () => {
  const m = { from_name: "Jo", from_address: "jo@x.com", to_text: "info@", subject: "S", text_body: "hi\nthere" };
  const r = composeBody("reply", "Thanks", m, "Nov 1");
  assert.match(r.text, /^Thanks\n\nOn Nov 1, Jo <jo@x.com> wrote:\n> hi\n> there$/);
  assert.match(composeBody("forward", "", m, "Nov 1").text, /Forwarded message/);
  assert.ok(!composeBody("reply", "<b>", m, "d").html.includes("<b>"));
  assert.equal(isOwnAddress("support@fastbreakcrm.test", "support@fastbreakcrm.test"), true);
});
test("mailer threads replies", () => {
  const m = { from: { name: "FB", address: "support@fastbreakcrm.test" }, to: "a@x.com", subject: "Re: S", html: "<p>x</p>", text: "x", inReplyTo: "<c@x>", references: "<a@x> <c@x>" };
  const msg = smtpMessage(m, mailHeaders(m));
  assert.equal(msg.inReplyTo, "<c@x>"); assert.equal(msg.references, "<a@x> <c@x>");
  assert.equal(smtpMessage({ ...m, inReplyTo: null, references: null }, mailHeaders(m)).inReplyTo, undefined);
});
