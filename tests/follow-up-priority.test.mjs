import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_PRIORITY,
  DEFAULT_PRIORITY_SEED,
  assertPriorityLabels,
  formatPriority,
  priorityChoices,
  priorityCircleNumbers,
  priorityLabelsFrom,
  validatePriority,
} from "../lib/follow-up-domain.ts";

const seed = DEFAULT_PRIORITY_SEED;

test("a company with no labels starts blank, and a new lead's priority is blank", () => {
  assert.equal(DEFAULT_PRIORITY, null);
  assert.deepEqual(priorityLabelsFrom(null), []);
  assert.deepEqual(priorityLabelsFrom([]), []);
  assert.deepEqual(priorityLabelsFrom(["Brand-new lead", "Needs follow-up"]), [], "old hard-coded names are not labels");
  assert.equal(validatePriority(undefined, []), null);
  assert.equal(validatePriority(null, []), null);
  assert.equal(validatePriority("", []), null);
  assert.equal(validatePriority("   ", []), null);
  assert.throws(() => validatePriority(1, []), /company's list/);
  assert.throws(() => validatePriority(0, []), /company's list/);
});

test("labels can be added, renamed, and removed without a code change", () => {
  const added = assertPriorityLabels([{ number: 2, label: "  Call back  " }, { number: "9", label: "Hot" }]);
  assert.deepEqual(added, [{ number: 2, label: "Call back" }, { number: 9, label: "Hot" }]);
  const renamed = assertPriorityLabels([{ number: 2, label: "Call tomorrow" }]);
  assert.equal(renamed[0].label, "Call tomorrow");
  assert.deepEqual(assertPriorityLabels([]), []);
  assert.throws(() => assertPriorityLabels([{ number: 2, label: "A" }, { number: 2, label: "B" }]), /twice/);
  assert.throws(() => assertPriorityLabels([{ number: 0, label: "Zero" }]), /1–9/);
  assert.throws(() => assertPriorityLabels([{ number: 10, label: "Ten" }]), /1–9/);
  assert.throws(() => assertPriorityLabels([{ number: 4, label: "  " }]), /needs a label/);
  const read = priorityLabelsFrom([{ number: 4, label: "Later" }, { number: 4, label: "dup" }, { number: 3, label: "" }, { label: "no number" }]);
  assert.deepEqual(read, [{ number: 4, label: "Later" }]);
});

test("Fast Break seed is Quoted, Not interested, and Wrong number — other numbers unused", () => {
  assert.deepEqual(seed.map(r => [r.number, r.label]), [
    [1, "Quoted"],
    [3, "Not interested"],
    [8, "Wrong number / bad / discard"],
  ]);
  assert.equal(validatePriority(1, seed), 1);
  assert.equal(validatePriority("3", seed), 3);
  assert.equal(validatePriority(8, seed), 8);
  assert.equal(validatePriority("", seed), null);
  assert.throws(() => validatePriority(2, seed), /company's list/);
  assert.throws(() => validatePriority("2.5", seed), /whole number/);
  assert.equal(formatPriority(seed, 1, "chip"), "P1 · Quoted");
  assert.equal(formatPriority(seed, 3, "status"), "Priority 3 · Not interested");
  assert.equal(formatPriority(seed, 8, "menu"), "P8 — Wrong number / bad / discard");
});

test("a stored number with no label still displays, and can be kept", () => {
  assert.equal(formatPriority(seed, 0, "chip"), "P0");
  assert.equal(formatPriority(seed, 4, "table"), "Prior: 4");
  assert.equal(formatPriority(seed, null, "status"), "No Priority");
  assert.equal(validatePriority(0, seed, 0), 0, "the number already on the lead can be saved again");
  assert.throws(() => validatePriority(4, seed, 0), /company's list/);
  assert.deepEqual(priorityChoices(seed, 4).map(c => c.value), [1, 3, 4, 8]);
  assert.deepEqual(priorityCircleNumbers(seed, [0, 1, null, 4, 4]), [0, 1, 3, 4, 8]);
  assert.deepEqual(priorityCircleNumbers([], []), []);
});

test("migration adds the label table and the Fast Break rows, and does not rewrite leads", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261027120000_priority_labels.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.priority_labels/i);
  assert.match(sql, /\(1,\s*'Quoted'\)/);
  assert.match(sql, /\(3,\s*'Not interested'\)/);
  assert.match(sql, /\(8,\s*'Wrong number \/ bad \/ discard'\)/);
  assert.match(sql, /on conflict \(number\) do nothing/i);
  assert.match(sql, /crm_is_active_admin/i);
  assert.match(sql, /alter column priority drop default/i);
  assert.match(sql, /priority between 0 and 9/);
  assert.doesNotMatch(sql, /update\s+public\.estimates/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.estimates/i);
  assert.doesNotMatch(sql, /drop\s+column/i);
});
