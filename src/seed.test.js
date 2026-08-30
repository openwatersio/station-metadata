import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createResolver } from "./resolve.js";
import { loadCorrections } from "./corrections.js";

const read = (name) =>
  readFileSync(fileURLToPath(new URL(`../data/${name}`, import.meta.url)), "utf8");

const corrections = loadCorrections(read("corrections.yaml"));
const gazetteer = JSON.parse(read("gazetteer.json"));
// A resolved slug comes from the published table and nowhere else, so a
// resolver built without it answers "" for every station.
const slugTable = JSON.parse(read("slugs.json"));
const slugs = new Map([...Object.entries(slugTable.tide), ...Object.entries(slugTable.current)]);
const resolve = createResolver({ corrections, gazetteer, slugs });

// Stations that arrive with no context of their own. IDs and coordinates were
// derived from slackwater-web's bundled station data, not written by hand -
// three hand-written IDs in an earlier draft pointed at the wrong stations.
// Two of the original 18 (Jim Creek, Telegraph Bay) are pinned separately in
// CHART_PLACED below, since their context is curated rather than derived.
const CONTEXTLESS = [
  ["noaa/9445133", "Bangor Wharf", 47.748, -122.727],
  ["noaa/9449424", "CHERRY POINT", 48.863, -122.759],
  ["noaa/9447659", "Everett", 47.980, -122.223],
  ["noaa/9445016", "Foulweather Bluff", 47.927, -122.617],
  ["noaa/9447973", "NAS Whidbey Island", 48.343, -122.686],
  ["noaa/9443090", "NEAH BAY", 48.371, -124.602],
  ["noaa/9449639", "POINT ROBERTS, PUGET SOUND", 48.975, -123.083],
  ["noaa/9444090", "Port Angeles", 48.125, -123.440],
  ["noaa/9444900", "PORT TOWNSEND", 48.111, -122.760],
  ["noaa/9447717", "Priest Point", 48.035, -122.227],
  ["noaa/9446804", "SANDY POINT ANDERSON ISLAND, PUGET SOUND", 47.153, -122.675],
  ["noaa/9448576", "Sneeoosh Point", 48.400, -122.548],
  ["noaa/9448009", "Spee-Bi-Dah", 48.088, -122.322],
  ["noaa/9447773", "Tulalip", 48.065, -122.288],
  ["noaa/9445478", "Union", 47.358, -123.098],
  ["noaa/9449746", "WALDRON ISLAND, PUGET SOUND", 48.687, -123.038],
];

// These six carry their own qualifier in the raw name already ("Blaine,
// Semiahmoo Bay"), which is exactly what makes the derived-context fallback
// misfire: the nearest gazetteer place ("Blaine") is a substring of the raw
// name, so namesOverlap suppresses the fallback and they resolve with no
// context at all - a real regression this test set did not cover.
const OVERLAP_SUPPRESSED = [
  ["noaa/9449679", "Blaine, Semiahmoo Bay", 48.9917, -122.765],
  ["noaa/9445958", "Bremerton, Sinclair Inlet, Port Orchard", 47.5617, -122.623],
  ["noaa/9446807", "Budd Inlet, Olympia Shoal", 47.0983, -122.895],
  ["noaa/9449880", "Friday Harbor, San Juan Island", 48.5453, -123.0125],
  ["noaa/9447130", "SEATTLE (Madison St.), Elliott Bay", 47.6026, -122.3393],
  ["noaa/9446484", "Tacoma, Commencement Bay, Sitcum Waterway", 47.2667, -122.4133],
];

for (const [id, raw, lat, lon] of OVERLAP_SUPPRESSED) {
  test(`${raw} resolves with a context despite naming its own nearest place`, () => {
    const r = resolve({ id, name: raw, latitude: lat, longitude: lon });
    assert.notEqual(r.context, "", `${raw} still has no context`);
    assert.notEqual(r.context.toLowerCase(), r.name.toLowerCase());
  });
}

// Two decommissioned NOAA gauges (issue #1) that no town or island can confidently
// hold, curated to the water body NOAA's own chart assignment places them in.
// Pinned so a future edit that re-derives or mis-places them fails a test, not a
// shared URL - and so the derived fallback can never quietly reclaim them.
const CHART_PLACED = [
  ["noaa/9449988", "TELEGRAPH BAY, PUGET SOUND", 48.443, -122.805, "Telegraph Bay", "Rosario Strait"],
  ["noaa/9443551", "Jim Creek", 48.187, -124.063, "Jim Creek", "Strait of Juan de Fuca"],
];

for (const [id, raw, lat, lon, name, context] of CHART_PLACED) {
  test(`${raw} resolves to its chart-placed context`, () => {
    const r = resolve({ id, name: raw, latitude: lat, longitude: lon });
    assert.equal(r.name, name);
    assert.equal(r.context, context);
    // Curated, not a nearest-town guess.
    assert.equal(r.derived, false);
  });
}

for (const [id, raw, lat, lon] of CONTEXTLESS) {
  test(`${raw} resolves with a context`, () => {
    const r = resolve({ id, name: raw, latitude: lat, longitude: lon });
    assert.notEqual(r.context, "", `${raw} still has no context`);
    assert.notEqual(r.context.toLowerCase(), r.name.toLowerCase());
  });
}

test("no name is left shouting", () => {
  for (const [id, raw, lat, lon] of CONTEXTLESS) {
    const { name } = resolve({ id, name: raw, latitude: lat, longitude: lon });
    const letters = name.replace(/[^A-Za-z]/g, "");
    assert.notEqual(letters, letters.toUpperCase(), `${name} still shouts`);
  }
});

// Stations the source data already describes well enough to need no override.
// Curating one anyway is not a neutral act: noaa/9448682 carried a hand-written
// `name: Anacortes` for a gauge that is neither in Anacortes nor named after
// it, and because a curated override wins outright, the correct source name
// was thrown away and the wrong one shipped to a deployed app.
//
// Pinned here so a future override that re-breaks one of these fails a test
// rather than a URL.
const RESOLVES_UNCURATED = [
  [
    "noaa/9448682",
    "Swinomish Channel ent., Padilla Bay",
    48.4583,
    -122.513,
    { name: "Swinomish Channel Entrance", context: "Padilla Bay", slug: "swinomish-channel-entrance" },
  ],
];

for (const [id, raw, lat, lon, expected] of RESOLVES_UNCURATED) {
  test(`${raw} resolves correctly with no correction`, () => {
    const r = resolve({ id, name: raw, latitude: lat, longitude: lon });
    assert.equal(r.name, expected.name);
    assert.equal(r.context, expected.context);
    assert.equal(r.slug, expected.slug);
    // Not `derived` - this context comes from the station's own qualifier, so
    // it is source data rather than a nearest-town guess.
    assert.equal(r.derived, false);
    assert.equal(corrections.has(id), false, `${id} has an override again`);
  });
}
