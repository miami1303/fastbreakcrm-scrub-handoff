import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BANNERS, BANNER_DIRECTION, BANNER_TRAVEL_MS, RANGE_LABELS, RANGES, bannerCountLabel } from "../lib/crm-constants.ts";
import { oneRepPatch } from "../lib/one-rep.ts";

test("banners travel once in 6 to 8 seconds, some each way, and each has its own color", () => {
  assert.equal(BANNER_TRAVEL_MS, 7000);
  assert.ok(BANNER_TRAVEL_MS >= 6000 && BANNER_TRAVEL_MS <= 8000);
  assert.equal(BANNERS.followUp.color, "#dc2626");
  assert.equal(BANNER_DIRECTION.followUp, "rtl");
  assert.equal(BANNER_DIRECTION.assign, "ltr");
  assert.equal(BANNER_DIRECTION.newLead, "rtl");
  assert.notEqual(BANNERS.esignContract.color, BANNERS.esignCc.color);
  assert.equal(BANNERS.assign.color, "#2563eb");
  assert.equal(BANNERS.newLead.color, "#ea580c");
  const dirs = new Set(Object.values(BANNER_DIRECTION));
  assert.deepEqual([...dirs].sort(), ["ltr", "rtl"]);
  assert.equal(bannerCountLabel("Assign New Estimate", 1), "Assign New Estimate (1)");
  assert.equal(bannerCountLabel("Follow Up", 2), "Follow Up (2)");
});

test("recurring ranges stop at This Month", () => {
  assert.deepEqual(RANGES.map(key => RANGE_LABELS[key]), ["Today", "Yesterday", "This Week", "Last Week", "This Month"]);
  const page = readFileSync(new URL("../app/recurring/page.tsx", import.meta.url), "utf8");
  const options = page.slice(page.indexOf("const OPTIONS"), page.indexOf("];", page.indexOf("const OPTIONS")));
  assert.match(options, /Today/);
  assert.match(options, /This Month/);
  assert.doesNotMatch(options, /Last Month|tomorrow|Older/);
});

test("one rep: assignment does not set a priority, a later change leaves priority alone", () => {
  const first = oneRepPatch({ id: "rep-jordan", userId: "user-jordan" }, "unassigned");
  assert.deepEqual(first, { assigned_rep_id: "rep-jordan", owner_id: "user-jordan", status: "draft" });
  assert.equal("priority" in first, false);
  const later = oneRepPatch({ id: "rep-sam", userId: "user-sam" }, "quoted");
  assert.deepEqual(later, { assigned_rep_id: "rep-sam", owner_id: "user-sam" });
  assert.equal("priority" in later, false);
});
