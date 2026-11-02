import test from "node:test";
import assert from "node:assert/strict";

test("lead sources: defaults, saved options (rename/hide), current value kept, filter", async () => {
  const { DEFAULT_LEAD_SOURCES, leadSourcesFrom, pickableLeadSources, filterLeadSources, WEB_LEAD_SOURCE } = await import("../lib/lead-sources.ts");
  assert.deepEqual(leadSourcesFrom(null).map(o => o.label), ["BBB", "Web Lead", "Referral", "Repeat Customer (used us before)", "Google", "Phone Call", "Social Media", "Purchased Lead", "Other"]);
  assert.equal(DEFAULT_LEAD_SOURCES.length, 9);
  assert.equal(WEB_LEAD_SOURCE, "Web Lead");
  const saved = leadSourcesFrom([{ label: "BBB" }, { label: "Yelp" }, { label: "Google", hidden: true }, { label: " bbb " }, { label: "" }]);
  assert.deepEqual(saved, [{ label: "BBB" }, { label: "Yelp" }, { label: "Google", hidden: true }]);
  assert.deepEqual(pickableLeadSources(saved), ["BBB", "Yelp"]);
  assert.deepEqual(pickableLeadSources(saved, "Google"), ["Google", "BBB", "Yelp"], "a hidden source already on a lead stays shown");
  assert.deepEqual(filterLeadSources(["BBB", "Web Lead", "Referral"], "re"), ["Referral"]);
});
