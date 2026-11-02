import test from "node:test";
import assert from "node:assert/strict";
import { balanceCents, chargesSummary, codFromTotal, extrasCents, totalCents, vehiclesCodCents, lineCents } from "../lib/pricing.ts";
import { extraChargesFrom } from "../lib/extra-charges.ts";
import { presetRange } from "../lib/date-ranges.ts";
import { renderTemplate } from "../lib/templates/registry.ts";

test("pricing: Deposit 295 + Carrier COD 500 = Total 795", () => {
  assert.equal(totalCents("295", "500", []), 79500);
});
test("pricing: changing the Deposit keeps the COD and recalculates the Total (295->345 gives 795->845)", () => {
  const cod = "500";
  assert.equal(totalCents("295", cod, []), 79500);
  assert.equal(totalCents("345", cod, []), 84500);
});
test("pricing: typing the Total recalculates COD = Total - Deposit - extras (never below 0)", () => {
  assert.deepEqual(codFromTotal("795", "295", []), { codC: 50000, short: false });
  assert.deepEqual(codFromTotal("900", "295", [{ amount: "50" }]), { codC: 55500, short: false });
  assert.deepEqual(codFromTotal("200", "295", []), { codC: 0, short: true });
});
test("pricing: extra lines add to the Total; only positive amounts count", () => {
  const extras = [{ amount: "75" }, { amount: "" }, { amount: "-20" }];
  assert.equal(extrasCents(extras), 7500);
  assert.equal(totalCents("295", "500", extras), 87000);
});
test("pricing: vehicle prices (carrier pay) x qty default the COD; blank prices = no default", () => {
  assert.equal(vehiclesCodCents([{ price: "400", qty: 2 }, { price: "350.50", qty: 1 }]), 115050);
  assert.equal(lineCents({ price: "400", qty: 3 }), 120000);
  assert.equal(vehiclesCodCents([{ price: "", qty: 1 }]), null);
});
test("vehicles: add 3, edit one, remove one -> totals stay correct", () => {
  let v = [{ price: "400", qty: 1 }, { price: "300", qty: 1 }, { price: "250", qty: 2 }];
  assert.equal(vehiclesCodCents(v), 120000);
  v = v.map((x, i) => i === 1 ? { ...x, price: "325" } : x); // edit
  assert.equal(vehiclesCodCents(v), 122500);
  v = v.filter((_, i) => i !== 0); // remove
  assert.equal(vehiclesCodCents(v), 82500);
  assert.equal(totalCents("295", (vehiclesCodCents(v) / 100).toFixed(2), []), 112000);
});
test("extra charges: max 3 lines, description + positive amount required", () => {
  const saved = extraChargesFrom([{ description: "Top load", amount: 75 }, { description: "", amount: 10 }, { description: "Neg", amount: -5 }, { description: "Fourth", amount: 9 }]);
  assert.deepEqual(saved, [{ description: "Top load", amount: 75 }]);
});

const doc = (extra = {}) => ({
  est: { job_number: "FB400001", customer_name: "Jane Rivera", customer_phone: "312-555-0142", created_at: "2026-10-23T12:00:00Z" },
  vehicles: [{ year: 2021, make: "Toyota", model: "Camry", vehicle_type: "Sedan", is_running: true, is_enclosed: false }],
  quote: { total_amount: 870, deposit_amount: 295, cod_amount: 500, extra_charges: [] },
  rep: { name: "Sam Rep", email: "", phone: "" },
  assetBaseUrl: "https://crm.example.test",
  links: { esignHref: "https://crm.example.test/d/tok#esign" },
  ...extra,
});
test("documents: extra charge lines print only when filled", () => {
  const none = renderTemplate("e_quote", doc()).html;
  assert.ok(!none.includes('data-extra-charge="1"'));
  const filled = renderTemplate("e_quote", doc({ quote: { total_amount: 870, deposit_amount: 295, cod_amount: 500, extra_charges: [{ description: "Top load", amount: 75 }, { description: "", amount: 0 }] } })).html;
  assert.equal((filled.match(/data-extra-charge="1"/g) || []).length, 1);
  assert.ok(filled.includes("Top load") && filled.includes("$75.00"));
});
test("documents: every vehicle is listed (qty and color) and the E-Quote shows the Total only", () => {
  const v = [
    { year: 2021, make: "Toyota", model: "Camry", vehicle_type: "Sedan", is_running: true, is_enclosed: false, color: "Silver", qty: 1, price: 400 },
    { year: 2019, make: "Ford", model: "F-150", vehicle_type: "Pickup", is_running: true, is_enclosed: false, qty: 2, price: 350 },
    { year: 2020, make: "Honda", model: "Civic", vehicle_type: "Sedan", is_running: false, is_enclosed: true, qty: 1 },
  ];
  const html = renderTemplate("e_quote", doc({ vehicles: v })).html;
  for (const s of ["Camry (Silver)", "F-150", "Civic"]) assert.ok(html.includes(s), s);
  assert.ok(html.includes("$870.00"));
  // Legacy prices, job COD does not match their sum: each vehicle shows its own carrier line.
  assert.ok(html.includes("$400.00") && html.includes("$700.00"), "per-vehicle totals on a multi-vehicle quote");
  assert.ok(!html.includes("Customer Balance") && !html.includes("Carrier COD"), "E-Quote: no balance, no deposit/COD split");
});
test("documents: booked order shows Total, Customer Payment and Balance Due after a recorded payment", () => {
  const html = renderTemplate("booked_esign", doc({ quote: { total_amount: 795, deposit_amount: 295, cod_amount: 500 }, paidAmount: 295 })).html;
  assert.ok(html.includes("$795.00"));
  assert.ok(html.includes("$295.00"));
  assert.ok(html.includes("$500.00"));
});

test("date ranges: presets are inclusive Chicago dates (week = Sun-Sat)", () => {
  const t = "2026-10-23";
  assert.deepEqual(presetRange("today", t), { from: t, to: t });
  assert.deepEqual(presetRange("yesterday", t), { from: "2026-10-22", to: "2026-10-22" });
  assert.deepEqual(presetRange("tomorrow", t), { from: "2026-10-24", to: "2026-10-24" });
  assert.deepEqual(presetRange("thisWeek", t), { from: "2026-10-18", to: "2026-10-24" });
  assert.deepEqual(presetRange("lastWeek", t), { from: "2026-10-11", to: "2026-10-17" });
  assert.deepEqual(presetRange("thisMonth", t), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(presetRange("lastMonth", "2027-03-05"), { from: "2027-02-01", to: "2027-02-28" });
  assert.deepEqual(presetRange("lastMonth", "2028-03-05"), { from: "2028-02-01", to: "2028-02-29" });
});
test("documents: booked order + CC form show Total only until a payment is recorded (no $0.00 paid)", () => {
  for (const kind of ["booked_esign", "cc_form"]) {
    const before = renderTemplate(kind, doc({ quote: { total_amount: 795, deposit_amount: 295, cod_amount: 500 }, paidAmount: null })).html;
    assert.ok(!before.includes("Customer Payment") && !before.includes("Customer Balance"), `${kind}: no payment rows before a payment`);
    const after = renderTemplate(kind, doc({ quote: { total_amount: 795, deposit_amount: 295, cod_amount: 500 }, paidAmount: 295 })).html;
    assert.ok(after.includes("Customer Payment") && after.includes("$295.00"), `${kind}: payment rows once recorded`);
  }
});

// Charges panel (Owner's screenshot bug, 2026-10-23): warning + Balance come from the live boxes.
const topLoad = [{ description: "Top load", amount: "75" }, { description: "", amount: "" }, { description: "", amount: "" }];
test("charges panel: Deposit 200 + COD 1050 + extra 'Top load' 75 = Total 1325, no warning, Balance 1325 with no payments", () => {
  const s = chargesSummary({ deposit: "200", cod: "1050", extras: topLoad, typedTotal: null, paidC: 0 });
  assert.deepEqual(s, { totalC: 132500, short: false, paidC: 0, balanceC: 132500 });
});
test("charges panel: typing Total 1325 (>= Deposit 200 + extras 75) shows no warning", () => {
  const r = codFromTotal("1325", "200", topLoad);
  assert.deepEqual(r, { codC: 105000, short: false });
  const s = chargesSummary({ deposit: "200", cod: "1050.00", extras: topLoad, typedTotal: "1325", paidC: 0 });
  assert.equal(s.short, false);
  assert.equal(s.totalC, 132500);
});
test("charges panel: warning only when the typed Total is below Deposit + extras (exactly equal is fine)", () => {
  assert.equal(chargesSummary({ deposit: "200", cod: "0", extras: topLoad, typedTotal: "250", paidC: 0 }).short, true);
  assert.equal(chargesSummary({ deposit: "200", cod: "0", extras: topLoad, typedTotal: "275", paidC: 0 }).short, false);
  // Lowering the Deposit afterwards re-checks against the live boxes: 250 >= 150 + 75.
  assert.equal(chargesSummary({ deposit: "150", cod: "0", extras: topLoad, typedTotal: "250", paidC: 0 }).short, false);
  // No typed Total (Deposit/COD/extras edited) -> never short.
  assert.equal(chargesSummary({ deposit: "900", cod: "", extras: topLoad, typedTotal: null, paidC: 0 }).short, false);
});
test("charges panel: Balance = live Total - recorded payments ($345 paid on 1325 -> 980; negative correction counted)", () => {
  assert.equal(chargesSummary({ deposit: "200", cod: "1050", extras: topLoad, typedTotal: null, paidC: 34500 }).balanceC, 98000);
  assert.equal(balanceCents(132500, 34500 - 4500), 102500);
  // Editing the COD live moves the Balance with it (unsaved boxes, same payments).
  assert.equal(chargesSummary({ deposit: "200", cod: "1100", extras: topLoad, typedTotal: null, paidC: 34500 }).balanceC, 103000);
});
test("documents: E-Quote, booked order and CC form all use the saved Total 1325 and Balance 1325 - 345 = 980", () => {
  const quote = { total_amount: 1325, deposit_amount: 200, cod_amount: 1050, extra_charges: [{ description: "Top load", amount: 75 }] };
  const eq = renderTemplate("e_quote", doc({ quote, paidAmount: null })).html;
  assert.ok(eq.includes("$1325.00"), "E-Quote shows the Total");
  assert.ok(!eq.includes("Customer Balance") && !eq.includes("$980.00"), "E-Quote: Total only");
  for (const kind of ["booked_esign", "cc_form"]) {
    const before = renderTemplate(kind, doc({ quote, paidAmount: null })).html;
    // Booked order prints the Total; the CC form has no amount line until a payment exists (unchanged layout).
    if (kind === "booked_esign") assert.ok(before.includes("$1325.00"), `${kind}: Total before a payment`);
    assert.ok(!before.includes("Customer Balance") && !before.includes("$725.00"), `${kind}: no balance row / no vehicle-price sum before a payment`);
    const html = renderTemplate(kind, doc({ quote, paidAmount: 345 })).html;
    assert.ok(html.includes("$1325.00"), `${kind}: Total`);
    assert.ok(html.includes("$345.00"), `${kind}: Customer Payment`);
    assert.ok(html.includes("$980.00"), `${kind}: Balance = Total - payments`);
    assert.ok(!html.includes("$725.00"), `${kind}: never the vehicle-price sum`);
  }
});

test("vehicle Price cell: own price, else the job Total, never 'pending' while the boxes have a Total", async () => {
  const { vehiclePriceCell, showJobTotalLine, totalCents } = await import("../lib/pricing.ts");
  // Sam Rep: 2026 Mercedes 550, no vehicle price, deposit 295 + COD 1000 -> $1,295.00
  const t = totalCents("295", "1000", []);
  assert.equal(t, 129500);
  assert.deepEqual(vehiclePriceCell({ price: "" }, 1, t), { kind: "total", cents: 129500 });
  // extras count toward the Total
  assert.deepEqual(vehiclePriceCell({ price: "" }, 1, totalCents("200", "1050", [{ amount: "75" }])), { kind: "total", cents: 132500 });
  // its own price wins (x qty)
  assert.deepEqual(vehiclePriceCell({ price: "400", qty: 2 }, 1, t), { kind: "own", cents: 80000 });
  // multi-vehicle, no per-vehicle prices: no fake split; one Job Total line
  assert.deepEqual(vehiclePriceCell({ price: "" }, 2, t), { kind: "inTotal" });
  assert.equal(showJobTotalLine([{ price: "" }, { price: "" }], t), true);
  assert.equal(showJobTotalLine([{ price: "500" }, { price: "700" }], t), false);
  assert.equal(showJobTotalLine([{ price: "" }], t), false);
  // only 'pending' when Deposit, COD and extras are all empty / 0
  assert.deepEqual(vehiclePriceCell({ price: "" }, 1, totalCents("", "", [])), { kind: "pending" });
  assert.deepEqual(vehiclePriceCell({ price: "" }, 1, totalCents("0", "0", [{ amount: "0" }])), { kind: "pending" });
  assert.deepEqual(vehiclePriceCell({ price: "" }, 3, 0), { kind: "pending" });
});
test("formatCentsComma: $1,295.00", async () => {
  const { formatCentsComma } = await import("../lib/money.ts");
  assert.equal(formatCentsComma(129500), "$1,295.00"); assert.equal(formatCentsComma(99), "$0.99"); assert.equal(formatCentsComma(123456789), "$1,234,567.89"); assert.equal(formatCentsComma(-150000), "-$1,500.00");
});

test("send warning (E-Quote / E-Sign): only when a vehicle has no price AND the job Total is 0", async () => {
  const { unpricedWarningCount, totalCents } = await import("../lib/pricing.ts");
  // FB400001: one vehicle, no price, Deposit 295 + COD 1000 = 1295 -> no warning
  assert.equal(unpricedWarningCount([{ price: "" }], totalCents("295", "1000", [])), 0);
  assert.equal(unpricedWarningCount([{ price: "" }, { price: "" }], totalCents("0", "", [{ amount: "50" }])), 0);
  assert.equal(unpricedWarningCount([{ price: "" }], totalCents("", "", [])), 1);
  assert.equal(unpricedWarningCount([{ price: "" }, { price: "400" }, { price: " " }], 0), 2);
  assert.equal(unpricedWarningCount([{ price: "400" }], 0), 0);
});

test("distinct subjects so Gmail doesn't thread quote / e-sign / CC together", async () => {
  const est = { job_number: "FB400001", customer_name: "Sam Rep", created_at: "2026-10-23T12:00:00Z" };
  const base = { est, vehicles: [], quote: { total_amount: 1295, deposit_amount: 295 }, rep: { name: "Sam Rep", email: "", phone: "" }, assetBaseUrl: "https://crm.example.test", links: {} };
  assert.equal(renderTemplate("e_quote", base).subject, "Fastbreak CRM — Your Auto Transport Quote FB400001");
  assert.equal(renderTemplate("booked_esign", base).subject, "Fastbreak CRM — Please E-Sign Your Auto Transport Order FB400001");
  assert.equal(renderTemplate("cc_form", base).subject, "Fastbreak CRM — Credit Card Authorization Form FB400001");
  // body / template unchanged: same title bar
  assert.ok(renderTemplate("e_quote", base).html.includes("Auto Transport Job Order") && renderTemplate("booked_esign", base).html.includes("Auto Transport Job Order"));
});
