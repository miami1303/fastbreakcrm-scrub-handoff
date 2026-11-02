import test from "node:test";
import assert from "node:assert/strict";
import { PAYMENT_METHODS } from "../lib/crm-constants.ts";

test("payment methods stay Credit Card, Zelle, Cash App, PayPal (Auto-charge is the switch, not a method)", () => {
  assert.deepEqual([...PAYMENT_METHODS], ["Credit Card", "Zelle", "Cash App", "PayPal"]);
  assert.equal(PAYMENT_METHODS.includes("Auto-charge"), false);
});
