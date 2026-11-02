import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderTemplate, TEMPLATES } from "../lib/templates/registry.ts";
import { DEFAULT_COMPANY } from "../lib/templates/company.ts";

const input = (extra = {}) => ({
  est: { job_number: "FB400001", customer_name: "Jane Rivera", customer_phone: "312-555-0142", created_at: "2026-10-23T12:00:00Z" },
  vehicles: [{ year: 2021, make: "Toyota", model: "Camry", vehicle_type: "Sedan", is_running: true, is_enclosed: false }],
  quote: { total_amount: 1250, deposit_amount: 200, card_last4: "4242", cardholder_name: "Jane Rivera", card_exp: "12/28", billing_address: "233 S Wacker Dr, Chicago, IL 60601" },
  rep: { name: "Sam Rep", email: "support@fastbreakcrm.test", phone: "" },
  paidAmount: 200,
  assetBaseUrl: "https://crm.example.test",
  links: { esignHref: "https://crm.example.test/d/tok#esign" },
  ...extra,
});

test("every registered template uses the shared layout (logo, Call line, footer)", () => {
  for (const key of Object.keys(TEMPLATES)) {
    const { html } = renderTemplate(key, input());
    assert.ok(html.includes("https://crm.example.test/brand/fastbreak-logo.png"), `${key}: absolute logo URL`);
    assert.ok(html.includes(`Call `) && html.includes(DEFAULT_COMPANY.mainPhone), `${key}: Call line`);
    assert.ok(!/<style|<script/i.test(html), `${key}: email-safe`);
  }
});

test("company settings flow into every template (no hard-coded contact info)", () => {
  const company = { ...DEFAULT_COMPANY, mainPhone: "555-000-1111", companyEmail: "new@example.test", website: "example.test", address: "Denver, CO" };
  for (const key of Object.keys(TEMPLATES)) {
    const { html } = renderTemplate(key, input({ company, rep: { name: "Sam Rep", email: "", phone: "" } }));
    assert.ok(html.includes("555-000-1111") && !html.includes("555-010-0101"), `${key}: phone from settings`);
    assert.ok(html.includes("new@example.test"), `${key}: email from settings`);
  }
  for (const f of ["lib/quote-template.ts", "lib/templates/layout.ts", "lib/templates/example.ts", "lib/templates/registry.ts"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(!/555-010-0101|866-240-7648|support@fastbreakcrm\.test/.test(src), `${f} has no hard-coded contact info`);
  }
});

test("flags: E-Quote shows the payment once entered (no e-sign); booked + CC show payment block; CC last 4 only", () => {
  const q = renderTemplate("e_quote", input()).html;
  assert.ok(q.includes("$1250.00") && q.includes("Customer Payment") && !q.includes("E-sign your"));
  const q0 = renderTemplate("e_quote", { ...input(), paidAmount: null }).html;
  assert.ok(!q0.includes("Customer Payment"), "E-Quote with no payment: Total only");
  const b = renderTemplate("booked_esign", input()).html;
  assert.ok(b.includes("Customer Payment") && b.includes("$200.00") && b.includes("$1050.00") && b.includes("E-sign your auto transport order"));
  const cc = renderTemplate("cc_form", input()).html;
  assert.ok(cc.includes("xxxx-xxxx-xxxx-4242") && !cc.includes("4242424242424242"));
  assert.ok(cc.includes("ELECTRONICALLY SIGN") && cc.includes("E-sign your credit card authorization form"));
  assert.equal((cc.match(/data-esign-link="1"/g) || []).length, 2, "two e-sign links on the CC form");
});

test("rep signature under the body of every template (name, email, phone; blank phone -> main number)", () => {
  for (const key of Object.keys(TEMPLATES)) {
    const html = renderTemplate(key, input({ freeText: { subject: "Hi", bodyHtml: "<p>Hello</p>" } })).html;
    const sig = html.slice(html.indexOf('data-rep-signature="1"'));
    assert.ok(html.includes('data-rep-signature="1"'), `${key}: signature`);
    assert.ok(sig.includes("Sam Rep") && sig.includes("support@fastbreakcrm.test") && sig.includes(DEFAULT_COMPANY.mainPhone), `${key}: signature fields`);
  }
  const withPhone = renderTemplate("free_text", input({ rep: { name: "Jordan Demo", email: "jordan@example.test", phone: "303-555-0101" }, freeText: { subject: "Hi", bodyHtml: "x" } })).html;
  assert.ok(withPhone.includes("303-555-0101") && withPhone.includes("jordan@example.test"));
});

test("free text: sanitized body in the shared layout, subject from the rep", () => {
  const r = renderTemplate("free_text", input({ freeText: { subject: "Your pickup", bodyHtml: '<p onclick="x()">Hi <b>Jane</b><script>alert(1)</script> <a href="javascript:alert(1)">bad</a> <a href="https://example.test/pay">Pay Deposit Online Here</a></p>' } }));
  assert.equal(r.subject, "Your pickup");
  assert.ok(r.html.includes("<b>Jane</b>") && !/script|onclick|javascript:/i.test(r.html));
  assert.ok(r.html.includes('href="https://example.test/pay" target="_blank" rel="noopener noreferrer"') && r.html.includes(">Pay Deposit Online Here</a>"));
});

test("extra stop / notes: boxed in the middle of E-Quote and booked order; hidden when empty", () => {
  const html = '<p><b>Payment schedule</b></p><p><a href="https://example.test/pay" target="_blank" rel="noopener noreferrer" style="color:#1a4fb4;text-decoration:underline">Pay Deposit Online Here</a></p>';
  for (const key of ["e_quote", "booked_esign"]) {
    const doc = renderTemplate(key, input({ est: { ...input().est, extra_stop_html: html } })).html;
    const i = doc.indexOf("Extra Stop / Notes"), v = doc.indexOf("Year / Make / Model");
    assert.ok(i > 0 && doc.indexOf("Pick-Up From") < i && i < v, `${key}: between From/To and vehicles`);
    assert.ok(doc.includes(">Pay Deposit Online Here</a>"), `${key}: named link`);
    assert.ok(!renderTemplate(key, input()).html.includes("Extra Stop / Notes"), `${key}: hidden when empty`);
  }
});

test("shared shipment Remarks: under Vehicles on quote + booked order, hidden when empty", () => {
  const est = { ...input().est, shipment_remarks: "Keys at the front desk <gate 4411>\nCall on arrival" };
  for (const key of ["e_quote", "booked_esign"]) {
    const { html, text } = renderTemplate(key, input({ est }));
    const r = html.indexOf('data-remarks="1"');
    assert.ok(r > html.indexOf(">Vehicles<") && r < html.indexOf("Understanding Your Quote"), `${key}: Remarks after Vehicles`);
    assert.ok(html.includes("Keys at the front desk &lt;gate 4411&gt;"), `${key}: escaped`);
    assert.ok(text.includes("Remarks: Keys at the front desk"), `${key}: plain text`);
    assert.ok(!renderTemplate(key, input()).html.includes('data-remarks="1"'), `${key}: hidden when empty`);
    assert.ok(!renderTemplate(key, input({ est: { ...est, shipment_remarks: "   " } })).html.includes('data-remarks="1"'), `${key}: blank hidden`);
  }
  assert.ok(!renderTemplate("cc_form", input({ est })).html.includes('data-remarks="1"'), "not on the CC form");
});

// Owner: EVERY template carries the per-send pixel + tracked links (applied in renderTemplate).
test("every registered template: tracking pixel + tracked links on every send", async () => {
  const { eventLabel, LINK_DETAIL } = await import("../lib/view-tracking.ts");
  const tok = "TOKabc123";
  const links = {
    jobNumberHref: `https://crm.example.test/d/FB400001/${tok}`, esignHref: `https://crm.example.test/d/FB400001/${tok}#esign`,
    trackingPixelUrl: `https://crm.example.test/api/email/open/${tok}`, clickBase: `https://crm.example.test/api/email/click/${tok}`,
    optOutHref: `https://crm.example.test/u/${tok}`,
  };
  const results = [];
  for (const key of Object.keys(TEMPLATES)) {
    const { html } = renderTemplate(key, input({ links, freeText: { subject: "Checking in", bodyHtml: '<p>Hi <a href="https://example.test/info">see this</a></p>' } }));
    const pixel = html.includes(`src="${links.trackingPixelUrl}"`);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, "&"));
    const tracked = hrefs.filter(h => h.startsWith(links.clickBase) || h.startsWith(links.jobNumberHref));
    const untracked = hrefs.filter(h => /^https?:/.test(h) && !tracked.includes(h) && h !== links.optOutHref);
    results.push(`${key}: pixel=${pixel} tracked=${tracked.length} untracked=${untracked.length}`);
    assert.ok(pixel, `${key}: tracking pixel`);
    assert.ok(tracked.length >= 1, `${key}: at least one tracked link`);
    assert.deepEqual(untracked, [], `${key}: every http(s) link is tracked`);
    const expected = key === "e_quote" || key === "booked_esign" ? "Quote Viewed" : "Email Viewed";
    assert.equal(eventLabel(key, "opened"), expected, `${key}: open label`);
    assert.equal(eventLabel(key, "viewed", `${LINK_DETAIL}https://example.test/info`), expected, `${key}: link-click label`);
  }
  console.log("# tracking per template: " + results.join(" | "));
});
