import test from "node:test";
import assert from "node:assert/strict";
import { cleanEsign, esignKindFor, rowTemplate, SEED_TEMPLATES } from "../lib/templates/email-templates.ts";
import { renderTemplateDef } from "../lib/templates/registry.ts";
import { sender } from "../lib/mailer.ts";

const input = (letterEsign) => ({
  est: { job_number: "FB400100", customer_name: "Jane", customer_email: "j@example.com", pickup_address: "1 A St, Miami, FL 33101", delivery_address: "2 B St, Austin, TX 78701", created_at: new Date().toISOString() },
  vehicles: [], quote: null, company: null, assetBaseUrl: "https://crm.example.com",
  rep: { name: "Rep", email: "rep@gmail.com", phone: "", title: null },
  links: { jobNumberHref: "https://crm.example.com/d/FB400100/tok", quoteLandingHref: "https://crm.example.com/v/tok", letterEsign },
});

test("esign option maps to the signable document kinds", () => {
  assert.equal(esignKindFor("order"), "booked_esign");
  assert.equal(esignKindFor("cc"), "cc_form");
  assert.equal(esignKindFor("none"), null);
  assert.equal(cleanEsign("bogus"), "none");
  assert.ok(SEED_TEMPLATES.every(t => t.esign === "none"));
});

test("template with e-sign renders a red e-sign link (html + text); without it, none", () => {
  const row = { ...SEED_TEMPLATES[0], opens_quote: true, esign: "order" };
  const es = { href: "https://crm.example.com/d/FB400100/es#esign", text: "Click this link to E-sign your auto transport order for service" };
  const r = renderTemplateDef(rowTemplate(row), input(es));
  assert.match(r.html, /data-esign-link="1"/);
  assert.match(r.html, /\/d\/FB400100\/es#esign/);
  assert.match(r.text, /E-sign your auto transport order/);
  assert.match(r.html, /\/v\/tok/); // job # -> quote landing
  const plain = renderTemplateDef(rowTemplate({ ...row, esign: "none", opens_quote: false }), input(null));
  assert.doesNotMatch(plain.html, /data-esign-link/);
  assert.doesNotMatch(plain.html, /\/v\/tok/);
});

test("every user sends From/Reply-To info@ (rep Gmail ignored)", () => {
  const s = sender({ emailFromName: null }, "rep@gmail.com", {});
  assert.equal(s.address, "support@fastbreakcrm.test");
  assert.equal(s.replyTo, "support@fastbreakcrm.test");
});
