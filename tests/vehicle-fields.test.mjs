import test from "node:test";
import assert from "node:assert/strict";
import { OTHER, VEHICLE_TYPES, topYear, typeChoice, validTypedYear, yearChoice, yearOptions } from "../lib/vehicle-fields.ts";

test("vehicle year: list starts at 2027 today (2026) and ends at 1950, newest first", () => {
  const y = yearOptions("2026-10-23");
  assert.equal(y[0], "2027");
  assert.equal(y.at(-1), "1950");
  assert.equal(y.length, 2027 - 1950 + 1);
  assert.ok(y.every((v, i) => i === 0 || Number(y[i - 1]) - Number(v) === 1));
});
test("vehicle year: top year bumps itself (current year + 1): in 2027 the list starts at 2028", () => {
  assert.equal(topYear("2027-01-01"), 2028);
  assert.equal(yearOptions("2027-06-01")[0], "2028");
});
test("vehicle year: pick 2027, pick 1950, type 1932 (Other / older)", () => {
  const t = "2026-10-23";
  assert.equal(yearChoice("2027", t), "2027");
  assert.equal(yearChoice("1950", t), "1950");
  assert.equal(yearChoice("1932", t), OTHER, "1932 is not listed -> Other with the typed value");
  assert.equal(validTypedYear("1932", t), true);
  assert.equal(validTypedYear("1885", t), false);
  assert.equal(validTypedYear("2028", t), false);
  assert.equal(validTypedYear("32", t), false);
  assert.equal(yearChoice("", t), "");
});
test("vehicle type: built-ins Sedan, SUV, Pickup, Van, Trailer, ATV, Golf Cart; anything else is Other (typed)", () => {
  assert.deepEqual([...VEHICLE_TYPES], ["Sedan", "SUV", "Pickup", "Van", "Trailer", "ATV", "Golf Cart"]);
  assert.equal(typeChoice("SUV"), "SUV");
  assert.equal(typeChoice("golf cart"), "Golf Cart");
  assert.equal(typeChoice("Motorcycle"), OTHER, "custom type shows Other with the typed value");
  assert.equal(typeChoice(""), "Sedan");
});
