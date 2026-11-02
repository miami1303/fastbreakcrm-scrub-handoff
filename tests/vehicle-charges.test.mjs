import test from "node:test";
import assert from "node:assert/strict";
import { cleanChargeLines, codFromTotalWithCharges, customerVehicleBlocks, jobMoney, paymentsByVehicle, vehicleMoney } from "../lib/vehicle-charges.ts";
import { accountingSummary } from "../lib/payments/returns.ts";
import { renderTemplate } from "../lib/templates/registry.ts";

test("vehicle: charge by payment goes into the Total, COD unchanged", () => {
  const m = vehicleMoney({ deposit: "200", cod: "800", charges: [{ amount: "75", collect: "payment" }] });
  assert.equal(m.totalC, 107500);
  assert.equal(m.carrierCodC, 80000);
  assert.equal(m.companyC, 27500);
  assert.equal(m.companyC + m.carrierCodC, m.totalC);
});

test("vehicle: charge on carrier COD goes into the Total AND the COD the carrier collects", () => {
  const m = vehicleMoney({ deposit: "200", cod: "800", charges: [{ amount: "100", collect: "cod" }] });
  assert.equal(m.totalC, 110000);
  assert.equal(m.carrierCodC, 90000);
  assert.equal(m.companyC, 20000);
});

test("vehicle: discount comes off the Total; COD stays the same", () => {
  const m = vehicleMoney({ deposit: "200", cod: "800", charges: [{ amount: "50" }], discount: "100" });
  assert.equal(m.totalC, 95000);
  assert.equal(m.carrierCodC, 80000);
  assert.equal(m.companyC, 15000);
  assert.equal(m.discountTooBig, false);
  assert.equal(vehicleMoney({ deposit: "200", cod: "800", discount: "250" }).discountTooBig, true);
});

test("blank / 0 amount lines are not charged; description defaults", () => {
  const r = cleanChargeLines([{ description: "Winch", amount: "75" }, { description: "", amount: "" }, { description: "Fuel", amount: "0" }], "Car");
  assert.ok(r.ok);
  assert.deepEqual(r.lines, [{ description: "Winch", amount: 75, collect: "payment" }]);
  assert.equal(cleanChargeLines([{ description: "", amount: "40", collect: "cod" }], "Car").lines[0].description, "Additional charge 1");
  assert.equal(cleanChargeLines([{ description: "x", amount: "abc" }], "Car").ok, false);
});

test("job totals = sum over vehicles (+ legacy job lines by payment)", () => {
  const j = jobMoney([
    { deposit: "200", cod: "800", charges: [{ amount: "75" }], discount: "50" },
    { deposit: "150", cod: "600", charges: [{ amount: "100", collect: "cod" }] },
  ], [{ amount: "25" }]);
  assert.equal(j.totalC, 102500 + 85000 + 2500);
  assert.equal(j.carrierCodC, 80000 + 70000);
  assert.equal(j.companyC + j.carrierCodC, j.totalC);
  assert.equal(j.discountC, 5000);
});

test("typing the vehicle Total: COD = Total - Deposit - charges + Discount", () => {
  assert.deepEqual(codFromTotalWithCharges("1000", { deposit: "200", charges: [{ amount: "75" }], discount: "25" }), { codC: 75000, short: false });
  assert.deepEqual(codFromTotalWithCharges("100", { deposit: "200" }), { codC: 0, short: true });
});

test("customer payments per vehicle; unassigned stay on the job; one vehicle = all on it", () => {
  const p = paymentsByVehicle([{ amount: 100, vehicle_index: 0 }, { amount: 50, vehicle_index: 1 }, { amount: 20, vehicle_index: null }, { amount: 99, vehicle_index: 0, voided_at: "x" }, { amount: 5, vehicle_index: 1, counts: false }], 2);
  assert.deepEqual(p, { byVehicleC: [10000, 5000], jobC: 2000, totalC: 17000 });
  assert.deepEqual(paymentsByVehicle([{ amount: 10, vehicle_index: 3 }], 1).byVehicleC, [1000]);
});

test("customer view: discount never shown, row is net; charges under the vehicle add up", () => {
  const b = customerVehicleBlocks([{ extra_charges: [{ description: "Winch", amount: 75 }], discount_amount: 100 }], () => 100000, { rows: [], show: false });
  assert.equal(b[0].priceText, "$900.00");
  assert.deepEqual(b[0].extras, [{ description: "Winch", cents: 7500 }]);
  const big = customerVehicleBlocks([{ extra_charges: [{ description: "Winch", amount: 75 }], discount_amount: 120 }], () => 100, { rows: [], show: false });
  assert.equal(big[0].priceText, "$0.00");
  // $1.00 row, $120 discount: $1.00 off the row, $119 off the $75 charge -> nothing left to show
  assert.deepEqual(big[0].extras, []);
});

test("customer doc: per-vehicle charges print under the vehicle, discount never printed, payment only when ≠ 0", () => {
  const base = {
    est: { job_number: "DA9", customer_name: "Pat", created_at: "2026-10-31T12:00:00Z" },
    vehicles: [
      { year: 2020, make: "Honda", model: "Civic", deposit_amount: 200, cod_amount: 800, extra_charges: [{ description: "Winch", amount: 75, collect: "payment" }], discount_amount: 50 },
      { year: 2019, make: "Ford", model: "F150", deposit_amount: 150, cod_amount: 600, extra_charges: [], discount_amount: null },
    ],
    quote: { total_amount: 1775, deposit_amount: 350, cod_amount: 1400 },
    assetBaseUrl: "https://crm.example.com",
  };
  const html = renderTemplate("e_quote", { ...base, paidAmount: null }).html;
  assert.match(html, /Winch:/);
  assert.match(html, /\$950\.00/); // Civic 200 + 800 - 50
  assert.doesNotMatch(html, /Discount/i);
  assert.doesNotMatch(html, /Customer Payment/);
  const paid = renderTemplate("booked_esign", { ...base, paidAmount: 300, paidRows: [{ amount: 300, vehicle_index: 0 }] }).html;
  assert.match(paid, /Customer Payment \(2020 \/ Honda \/ Civic\):/);
  assert.match(paid, /Customer Balance:/);
});

test("accounting: a refunded deposit comes off Deposit paid / Deposit kept", () => {
  const a = accountingSummary({
    payments: [
      { amount: 500, is_deposit: true, charge_status: "succeeded", confirmation_no: "pi_1" },
      { amount: -200, is_deposit: true, charge_status: "succeeded", confirmation_no: "re_1" },
    ],
    carrier: [{ status: "sent", amount: 100, source: "deposit" }],
    totalAmount: 1500, codAmount: 1000,
  });
  assert.equal(a.depositPaidC, 30000);
  assert.equal(a.depositKeptC, 20000);
  assert.equal(a.customerPaidC, 30000);
  assert.equal(a.refundedC, 20000);
  assert.equal(a.balanceC, 120000);
});

// ---- Shared Additional charges & discount box: vehicle# set vs blank (Owner 2026-10-31) ----
import { distributeSharedRows as dist, sharedRowsFromVehicles as rowsFrom, parseVehicleNo, jobMoney as jm2, savedChargeLines, chargeLinesForForm } from "../lib/vehicle-charges.ts";

const blankRow = { description: "", amount: "", collect: "payment", veh: "" };
test("parseVehicleNo: blank = all, 1..n = index, else bad", () => {
  assert.equal(parseVehicleNo("", 2), null);
  assert.equal(parseVehicleNo(" 2 ", 2), 1);
  assert.equal(parseVehicleNo("3", 2), "bad");
  assert.equal(parseVehicleNo("0", 2), "bad");
  assert.equal(parseVehicleNo("x", 2), "bad");
});

test("shared box: vehicle# 2 puts the charge and discount on vehicle 2 only", () => {
  const r = dist({ charges: [{ description: "Winch", amount: "75", collect: "cod", veh: "2" }, blankRow, blankRow], discounts: [{ veh: "2", amount: "50" }] }, 2);
  assert.deepEqual(r.vehicles[0], { charges: [], discount: "" });
  assert.deepEqual(r.vehicles[1], { charges: [{ description: "Winch", amount: "75", collect: "cod" }], discount: "50" });
  assert.deepEqual(r.bad, []);
});

test("shared box: blank vehicle# = all vehicles, applied ONCE on vehicle 1 (never multiplied)", () => {
  const r = dist({ charges: [{ description: "Fuel", amount: "40", collect: "payment", veh: "" }, blankRow, blankRow], discounts: [{ veh: "", amount: "25" }] }, 3);
  assert.deepEqual(r.vehicles[0].charges, [{ description: "Fuel", amount: "40", collect: "payment", all: true }]);
  assert.equal(r.vehicles[0].discount, "25");
  assert.deepEqual(r.vehicles.slice(1).map(v => v.charges.length + (v.discount ? 1 : 0)), [0, 0]);
  const m = jm2(r.vehicles.map((v, i) => ({ deposit: 100, cod: 500 + i, charges: v.charges, discount: v.discount })));
  assert.equal(m.extrasC, 4000);
  assert.equal(m.discountC, 2500);
});

test("shared box: one vehicle ignores vehicle# and never flags all", () => {
  const r = dist({ charges: [{ description: "Fuel", amount: "40", collect: "payment", veh: "" }, blankRow, blankRow], discounts: [{ veh: "", amount: "" }] }, 1);
  assert.deepEqual(r.vehicles[0], { charges: [{ description: "Fuel", amount: "40", collect: "payment" }], discount: "" });
});

test("shared box: a bad vehicle# is flagged and counted on vehicle 1", () => {
  const r = dist({ charges: [{ description: "X", amount: "10", collect: "payment", veh: "9" }, blankRow, blankRow], discounts: [{ veh: "", amount: "" }] }, 2);
  assert.deepEqual(r.bad, ["Additional charge 1"]);
  assert.equal(r.vehicles[0].charges.length, 1);
});

test("shared box: two discounts on the same vehicle add up", () => {
  const r = dist({ charges: [blankRow], discounts: [{ veh: "2", amount: "10" }, { veh: "2", amount: "5.50" }] }, 2);
  assert.equal(r.vehicles[1].discount, "15.50");
});

test("shared box round trip: rows -> vehicles -> rows keeps vehicle# and blank (all)", () => {
  const rows = { charges: [{ description: "Fuel", amount: "40", collect: "payment", veh: "" }, { description: "Winch", amount: "75", collect: "cod", veh: "2" }, blankRow], discounts: [{ veh: "2", amount: "50" }] };
  const back = rowsFrom(dist(rows, 2).vehicles);
  assert.deepEqual(back.charges, rows.charges);
  assert.deepEqual(back.discounts, rows.discounts);
  // vehicle 1 discount reads back blank (= all; same money either way)
  assert.deepEqual(rowsFrom(dist({ charges: [blankRow], discounts: [{ veh: "1", amount: "5" }] }, 2).vehicles).discounts, [{ veh: "", amount: "5" }]);
});

test("saved lines keep the all flag through clean + saved + form", () => {
  const c = cleanChargeLines([{ description: "Fuel", amount: "40", collect: "payment", all: true }], "V");
  assert.equal(c.ok, true);
  assert.deepEqual(c.lines, [{ description: "Fuel", amount: 40, collect: "payment", all: true }]);
  assert.deepEqual(savedChargeLines(c.lines)[0].all, true);
  assert.equal(chargeLinesForForm(c.lines)[0].all, true);
  assert.equal(chargeLinesForForm([{ description: "A", amount: 1, collect: "payment" }])[0].all, undefined);
});
