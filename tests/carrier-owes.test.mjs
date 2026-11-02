import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { carrierOwesEmail, carrierOwesState, checkWindow, customerMoney, parseCarrierOwes } from "../lib/carrier-owes.ts";
import { vehicleMoney } from "../lib/vehicle-charges.ts";
import { BANNERS, BANNER_DIRECTION, KIND_TO_BANNER, STICKY_BANNERS, UNTIL_CARRIER_PAID, UNTIL_LEAD_OPENED } from "../lib/crm-constants.ts";

test("Owner's example: deposit 395 + COD 1100 = customer 1495 / balance 1100, carrier owes 100 is back office only", () => {
  const est = { deposit: "395", cod: "1100", carrier_owes_amount: 100 };
  const cust = customerMoney({ deposit: est.deposit, cod: est.cod, paid: "395" });
  assert.equal(cust.totalC, 149500);
  assert.equal(cust.paidC, 39500);
  assert.equal(cust.balanceC, 110000);
  // Same numbers with or without carrier owes; the vehicle math has no carrier-owes input either.
  const a = vehicleMoney({ deposit: "395", cod: "1100", charges: [], discount: "" });
  const b = vehicleMoney({ deposit: "395", cod: "1100", charges: [], discount: "", carrier_owes_amount: 100 });
  assert.deepEqual(a, b);
  assert.equal(a.totalC, 149500);
  assert.equal(carrierOwesState(est).owesC, 10000);
});

test("banner only after delivered, until paid", () => {
  assert.equal(carrierOwesState({ carrier_owes_amount: 100 }).bannerOn, false);
  assert.equal(carrierOwesState({ carrier_owes_amount: 100, delivered_at: "2026-10-31T12:00:00Z" }).bannerOn, true);
  const paid = carrierOwesState({ carrier_owes_amount: "100.00", delivered_at: "2026-10-31T12:00:00Z", carrier_owes_paid_at: "2026-11-01T12:00:00Z" });
  assert.equal(paid.bannerOn, false);
  assert.equal(paid.paid, true);
  assert.equal(paid.owesC, 10000); // paid does not erase the amount (history), it just stops the banner
  assert.equal(carrierOwesState({ carrier_owes_amount: 0, delivered_at: "x" }).bannerOn, false);
  assert.equal(carrierOwesState({ carrier_owes_amount: null, delivered_at: "x" }).bannerOn, false);
});

test("parse carrier owes amount", () => {
  assert.deepEqual(parseCarrierOwes("$100"), { ok: true, amount: 100 });
  assert.deepEqual(parseCarrierOwes("1,250.5"), { ok: true, amount: 1250.5 });
  assert.deepEqual(parseCarrierOwes(""), { ok: true, amount: null });
  assert.deepEqual(parseCarrierOwes("0"), { ok: true, amount: null });
  assert.equal(parseCarrierOwes("-100").ok, false);
  assert.equal(parseCarrierOwes("abc").ok, false);
});

test("two-day windows", () => {
  assert.equal(checkWindow("F.A.D.", "2026-11-02", "2026-11-03"), null);
  assert.equal(checkWindow("F.A.D.", "2026-11-02", ""), null);
  assert.equal(checkWindow("F.A.D.", "", ""), null);
  assert.match(checkWindow("F.A.D.", "", "2026-11-03"), /first date/);
  assert.match(checkWindow("F.A.D.", "2026-11-03", "2026-11-02"), /before/);
});

test("carrier owes banner: own kind, clears on each admin's view, paid clears for everyone", () => {
  assert.equal(KIND_TO_BANNER.carrier_owes, "carrierOwes");
  assert.ok(BANNERS.carrierOwes.label.toLowerCase().includes("carrier owes"));
  assert.ok(BANNER_DIRECTION.carrierOwes);
  assert.ok(!UNTIL_CARRIER_PAID.has("carrierOwes"));
  assert.ok(!UNTIL_LEAD_OPENED.has("carrierOwes"));
  assert.ok(!STICKY_BANNERS.has("carrierOwes") && STICKY_BANNERS.has("jobAssigned"));
  const banners = readFileSync(new URL("../app/components/CrmBanners.tsx", import.meta.url), "utf8");
  assert.match(banners, /!STICKY_BANNERS\.has\(k\)/); // opening the panel never marks it seen
  const act = readFileSync(new URL("../app/actions/carrier-owes.ts", import.meta.url), "utf8");
  const alert = readFileSync(new URL("../lib/carrier-owes-alert.ts", import.meta.url), "utf8");
  assert.match(alert, /ops@fastbreakcrm\.test/);
  assert.match(act, /sendCarrierOwesEmail/);
  assert.match(act, /eq\("kind", "carrier_owes"\)\.is\("dismissed_at", null\)/); // paid dismisses for everyone
  assert.doesNotMatch(act, /from\("(quotes|vehicles|payments)"\)\.(update|insert)/); // never touches customer money
});

test("customer documents never mention carrier owes", () => {
  const q = readFileSync(new URL("../lib/quote-template.ts", import.meta.url), "utf8");
  assert.doesNotMatch(q, /carrier_owes|fad_|delivery_window/);
});

test("carrier owes email has lead + carrier info", () => {
  const m = carrierOwesEmail({ job: "FB400010", customer: "Jane", pickup: "Miami, FL", delivery: "Austin, TX", amount: "$100.00", deliveredAt: "10/31/2026", carrier: "ACME Haul\n555-1212", url: "https://x/estimates/1/payments", vehicles: "2020 Honda Civic" });
  assert.match(m.subject, /^ATTN Ops carrier owes: \$100\.00 — Job #FB400010 — Jane/);
  assert.match(m.text, /^ATTN Ops — carrier owes\./);
  assert.match(m.text, /chase the carrier/);
  assert.match(m.text, /Job: FB400010/);
  assert.match(m.text, /ACME Haul/);
  assert.match(m.text, /2020 Honda Civic/);
  assert.match(m.text, /https:\/\/x\/estimates\/1\/payments/);
});

test("discount no longer says staff only", () => {
  const v = readFileSync(new URL("../app/components/VehicleExtrasBox.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(v, /staff only/i);
});

import { carrierOwesPill } from "../lib/carrier-owes.ts";
test("Carrier owes strip pill: hidden / blue / green", () => {
  assert.equal(carrierOwesPill({}), "hidden");
  assert.equal(carrierOwesPill({ carrier_owes_amount: 100 }), "blue");
  assert.equal(carrierOwesPill({ carrier_owes_amount: 100, picked_up_at: "x" }), "blue");
  assert.equal(carrierOwesPill({ carrier_owes_amount: 100, delivered_at: "x" }), "green");
  assert.equal(carrierOwesPill({ carrier_owes_amount: 100, delivered_at: "x", carrier_owes_paid_at: "y" }), "hidden");
  assert.equal(carrierOwesPill({ carrier_owes_amount: 0, delivered_at: "x" }), "hidden");
});
