import test from "node:test";
import assert from "node:assert/strict";
import { cardWarnings, detectCardType, normalizeCardType } from "../lib/card-type.ts";

test("prefix detection", () => {
  assert.equal(detectCardType("4111 1111 1111 1111"), "Visa");
  assert.equal(detectCardType("4222222222222"), "Visa"); // 13 digits
  for (const p of ["51", "52", "53", "54", "55"]) assert.equal(detectCardType(p + "00000000000000"), "Mastercard");
  assert.equal(detectCardType("2221000000000009"), "Mastercard");
  assert.equal(detectCardType("2720990000000000"), "Mastercard");
  assert.equal(detectCardType("2220990000000000"), null);
  assert.equal(detectCardType("2721000000000000"), null);
  assert.equal(detectCardType("378282246310005"), "Amex");
  assert.equal(detectCardType("341111111111111"), "Amex");
  assert.equal(detectCardType("6011111111111117"), "Discover");
  assert.equal(detectCardType("6500000000000002"), "Discover");
  for (const p of ["644", "645", "649"]) assert.equal(detectCardType(p + "0000000000000"), "Discover");
  assert.equal(detectCardType("6430000000000000"), null);
  assert.equal(detectCardType("3530111333300000"), null); // JCB: no rule -> blank, never a guess
  assert.equal(detectCardType("5000000000000000"), null);
  assert.equal(detectCardType(""), null);
});

test("Amex: 15 digits and a 4-digit CVV", () => {
  assert.deepEqual(cardWarnings("378282246310005", "1234"), []);
  assert.match(cardWarnings("378282246310005", "123")[0], /CVV is usually 4/);
  assert.match(cardWarnings("3782822463100050", "1234")[0], /15 digits/);
});

test("soft warnings use the rep's choice when set; mismatch is flagged", () => {
  assert.deepEqual(cardWarnings("4111111111111111", "123"), []);
  assert.match(cardWarnings("4111111111111111", "1234")[0], /CVV is usually 3/);
  assert.ok(cardWarnings("4111111111111111", "123", "Amex").some(w => /looks like Visa/.test(w)));
  assert.deepEqual(cardWarnings("9999", "12"), []); // unknown -> no warnings
  assert.equal(normalizeCardType("VISA"), "Visa");
  assert.equal(normalizeCardType("MasterCard"), "Mastercard");
  assert.equal(normalizeCardType(""), null);
});

import { confidentCardType, resolveCardType } from "../lib/card-type.ts";
import { renderTemplate } from "../lib/templates/registry.ts";

test("stored type: rep choice wins; blank + confident prefix+length -> auto; else blank", () => {
  assert.deepEqual(resolveCardType("", "378282246310005"), { type: "Amex", source: "auto" });
  assert.deepEqual(resolveCardType("", "4111111111111111"), { type: "Visa", source: "auto" });
  assert.deepEqual(resolveCardType("Mastercard", "4111111111111111"), { type: "Mastercard", source: "rep" });
  assert.deepEqual(resolveCardType("", "41111111111111"), { type: null, source: null }); // Visa prefix, 14 digits
  assert.deepEqual(resolveCardType("", "37828224631000"), { type: null, source: null }); // Amex prefix, 14 digits
  assert.deepEqual(resolveCardType("", "3530111333300000"), { type: null, source: null }); // unknown prefix
  assert.deepEqual(resolveCardType("", ""), { type: null, source: null });
  assert.equal(confidentCardType("6011111111111117"), "Discover");
});

test("CC Auth form prints Card Type only when set; customer sees last 4 only", () => {
  const base = {
    est: { job_number: "FB400001", customer_name: "Jane Rivera" }, vehicles: [], rep: { name: "Sam Rep", email: "m@example.test", phone: "" },
    paidAmount: 200, assetBaseUrl: "https://crm.example.test", links: {},
  };
  const withType = renderTemplate("cc_form", { ...base, quote: { total_amount: 1250, deposit_amount: 200, card_last4: "0005", card_type: resolveCardType("", "378282246310005").type } });
  assert.ok(withType.html.includes("Card Type:") && withType.html.includes("Amex") && withType.text.includes("Card Type: Amex"));
  assert.ok(withType.html.includes("xxxx-xxxx-xxxx-0005") && !withType.html.includes("378282246310005"));
  const blank = renderTemplate("cc_form", { ...base, quote: { total_amount: 1250, deposit_amount: 200, card_last4: "0000", card_type: resolveCardType("", "41111111111111").type } });
  assert.ok(!blank.html.includes("Card Type") && !blank.text.includes("Card Type"));
});

import { normalizeJobNumber, JOB_NUMBER_RE } from "../lib/job-number.ts";
test("job numbers: FB400001 / 400001 normalize; grows past 999999", () => {
  assert.equal(normalizeJobNumber("FB400001"), "FB400001");
  assert.equal(normalizeJobNumber("400001"), "FB400001");
  assert.equal(normalizeJobNumber(" fb 400001 "), "FB400001");
  assert.equal(normalizeJobNumber("1000000"), "FB1000000");
  assert.ok(JOB_NUMBER_RE.test("FB1000000"));
  assert.equal(normalizeJobNumber("Jane"), "");
  assert.equal(normalizeJobNumber("DA12"), "");
});
