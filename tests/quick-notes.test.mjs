import test from "node:test";
import assert from "node:assert/strict";
import { QUICK_NOTES, quickNotesFrom, insertQuickNote } from "../lib/quick-notes.ts";

test("quick notes: exactly Owner's flat list, in order", () => {
  assert.deepEqual(quickNotesFrom(["something old"]), ["Left VM", "Left VM, sent email & text", "No answer, sent email & text", "Disconnected / Wrong Number",
    "Quoted", "Quoted - Follow Up", "Customer checking other options", "Need to confirm with spouse", "Not interested", "Awaiting E-sign", "Sent E-sign reminder", "Booked"]);
  assert.equal(QUICK_NOTES.length, 12);
});
test("quick note inserts into the remarks box (editable)", () => {
  assert.equal(insertQuickNote("", "Quoted"), "Quoted");
  assert.equal(insertQuickNote("Called Tue  \n", "Quoted - Follow Up"), "Called Tue\nQuoted - Follow Up");
});
