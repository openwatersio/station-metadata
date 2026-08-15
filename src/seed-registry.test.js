import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRegistry, validateRegistry } from "./registry.js";
import { loadCorrections } from "./corrections.js";
import { createResolver } from "./resolve.js";
import { validatePositions, coverageWarnings } from "./validate-positions.js";

const read = (name) =>
  readFileSync(fileURLToPath(new URL(`../data/${name}`, import.meta.url)), "utf8");

const registry = loadRegistry(read("registry.yaml"));
const corrections = loadCorrections(read("corrections.yaml"));
const resolve = createResolver({ registry, corrections });

test("the shipped registry is valid against the shipped corrections", () => {
  assert.deepEqual(validateRegistry(registry, { corrections }), []);
});

// The one non-CHS entry: a NOAA current station carried here because
// currents-vault, which curates the same gates, is dropping station identity
// in favour of this registry. Named so a station going missing or a provider
// silently changing (either direction) still fails loudly.
const NOAA_GATES = ["noaa-boundary-pass"];

// The 10 CHS tide reference ports (chs-online design spec §6b). CHS designates
// these itself - we did not choose the set. Pinned so one going missing, or a
// current gate drifting into the tide set, fails loudly.
const REFERENCE_PORTS = [
  "chs-owen-bay", "chs-campbell-river", "chs-point-atkinson", "chs-vancouver",
  "chs-port-alberni", "chs-tofino", "chs-fulford-harbour", "chs-port-renfrew",
  "chs-victoria", "chs-sooke",
];

test("every registry station is a CHS station except the one NOAA gate", () => {
  assert.equal(registry.size, 34 + NOAA_GATES.length); // +1: derived gate chs-malibu-rapids
  for (const [id, record] of registry) {
    if (NOAA_GATES.includes(id)) {
      assert.equal(record.provider, "noaa", `${id} is not a noaa provider`);
    } else {
      assert.ok(id.startsWith("chs-"), `${id} is not a chs key`);
      assert.equal(record.provider, "chs");
    }
  }
});

test("the 10 tide reference ports resolve, each classed as a tide", () => {
  for (const id of REFERENCE_PORTS) {
    assert.ok(registry.has(id), `${id} missing from the registry`);
    const r = resolve({ id });
    assert.ok(r.name, `${id} has no name`);
    assert.notEqual(r.context, "", `${id} has no context`);
    assert.notEqual(r.context.toLowerCase(), r.name.toLowerCase(), `${id} context restates the name`);
    assert.equal(r.kind, "tide", `${id} is not classed as a tide`);
  }
});

test("tide ports and current gates are distinguishable, and only the 10 ports are tides", () => {
  const tides = [...registry.keys()].filter((id) => resolve({ id }).kind === "tide");
  assert.deepEqual(tides.sort(), [...REFERENCE_PORTS].sort());
});

test("every station resolves with a name, a context and a position", () => {
  for (const id of registry.keys()) {
    const r = resolve({ id });
    assert.ok(r.name, `${id} has no name`);
    assert.notEqual(r.context, "", `${id} has no context`);
    assert.equal(typeof r.latitude, "number", `${id} has no latitude`);
    assert.equal(typeof r.longitude, "number", `${id} has no longitude`);
    assert.equal(r.corrected, false);
    assert.equal(r.derived, false);
  }
});

test("slugs are unique across the registry", () => {
  const slugs = [...registry.keys()].map((id) => resolve({ id }).slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

// #9: the coastline clip is derived from the registry's own extent, so every
// gate - including the three northern ones (Blackney, Johnstone Strait central,
// Weynton) that used to fall outside the Salish Sea clip - now sits within
// coverage. Pinned so a registry station growing beyond the clip without a
// coastline rebuild fails here, rather than silently going unaudited.
test("every registry station is within coastline coverage", () => {
  assert.deepEqual(coverageWarnings(registry), []);
});

// The spec requires every registry position to be either confirmed in water or
// reported as outside coverage. The test above pins that all gates are now
// covered; this pins that every one is actually in water - without it, a
// registry position drifting onto land would pass silently.
test("every registry position is in water", () => {
  assert.deepEqual(validatePositions(registry), []);
});
