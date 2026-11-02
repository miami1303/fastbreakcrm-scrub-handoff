import test from "node:test";
import assert from "node:assert/strict";
import { nameLines } from "../lib/contact-display.ts";
import { stripeLinkMethods } from "../lib/payment-methods.ts";

test("contact that equals the customer is not printed twice", () => {
  assert.deepEqual(nameLines("Jane Rivera", "jane rivera"), ["Jane Rivera"]);
  assert.deepEqual(nameLines("Jane Rivera", "Bob Lee"), ["Jane Rivera", "Bob Lee"]);
  assert.deepEqual(nameLines("Jane Rivera", ""), ["Jane Rivera"]);
});

test("Zelle is never a Stripe payment method", () => {
  assert.ok(!stripeLinkMethods({ STRIPE_LINK_METHODS: "card,zelle,cashapp" }).includes("zelle"));
  assert.ok(!stripeLinkMethods({}).includes("zelle"));
});
