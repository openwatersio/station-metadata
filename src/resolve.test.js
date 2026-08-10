import { test } from "node:test";
import assert from "node:assert/strict";
import { createResolver } from "./resolve.js";
import { loadCorrections } from "./corrections.js";

const corrections = loadCorrections(`
noaa/9447659:
  name: Everett
  context: Port Gardner
  slug: everett
  cities: [Everett]
noaa/8:
  name: Anacortes
  context: Guemes Channel
  position: [48.5163, -122.6142]
  reason: inland
`);

// Minimal gazetteer: name, lat, lon.
const gazetteer = [
  { name: "Forks", region: "WA", latitude: 47.95, longitude: -124.385 },
  { name: "Everett", region: "WA", latitude: 47.979, longitude: -122.202 },
];

const resolve = createResolver({ corrections, gazetteer });

test("a curated override wins outright", () => {
  const r = resolve({ id: "noaa/9447659", name: "Everett", latitude: 47.98, longitude: -122.223 });
  assert.equal(r.name, "Everett");
  assert.equal(r.context, "Port Gardner");
  assert.equal(r.slug, "everett");
  assert.equal(r.derived, false);
});

test("a corrected position replaces the published one", () => {
  const r = resolve({ id: "noaa/8", name: "ANACORTES", latitude: 48.51, longitude: -122.61 });
  assert.equal(r.latitude, 48.5163);
  assert.equal(r.longitude, -122.6142);
  assert.equal(r.corrected, true);
});

test("an uncorrected station still gets a cleaned name and a slug", () => {
  const r = resolve({ id: "noaa/1", name: "CHERRY POINT", latitude: 48.863, longitude: -122.759 });
  assert.equal(r.name, "Cherry Point");
  assert.equal(r.slug, "cherry-point");
  assert.equal(r.corrected, false);
});

test("context falls back to the nearest gazetteer place", () => {
  const r = resolve({ id: "noaa/2", name: "Jim Creek", latitude: 48.187, longitude: -124.063 });
  assert.equal(r.context, "~Forks, WA");
  assert.equal(r.derived, true);
});

test("no place is offered beyond DERIVED_MAX_KM", () => {
  // Mid-Pacific. Telling this station it is "~Forks, WA" would be worse than
  // telling it nothing, which is what the empty context lets a consumer do:
  // fall through to its own coarse label.
  const r = resolve({ id: "noaa/far", name: "Nowhere Bank", latitude: 40, longitude: -140 });
  assert.equal(r.context, "");
  assert.equal(r.derived, false);
});

test("a recognisable town outweighs a neighbourhood that is slightly closer", () => {
  // The shipped failure: a Victoria gauge labelled "~Tillicum, BC" (a
  // neighbourhood 2 km off) instead of Victoria at 4 km.
  const withPopulations = createResolver({
    gazetteer: [
      { name: "Tillicum", region: "BC", latitude: 48.452, longitude: -123.386, population: 10080 },
      { name: "Victoria", region: "BC", latitude: 48.4284, longitude: -123.3656, population: 289625 },
    ],
  });
  const r = withPopulations({
    id: "chs/1", name: "Selkirk Water", latitude: 48.4483, longitude: -123.3831,
  });
  assert.equal(r.context, "~Victoria, BC");
});

test("a small place still wins when it is genuinely the nearest thing", () => {
  // The weighting must not let a distant city swallow the local answer: a
  // village 8 km away beats a city 60 km away, which is also past the cap.
  const withPopulations = createResolver({
    gazetteer: [
      { name: "Sointula", region: "BC", latitude: 50.6316, longitude: -127.0263, population: 513 },
      { name: "Victoria", region: "BC", latitude: 48.4284, longitude: -123.3656, population: 289625 },
    ],
  });
  const r = withPopulations({
    id: "chs/2", name: "Alert Bay", latitude: 50.5853, longitude: -126.9319,
  });
  assert.equal(r.context, "~Sointula, BC");
});

test("a place with no population competes on distance alone", () => {
  // A hand-written gazetteer carries no populations, so every entry gets the
  // same zero credit and the pick is exactly the nearest — what the 19-town
  // gazetteer did before the weighting existed.
  const r = resolve({ id: "noaa/2b", name: "Jim Creek", latitude: 48.187, longitude: -124.063 });
  assert.equal(r.context, "~Forks, WA");
});

test("a derived context never restates the name", () => {
  // Nearest place to the Everett station IS Everett; repeating it is the bug.
  const r = resolve({ id: "noaa/3", name: "Everett", latitude: 47.979, longitude: -122.202 });
  assert.notEqual(r.context.toLowerCase(), "everett");
  assert.equal(r.context, "");
});

test("a derived context is suppressed even when it only overlaps the name as a phrase", () => {
  // Exact-equality would miss this: "Everett" inside "Everett Marina" is the
  // same restating-the-name mistake validateCorrections rejects from a human.
  const r = resolve({ id: "noaa/4", name: "Everett Marina", latitude: 47.979, longitude: -122.202 });
  assert.equal(r.context, "");
});

test("aliases always include the name and the slug", () => {
  const r = resolve({ id: "noaa/1", name: "CHERRY POINT", latitude: 48.863, longitude: -122.759 });
  assert.ok(r.aliases.includes("cherry point"));
  assert.ok(r.aliases.includes("cherry-point"));
});

test("formerSlugs defaults to an empty array when the correction sets none", () => {
  const r = resolve({ id: "noaa/9447659", name: "Everett", latitude: 47.98, longitude: -122.223 });
  assert.deepEqual(r.formerSlugs, []);
});

test("formerSlugs appears on the resolved record when the correction sets it", () => {
  const withHistory = loadCorrections(`
noaa/8:
  name: Swinomish Channel Entrance
  slug: swinomish-channel-entrance
  formerSlugs: [anacortes]
`);
  const r = createResolver({ corrections: withHistory })({
    id: "noaa/8",
    name: "Swinomish Channel ent., Padilla Bay",
    latitude: 48.4583,
    longitude: -122.513,
  });
  assert.deepEqual(r.formerSlugs, ["anacortes"]);
});

test("omits positionVerified from the resolved object when not set", () => {
  const r = resolve({ id: "noaa/9447659", name: "Everett", latitude: 47.98, longitude: -122.223 });
  assert.equal("positionVerified" in r, false);
});

test("includes positionVerified on the resolved object when set", () => {
  const verified = loadCorrections(`
noaa/1:
  positionVerified: "up the river; the coastline maps ocean only"
`);
  const r = createResolver({ corrections: verified, gazetteer: [] })({
    id: "noaa/1",
    name: "Test",
    latitude: 48,
    longitude: -122,
  });
  assert.equal(r.positionVerified, "up the river; the coastline maps ocean only");
});

test("does not crash on a non-string alias in the corrections map", () => {
  // validateCorrections rejects this in the shipped corrections.yaml, but
  // createResolver is also usable directly with a hand-built Map that never
  // went through validation.
  const badCorrections = new Map([["noaa/9", { aliases: [123] }]]);
  const badResolve = createResolver({ corrections: badCorrections, gazetteer: [] });
  assert.doesNotThrow(() => badResolve({ id: "noaa/9", name: "Test", latitude: 48, longitude: -122 }));
});

// NOAA station names carry their location as a trailing comma qualifier:
// "Friday Harbor, San Juan Island". Uncurated stations with no gazetteer
// override should split on that comma rather than leaving context empty.
const splitResolve = createResolver({ corrections, gazetteer });

test("a comma-qualified name splits into a name and a context", () => {
  const r = splitResolve({
    id: "noaa/100",
    name: "Friday Harbor, San Juan Island",
    latitude: 48.545,
    longitude: -123.012,
  });
  assert.equal(r.name, "Friday Harbor");
  assert.equal(r.context, "San Juan Island");
  assert.equal(r.derived, false);
});

test("extra comma segments join with a middot", () => {
  const r = splitResolve({
    id: "noaa/101",
    name: "Bremerton, Sinclair Inlet, Port Orchard",
    latitude: 47.5617,
    longitude: -122.623,
  });
  assert.equal(r.name, "Bremerton");
  assert.equal(r.context, "Sinclair Inlet · Port Orchard");
});

test("abbreviations expand on both sides of the split", () => {
  const r = splitResolve({
    id: "noaa/102",
    name: "Hanbury Point, Mosquito Pass, San Juan I.",
    latitude: 48.55,
    longitude: -123.02,
  });
  assert.equal(r.name, "Hanbury Point");
  assert.equal(r.context, "Mosquito Pass · San Juan Island");
});

// The qualifier a NOAA current station carries is a bearing off a landmark, and
// it is what a card renders under the station name. It reached the card as
// "7.6 mi. Sse" - a title-cased compass point, in statute miles above a range
// the consumer computes in nautical.
test("a bearing qualifier keeps its compass point and states range in nautical miles", () => {
  const r = splitResolve({
    id: "noaa/104",
    name: "Discovery Island, 7.6 mi. SSE of",
    latitude: 48.35,
    longitude: -123.16,
  });
  assert.equal(r.name, "Discovery Island");
  assert.equal(r.context, "6.6 nm SSE of");
});

test("a parenthetical in the name survives the split", () => {
  const r = splitResolve({
    id: "noaa/103",
    name: "SEATTLE (Madison St.), Elliott Bay",
    latitude: 47.6026,
    longitude: -122.3393,
  });
  assert.equal(r.name, "Seattle (Madison St.)");
  assert.equal(r.context, "Elliott Bay");
});

test("a trailing Puget Sound qualifier is dropped, not used as context", () => {
  const r = splitResolve({
    id: "noaa/104",
    name: "Point Roberts, Puget Sound",
    // Close to the "Forks" gazetteer entry so a dropped split falls through
    // to the derived fallback instead of leaving context empty.
    latitude: 47.95,
    longitude: -124.385,
  });
  assert.equal(r.name, "Point Roberts");
  assert.equal(r.context, "~Forks, WA");
  assert.equal(r.derived, true);
});

test("a split context that restates the name is dropped, not emitted as a tautology", () => {
  const r = splitResolve({
    id: "noaa/105",
    name: "Union, Union Bay",
    // Close to the "Everett" gazetteer entry so a dropped split falls
    // through to the derived fallback instead of leaving context empty.
    latitude: 47.979,
    longitude: -122.202,
  });
  assert.equal(r.name, "Union");
  assert.notEqual(r.context, "Union Bay");
  assert.equal(r.context, "~Everett, WA");
  assert.equal(r.derived, true);
});

test("a curated name and context still win outright over a comma-qualified raw name", () => {
  const curatedForSplit = loadCorrections(`
noaa/106:
  name: Curated Name
  context: Curated Context
`);
  const resolveWithCuration = createResolver({ corrections: curatedForSplit, gazetteer: [] });
  const r = resolveWithCuration({
    id: "noaa/106",
    name: "Raw Name, Raw Qualifier",
    latitude: 48,
    longitude: -122,
  });
  assert.equal(r.name, "Curated Name");
  assert.equal(r.context, "Curated Context");
});

test("a plain name with no comma is unaffected by the split", () => {
  const r = splitResolve({ id: "noaa/107", name: "Everett", latitude: 47.979, longitude: -122.202 });
  assert.equal(r.name, "Everett");
});

const registry = new Map([
  ["chs-dodd-narrows", {
    name: "Dodd Narrows",
    context: "Nanaimo",
    position: [49.1344, -123.8171],
    provider: "chs",
    cities: ["Nanaimo"],
    aliases: ["dodd"],
  }],
]);
const withRegistry = createResolver({ corrections, gazetteer, registry });

test("a registry station resolves from its id alone", () => {
  const r = withRegistry({ id: "chs-dodd-narrows" });
  assert.equal(r.name, "Dodd Narrows");
  assert.equal(r.context, "Nanaimo");
  assert.equal(r.slug, "dodd-narrows");
  assert.equal(r.latitude, 49.1344);
  assert.equal(r.longitude, -123.8171);
  assert.deepEqual(r.cities, ["Nanaimo"]);
  assert.equal(r.corrected, false);
  assert.equal(r.derived, false);
  assert.deepEqual(r.formerSlugs, []);
});

test("formerSlugs appears on a registry station's resolved record", () => {
  const registryWithHistory = new Map([
    ["chs-dodd-narrows", {
      name: "Dodd Narrows",
      position: [49.1344, -123.8171],
      provider: "chs",
      formerSlugs: ["dodds-narrows"],
    }],
  ]);
  const r = createResolver({ registry: registryWithHistory })({ id: "chs-dodd-narrows" });
  assert.deepEqual(r.formerSlugs, ["dodds-narrows"]);
});

test("registry aliases include the name and slug", () => {
  const r = withRegistry({ id: "chs-dodd-narrows" });
  assert.ok(r.aliases.includes("dodd narrows"));
  assert.ok(r.aliases.includes("dodd-narrows"));
  assert.ok(r.aliases.includes("dodd"));
});

test("the registry outranks provider data", () => {
  const r = withRegistry({ id: "chs-dodd-narrows", name: "WRONG", latitude: 1, longitude: 2 });
  assert.equal(r.name, "Dodd Narrows");
  assert.equal(r.latitude, 49.1344);
});

test("a registry station's kind flows through to the resolved record", () => {
  const tideRegistry = new Map([
    ["chs-victoria", { name: "Victoria", position: [48.424, -123.371], provider: "chs", kind: "tide" }],
  ]);
  const r = createResolver({ registry: tideRegistry })({ id: "chs-victoria" });
  assert.equal(r.kind, "tide");
});

test("a registry station without a kind defaults to current - the registry was currents first", () => {
  // chs-dodd-narrows in the shared fixture sets no kind.
  const r = withRegistry({ id: "chs-dodd-narrows" });
  assert.equal(r.kind, "current");
});

test("a tide port and a current gate are distinguishable after resolving", () => {
  const mixed = new Map([
    ["chs-victoria", { name: "Victoria", position: [48.424, -123.371], provider: "chs", kind: "tide" }],
    ["chs-active-pass", { name: "Active Pass", position: [48.8604, -123.3128], provider: "chs" }],
  ]);
  const resolve = createResolver({ registry: mixed });
  assert.equal(resolve({ id: "chs-victoria" }).kind, "tide");
  assert.equal(resolve({ id: "chs-active-pass" }).kind, "current");
});

test("a station not in the registry falls through to the overlay unchanged", () => {
  const r = withRegistry({ id: "noaa/9447659", name: "Everett", latitude: 47.98, longitude: -122.223 });
  assert.equal(r.name, "Everett");
  assert.equal(r.context, "Port Gardner");
});

test("a resolver with no registry behaves exactly as before", () => {
  const r = resolve({ id: "noaa/9447659", name: "Everett", latitude: 47.98, longitude: -122.223 });
  assert.equal(r.name, "Everett");
  assert.equal(r.context, "Port Gardner");
});

test("a registry station with a malformed position throws a clear, actionable error rather than crashing on undefined", () => {
  // createResolver is public API and accepts a caller-supplied registry that
  // never went through validateRegistry - a missing position must not throw
  // a raw TypeError from indexing owned.position[0].
  const badRegistry = new Map([
    ["chs-broken", { name: "Broken", provider: "chs" }],
  ]);
  const badResolve = createResolver({ registry: badRegistry });
  assert.throws(
    () => badResolve({ id: "chs-broken" }),
    /chs-broken/,
  );
});

test("a gate's tideReference flows through to the resolved record", () => {
  const paired = new Map([
    ["chs-vic", { name: "Victoria", position: [48.424, -123.371], provider: "chs", kind: "tide" }],
    ["chs-gate", { name: "Gate", position: [49.1, -123.1], provider: "chs", tideReference: "chs-vic" }],
  ]);
  const r = createResolver({ registry: paired })({ id: "chs-gate" });
  assert.equal(r.tideReference, "chs-vic");
});

test("an unpaired gate carries no tideReference on the resolved record", () => {
  // chs-dodd-narrows in the shared fixture pairs to nothing - the key must be
  // absent, not present-and-undefined, matching how positionVerified behaves.
  // (`derived` is a different field entirely - the gazetteer-context boolean.)
  const r = withRegistry({ id: "chs-dodd-narrows" });
  assert.ok(!("tideReference" in r));
});

test("a derived gate resolves with tideReference set to its derived reference", () => {
  // A gate CHS publishes no current station for carries a `derived` block, not
  // a `tideReference`. The resolved record surfaces the *effective* reference
  // tide port either way - the paired-tide view needs one field, not two - and
  // for a derived gate that is derived.reference.
  const dr = new Map([
    ["chs-pa", { name: "Point Atkinson", position: [49.337, -123.254], provider: "chs", kind: "tide" }],
    ["chs-malibu", { name: "Malibu", position: [50.16, -123.85], provider: "chs",
      derived: { reference: "chs-pa", hwLagMinutes: 25, lwLagMinutes: 35 } }],
  ]);
  const r = createResolver({ registry: dr })({ id: "chs-malibu" });
  assert.equal(r.tideReference, "chs-pa");
});
