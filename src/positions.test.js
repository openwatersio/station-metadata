import assert from "node:assert/strict";
import test from "node:test";

import { findNearbyPairs, haversineMetres, NEARBY_METRES } from "./positions.js";

const at = (id, latitude, longitude) => ({ id, latitude, longitude });

test("finds a pair closer than the threshold", () => {
  const pairs = findNearbyPairs([at("a", 48.424, -123.371), at("b", 48.424363, -123.370828)]);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a, pairs[0].b], ["a", "b"]);
  assert.ok(pairs[0].metres < NEARBY_METRES);
});

test("ignores stations further apart than the threshold", () => {
  // Vancouver to Victoria: same region, nobody's duplicate.
  assert.deepEqual(findNearbyPairs([at("a", 49.286, -123.1), at("b", 48.424, -123.371)]), []);
});

test("finds a pair that straddles a cell boundary", () => {
  // The grid is the whole risk: a pair either side of a cell edge is only found
  // because neighbouring cells are searched too. 0.01 deg latitude is ~1.1 km,
  // so these sit in adjacent cells and ~22 m apart.
  const pairs = findNearbyPairs([at("a", 48.0099, -123.0), at("b", 48.0101, -123.0)]);
  assert.equal(pairs.length, 1);
  assert.ok(pairs[0].metres < 30);
});

test("reports each pair once, not once per direction", () => {
  const pairs = findNearbyPairs([at("b", 48.0, -123.0), at("a", 48.0, -123.0)]);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a, pairs[0].b], ["a", "b"], "lower id first");
});

test("skips stations with no position rather than colliding them at null island", () => {
  const pairs = findNearbyPairs([
    { id: "a" },
    { id: "b" },
    { id: "c", latitude: null, longitude: null },
  ]);
  assert.deepEqual(pairs, []);
});

test("sorts nearest first", () => {
  const pairs = findNearbyPairs([
    at("far-1", 48.0, -123.0),
    at("far-2", 48.0006, -123.0), // ~67 m
    at("near-1", 49.0, -123.0),
    at("near-2", 49.00002, -123.0), // ~2 m
  ]);
  assert.equal(pairs.length, 2);
  assert.deepEqual([pairs[0].a, pairs[0].b], ["near-1", "near-2"]);
});

test("the four duplicates 4.0.0 shipped are all inside the threshold", () => {
  // The real distances, so the threshold cannot be tightened past the cases it
  // exists to catch without a test failing and saying so.
  const cases = [
    [{ latitude: 49.286, longitude: -123.1 }, { latitude: 49.2863, longitude: -123.0997 }, 40],
    [{ latitude: 48.424, longitude: -123.371 }, { latitude: 48.424363, longitude: -123.370828 }, 43],
    [{ latitude: 49.337, longitude: -123.254 }, { latitude: 49.3375, longitude: -123.253583 }, 64],
    [{ latitude: 48.6912, longitude: -123.245 }, { latitude: 48.6912117, longitude: -123.2450104 }, 2],
  ];
  for (const [a, b, ceiling] of cases) {
    const metres = haversineMetres(a, b);
    assert.ok(metres <= ceiling, `${metres} m should be within ${ceiling} m`);
    assert.ok(metres <= NEARBY_METRES, `${metres} m should be inside the threshold`);
  }
});

test("indexes rather than scanning: a full-catalogue sweep is not quadratic", () => {
  // Issue #2 is this repo paying for a linear geometric scan. All-pairs over
  // this many stations is ~8M haversines; the grid makes it linear. The bound
  // is loose on purpose - it catches a rewrite back to the nested loop, not a
  // slow machine.
  const stations = [];
  for (let i = 0; i < 4000; i++) {
    stations.push(at(`s${i}`, 40 + (i % 200) * 0.05, -130 + Math.floor(i / 200) * 0.05));
  }
  const started = Date.now();
  findNearbyPairs(stations);
  assert.ok(Date.now() - started < 1000, "swept 4,000 stations in under a second");
});
