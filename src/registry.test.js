import { test } from "node:test";
import assert from "node:assert/strict";
import { currentGates, loadRegistry, validateRegistry } from "./registry.js";
import { loadCorrections } from "./corrections.js";

const VALID = `
chs-dodd-narrows:
  name: Dodd Narrows
  context: Nanaimo
  position: [49.1344, -123.8171]
  provider: chs
  cities: [Nanaimo]
  aliases: [dodd]
`;

test("loads records keyed by station id", () => {
  const registry = loadRegistry(VALID);
  assert.equal(registry.get("chs-dodd-narrows").name, "Dodd Narrows");
  assert.deepEqual(registry.get("chs-dodd-narrows").position, [49.1344, -123.8171]);
});

test("accepts a valid registry", () => {
  assert.deepEqual(validateRegistry(loadRegistry(VALID)), []);
});

test("accepts kind tide or current, rejects any other value", () => {
  const withKind = (kind) =>
    `chs-x:\n  name: X\n  context: Somewhere\n  position: [48.4, -123.3]\n  provider: chs\n  kind: ${kind}\n`;
  for (const kind of ["tide", "current"]) {
    assert.deepEqual(validateRegistry(loadRegistry(withKind(kind))), [], `${kind} should be valid`);
  }
  const problems = validateRegistry(loadRegistry(withKind("tidal")));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /kind/);
});

test("accepts a current magnitude note and rejects an empty one", () => {
  const withNote = (note) => `${VALID}  magnitudeNote: ${note}\n`;
  assert.deepEqual(validateRegistry(loadRegistry(withNote('"9 kn flood & ebb"'))), []);
  assert.ok(validateRegistry(loadRegistry(withNote('""'))).some((m) => /magnitudeNote/.test(m)));
});

test("accepts a derived gate referencing an existing tide port", () => {
  const yaml = `
chs-point-atkinson:
  name: Point Atkinson
  context: West Vancouver
  position: [49.337, -123.254]
  provider: chs
  kind: tide
chs-malibu-rapids:
  name: Malibu Rapids
  context: Princess Louisa Inlet
  position: [50.163, -123.85]
  provider: chs
  kind: current
  derived:
    reference: chs-point-atkinson
    hwLagMinutes: 25
    lwLagMinutes: 35
`;
  assert.deepEqual(validateRegistry(loadRegistry(yaml)), []);
});

test("rejects a derived block that is malformed or points at the wrong reference", () => {
  const derived = (body) =>
    `chs-tide:\n  name: Ref\n  context: Somewhere\n  position: [49.3, -123.2]\n  provider: chs\n  kind: tide\n` +
    `chs-x:\n  name: X\n  context: Elsewhere\n  position: [50.1, -123.8]\n  provider: chs\n  kind: current\n  derived:\n${body}`;
  // missing reference + non-numeric lag
  let p = validateRegistry(loadRegistry(derived("    hwLagMinutes: soon\n    lwLagMinutes: 35\n")));
  assert.ok(p.some((m) => /derived.reference is required/.test(m)));
  assert.ok(p.some((m) => /derived.hwLagMinutes must be a number/.test(m)));
  // reference to an unknown station
  p = validateRegistry(loadRegistry(derived("    reference: chs-nope\n    hwLagMinutes: 25\n    lwLagMinutes: 35\n")));
  assert.ok(p.some((m) => /not a station in this registry/.test(m)));
  // reference to a current gate (not a tide port)
  const toGate =
    `chs-gate:\n  name: Gate\n  context: A\n  position: [49.3, -123.2]\n  provider: chs\n  kind: current\n` +
    `chs-x:\n  name: X\n  context: B\n  position: [50.1, -123.8]\n  provider: chs\n  kind: current\n` +
    `  derived:\n    reference: chs-gate\n    hwLagMinutes: 25\n    lwLagMinutes: 35\n`;
  p = validateRegistry(loadRegistry(toGate));
  assert.ok(p.some((m) => /must be a tide port/.test(m)));
});

test("requires name, position and provider", () => {
  const problems = validateRegistry(loadRegistry("chs-x:\n  context: Somewhere\n"));
  assert.equal(problems.length, 3);
  for (const field of ["name", "position", "provider"]) {
    assert.ok(problems.some((p) => p.includes(field)), `no problem mentioned ${field}`);
  }
});

test("rejects a malformed position", () => {
  const problems = validateRegistry(loadRegistry(`
chs-x:
  name: X
  position: 5
  provider: chs
`));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /position must be/);
});

test("rejects an out-of-range latitude", () => {
  const problems = validateRegistry(loadRegistry(`
chs-x:
  name: X
  position: [95, -123]
  provider: chs
`));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /latitude 95 is out of range/);
});

test("rejects a context that restates the name", () => {
  const problems = validateRegistry(loadRegistry(`
chs-dodd-narrows:
  name: Dodd Narrows
  context: Dodd Narrows Approach
  position: [49.1344, -123.8171]
  provider: chs
`));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /context repeats the name/);
});

test("rejects a malformed slug and duplicate slugs within the registry", () => {
  const problems = validateRegistry(loadRegistry(`
chs-a:
  name: A
  slug: Not A Slug
  position: [49, -123]
  provider: chs
chs-b:
  name: B
  slug: dupe
  position: [49, -123]
  provider: chs
chs-c:
  name: C
  slug: dupe
  position: [49, -123]
  provider: chs
`));
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => /must be lowercase/.test(p)));
  assert.ok(problems.some((p) => /duplicate slug "dupe"/.test(p)));
});

test("reports rather than throws on wrong types", () => {
  const problems = validateRegistry(loadRegistry(`
chs-x:
  name: 5
  position: [49, -123]
  provider: chs
  cities: "Nanaimo"
`));
  assert.ok(problems.some((p) => /name must be a string/.test(p)));
  assert.ok(problems.some((p) => /cities must be an array of strings/.test(p)));
});

test("an empty registry is valid", () => {
  assert.deepEqual(validateRegistry(loadRegistry("")), []);
});

test("a station declared in both files is rejected", () => {
  const registry = loadRegistry(`
chs-dodd-narrows:
  name: Dodd Narrows
  position: [49.1344, -123.8171]
  provider: chs
`);
  const corrections = loadCorrections("chs-dodd-narrows:\n  name: Dodd\n");
  const problems = validateRegistry(registry, { corrections });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /both the registry and corrections/);
});

test("a slug colliding across files is rejected", () => {
  const registry = loadRegistry(`
chs-dodd-narrows:
  name: Dodd Narrows
  slug: nanaimo
  position: [49.1344, -123.8171]
  provider: chs
`);
  const corrections = loadCorrections("noaa/1:\n  name: Nanaimo\n  slug: nanaimo\n");
  const problems = validateRegistry(registry, { corrections });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /collides with chs-dodd-narrows/);
});

test("corrections with no overlap produce no cross-file problems", () => {
  const registry = loadRegistry(VALID);
  const corrections = loadCorrections("noaa/1:\n  name: Everett\n  slug: everett\n");
  assert.deepEqual(validateRegistry(registry, { corrections }), []);
});

test("two registry entries with derived (unset) slugs that collide are rejected", () => {
  const problems = validateRegistry(loadRegistry(`
chs-a:
  name: Friday Harbor
  position: [48.5, -123]
  provider: chs
chs-b:
  name: Friday Harbor
  position: [48.5, -123]
  provider: chs
`));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /duplicate slug "friday-harbor"/);
});

test("a registry entry's derived slug colliding with a corrections entry's explicit slug is rejected", () => {
  const registry = loadRegistry(`
chs-dodd-narrows:
  name: Nanaimo
  position: [49.1344, -123.8171]
  provider: chs
`);
  const corrections = loadCorrections("noaa/1:\n  name: Somewhere Else\n  slug: nanaimo\n");
  const problems = validateRegistry(registry, { corrections });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /collides with chs-dodd-narrows/);
});

test("accepts valid formerSlugs on a registry entry", () => {
  const problems = validateRegistry(loadRegistry(`
chs-dodd-narrows:
  name: Dodd Narrows
  position: [49.1344, -123.8171]
  provider: chs
  formerSlugs: [old-dodd]
`));
  assert.deepEqual(problems, []);
});

test("rejects a malformed formerSlugs entry on a registry entry", () => {
  const problems = validateRegistry(loadRegistry(`
chs-x:
  name: X
  position: [49, -123]
  provider: chs
  formerSlugs: [Not A Slug]
`));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /formerSlugs entry "Not A Slug" must be lowercase/);
});

test("rejects a registry slug colliding with another registry entry's formerSlugs", () => {
  const problems = validateRegistry(loadRegistry(`
chs-a:
  name: A
  position: [49, -123]
  provider: chs
  formerSlugs: [old-b]
chs-b:
  name: B
  slug: old-b
  position: [49, -123]
  provider: chs
`));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /chs-b: slug "old-b" collides with a former slug of chs-a/);
});

test("rejects a registry slug colliding with a corrections entry's formerSlugs", () => {
  const registry = loadRegistry(`
chs-dodd-narrows:
  name: Nanaimo
  position: [49.1344, -123.8171]
  provider: chs
`);
  const corrections = loadCorrections("noaa/1:\n  formerSlugs: [nanaimo]\n");
  const problems = validateRegistry(registry, { corrections });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /chs-dodd-narrows: slug "nanaimo" collides with a former slug of noaa\/1/);
});

test("rejects a corrections slug colliding with a registry entry's formerSlugs", () => {
  const registry = loadRegistry(`
chs-dodd-narrows:
  name: Dodd Narrows
  position: [49.1344, -123.8171]
  provider: chs
  formerSlugs: [nanaimo]
`);
  const corrections = loadCorrections("noaa/1:\n  name: Nanaimo\n  slug: nanaimo\n");
  const problems = validateRegistry(registry, { corrections });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /noaa\/1: slug "nanaimo" collides with a former slug of chs-dodd-narrows/);
});

test("a registry entry with no slug and no name does not throw or register a bogus slug", () => {
  const registry = loadRegistry(`
chs-a:
  position: [49, -123]
  provider: chs
chs-b:
  name: undefined
  position: [49, -123]
  provider: chs
`);
  const problems = validateRegistry(registry);
  assert.ok(problems.some((p) => /chs-a: name is required/.test(p)));
  assert.ok(!problems.some((p) => /duplicate slug/.test(p)));
});

test("accepts a current gate with a tideReference to an existing tide port", () => {
  const problems = validateRegistry(
    loadRegistry(
      "chs-port:\n  name: Port\n  context: Somewhere\n  position: [49.0, -123.0]\n  provider: chs\n  kind: tide\n" +
        "chs-gate:\n  name: Gate\n  context: Elsewhere\n  position: [49.1, -123.1]\n  provider: chs\n  kind: current\n  tideReference: chs-port\n",
    ),
  );
  assert.deepEqual(problems, []);
});

test("rejects a tideReference that is unknown, not a tide port, on a tide port, or on a derived gate", () => {
  const base =
    "chs-port:\n  name: Port\n  context: Somewhere\n  position: [49.0, -123.0]\n  provider: chs\n  kind: tide\n" +
    "chs-other-gate:\n  name: Other Gate\n  context: Elsewhere\n  position: [49.2, -123.2]\n  provider: chs\n  kind: current\n";
  // unknown key
  let p = validateRegistry(loadRegistry(base + "chs-gate:\n  name: Gate\n  context: Away\n  position: [49.1, -123.1]\n  provider: chs\n  kind: current\n  tideReference: chs-nope\n"));
  assert.ok(p.some((m) => /tideReference "chs-nope" is not a station/.test(m)));
  // points at a current gate
  p = validateRegistry(loadRegistry(base + "chs-gate:\n  name: Gate\n  context: Away\n  position: [49.1, -123.1]\n  provider: chs\n  kind: current\n  tideReference: chs-other-gate\n"));
  assert.ok(p.some((m) => /tideReference "chs-other-gate" must be a tide port/.test(m)));
  // on a tide port
  p = validateRegistry(loadRegistry(base + "chs-port2:\n  name: Port Two\n  context: Away\n  position: [49.3, -123.3]\n  provider: chs\n  kind: tide\n  tideReference: chs-port\n"));
  assert.ok(p.some((m) => /a tide port cannot carry a tideReference/.test(m)));
  // on a derived gate (derived.reference already pairs it)
  p = validateRegistry(loadRegistry(base + "chs-gate:\n  name: Gate\n  context: Away\n  position: [49.1, -123.1]\n  provider: chs\n  kind: current\n  tideReference: chs-port\n  derived:\n    reference: chs-port\n    hwLagMinutes: 25\n    lwLagMinutes: 35\n"));
  assert.ok(p.some((m) => /derived gate already pairs via derived.reference/.test(m)));
  // not a string
  p = validateRegistry(loadRegistry(base + "chs-gate:\n  name: Gate\n  context: Away\n  position: [49.1, -123.1]\n  provider: chs\n  kind: current\n  tideReference: 7\n"));
  assert.ok(p.some((m) => /tideReference must be a station key string/.test(m)));
});


// currentGates — the shared answer to "which registry entries are gates I can
// fetch live current data for". Every consumer used to re-derive this, and two
// of them shipped the same bug: signalk-currents swept the tide ports in and
// threw "no live id" ten times a poll cycle on the boat Pi (2026-08-10), and
// chs-constituents kept the derived Malibu gate in its overlay, so every build
// logged a drift warning for a station that by definition has no live series.
const MIXED = `
chs-dodd-narrows:
  name: Dodd Narrows
  context: Nanaimo
  position: [49.1344, -123.8171]
  provider: chs
chs-victoria:
  name: Victoria
  context: Inner Harbour
  position: [48.424, -123.371]
  provider: chs
  kind: tide
chs-malibu-rapids:
  name: Malibu Rapids
  context: Jervis Inlet
  position: [50.16, -123.85]
  provider: chs
  kind: current
  derived: { reference: chs-victoria, hwLagMinutes: 25, lwLagMinutes: 35 }
noaa-boundary-pass:
  name: Boundary Pass
  context: Gulf Islands
  position: [48.6912, -123.245]
  provider: noaa
`;

test("currentGates keeps the plain gates, dropping tide ports and derived gates", () => {
  const gates = currentGates({ registry: loadRegistry(MIXED) });
  assert.deepEqual([...gates.keys()], ["chs-dodd-narrows", "noaa-boundary-pass"]);
});

test("currentGates filters by provider when asked, and spans providers when not", () => {
  const registry = loadRegistry(MIXED);
  assert.deepEqual([...currentGates({ registry, provider: "chs" }).keys()], ["chs-dodd-narrows"]);
  assert.deepEqual([...currentGates({ registry, provider: "noaa" }).keys()], ["noaa-boundary-pass"]);
});

test("currentGates includes derived gates on request — they are gates, just not fetchable", () => {
  const gates = currentGates({ registry: loadRegistry(MIXED), provider: "chs", includeDerived: true });
  assert.deepEqual([...gates.keys()], ["chs-dodd-narrows", "chs-malibu-rapids"]);
});

test("currentGates treats an absent kind as current — the registry was currents first", () => {
  const gates = currentGates({ registry: loadRegistry(MIXED), provider: "chs" });
  assert.equal(gates.get("chs-dodd-narrows").name, "Dodd Narrows");
});

// An allowlist, not `kind !== "tide"`. The bug this export exists to stop WAS
// the registry growing a kind a consumer had never seen; a denylist re-acquires
// it the next time that happens. validateRegistry rejects an unknown kind, so
// this is defence behind a closed door — but it is the door that already failed.
test("currentGates drops a kind it has never seen rather than assuming it is a gate", () => {
  const registry = loadRegistry(`
chs-somewhere:
  name: Somewhere
  context: Elsewhere
  position: [49, -123]
  provider: chs
  kind: wave
`);
  assert.deepEqual([...currentGates({ registry }).keys()], []);
});

test("currentGates defaults to the registry this package ships", () => {
  const gates = currentGates({ provider: "chs" });
  assert.ok(gates.has("chs-dodd-narrows"), "the bundled registry should carry Dodd Narrows");
  assert.ok(!gates.has("chs-victoria"), "a bundled tide port must not read as a gate");
  assert.ok(!gates.has("chs-malibu-rapids"), "the bundled derived gate must not read as fetchable");
});
