import test from "node:test";
import assert from "node:assert/strict";
import { haversineMiles, routeMiles, milesLabel } from "../lib/mileage.ts";

const citra = { lat: 29.4113, lon: -82.1098 }, luttrell = { lat: 36.2052, lon: -83.7445 };

test("haversine straight-line distance", () => {
  const d = haversineMiles(citra, luttrell);
  assert.ok(d > 470 && d < 490, String(d));
});

test("falls back to haversine x 1.2 (est.) when OSRM fails or is rate-limited", async () => {
  const r429 = async () => new Response("rate limited", { status: 429 });
  const r = await routeMiles(citra, luttrell, { fetchImpl: r429 });
  assert.equal(r.source, "estimate");
  assert.equal(r.miles, Math.round(haversineMiles(citra, luttrell) * 1.2));
  assert.equal(milesLabel(r.miles, r.source), `${r.miles} Miles (est.)`);
});

test("uses OSRM driving distance when available (rounded to whole miles)", async () => {
  const ok = async () => new Response(JSON.stringify({ code: "Ok", routes: [{ distance: 930000 }] }), { status: 200 });
  const r = await routeMiles(citra, luttrell, { fetchImpl: ok });
  assert.deepEqual(r, { miles: 578, source: "osrm" });
  assert.equal(milesLabel(1197, "osrm"), "1,197 Miles");
});

test("Owner's case: Dublin GA 31021 -> Carbon Hill AL 35549 (Google: 346 mi fastest, 338/349 alternates)", async () => {
  const dublin = { lat: 32.5404, lon: -82.9038 }, carbonHill = { lat: 33.8907, lon: -87.5264 }; // zippopotam.us ZIP centroids
  const down = async () => ({ ok: false, json: async () => ({}) });
  const est = await routeMiles(dublin, carbonHill, { fetchImpl: down });
  assert.equal(est.source, "estimate");
  assert.ok(est.miles >= 330 && est.miles <= 355, `fallback ${est.miles}`); // within Google's 338-349 band +-
});
