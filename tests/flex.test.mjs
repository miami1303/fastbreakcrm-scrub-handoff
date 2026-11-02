import test from "node:test";
import assert from "node:assert/strict";
import { vehicleRemarkCell, buildQuoteText } from "../lib/quote-template.ts";
import { renderTemplate } from "../lib/templates/registry.ts";

// FLEX is per vehicle now (vehicles.flex).
const base = (flex, remark) => ({
  est: { job_number: "FB400001", customer_name: "Sam Rep", customer_email: "customer@example.test", pickup_zip: "33313", delivery_zip: "80126", shipment_remarks: "Gate code 4411" },
  vehicles: [{ year: 2026, make: "Mercedes", model: "550", vehicle_type: "Sedan", is_running: true, is_enclosed: false, remarks: remark, flex }],
  quote: { total_amount: 1295, deposit_amount: 295, cod_amount: 1000 },
  assetBaseUrl: "https://example.test",
});
const cells = h => [...h.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(x => x[1].trim());

test("FLEX: remark cell text", () => {
  assert.equal(vehicleRemarkCell("", true), "FLEX");
  assert.equal(vehicleRemarkCell("Keys under mat", true), "FLEX - Keys under mat");
  assert.equal(vehicleRemarkCell("Keys under mat", false), "Keys under mat");
  assert.equal(vehicleRemarkCell(null, false), "");
});
test("ASAP: same remarks cell as FLEX, and both flags show together", () => {
  assert.equal(vehicleRemarkCell("", false, true), "ASAP");
  assert.equal(vehicleRemarkCell("Keys under mat", false, true), "ASAP - Keys under mat");
  assert.equal(vehicleRemarkCell("", true, true), "FLEX - ASAP");
  assert.equal(vehicleRemarkCell("Keys under mat", true, true), "FLEX - ASAP - Keys under mat");
  assert.equal(vehicleRemarkCell("Keys under mat", false, false), "Keys under mat");
});
// Owner 2026-10-31: flags print on the line UNDER the vehicle (data-vehicle-flags); Remarks = typed text only.
const flagLine = h => (h.match(/<tr data-vehicle-flags="1">([\s\S]*?)<\/tr>/) || [, ""])[1];
for (const kind of ["e_quote", "booked_esign"]) {
  test(`ASAP/FLEX: ${kind} flags on the line under the vehicle, Remarks keeps only typed text`, () => {
    const asap = base(false, "Keys under mat");
    asap.vehicles[0].asap = true;
    let h = renderTemplate(kind, asap).html;
    assert.ok(cells(h).includes("Keys under mat") && !cells(h).includes("ASAP - Keys under mat"));
    assert.match(flagLine(h), />ASAP</);
    asap.vehicles[0].flex = true;
    h = renderTemplate(kind, asap).html;
    assert.match(flagLine(h), />FLEX &middot; ASAP</);
    assert.match(buildQuoteText(asap), /\| Keys under mat \|/);
    assert.match(buildQuoteText(asap), /\n  FLEX · ASAP\n/);
    assert.match(h, /<b>Remarks:<\/b> Gate code 4411<\/td>/);
    const off = renderTemplate(kind, base(false, "Keys under mat")).html;
    assert.ok(!off.includes("data-vehicle-flags"), "no flags -> no line");
  });
}

test("FLEX per vehicle: only the flagged vehicle gets a flag line; remark text kept", () => {
  const input = base(false, "");
  input.vehicles = [
    { year: 2026, make: "Mercedes", model: "550", vehicle_type: "Sedan", remarks: "Keys under mat", flex: true },
    { year: 2020, make: "Honda", model: "Civic", vehicle_type: "Sedan", remarks: "Low clearance", flex: false },
  ];
  const h = renderTemplate("booked_esign", input).html;
  assert.equal((h.match(/data-vehicle-flags="1"/g) || []).length, 1);
  assert.ok(h.indexOf("data-vehicle-flags") < h.indexOf(">Low clearance<"));
  assert.ok(cells(h).includes("Keys under mat") && cells(h).includes("Low clearance"));
  assert.equal(input.vehicles[0].remarks, "Keys under mat", "remark not overwritten");
});
