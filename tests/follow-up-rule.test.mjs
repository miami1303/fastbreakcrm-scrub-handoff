import test from "node:test";
import assert from "node:assert/strict";
import { isFollowUpDue } from "../lib/follow-up-rule.ts";

// 2:00 PM CDT on 2026-10-23 = 19:00Z
const at = (hhmm) => new Date(`2026-10-23T${hhmm}:00-05:00`).getTime();
const iso = (hhmm) => new Date(at(hhmm)).toISOString();

test("due 2:00, checked 1:59: not yet", () => assert.equal(isFollowUpDue(iso("14:00"), null, at("13:59")), false));
test("due 2:00, checked 2:00: in Follow Up", () => assert.equal(isFollowUpDue(iso("14:00"), null, at("14:00")), true));
test("due 2:00, checked 2:30, no touch: still showing", () => assert.equal(isFollowUpDue(iso("14:00"), null, at("14:30")), true));
test("never expires on its own (30 days later)", () => assert.equal(isFollowUpDue(iso("14:00"), null, at("14:00") + 30 * 86400_000), true));
test("note at 2:31: gone", () => assert.equal(isFollowUpDue(iso("14:00"), iso("14:31"), at("14:32")), false));
test("another lead due 2:00, email at 3:00: gone", () => assert.equal(isFollowUpDue(iso("14:00"), iso("15:00"), at("15:01")), false));
test("touch BEFORE the due time does not pre-clear it", () => assert.equal(isFollowUpDue(iso("14:00"), iso("13:30"), at("14:30")), true));
test("new future follow-up time clears it until reached", () => {
  assert.equal(isFollowUpDue(iso("16:00"), iso("13:30"), at("14:30")), false);
  assert.equal(isFollowUpDue(iso("16:00"), iso("13:30"), at("16:00")), true);
});
test("no follow-up set: never due", () => assert.equal(isFollowUpDue(null, null, at("14:00")), false));

import { chicagoToIso, crmStamp } from "../lib/crm-time.ts";
test("follow-up time is entered as Central Time (DST-aware)", () => {
  assert.equal(chicagoToIso(2026, 9, 23, 14, 0), "2026-10-23T19:00:00.000Z"); // CDT
  assert.equal(chicagoToIso(2026, 11, 1, 14, 0), "2026-12-01T20:00:00.000Z"); // CST
  assert.equal(crmStamp("2026-10-23T19:00:00.000Z"), "10/23/2026 02:00 PM CDT");
});
