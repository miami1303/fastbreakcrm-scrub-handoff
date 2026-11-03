import test from "node:test";
import assert from "node:assert/strict";
import {
  autoChargeAmountCents,
  autoChargeDecision,
  armAutoCharge,
  NO_CARD_MESSAGE,
  NOTHING_DUE_MESSAGE,
  STRIPE_HINT,
} from "../lib/auto-charge.ts";
import { stripeConnected } from "../lib/payments/provider.ts";
import {
  customerShowsPayments,
  customerVehiclePriceText,
  describeVehiclePriceChanges,
  resolveVehicleMoney,
  sumEnteredVehicles,
} from "../lib/vehicle-pricing.ts";
import { renderTemplate } from "../lib/templates/registry.ts";

test("stripe stays disconnected until the provider is marked ready", () => {
  assert.equal(stripeConnected(), false);
});

test("auto-charge: inert until Stripe is connected; no card and no double charge", () => {
  assert.equal(armAutoCharge({ stripeConnected: false, hasCard: true, wantOn: true }).ok, false);
  assert.match(armAutoCharge({ stripeConnected: false, hasCard: true, wantOn: true }).error, new RegExp(STRIPE_HINT));
  assert.equal(armAutoCharge({ stripeConnected: true, hasCard: false, wantOn: true }).error, NO_CARD_MESSAGE);
  assert.deepEqual(armAutoCharge({ stripeConnected: true, hasCard: true, wantOn: true }), { ok: true, on: true });
  assert.deepEqual(armAutoCharge({ stripeConnected: false, hasCard: false, wantOn: false }), { ok: true, on: false });

  const ready = { enabled: true, stripeConnected: true, hasCard: true, bothSigned: true, alreadyCharged: false, amountCents: 29500 };
  assert.equal(autoChargeDecision({ ...ready, stripeConnected: false }).reason, "stripe");
  assert.equal(autoChargeDecision({ ...ready, enabled: false }).reason, "off");
  assert.equal(autoChargeDecision({ ...ready, bothSigned: false }).reason, "waiting");
  assert.equal(autoChargeDecision({ ...ready, alreadyCharged: true }).reason, "already");
  assert.equal(autoChargeDecision({ ...ready, hasCard: false }).message, NO_CARD_MESSAGE);
  assert.equal(autoChargeDecision({ ...ready, amountCents: 0 }).message, NOTHING_DUE_MESSAGE);
  assert.deepEqual(autoChargeDecision(ready), { action: "charge", amountCents: 29500 });
});

test("auto-charge amount: unpaid deposit, never more than the balance, 0 when the deposit is already paid", () => {
  assert.equal(autoChargeAmountCents({ depositCents: 29500, totalCents: 129500, paidCents: 0 }), 29500);
  assert.equal(autoChargeAmountCents({ depositCents: 29500, totalCents: 129500, paidCents: 10000 }), 19500);
  assert.equal(autoChargeAmountCents({ depositCents: 29500, totalCents: 129500, paidCents: 29500 }), 0);
  assert.equal(autoChargeAmountCents({ depositCents: 0, totalCents: 129500, paidCents: 0 }), 129500);
  assert.equal(autoChargeAmountCents({ depositCents: 0, totalCents: 129500, paidCents: 129500 }), 0);
});

test("per-vehicle sums: multi, single, extras, rounding, explicit split beats a stale job total", () => {
  const split = resolveVehicleMoney(
    [{ deposit: "100", cod: "50" }, { deposit: "20.00", cod: "30" }],
    "999", "999",
    [],
  );
  assert.equal(split.mode, "split");
  assert.equal(split.depositC, 12000);
  assert.equal(split.codC, 8000);
  assert.equal(split.totalC, 20000);

  const one = resolveVehicleMoney([{ deposit: "295", cod: "1000" }], "295", "1000", [{ amount: "75" }]);
  assert.equal(one.vehicles[0].totalC, 129500, "vehicle total excludes extras");
  assert.equal(one.extrasC, 7500);
  assert.equal(one.totalC, 137000, "job total includes extras once");

  const cents = resolveVehicleMoney(
    [{ deposit: "33.33", cod: "0" }, { deposit: "33.33", cod: "0" }, { deposit: "33.34", cod: "0" }],
    "", "",
    [{ amount: "0.01" }],
  );
  assert.equal(cents.depositC, 10000);
  assert.equal(cents.extrasC, 1);
  assert.equal(cents.totalC, 10001);
  assert.deepEqual(sumEnteredVehicles([{ deposit: "0.10", cod: "0.20" }]), { depositC: 10, codC: 20, totalC: 30, invalid: false });
  assert.equal(sumEnteredVehicles([{ deposit: "nope", cod: "" }]).invalid, true);
});

test("legacy fallback puts the job deposit and COD on the first vehicle; a mismatch keeps the saved job COD", () => {
  const fallback = resolveVehicleMoney([{ price: "" }, { price: "" }], "295", "1000", []);
  assert.equal(fallback.mode, "fallback");
  assert.deepEqual(
    fallback.vehicles.map(v => [v.depositC, v.codC]),
    [[29500, 100000], [0, 0]],
  );
  assert.equal(fallback.totalC, 129500);

  const priced = resolveVehicleMoney(
    [{ price: "400", qty: 1 }, { price: "350", qty: 2 }, {}],
    "295", "1100",
    [],
  );
  assert.equal(priced.mode, "fallback", "job COD equals price × qty, so the split fits");
  assert.equal(priced.vehicles[0].depositC, 29500);
  assert.equal(priced.vehicles[0].codC, 40000);
  assert.equal(priced.vehicles[1].codC, 70000);
  assert.equal(priced.codC, 110000);

  const mismatch = resolveVehicleMoney(
    [{ price: "400", qty: 1 }, { price: "350", qty: 2 }, {}],
    "295", "500",
    [],
  );
  assert.equal(mismatch.mode, "legacy-mismatch");
  assert.equal(mismatch.depositC, 29500);
  assert.equal(mismatch.codC, 50000, "saved job COD is kept");
  assert.equal(mismatch.totalC, 79500);
  assert.equal(mismatch.vehicles[0].codC, 40000);
  assert.equal(mismatch.vehicles[1].codC, 70000);
});

test("customer price cell: one vehicle is the job total; several vehicles show their own total", () => {
  const quote = { total_amount: 1370, deposit_amount: 295, cod_amount: 1000 };
  assert.equal(customerVehiclePriceText([{ deposit: "295", cod: "1000" }], 0, quote), "$1370.00");
  const multi = [
    { year: 2021, make: "Toyota", model: "Camry", deposit_amount: 200, cod_amount: 400 },
    { year: 2019, make: "Ford", model: "F-150", deposit_amount: 0, cod_amount: 0 },
    { year: 2020, make: "Honda", model: "Civic" },
  ];
  assert.equal(customerVehiclePriceText(multi, 0, quote), "$600.00");
  assert.equal(customerVehiclePriceText(multi, 1, quote), "$0.00", "explicit zero is shown");
  assert.equal(customerVehiclePriceText(multi, 2, quote), "", "a fallback blank stays blank");

  const legacy = [{ price: 400, qty: 1 }, { price: 350, qty: 2 }, {}];
  const legacyQuote = { total_amount: 870, deposit_amount: 295, cod_amount: 500 };
  assert.equal(customerVehiclePriceText(legacy, 0, legacyQuote), "$400.00");
  assert.equal(customerVehiclePriceText(legacy, 1, legacyQuote), "$700.00");
  assert.equal(customerVehiclePriceText(legacy, 2, legacyQuote), "");
});

test("customer payments: every customer document once a payment is entered (booked or not)", () => {
  for (const kind of ["e_quote", "quote"]) {
    assert.equal(customerShowsPayments(kind, true), true);
    assert.equal(customerShowsPayments(kind, false), false);
  }
  assert.equal(customerShowsPayments("booked", false), false);
  assert.equal(customerShowsPayments("cc", false), false);
  assert.equal(customerShowsPayments("booked", true), true);
  assert.equal(customerShowsPayments("cc", true), true);
});

test("customer documents: multi-vehicle prices, no deposit/COD split, payment rows follow the booked rule", () => {
  const vehicles = [
    { year: 2021, make: "Toyota", model: "Camry", vehicle_type: "Sedan", is_running: true, is_enclosed: false, deposit_amount: 200, cod_amount: 400, asap: true, remarks: "Keys" },
    { year: 2019, make: "Ford", model: "F-150", vehicle_type: "Pickup", is_running: true, is_enclosed: false, deposit_amount: 95, cod_amount: 600 },
  ];
  const doc = {
    est: { job_number: "FB400001", customer_name: "Jane Rivera", created_at: "2026-10-23T12:00:00Z" },
    vehicles,
    quote: { total_amount: 1295, deposit_amount: 295, cod_amount: 1000 },
    assetBaseUrl: "https://crm.example.test",
    links: { esignHref: "https://crm.example.test/d/tok#esign" },
  };
  const quote = renderTemplate("e_quote", { ...doc, paidAmount: 295 }).html;
  assert.ok(quote.includes("$600.00") && quote.includes("$695.00"));
  assert.ok(quote.includes(">Keys<") && quote.includes(">ASAP<"), "remark in Remarks, flags on the line under");
  assert.ok(quote.includes("$1295.00"));
  // Owner 2026-10-31: a payment entered shows on the E-Quote too (before booking).
  assert.ok(quote.includes("Customer Payment") && quote.includes("Customer Balance") && quote.includes("$1000.00"));
  assert.ok(!quote.includes("Carrier COD"));

  const booked = renderTemplate("booked_esign", { ...doc, paidAmount: null }).html;
  assert.ok(!booked.includes("Customer Payment"));
  const paid = renderTemplate("booked_esign", { ...doc, paidAmount: 295 }).html;
  assert.ok(paid.includes("Customer Payment") && paid.includes("$295.00"));
  assert.ok(paid.includes("Customer Balance") && paid.includes("$1000.00"));
  const cc = renderTemplate("cc_form", { ...doc, paidAmount: 295 }).html;
  assert.ok(cc.includes("Customer Payment") && cc.includes("Customer Balance"));
});

test("charges history names the vehicle and the deposit, COD, and total", () => {
  const lines = describeVehiclePriceChanges(
    [{ year: 2026, make: "Mercedes", model: "550", depositC: 29500, codC: 100000 }],
    [{ year: 2026, make: "Mercedes", model: "550", depositC: 34500, codC: 100000 }],
  );
  assert.deepEqual(lines, ["2026 Mercedes 550: Deposit 295.00 → 345.00 · Carrier COD 1000.00 → 1000.00 · Total 1295.00 → 1345.00"]);
  const added = describeVehiclePriceChanges([], [{ make: "Honda", model: "Civic", depositC: 0, codC: 0 }]);
  assert.equal(added[0], "Honda Civic: added · Deposit 0.00 · Carrier COD 0.00 · Total 0.00");
});
