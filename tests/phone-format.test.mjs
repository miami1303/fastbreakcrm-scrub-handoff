import test from "node:test";
import assert from "node:assert/strict";
import { formatPhone, formatPhoneEdit, phoneForField } from "../lib/phone-format.ts";

test("paste variants with a leading country code become 303-555-1234", () => {
  for (const raw of [
    "1-303-555-1234",
    "+1 303 555 1234",
    "+1 (303) 555-1234",
    "13035551234",
    "1 303.555.1234",
    "1 (303) 555-1234",
  ]) {
    assert.equal(formatPhone(raw), "303-555-1234", raw);
  }
});

test("a leading 1 is blocked while typing and a finished 10-digit number is kept", () => {
  assert.equal(formatPhone("1"), "");
  assert.equal(formatPhone("+1"), "");
  assert.equal(formatPhone("13"), "3");
  assert.equal(formatPhone("1303"), "303");
  assert.equal(formatPhone("1303555"), "303-555");
  // 10 digits already, even if they start with 1, are not shortened.
  assert.equal(formatPhone("1234567890"), "123-456-7890");
});

test("partial typing inserts dashes and stops at 10 digits", () => {
  assert.equal(formatPhone(""), "");
  assert.equal(formatPhone("3"), "3");
  assert.equal(formatPhone("30"), "30");
  assert.equal(formatPhone("303"), "303");
  assert.equal(formatPhone("3035"), "303-5");
  assert.equal(formatPhone("30355"), "303-55");
  assert.equal(formatPhone("303555"), "303-555");
  assert.equal(formatPhone("3035551"), "303-555-1");
  assert.equal(formatPhone("30355512"), "303-555-12");
  assert.equal(formatPhone("303555123"), "303-555-123");
  assert.equal(formatPhone("3035551234"), "303-555-1234");
  assert.equal(formatPhone("30355512345"), "303-555-1234");
  assert.equal(formatPhone("303-555-1234 x99"), "303-555-1234");
  assert.equal(formatPhone("abc"), "");
  assert.equal(formatPhone("303-555-HOME"), "303-555");
  assert.equal(formatPhone(formatPhone("+1 (303) 555-1234")), "303-555-1234");
});

test("backspace drops a digit and does not stick on a dash", () => {
  const full = formatPhone("3035551234");
  assert.equal(full, "303-555-1234");
  // The browser deletes the last character, then the field is formatted again.
  const trimmed = full.slice(0, -1);
  const end = formatPhoneEdit(trimmed, trimmed.length);
  assert.equal(end.value, "303-555-123");
  assert.equal(end.caret, end.value.length);
  // Deleting the first subscriber digit leaves the dash in the raw field for a moment.
  const stuck = formatPhoneEdit("303-", 4);
  assert.equal(stuck.value, "303");
  assert.equal(stuck.caret, 3);
  // Backspace in the middle removes that digit and the dashes regroup behind the caret.
  const shown = "303-555";
  const caret = 2;
  const raw = shown.slice(0, caret - 1) + shown.slice(caret);
  const mid = formatPhoneEdit(raw, caret - 1);
  assert.equal(mid.value, "335-55");
  assert.equal(mid.caret, 1);
});

test("older saved shapes still display, and a number is stored with dashes", () => {
  assert.equal(phoneForField("555-010-0102"), "555-010-0102");
  assert.equal(phoneForField("5550100102"), "555-010-0102");
  assert.equal(phoneForField("555-010-0102"), "555-010-0102");
  assert.equal(phoneForField("1-816-555-0102"), "816-555-0102");
  assert.equal(phoneForField("call the dock"), "call the dock");
  assert.equal(phoneForField("  "), "");
  assert.equal(phoneForField(null), "");
});
