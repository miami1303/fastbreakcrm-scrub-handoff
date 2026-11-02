import test from "node:test";
import assert from "node:assert/strict";
import { laneRate, perMile, perMileLabel, placeFor } from "../lib/lane-rates.ts";

const now = Date.parse("2026-10-31T12:00:00Z");
const day = n => new Date(now - n * 86_400_000).toISOString();

test("per mile from COD / miles", () => {
  assert.equal(perMile(975, 1300), 0.75);
  assert.equal(perMileLabel(0.75), "$0.75 per mile");
  assert.equal(perMile(0, 100), null);
  assert.equal(perMile(500, 0), null);
});

test("Miami, Ft Lauderdale, Palm Beach share South FL; Key West is its own bucket", () => {
  assert.equal(placeFor("33131").metro, "SOFL");
  assert.equal(placeFor("33301").metro, "SOFL");
  assert.equal(placeFor("33401").metro, "SOFL");
  assert.equal(placeFor("33040").metro, "KEYS");
  assert.equal(placeFor("10001").metro, "NYC");
  assert.equal(placeFor("90210").region, "West Coast");
});

test("learns the corridor: Palm Beach -> NY uses Miami -> NY jobs, Key West does not", () => {
  const s = [
    { pickup_zip: "33131", delivery_zip: "10001", carrier_pay: 900, miles: 1280, at: day(5) },
    { pickup_zip: "33301", delivery_zip: "11201", carrier_pay: 950, miles: 1260, at: day(20) },
    { pickup_zip: "33040", delivery_zip: "10001", carrier_pay: 1400, miles: 1440, at: day(3) },
  ];
  const pb = laneRate("33401", "10019", s, now);
  assert.equal(pb.level, "metro");
  assert.equal(pb.count, 2);
  assert.ok(pb.perMile > 0.7 && pb.perMile < 0.76, String(pb.perMile));
  const kw = laneRate("33040", "10019", s, now);
  assert.equal(kw.count, 1);
  assert.equal(kw.perMile, 0.97);
});

test("falls back to state, then region, then nothing", () => {
  const s = [{ pickup_zip: "32501", delivery_zip: "14201", carrier_pay: 1000, miles: 1100, at: day(1) }];
  assert.equal(laneRate("32601", "12201", s, now).level, "state");
  const r = laneRate("32601", "08540", s, now);
  assert.equal(r.level, "region");
  assert.equal(laneRate("90001", "10001", s, now), null);
});

test("recent jobs weigh more", () => {
  const s = [
    { pickup_zip: "33131", delivery_zip: "10001", carrier_pay: 1300, miles: 1300, at: day(0) },
    { pickup_zip: "33131", delivery_zip: "10001", carrier_pay: 650, miles: 1300, at: day(180) },
  ];
  assert.ok(laneRate("33131", "10001", s, now).perMile > 0.9);
});
