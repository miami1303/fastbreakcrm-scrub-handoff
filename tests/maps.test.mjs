import test from "node:test";
import assert from "node:assert/strict";
import { GOOGLE_MAPS_HOME, googleMapsDirectionsUrl, googleMapsSearchUrl, mapsPlace } from "../lib/maps.ts";

test("full address is used as entered: no ', USA' appended (Owner 2026-10-31)", () => {
  assert.equal(mapsPlace({ street: "100 Main St", city: "Carbon Hill", state: "AL", zip: "35549" }), "100 Main St, Carbon Hill, AL 35549");
  assert.equal(mapsPlace({ city: "Dublin", state: "ga", zip: "31021" }), "Dublin, GA 31021");
  assert.equal(mapsPlace({ street: "9300 S Broadway", zip: "80126" }), "9300 S Broadway, 80126");
});

test("ZIP only: lat,lon from the lookup, else 'ZIP, USA'; nothing: null", () => {
  assert.equal(mapsPlace({ zip: "31021", lat: 32.5404, lon: -82.9038 }), "32.54040,-82.90380");
  assert.equal(mapsPlace({ zip: "31021" }), "31021, USA");
  assert.equal(mapsPlace({}), null);
});

test("route: directions when both places are known, URL-encoded, no USA", () => {
  const withStreet = googleMapsDirectionsUrl({ street: "100 N University Dr", city: "Plantation", state: "FL", zip: "33313" }, { street: "9300 S Broadway", city: "Littleton", state: "CO", zip: "80126" });
  assert.ok(withStreet.startsWith("https://www.google.com/maps/dir/?api=1&origin=100+N+University+Dr%2C+Plantation%2C+FL+33313&destination=9300+S+Broadway%2C+Littleton%2C+CO+80126&travelmode=driving"));
  const u = new URL(googleMapsDirectionsUrl({ city: "Plantation", state: "FL", zip: "33313" }, { city: "Littleton", state: "CO", zip: "80126" }));
  assert.equal(u.searchParams.get("origin"), "Plantation, FL 33313");
  assert.equal(u.searchParams.get("destination"), "Littleton, CO 80126");
});

test("route with one side missing opens that place; nothing opens Google Maps (never a dead button)", () => {
  const u = new URL(googleMapsDirectionsUrl({ city: "Plantation", state: "FL" }, {}));
  assert.equal(u.pathname, "/maps/search/");
  assert.equal(u.searchParams.get("query"), "Plantation, FL");
  assert.equal(googleMapsDirectionsUrl({}, {}), GOOGLE_MAPS_HOME);
});

test("pickup / delivery map links: a Google Maps search for that one place", () => {
  const u = new URL(googleMapsSearchUrl({ street: "100 Main St", city: "Carbon Hill", state: "AL", zip: "35549" }));
  assert.equal(u.origin + u.pathname, "https://www.google.com/maps/search/");
  assert.equal(u.searchParams.get("api"), "1");
  assert.equal(u.searchParams.get("query"), "100 Main St, Carbon Hill, AL 35549");
  assert.equal(new URL(googleMapsSearchUrl({ zip: "80126" })).searchParams.get("query"), "80126, USA");
  assert.equal(googleMapsSearchUrl({}), GOOGLE_MAPS_HOME);
});
