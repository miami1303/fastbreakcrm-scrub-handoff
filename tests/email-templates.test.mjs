import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderTemplate, renderTemplateDef } from "../lib/templates/registry.ts";
import { CUSTOMER_LETTERS } from "../lib/templates/customer-messages.ts";
import { SEED_TEMPLATES, MERGE_FIELDS, activeTemplates, rowTemplate, sendKindFor, slugKey, unknownMergeFields } from "../lib/templates/email-templates.ts";
import { CUSTOMER_MESSAGE_KINDS, isQuoteMessageKind } from "../lib/crm-constants.ts";
import { messageLinks } from "../lib/customer-email-views.ts";

const input = (kind = "custom_letter", extra = {}) => ({
  est: { job_number: "FB400001", customer_name: "Jane <Rivera>", pickup_address: "1 A St, Miami, FL 33101", pickup_zip: "33101", delivery_address: "2 B Ave, Austin, TX 78701", delivery_zip: "78701", created_at: "2026-10-23T12:00:00Z" },
  vehicles: [], quote: null,
  rep: { name: "Sam Rep", email: "rep@example.test", phone: "555-010-0103", title: "Senior Coordinator" },
  assetBaseUrl: "https://crm.example.test",
  links: messageLinks(kind, "https://crm.example.test", "tok1234567890abcdef", "FB400001").links,
  ...extra,
});

test("seeds = the 8 code letters, same keys/order, active", () => {
  assert.equal(SEED_TEMPLATES.length, 8);
  assert.deepEqual(SEED_TEMPLATES.map(t => t.key), [...CUSTOMER_MESSAGE_KINDS]);
  assert.deepEqual(SEED_TEMPLATES.map(t => t.name), CUSTOMER_LETTERS.map(l => l.title));
  for (const t of SEED_TEMPLATES) assert.equal(t.opens_quote, isQuoteMessageKind(t.key));
});

test("migration seeds every letter and adds the custom kinds", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261101040000_email_templates.sql", import.meta.url), "utf8");
  for (const t of SEED_TEMPLATES) assert.ok(sql.includes(`$tpl$${t.key}$tpl$`), t.key);
  assert.match(sql, /'custom_letter', 'custom_quote'/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /crm_is_active_admin\(\)/);
});

test("a seed row renders the same letter as the hardcoded template", () => {
  for (const t of SEED_TEMPLATES) {
    const i = input(t.key);
    const a = renderTemplate(t.key, i), b = renderTemplateDef(rowTemplate(t), i);
    assert.equal(b.subject, a.subject, t.key);
    assert.ok(b.html.includes("Sam Rep") && b.html.includes("Senior Coordinator"), `${t.key}: rep signature + title`);
    assert.ok(b.html.includes("555-010-0103"), `${t.key}: rep direct line`);
  }
});

test("custom template: merge fields filled + escaped, job # links to the order, no fax", () => {
  const row = { id: "x", key: "thanks", name: "Thanks", subject: "Thanks {customer_name} - {job_number}", body_html: "<p>Hi {customer_name}, from {pickup_city_state_zip} to {delivery_state}.</p><script>x</script>", kind: "letter", is_active: true, sort_order: 1, opens_quote: false };
  const { html, subject, text } = renderTemplateDef(rowTemplate(row), input());
  assert.equal(subject, "Thanks Jane <Rivera> - FB400001");
  assert.ok(html.includes("Hi Jane &lt;Rivera&gt;") && html.includes("Miami, FL 33101") && html.includes("TX"));
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes("/d/FB400001/tok1234567890abcdef"), "job number -> customer order");
  assert.ok(!/fax/i.test(html));
  assert.ok(text.includes("Hi Jane <Rivera>"));
  assert.equal(sendKindFor(row), "custom_letter");
  assert.equal(sendKindFor({ ...row, opens_quote: true }), "custom_quote");
  assert.equal(sendKindFor({ key: "ready_to_book", opens_quote: true }), "ready_to_book");
});

test("rep title falls back to Transport Coordinator", () => {
  const { html } = renderTemplateDef(rowTemplate(SEED_TEMPLATES[0]), input("request_received", { rep: { name: "Jordan", email: "", phone: "" } }));
  assert.ok(html.includes("Transport Coordinator"));
});

test("active list: DB rows sorted, inactive hidden, seeds when empty", () => {
  assert.equal(activeTemplates([]).length, 8);
  assert.equal(activeTemplates(null).length, 8);
  const rows = [{ ...SEED_TEMPLATES[0], sort_order: 50 }, { ...SEED_TEMPLATES[1], sort_order: 5 }, { ...SEED_TEMPLATES[2], is_active: false }];
  assert.deepEqual(activeTemplates(rows).map(r => r.key), ["company_intro", "request_received"]);
});

test("merge-field helpers", () => {
  assert.deepEqual(unknownMergeFields("{customer_name} {bogus}", "{rep_name}{job_link}"), ["bogus"]);
  assert.ok(MERGE_FIELDS.some(f => f.key === "rep_title"));
  assert.equal(slugKey("  My Template!! 2 "), "my_template_2");
});

test("Email Center hover + Maintenance tab are wired to the DB templates", () => {
  const ec = readFileSync(new URL("../app/estimates/[id]/email-center.tsx", import.meta.url), "utf8");
  assert.match(ec, /listActiveTemplates/);
  const maint = readFileSync(new URL("../app/admin-menu/maintenance/page.tsx", import.meta.url), "utf8");
  assert.match(maint, /id: "email", label: "Email Center"/);
  assert.match(maint, /EmailCenterForm/);
  const act = readFileSync(new URL("../app/actions/email.ts", import.meta.url), "utf8");
  assert.match(act, /findActiveTemplate/);
});
