import { test } from "node:test";
import assert from "node:assert/strict";
import { departures, DEPARTURE_LIMIT } from "./catalogue.js";

test("departures are ids present before and absent now, sorted", () => {
  const gone = departures(["noaa/3", "noaa/1", "noaa/2"], ["noaa/2"]);
  assert.deepEqual(gone, ["noaa/1", "noaa/3"]);
});

test("no departures when the catalogue only grows", () => {
  assert.deepEqual(departures(["noaa/1"], ["noaa/1", "noaa/2"]), []);
});

test("the departure limit is a fixed count, not a proportion", () => {
  // A proportion scales with the lock, which is the thing it protects: a
  // truncated catalogue stays under a percentage as the catalogue grows.
  assert.equal(typeof DEPARTURE_LIMIT, "number");
  assert.ok(DEPARTURE_LIMIT > 0 && DEPARTURE_LIMIT < 100);
});
