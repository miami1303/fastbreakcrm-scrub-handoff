import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyEmail, extractAmountCents, extractJobNumber, gmailQuery, isCrystalMail, isFastBreakMail } from "../lib/inbox-watch/classify.ts";
import { BANNERS, KIND_TO_BANNER, STICKY_BANNERS } from "../lib/crm-constants.ts";

const FB = "support@fastbreakcrm.test";

test("job number extraction", () => {
  assert.equal(extractJobNumber("Order FB400123 picked up"), "FB400123");
  assert.equal(extractJobNumber("Load ID: FB-400555"), "FB400555");
  assert.equal(extractJobNumber("Job # 400777 delivered"), "FB400777");
  assert.equal(extractJobNumber("call 555-010-0101"), "");
});

test("amount extraction", () => {
  assert.equal(extractAmountCents("You received $1,100.00 from"), 110000);
  assert.equal(extractAmountCents("amount USD 100"), 10000);
  assert.equal(extractAmountCents("no money here"), null);
});

test("crystal company mail is always ignored, even with FB address + payment words", () => {
  const m = { id: "1", from: "Zelle <alerts@zellepay.com>", to: FB, subject: "You received a payment", body: "Jane Doe sent you $45.00 for Amethyst crystal set" };
  assert.ok(isCrystalMail(m));
  assert.equal(classifyEmail(m).kind, "ignore");
  const lab = { id: "2", from: "notifications@stripe.com", to: FB, subject: "Payment of $20.00 succeeded", body: "Fast Break", labels: ["Crystal"] };
  assert.equal(classifyEmail(lab).kind, "ignore");
  assert.equal(classifyEmail({ ...lab, labels: [], body: "x" }, ["sideshop"]).kind, "customer_payment");
  assert.equal(classifyEmail({ ...lab, labels: [], body: "sideshop order" }, ["sideshop"]).kind, "ignore");
});

test("non-FB payment mail is ignored", () => {
  const m = { id: "3", from: "notifications@stripe.com", to: "someone@else.com", subject: "Payment of $20.00 succeeded", body: "Thanks" };
  assert.equal(isFastBreakMail(m), false);
  assert.equal(classifyEmail(m).kind, "ignore");
});

test("FB customer payment (Stripe) -> customer_payment with amount, charged, ref, email", () => {
  const m = { id: "4", from: "Stripe <notifications@stripe.com>", to: FB, subject: "Payment of $395.00 succeeded — Fast Break", body: "Customer: John Smith\njohn@example.com\nFB400123\npi_3ABCDEFGHIJ" };
  const c = classifyEmail(m);
  assert.equal(c.kind, "customer_payment");
  assert.equal(c.amountCents, 39500);
  assert.equal(c.charged, true);
  assert.equal(c.jobNumber, "FB400123");
  assert.equal(c.customerEmail, "john@example.com");
  assert.equal(c.reference, "pi_3ABCDEFGHIJ");
  assert.equal(c.method, "Credit Card");
});

test("FB Zelle with carrier info -> carrier_payment", () => {
  const m = { id: "5", from: "alerts@zellepay.com", to: FB, subject: "You received money with Zelle", body: "ABC Trucking LLC sent you $100.00. Memo: carrier owes FB400123 MC# 123456" };
  const c = classifyEmail(m);
  assert.equal(c.kind, "carrier_payment");
  assert.equal(c.jobNumber, "FB400123");
  assert.equal(c.amountCents, 10000);
  assert.equal(c.method, "Zelle");
});

test("failed payment is detected as not charged", () => {
  const m = { id: "6", from: "notifications@stripe.com", to: FB, subject: "Payment of $50.00 failed", body: "Fast Break" };
  assert.equal(classifyEmail(m).charged, false);
});

test("Central Dispatch pickup / delivered (TODO: replace with real samples)", () => {
  const p = classifyEmail({ id: "7", from: "Central Dispatch <noreply@centraldispatch.com>", to: FB, subject: "Vehicle(s) Picked Up - Order ID FB400123", body: "Delivery ETA 11/5" });
  assert.equal(p.kind, "cd_pickup"); assert.equal(p.jobNumber, "FB400123");
  const d = classifyEmail({ id: "8", from: "noreply@centraldispatch.com", to: FB, subject: "Order FB400123 has been delivered", body: "" });
  assert.equal(d.kind, "cd_delivered");
  assert.equal(classifyEmail({ id: "9", from: "noreply@centraldispatch.com", to: FB, subject: "Weekly newsletter", body: "" }).kind, "ignore");
  // Crystal check runs before CD too.
  assert.equal(classifyEmail({ id: "10", from: "noreply@centraldispatch.com", subject: "Crystal order picked up", body: "" }).kind, "ignore");
});

test("gmail query excludes crystal words", () => {
  const q = gmailQuery(2);
  assert.match(q, /-crystal/);
  assert.match(q, /centraldispatch\.com/);
});

test("new banners exist, map from kinds, and are not sticky", () => {
  for (const [kind, key] of [["payment_received", "paymentReceived"], ["customer_pickup", "customerPickup"], ["customer_delivered", "customerDelivered"]]) {
    assert.equal(KIND_TO_BANNER[kind], key);
    assert.ok(BANNERS[key]);
    assert.ok(!STICKY_BANNERS.has(key));
  }
});

test("carrier paid goes to deposit bookkeeping only (no payments row)", () => {
  const src = readFileSync(new URL("../app/actions/carrier-owes.ts", import.meta.url), "utf8");
  assert.match(src, /carrier_owes_deposited_at/);
  assert.doesNotMatch(src, /from\("payments"\)/);
  const apply = readFileSync(new URL("../lib/inbox-watch/apply.ts", import.meta.url), "utf8");
  const carrierBlock = apply.slice(apply.indexOf('c.kind === "carrier_payment"'), apply.indexOf("// Customer payment"));
  assert.doesNotMatch(carrierBlock, /from\("payments"\)/);
});
