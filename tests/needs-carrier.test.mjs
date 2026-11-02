import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addDays, needsCarrierAction, needsCarrierDue, needsCarrierMessage, pickupWindowEnd, pickupWindowKey } from "../lib/needs-carrier.ts";
import { carrierOwesEmail } from "../lib/carrier-owes.ts";
import { BANNERS, CLEAR_ON_LEAD_OPEN, CLEAR_ON_VIEW, KIND_TO_BANNER, PER_VIEWER_KINDS, STICKY_BANNERS, UNTIL_CARRIER_OR_DATES } from "../lib/crm-constants.ts";

const job = { status: "booked", job_number: "FB400010", customer_name: "Jane", primary_date: "2026-10-20", backup_date: "2026-10-22", carrier_assigned_at: null };

test("ATTN Ops carrier owes: subject + body carry job# and carrier info", () => {
  const m = carrierOwesEmail({ job: "FB400010", customer: "Jane", pickup: "Miami, FL", delivery: "Austin, TX", amount: "$100.00", deliveredAt: "10/31/2026", carrier: "ACME Haul\nMC 123", url: "https://x/e/1/payments", vehicles: "" });
  assert.match(m.subject, /ATTN Ops carrier owes/);
  assert.match(m.subject, /FB400010/);
  assert.match(m.text, /ATTN Ops/);
  assert.match(m.text, /ACME Haul\nMC 123/);
  // CD-delivered path (inbox watch) sends the same email, gated once per delivery.
  const apply = readFileSync(new URL("../lib/inbox-watch/apply.ts", import.meta.url), "utf8");
  assert.match(apply, /sendCarrierOwesEmail/);
  assert.match(apply, /is\("carrier_owes_notified_at", null\)/);
});

test("pickup window end = second date, else first", () => {
  assert.equal(pickupWindowEnd(job), "2026-10-22");
  assert.equal(pickupWindowEnd({ primary_date: "2026-10-20" }), "2026-10-20");
  assert.equal(pickupWindowEnd({ primary_date: "2026-10-20", backup_date: "2026-10-18" }), "2026-10-20");
  assert.equal(pickupWindowEnd({}), "");
  assert.equal(addDays("2026-12-31", 2), "2027-01-02");
});

test("raises 2 days after window end with no carrier", () => {
  assert.equal(needsCarrierDue(job, "2026-10-23"), false);
  assert.equal(needsCarrierDue(job, "2026-10-24"), true);
  assert.equal(needsCarrierAction(job, null, "2026-10-24"), "raise");
  assert.equal(needsCarrierAction(job, pickupWindowKey(job), "2026-10-30"), "keep"); // no duplicate
  assert.equal(needsCarrierDue({ primary_date: "2026-10-20", status: "booked" }, "2026-10-22"), true);
  assert.equal(needsCarrierDue({ ...job, status: "quoted" }, "2026-11-30"), false);
  assert.match(needsCarrierMessage(job), /Job #FB400010.*pickup window ended 2026-10-22.*no carrier/);
});

test("does not raise when a carrier is assigned", () => {
  assert.equal(needsCarrierAction({ ...job, carrier_assigned_at: "2026-10-21T00:00:00Z" }, null, "2026-11-01"), "keep");
});

test("clears when carrier assigned or pickup window changes", () => {
  const key = pickupWindowKey(job);
  assert.equal(needsCarrierAction({ ...job, carrier_assigned_at: "2026-10-25T00:00:00Z" }, key, "2026-10-26"), "clear");
  assert.equal(needsCarrierAction({ ...job, backup_date: "2026-10-30" }, key, "2026-10-26"), "clear");
  assert.equal(needsCarrierAction({ ...job, backup_date: "2026-10-23" }, key, "2026-10-30"), "clear_raise"); // new window also overdue
  const leads = readFileSync(new URL("../app/actions/leads.ts", import.meta.url), "utf8");
  assert.ok((leads.match(/recheckNeedsCarrier\(estimateId\)/g) || []).length >= 2);
});

test("payment / pickup / delivered / carrier owes dismiss on each admin's view", () => {
  for (const k of ["paymentReceived", "customerPickup", "customerDelivered", "carrierOwes"]) {
    assert.ok(CLEAR_ON_VIEW.has(k) && !STICKY_BANNERS.has(k) && CLEAR_ON_LEAD_OPEN.has(k), k);
  }
  for (const k of ["payment_received", "customer_pickup", "customer_delivered", "carrier_owes"]) assert.ok(PER_VIEWER_KINDS.has(k));
  const banners = readFileSync(new URL("../app/actions/banners.ts", import.meta.url), "utf8");
  assert.match(banners, /\.eq\("user_id", staff\.userId\)/); // only the viewer's own rows
});

test("needs carrier does NOT dismiss on view", () => {
  assert.equal(KIND_TO_BANNER.needs_carrier, "needsCarrier");
  assert.ok(BANNERS.needsCarrier);
  assert.ok(UNTIL_CARRIER_OR_DATES.has("needsCarrier") && STICKY_BANNERS.has("needsCarrier"));
  assert.ok(!CLEAR_ON_VIEW.has("needsCarrier") && !CLEAR_ON_LEAD_OPEN.has("needsCarrier"));
  const banners = readFileSync(new URL("../app/actions/banners.ts", import.meta.url), "utf8");
  assert.match(banners, /neq\("kind", "needs_carrier"\)/); // markSeen refuses it server-side too
});

test("Carrier paid: banner for all admins, clears per admin on view, ATTN Ops email", async () => {
  const { carrierPaidEmail } = await import("../lib/carrier-owes.ts");
  assert.equal(KIND_TO_BANNER.carrier_paid, "carrierPaid");
  assert.ok(BANNERS.carrierPaid.label === "Carrier paid");
  assert.ok(CLEAR_ON_VIEW.has("carrierPaid") && CLEAR_ON_LEAD_OPEN.has("carrierPaid") && !STICKY_BANNERS.has("carrierPaid"));
  assert.ok(PER_VIEWER_KINDS.has("carrier_paid"));
  const m = carrierPaidEmail({ job: "FB400010", customer: "Jane", amount: "$100.00", paidAt: "10/31/2026", method: "Zelle", carrier: "ACME Haul\nMC 123", url: "https://x/e/1/payments", vehicles: "2020 Honda Civic" });
  assert.match(m.subject, /^ATTN Ops carrier paid: \$100\.00 — Job #FB400010 — Jane$/);
  assert.match(m.text, /ACME Haul/); assert.match(m.text, /https:\/\/x\/e\/1\/payments/);
});

test("Needs carrier email: subject/body + wired once per window in the cron run", async () => {
  const { needsCarrierEmail } = await import("../lib/needs-carrier.ts");
  const m = needsCarrierEmail({ job: "FB400010", customer: "Jane", windowEnd: "2026-10-22", url: "https://x/estimates/1" });
  assert.match(m.subject, /^ATTN needs carrier: Job #FB400010 — Jane$/);
  assert.match(m.text, /^ATTN needs carrier\./);
  assert.match(m.text, /Pickup window ended: 2026-10-22/);
  assert.match(m.text, /https:\/\/x\/estimates\/1/);
  const run = readFileSync(new URL("../lib/needs-carrier-run.ts", import.meta.url), "utf8");
  const claim = run.indexOf('.is("needs_carrier_window", null)'), send = run.indexOf("sendNeedsCarrierEmail(e)");
  assert.ok(claim > 0 && send > claim, "email sent only after claiming the window");
  const alert = readFileSync(new URL("../lib/carrier-owes-alert.ts", import.meta.url), "utf8");
  assert.match(alert, /CARRIER_OWES_EMAIL_TO = process.env.OPS_ALERT_EMAIL/);
});
