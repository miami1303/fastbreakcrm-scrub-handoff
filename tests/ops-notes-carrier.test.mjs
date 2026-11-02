import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOTE_KINDS, NOTE_STACK_ORDER, NOTE_INPUT_ROWS, isNoteKind, latestLimit, showViewAll, splitSharedNotes } from "../lib/note-kinds.ts";
import { renderTemplate, TEMPLATES } from "../lib/templates/registry.ts";
import { buildQuoteBody, buildQuoteText, carrierForEmail, carrierInfoHtml, vehicleFlagLineHtml, vehicleFlagLineText } from "../lib/quote-template.ts";
import { EMAIL_KIND_LABEL, emailKindLabel } from "../lib/crm-constants.ts";
import { eventLabel, notifyKindFor, viewLabel } from "../lib/view-tracking.ts";

const input = (extra = {}) => ({
  est: { job_number: "FB400001", customer_name: "Jane Rivera", status: "booked", primary_date: "2026-11-04", created_at: "2026-10-23T12:00:00Z" },
  vehicles: [{ year: 2021, make: "Toyota", model: "Camry", vehicle_type: "Sedan", is_running: false, is_enclosed: true, flex: true, asap: true, expedited: true }],
  quote: { total_amount: 1250, deposit_amount: 200 },
  rep: { name: "Sam Rep", email: "rep@example.test", phone: "" },
  assetBaseUrl: "https://crm.example.test",
  links: { jobNumberHref: "https://crm.example.test/d/FB400001/tok", trackingPixelUrl: "https://crm.example.test/api/email/open/tok", clickBase: "https://crm.example.test/api/email/click/tok" },
  ...extra,
});
const carriers = [
  { body: "ACME Hauling — Bob 555-0100, MC 123", created_at: "2026-10-31T18:00:00Z" },
  { body: "Old Carrier (cancelled)", created_at: "2026-10-30T18:00:00Z" },
];

test("carrier is a note kind; stack order is Rep, Customer, Carrier, Operation, Policy", () => {
  assert.ok(isNoteKind("carrier"));
  assert.ok(!isNoteKind("bogus"));
  assert.deepEqual([...NOTE_STACK_ORDER], ["rep", "customer", "carrier", "operations", "policy"]);
  assert.equal(NOTE_INPUT_ROWS.rep, 8);
  assert.ok(NOTE_INPUT_ROWS.customer < NOTE_INPUT_ROWS.carrier);
  assert.equal(latestLimit("operations"), 3);
  assert.equal(latestLimit("policy"), 3);
  assert.equal(latestLimit("customer"), 3);
  assert.equal(NOTE_KINDS.length, 5);
});

test("migration allows carrier notes and carrier_confirm emails", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261031210000_carrier_notes_and_confirm_email.sql", import.meta.url), "utf8");
  assert.match(sql, /estimate_notes_kind_check[\s\S]*'carrier'\)/);
  assert.match(sql, /crm_emails_kind_check[\s\S]*'carrier_confirm'/);
});

test("View all notes only when a section has more than one note", () => {
  assert.equal(showViewAll(0), false);
  assert.equal(showViewAll(1), false);
  assert.equal(showViewAll(2), true);
});

test("splitSharedNotes: carrier newest first, newest customer remark", () => {
  const r = splitSharedNotes([
    { kind: "carrier", body: "old", created_at: "2026-10-30T00:00:00Z" },
    { kind: "customer", body: "first", created_at: "2026-10-29T00:00:00Z" },
    { kind: "carrier", body: "new", created_at: "2026-10-31T00:00:00Z" },
    { kind: "customer", body: " latest ", created_at: "2026-10-31T01:00:00Z" },
  ]);
  assert.deepEqual(r.carrierNotes.map(n => n.body), ["new", "old"]);
  assert.equal(r.latestCustomerRemark, "latest");
});

test("selected toggles print on the line UNDER the vehicle, Remarks stays blank", () => {
  const body = buildQuoteBody(input());
  const m = body.match(/<tr data-vehicle-flags="1">([\s\S]*?)<\/tr>/);
  assert.ok(m, "flag line exists");
  assert.match(m[1], /data-flags-main="1"[^>]*>FLEX &middot; ASAP &middot; EXPEDITED</);
  assert.match(m[1], /data-flags-run="1"[^>]*><span style="color:#B12E39;">INOP<\/span>/);
  assert.match(m[1], /data-flags-enclosed="1"[^>]*>Enclosed</);
  // Vehicle row itself: no flag words (Remarks blank, no typed remark).
  const row = body.slice(body.indexOf("2021 Toyota Camry"), body.indexOf('data-vehicle-flags="1"'));
  for (const t of ["FLEX", "ASAP", "INOP", "EXPEDITED"]) assert.ok(!row.includes(t), `${t} not in Remarks`);
  assert.equal(vehicleFlagLineHtml({ is_running: true, is_enclosed: false }), "", "no flags -> no line, never OPEN");
  assert.equal(vehicleFlagLineText({ is_running: false, is_enclosed: false, flex: true }), "FLEX · INOP");
  const typed = buildQuoteBody(input({ vehicles: [{ year: 2021, make: "Toyota", model: "Camry", is_running: true, remarks: "Keys at desk" }] }));
  assert.ok(typed.includes(">Keys at desk<") && !typed.includes("data-vehicle-flags"));
  const text = buildQuoteText(input());
  assert.match(text, /\| Sedan \| No \| Yes \|  \| 1 \|/);
  assert.match(text, /\n  FLEX · ASAP · EXPEDITED · INOP · Enclosed/);
  assert.ok(!/OPEN/.test(text + body.replace(/OPEN_/g, "")));
});

test("customer order: Carrier Info box with newest note + See all for older", () => {
  const body = buildQuoteBody(input({ carrierNotes: carriers }));
  assert.match(body, /data-carrier-info="1"/);
  assert.match(body, /data-carrier-latest="1"[^>]*>ACME Hauling/);
  assert.match(body, /See all carrier notes \(2\)/);
  assert.ok(body.indexOf("Carrier Info") < body.indexOf(">Vehicles<"), "carrier box sits above Vehicles");
  assert.equal(carrierInfoHtml({ carrierNotes: [] }), "");
  assert.ok(!carrierInfoHtml({ carrierNotes: [carriers[0]] }).includes("See all"));
});

test("emails carry only the newest carrier note", () => {
  assert.equal(carrierForEmail({ carrierNotes: carriers }).carrierNotes.length, 1);
  const { html, text, subject } = renderTemplate("carrier_confirm", input({ carrierNotes: carriers }));
  assert.ok(TEMPLATES.carrier_confirm);
  assert.match(subject, /Carrier confirmed for job FB400001/);
  assert.ok(html.includes("ACME Hauling"));
  assert.ok(!html.includes("Old Carrier"));
  assert.ok(!html.includes("See all carrier notes"));
  assert.ok(!/esign/i.test(html.replace(/data-[a-z-]+/g, "")), "no e-sign link");
  // Job number links straight to the tracked /d/<job>/<token> page (not rewritten through click tracking).
  assert.match(html, /href="https:\/\/crm\.example\.test\/d\/FB400001\/tok"[^>]*data-job-link="1"/);
  assert.ok(html.includes("/api/email/open/tok"), "open pixel");
  assert.ok(text.includes("ACME Hauling") && !text.includes("Old Carrier"));
});

test("carrier_confirm is an Email Viewed kind, not Quote Viewed", () => {
  assert.equal(EMAIL_KIND_LABEL.carrier_confirm, "Carrier Confirmation");
  assert.equal(emailKindLabel("carrier_confirm"), "Carrier Confirmation");
  assert.equal(viewLabel("carrier_confirm"), "Email Viewed");
  assert.equal(eventLabel("carrier_confirm", "viewed"), "Email Viewed");
  assert.equal(eventLabel("carrier_confirm", "opened"), "Email Viewed");
  assert.equal(notifyKindFor("carrier_confirm"), "email_viewed");
});

test("Charges toggles are split into Run / Enclosed columns (not one colspan cell)", () => {
  const src = readFileSync(new URL("../app/components/VehiclePrices.tsx", import.meta.url), "utf8");
  assert.match(src, /data-testid="vehicle-flags-run"><VehicleToggleRow \{\.\.\.p\} part="run"/);
  assert.match(src, /data-testid="vehicle-flags-enclosed"><VehicleToggleRow \{\.\.\.p\} part="enclosed"/);
  assert.match(src, /<td colSpan=\{2\} data-testid="vehicle-toggle-cell-main"><VehicleToggleRow \{\.\.\.p\} part="main"/);
  assert.ok(!/colSpan=\{7\}><VehicleToggleRow/.test(src));
  const list = readFileSync(new URL("../app/components/VehicleList.tsx", import.meta.url), "utf8");
  assert.match(list, /<VehicleToggleCells /);
});
