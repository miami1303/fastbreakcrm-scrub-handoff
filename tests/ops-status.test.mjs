import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { carrierAssignedSms, firstChargedAt, opsSteps } from "../lib/ops-status.ts";
import { BANNERS, BANNER_DIRECTION, KIND_TO_BANNER, UNTIL_LEAD_OPENED } from "../lib/crm-constants.ts";

test("ops strip order: Charged -> Job Posted -> Carrier assigned -> Picked up -> Delivered (no Contract/CC e-sign)", () => {
  const s = opsSteps({ postedAt: "2026-10-31T12:00:00Z" });
  assert.deepEqual(s.map(x => x.label), ["Charged", "Job Posted", "Carrier assigned", "Picked up", "Delivered"]);
  assert.deepEqual(s.map(x => x.done), [false, true, false, false, false]);
});

test("charged = earliest non-void positive payment", () => {
  assert.equal(firstChargedAt([
    { created_at: "2026-10-31T12:00:00Z", amount: 100 },
    { created_at: "2026-10-30T12:00:00Z", amount: 50, voided_at: "x" },
    { created_at: "2026-10-31T09:00:00Z", amount: "-20" },
    { created_at: "2026-10-31T11:00:00Z", amount: "250" },
  ]), "2026-10-31T11:00:00Z");
  assert.equal(firstChargedAt([]), null);
});

test("carrier-assigned text: from the company, carrier info as pasted, pickup", () => {
  const t = carrierAssignedSms({ company: "Fastbreak CRM", job: "FB400010", carrier: "Rocky Mtn Haulers\nMike 303-555-0177", pickup: "11/05/2026 9 AM", phone: "555-010-0101" });
  assert.match(t, /^Fastbreak CRM: a carrier is assigned for your job FB400010\. Pickup: 11\/05\/2026 9 AM\./);
  assert.ok(t.includes("Rocky Mtn Haulers\nMike 303-555-0177"));
  assert.ok(!carrierAssignedSms({ company: "X", job: "J", carrier: "C", pickup: "", phone: "1" }).includes("Pickup:"));
});

test("Job Assigned banner: wired, loops until the lead is opened", () => {
  assert.equal(BANNERS.jobAssigned.label, "Job Assigned");
  assert.equal(KIND_TO_BANNER.job_assigned, "jobAssigned");
  assert.ok(BANNER_DIRECTION.jobAssigned);
  assert.ok(UNTIL_LEAD_OPENED.has("jobAssigned"));
  const src = readFileSync(new URL("../app/components/CrmBanners.tsx", import.meta.url), "utf8");
  assert.match(src, /n\.estimate_id === focusId/);
  assert.match(src, /filter\(k => !STICKY_BANNERS\.has\(k\)\)/); // STICKY_BANNERS = UNTIL_LEAD_OPENED + UNTIL_CARRIER_PAID
});

test("migration adds posted_at + carrier_assigned_at", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261031220000_job_posted_carrier_assigned.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists posted_at timestamptz/);
  assert.match(sql, /add column if not exists carrier_assigned_at timestamptz/);
});

test("Job Posted / Carrier assigned stay clickable and never lock the lead (Owner 2026-10-31)", () => {
  const layout = readFileSync(new URL("../app/estimates/[id]/layout.tsx", import.meta.url), "utf8");
  const ops = readFileSync(new URL("../app/actions/ops.ts", import.meta.url), "utf8");
  const ctx = readFileSync(new URL("../app/estimates/[id]/lead-context.tsx", import.meta.url), "utf8");
  assert.match(layout, /const can = true;/); // every pill is a button; unbooked clicks flash "Book this job first."
  assert.match(layout, /Book this job first\./);
  assert.doesNotMatch(layout, /posted_at && x\.key === "carrier"/); // no posted_at gate on Carrier
  assert.doesNotMatch(ops, /if \(est\.posted_at\) return/); // repost refreshes posted_at
  assert.match(ctx, /if \(!loadedRef\.current\) setError/); // refresh errors never blank the lead
});

import { chargeState, opsCalendarColor, stripNeedsCarrier } from "../lib/ops-status.ts";
import { pickupDateText, formatPickupTime } from "../lib/quote-template.ts";

test("strip: five on/off steps, all toggles (Charged too)", () => {
  const s = opsSteps({ chargedAt: "a", pickedUpAt: "b" });
  assert.deepEqual(s.map(x => x.key), ["charged", "posted", "carrier", "picked", "delivered"]);
  assert.deepEqual(s.map(x => x.done), [true, false, false, true, false]);
  assert.deepEqual(s.map(x => x.toggle), [true, true, true, true, true]);
});

test("Charged -> Refund when fully refunded", () => {
  assert.equal(chargeState([]).state, "none");
  assert.equal(chargeState([{ created_at: "2026-10-01", amount: 395 }]).state, "charged");
  assert.equal(chargeState([{ created_at: "2026-10-01", amount: 395 }, { created_at: "2026-10-02", amount: -100 }]).state, "charged");
  const r = chargeState([{ created_at: "2026-10-01", amount: 395 }, { created_at: "2026-10-03", amount: -395 }]);
  assert.equal(r.state, "refund"); assert.equal(r.at, "2026-10-03");
  assert.equal(chargeState([{ created_at: "2026-10-01", amount: 395, voided_at: "x" }]).state, "none");
});

test("needs carrier red: 2+ days after the window end, no carrier", () => {
  const e = { status: "booked", primary_date: "2026-11-10", backup_date: "2026-11-12" };
  assert.equal(stripNeedsCarrier(e, "2026-11-13"), false);
  assert.equal(stripNeedsCarrier(e, "2026-11-14"), true);
  assert.equal(stripNeedsCarrier({ ...e, backup_date: null }, "2026-11-12"), true);
  assert.equal(stripNeedsCarrier({ ...e, carrier_assigned_at: "x" }, "2026-11-20"), false);
});

test("calendar colors: red / orange / green / delivered", () => {
  const e = { status: "booked", primary_date: "2026-11-10", backup_date: null };
  assert.equal(opsCalendarColor(e, "2026-11-11"), "none");
  assert.equal(opsCalendarColor(e, "2026-11-12"), "red");
  assert.equal(opsCalendarColor({ ...e, carrier_assigned_at: "x" }, "2026-11-12"), "orange");
  assert.equal(opsCalendarColor({ ...e, carrier_assigned_at: "x", picked_up_at: "y" }, "2026-11-12"), "green");
  assert.equal(opsCalendarColor({ ...e, picked_up_at: "y", delivered_at: "z" }, "2026-11-12"), "delivered");
});

test("pickup date: one day, window, and carrier time", () => {
  assert.equal(formatPickupTime("14:30"), "2:30 PM");
  assert.equal(formatPickupTime("00:05"), "12:05 AM");
  assert.ok(!pickupDateText({ primary_date: "2026-11-10" }).includes("Between"));
  assert.match(pickupDateText({ primary_date: "2026-11-10", backup_date: "2026-11-12" }), /^Between .+ to .+/);
  assert.match(pickupDateText({ primary_date: "2026-11-10", pickup_time: "10:00" }), / at 10:00 AM$/);
});

test("strip toggles + calendar + inbox pickup wiring", () => {
  const layout = readFileSync(new URL("../app/estimates/[id]/layout.tsx", import.meta.url), "utf8");
  assert.ok(layout.includes("setOpsFlag(") && layout.includes("ops-needs-carrier") && layout.includes("Refund"));
  const apply = readFileSync(new URL("../lib/inbox-watch/apply.ts", import.meta.url), "utf8");
  assert.ok(apply.includes("picked_up_at: now"));
  const cal = readFileSync(new URL("../app/operations/page.tsx", import.meta.url), "utf8");
  assert.ok(cal.includes("opsCalendarColor("));
});

test("audit fixes: carrier pill ON raises Job Assigned, Delivered off uses markDelivered undo, off pills blue", () => {
  const layout = readFileSync(new URL("../app/estimates/[id]/layout.tsx", import.meta.url), "utf8");
  const ops = readFileSync(new URL("../app/actions/ops.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(ops, /if \(on\) await notify\("job_assigned"/);
  assert.match(ops, /await recheckNeedsCarrier\(estimateId\)/);
  assert.match(layout, /markDelivered\(e\.id, true\)/);
  assert.match(layout, /ops-carrier-owes/);
  assert.match(css, /\.ops-pill \{[^}]*border: 1px solid var\(--brand-blue\)/);
  assert.match(css, /\.ops-pill\.idle-blue/);
});

test("Charged / Job Posted / Carrier assigned toggle on unbooked leads", async () => {
  const { readFileSync } = await import("node:fs");
  const ops = readFileSync(new URL("../app/actions/ops.ts", import.meta.url), "utf8");
  assert.match(ops, /charged: "charged_override"/);
  assert.match(ops, /\(flag === "picked" \|\| flag === "delivered"\) && est.status !== "booked"/);
  const ui = readFileSync(new URL("../app/estimates/[id]/layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /x.key === "charged"\) \{ router.push/);
});

test("Charged: real payment charge locks green (click opens Payments); override only without a charge; Refund pill red", async () => {
  const { readFileSync } = await import("node:fs");
  const ui = readFileSync(new URL("../app/estimates/[id]/layout.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(ui, /const paymentCharged = charge\.state !== "none"/);
  assert.match(ui, /chargedAt = paymentCharged \? charge\.at : ex\.charged_override === true/);
  assert.match(ui, /x\.key === "charged" && paymentCharged\) \{ router\.push\(`\/estimates\/\$\{e\.id\}\/payments`\); return; \}/);
  assert.match(ui, /charge\.state === "refund" && <button[^>]*className="ops-pill refund"/);
  assert.match(css, /\.ops-pill\.refund, button\.ops-pill\.refund:hover \{ background: #dc2626;[^}]*color: #fff/);
});
