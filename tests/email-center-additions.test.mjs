import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderTemplate, TEMPLATES } from "../lib/templates/registry.ts";
import { emailKindLabel } from "../lib/crm-constants.ts";
import { mailHeaders } from "../lib/mailer.ts";

const input = (extra = {}) => ({
  est: { job_number: "FB400001", customer_name: "Jane Rivera", created_at: "2026-10-23T12:00:00Z" },
  vehicles: [], quote: { total_amount: 1250, deposit_amount: 200 },
  rep: { name: "Sam Rep", email: "rep@example.test", phone: "" },
  assetBaseUrl: "https://crm.example.test",
  ...extra,
});
const token = "tok_abcdefghijklmnopqrstuvwxyz012345";
const links = { trackingPixelUrl: `https://crm.example.test/api/email/open/${token}`, clickBase: `https://crm.example.test/api/email/click/${token}`, optOutHref: `https://crm.example.test/u/${token}` };

test("payment link email: branded, tracked (pixel + click), opt-out, own subject", () => {
  assert.ok(TEMPLATES.payment_link);
  const r = renderTemplate("payment_link", input({ paymentLink: { url: "https://checkout.stripe.com/c/pay/cs_test_1", amount: "$200.00" }, links }));
  assert.match(r.subject, /^Payment link for job FB400001/);
  assert.ok(r.html.includes(links.trackingPixelUrl), "pixel");
  assert.ok(r.html.includes(`/api/email/click/${token}?u=${encodeURIComponent("https://checkout.stripe.com/c/pay/cs_test_1")}`), "pay button is click-tracked");
  assert.ok(r.html.includes(links.optOutHref), "opt-out");
  assert.ok(r.html.includes("$200.00"));
  assert.ok(r.text.includes("https://checkout.stripe.com/c/pay/cs_test_1"));
  assert.equal(emailKindLabel("payment_link"), "Payment Link");
});

test("every template keeps its tracking pixel after the margin changes", () => {
  for (const key of Object.keys(TEMPLATES)) {
    const html = renderTemplate(key, input({ links, freeText: { subject: "Hi", bodyHtml: "<p>Hi</p>" }, paymentLink: { url: "https://x.test/p", amount: "$1.00" } })).html;
    assert.ok(html.includes(links.trackingPixelUrl), `${key}: pixel`);
  }
});

test("customer letters: tight paragraphs, no double <br> gaps, one-line layout signature", () => {
  const html = renderTemplate("ready_to_book", input({ links })).html;
  assert.ok(!html.includes("<br><br>"));
  assert.ok(html.includes('<p style="margin:0 0 8px;">'));
  assert.ok(!html.includes("padding:14px 8px 0 8px"));
});

test("outbound mail asks for no auto-replies", () => {
  const h = mailHeaders({ from: { name: "x", address: "support@fastbreakcrm.test" }, unsubscribeUrl: "https://crm.example.test/u/t" }).headers;
  assert.equal(h["X-Auto-Response-Suppress"], "OOF, AutoReply");
  assert.ok(h["List-Unsubscribe"]);
  assert.equal(h["Precedence"], undefined);
});

test("payment_link migration is additive and keeps every existing kind", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261030230000_payment_link_email_kind.sql", import.meta.url), "utf8");
  for (const k of ["cc_form", "e_quote", "booked_esign", "free_text", "request_received", "company_intro", "ready_to_book", "flex_pricing", "honest_followup", "booked_scheduled", "pickup_confirmed", "hi_lets_chat", "payment_link"]) assert.ok(sql.includes(`'${k}'`), k);
  assert.doesNotMatch(sql, /drop table|delete from|update /i);
});
