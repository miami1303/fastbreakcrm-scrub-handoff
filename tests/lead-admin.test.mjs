import test from "node:test";
import assert from "node:assert/strict";
import { money, netPriceChange, priceReductions, returnsToCustomer } from "../lib/lead-admin.ts";

test("price reductions count only lowered totals", () => {
  const h = [
    { created_at: "2026-10-01T10:00:00Z", changed_by_name: "Sam", old_total: 1500, new_total: 1400 },
    { created_at: "2026-10-02T10:00:00Z", changed_by_name: "Sam", old_total: 1400, new_total: 1450 },
    { created_at: "2026-10-03T10:00:00Z", changed_by_name: "Jordan", old_total: "1450", new_total: "1250.50" },
    { created_at: "2026-10-04T10:00:00Z", changed_by_name: "Sam", old_total: null, new_total: 100 },
  ];
  const r = priceReductions(h);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].by, "Jordan");
  assert.equal(r.totalOffCents, 10000 + 19950);
  assert.deepEqual(netPriceChange(h, 1250.5), { firstCents: 150000, currentCents: 125050, diffCents: -24950 });
  assert.equal(netPriceChange([], 100), null);
});

test("returns to customer: negative, non-void rows only", () => {
  const r = returnsToCustomer([
    { id: "a", created_at: "2026-10-01", amount: 200 },
    { id: "b", created_at: "2026-10-02", amount: -50 },
    { id: "c", created_at: "2026-10-03", amount: -25, voided_at: "2026-10-04" },
  ]);
  assert.deepEqual(r.rows.map(x => x.id), ["b"]);
  assert.equal(r.totalCents, 5000);
  assert.equal(money(-1234), "-$12.34");
});
