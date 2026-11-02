import test from "node:test";
import assert from "node:assert/strict";
import { rowSorter } from "../lib/job-sort.ts";

test("Follow-Up order: dated first (by date), then undated by priority (No Priority last), then newest", () => {
  const r = (job, fu, priority, created) => ({ job_number: job, follow_up_at: fu, priority, created_at: created, primary_date: null, total: null });
  const rows = [
    r("FB1", null, null, "2026-10-01T00:00:00Z"),
    r("DA2", "2026-10-25T15:00:00Z", 3, "2026-10-02T00:00:00Z"),
    r("DA3", null, 1, "2026-10-03T00:00:00Z"),
    r("DA4", null, 1, "2026-10-04T00:00:00Z"),
    r("DA5", "2026-10-24T15:00:00Z", null, "2026-10-05T00:00:00Z"),
    r("DA6", null, 0, "2026-10-06T00:00:00Z"),
    r("DA7", null, null, "2026-10-07T00:00:00Z"),
  ];
  assert.deepEqual(rows.sort(rowSorter("followUp")).map(x => x.job_number), ["DA5", "DA2", "DA6", "DA4", "DA3", "DA7", "FB1"]);
});
