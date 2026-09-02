import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isOnLand, inlandMetres, nearestWater, coverageBounds, coverageRegions, isWithinCoverage } from "./coastline.js";

test("the bundled coastline has not been generalised down to a handful of shapes", () => {
  // The 7 golden points below only prove those exact coordinates. A coarser
  // rebuild (the exact Natural Earth failure this package was built to
  // avoid - see CONTRIBUTING "Rebuilding the bundled data") could keep all 7 correct while
  // merging away small islands and inlets everywhere else. Feature count is
  // a cheap proxy for that: the built coastline has 4,318 features: a large
  // drop means an over-simplified rebuild, not a golden-point regression.
  const coastline = JSON.parse(
    readFileSync(fileURLToPath(new URL("../data/coastline.geojson", import.meta.url)), "utf8"),
  );
  assert.ok(
    coastline.features.length >= 4000,
    `expected at least ~4,000 features, got ${coastline.features.length}`,
  );
});

// Golden points with MEASURED inland distances against the built coastline.
// Natural Earth 1:10m gets several of these wrong, which is why it was rejected.
const GOLDEN = [
  ["Everett gauge",                    47.9800, -122.2230, 0],
  ["Cherry Point gauge",               48.8630, -122.7590, 0],
  ["mid Strait of Georgia",            48.9000, -123.2000, 0],
  // Correctly sited on a pier - land, but nowhere near the reporting threshold.
  ["Friday Harbor gauge (on a pier)",  48.5460, -123.0130, 31],
];

for (const [label, lat, lon, expected] of GOLDEN) {
  test(`${label} is ${expected} m inland`, () => {
    // Coastline generalisation moves this a little; the band is what matters.
    const actual = inlandMetres(lat, lon);
    if (expected === 0) assert.equal(actual, 0);
    else assert.ok(Math.abs(actual - expected) <= 40, `expected ~${expected} m, got ${actual}`);
  });
}

test("deep inland reads as deeply inland", () => {
  // Mount Vernon is kilometres from salt water in every direction.
  assert.ok(inlandMetres(48.42, -122.33) > 1000);
});

test("a pier-mounted gauge is under the reporting threshold", () => {
  // The rule the 200 m tolerance exists to encode: piers are not errors.
  assert.ok(inlandMetres(48.546, -123.013) < 200);
});

test("a pier-mounted gauge is still on land", () => {
  // The golden-point band (+/-40 m around 31) accepts 0, and 0 means "water" -
  // exactly the Natural Earth misclassification this package exists to catch.
  // This assertion is what actually guards against that regression.
  assert.equal(isOnLand(48.546, -123.013), true);
});

test("inlandMetres never throws: far inland with no mapped water returns Infinity", () => {
  // A true mid-continent point (e.g. 47.0, -100.0, central North Dakota) falls
  // entirely outside this bundled coastline's bbox, so isOnLand reports false
  // there and inlandMetres never even reaches the ring search - it can't
  // exercise the bug. Whistler, BC is inside the bbox, genuinely on land, and
  // has no mapped water within the 20 km search radius, so it does exercise it.
  // The documented contract is "always a number" - a batch audit of many
  // stations must not die because one row's coordinate has no nearby water.
  assert.equal(inlandMetres(50.12, -122.95), Infinity);
});

test("nearest water from an inland point is in water and close by", () => {
  const found = nearestWater(48.5100, -122.6100);
  assert.equal(isOnLand(found.latitude, found.longitude), false);
  assert.ok(found.metres > 0 && found.metres < 5000, `got ${found.metres} m`);
});

test("nearest water from a point already in water is itself", () => {
  const found = nearestWater(48.9, -123.2);
  assert.equal(found.metres, 0);
});

test("coverage bounds are derived from the coastline data", () => {
  // scripts/build-coastline.mjs floors the clip at the Salish Sea box
  // [-125.5, 47.0, -122.0, 50.5] and grows it outward to enclose the registry
  // (#9), so the south/east edges stay put while the north/west follow the
  // northern CHS gates. Exact edges move with the registry, so assert the
  // invariant, not fixed numbers: the floor is preserved and the box only ever
  // grew from it.
  //
  // Asserted on the REGION carrying the floor, not on the overall bounds. Once
  // the registry went national the clip became several disjoint regions, and
  // the overall bounds run to Cape Breton — which would pass a "grew outward"
  // check while saying nothing about the Salish box still being intact.
  const salish = coverageRegions().find((r) => Math.abs(r.minLat - 47.0) < 0.01);
  assert.ok(salish, "no region preserves the Salish Sea floor's southern edge");
  assert.ok(Math.abs(salish.maxLon - -122.0) < 0.01, `maxLon (floor) was ${salish.maxLon}`);
  assert.ok(salish.maxLat >= 50.5, `maxLat should cover past the old clip, was ${salish.maxLat}`);
  assert.ok(salish.minLon <= -125.5, `minLon should cover past the old clip, was ${salish.minLon}`);
});

test("the water between two clip regions is not claimed as covered", () => {
  // The defect a single spanning rectangle would reintroduce: with gates on
  // both coasts, the bounds enclose the whole country, and every prairie
  // section line would audit as clear open water.
  const regions = coverageRegions();
  if (regions.length < 2) return; // one region: nothing between, nothing to claim
  const b = coverageBounds();
  const inBounds = (lat, lon) =>
    lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
  // Winnipeg — inside the coast-to-coast bounds, inside no clip region.
  assert.equal(inBounds(49.9, -97.1), true, "test point must be inside the outer bounds");
  assert.equal(isWithinCoverage(49.9, -97.1), false);
});

// A point beyond the coastline in every direction, whatever the current clip -
// derived from the bounds so it can't go stale when the clip grows (#9).
const b = coverageBounds();
const OUTSIDE = [b.maxLat + 1, b.minLon - 1];

test("positions outside the clip are not covered", () => {
  assert.equal(isWithinCoverage(...OUTSIDE), false);
  // Weynton Passage - a real CHS gate, now inside the registry-derived clip.
  assert.equal(isWithinCoverage(50.6033, -126.8117), true);
  // Dodd Narrows - inside.
  assert.equal(isWithinCoverage(49.1344, -123.8171), true);
});

test("an uncovered position is not silently reported as water", () => {
  // This is the bug: isOnLand cannot tell "no land here" from "no data here".
  assert.equal(isOnLand(...OUTSIDE), false);
  assert.equal(isWithinCoverage(...OUTSIDE), false);
});
