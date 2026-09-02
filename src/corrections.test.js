import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorrections, validateCorrections } from "./corrections.js";

const VALID = `
noaa/9447659:
  name: Everett
  context: Port Gardner
  slug: everett
  cities: [Everett, Marysville]
  aliases: [port gardner]
noaa/8:
  name: Anacortes
  context: Guemes Channel
  slug: anacortes
  position: [48.5163, -122.6142]
  reason: "published position is inland on Fidalgo Island"
`;

test("loads records keyed by station id", () => {
  const map = loadCorrections(VALID);
  assert.equal(map.get("noaa/9447659").context, "Port Gardner");
  assert.deepEqual(map.get("noaa/8").position, [48.5163, -122.6142]);
});

test("accepts a valid file", () => {
  assert.deepEqual(validateCorrections(loadCorrections(VALID)), []);
});

test("requires a reason whenever a position is corrected", () => {
  const map = loadCorrections(`
noaa/1:
  position: [48.5, -122.6]
`);
  const problems = validateCorrections(map);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /noaa\/1.*reason/);
});

test("rejects a context that restates the name", () => {
  // The failure mode a nearest-town derivation walks into.
  const map = loadCorrections(`
noaa/1:
  name: Everett
  context: Everett
`);
  assert.match(validateCorrections(map)[0], /context repeats the name/);
});

test("rejects a context that is one of the record's own cities", () => {
  const map = loadCorrections(`
noaa/1:
  name: Naval Air Station Whidbey Island
  context: Oak Harbor
  cities: [Oak Harbor]
`);
  assert.match(validateCorrections(map)[0], /context "Oak Harbor" is a town in cities/);
});

test("rejects a context that contains the name as a prefixed phrase", () => {
  const map = loadCorrections(`
noaa/1:
  name: Everett
  context: Everett Harbor
`);
  assert.match(validateCorrections(map)[0], /context repeats the name/);
});

test("rejects a context that contains the name deeper in the phrase", () => {
  const map = loadCorrections(`
noaa/1:
  name: Everett
  context: Port of Everett
`);
  assert.match(validateCorrections(map)[0], /context repeats the name/);
});

test("rejects a context that is the name plus a generic suffix", () => {
  const map = loadCorrections(`
noaa/1:
  name: Union
  context: Union Bay
`);
  assert.match(validateCorrections(map)[0], /context repeats the name/);
});

test("does not flag different places that merely share a word", () => {
  const map = loadCorrections(`
noaa/1:
  name: Port Townsend
  context: Port Angeles
`);
  assert.deepEqual(validateCorrections(map), []);
});

test("does not flag an unrelated context", () => {
  const map = loadCorrections(`
noaa/1:
  name: Friday Harbor
  context: San Juan Islands
`);
  assert.deepEqual(validateCorrections(map), []);
});

test("does not flag an unrelated hazard-style context", () => {
  const map = loadCorrections(`
noaa/1:
  name: Deception Pass
  context: Strong Currents
`);
  assert.deepEqual(validateCorrections(map), []);
});

test("does not flag the name appearing only as a substring of a longer word", () => {
  const map = loadCorrections(`
noaa/1:
  name: Union
  context: Reunion Island
`);
  assert.deepEqual(validateCorrections(map), []);
});

test("rejects duplicate slugs", () => {
  const map = loadCorrections(`
noaa/1:
  slug: everett
noaa/2:
  slug: everett
`);
  assert.match(validateCorrections(map)[0], /duplicate slug/);
});

test("accepts valid formerSlugs", () => {
  const map = loadCorrections(`
noaa/1:
  slug: everett
  formerSlugs: [old-everett, ancient-everett]
`);
  assert.deepEqual(validateCorrections(map), []);
});

test("rejects a malformed formerSlugs entry", () => {
  const map = loadCorrections(`
noaa/1:
  formerSlugs: [Not A Slug]
`);
  assert.equal(validateCorrections(map).length, 1);
  assert.match(validateCorrections(map)[0], /formerSlugs entry "Not A Slug" must be lowercase/);
});

test("rejects a slug colliding with another station's formerSlugs", () => {
  const map = loadCorrections(`
noaa/1:
  slug: anacortes
  formerSlugs: [old-anacortes]
noaa/2:
  slug: old-anacortes
`);
  const problems = validateCorrections(map);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /noaa\/2.*slug "old-anacortes".*collides with a former slug of noaa\/1/);
});

test("rejects an implausible position", () => {
  const map = loadCorrections(`
noaa/1:
  position: [148.5, -122.6]
  reason: typo
`);
  assert.match(validateCorrections(map)[0], /latitude/);
});

test("accepts a verified position with a stated reason", () => {
  const map = loadCorrections(`
noaa/9442396:
  positionVerified: "up the Quillayute River; the coastline maps ocean only"
`);
  assert.deepEqual(validateCorrections(map), []);
});

test("rejects a station that is both corrected and verified", () => {
  // A position cannot be both wrong and confirmed right.
  const map = loadCorrections(`
noaa/1:
  position: [48.5, -122.6]
  reason: inland
  positionVerified: "actually it is fine"
`);
  assert.match(validateCorrections(map)[0], /both/);
});

test("rejects an empty verification reason", () => {
  const map = loadCorrections(`
noaa/1:
  positionVerified: ""
`);
  assert.match(validateCorrections(map)[0], /positionVerified/);
});

test("reports a malformed position instead of throwing", () => {
  const map = loadCorrections(`
noaa/1:
  position: 5
  reason: typo
`);
  assert.doesNotThrow(() => validateCorrections(map));
  assert.match(validateCorrections(map)[0], /position/);
});

test("reports a position with the wrong number of elements instead of throwing", () => {
  const map = loadCorrections(`
noaa/1:
  position: [48.5]
  reason: typo
`);
  assert.match(validateCorrections(map)[0], /position/);
});

test("reports a position with non-numeric elements instead of throwing", () => {
  const map = loadCorrections(`
noaa/1:
  position: ["a", "b"]
  reason: typo
`);
  assert.match(validateCorrections(map)[0], /position/);
});

test("reports a non-string name instead of throwing", () => {
  const map = loadCorrections(`
noaa/1:
  name: 5
`);
  assert.doesNotThrow(() => validateCorrections(map));
  assert.match(validateCorrections(map)[0], /name/);
});

for (const field of ["context", "slug", "reason", "positionVerified"]) {
  test(`reports a non-string ${field} instead of throwing`, () => {
    const map = loadCorrections(`
noaa/1:
  ${field}: 5
`);
    assert.doesNotThrow(() => validateCorrections(map));
    assert.match(validateCorrections(map)[0], new RegExp(field));
  });
}

for (const field of ["aliases", "cities", "formerSlugs"]) {
  test(`reports a non-array ${field} instead of throwing`, () => {
    const map = loadCorrections(`
noaa/1:
  ${field}: 5
`);
    assert.doesNotThrow(() => validateCorrections(map));
    assert.match(validateCorrections(map)[0], new RegExp(field));
  });

  test(`reports a ${field} array with a non-string element instead of throwing`, () => {
    const map = loadCorrections(`
noaa/1:
  ${field}: [Everett, 5]
`);
    assert.doesNotThrow(() => validateCorrections(map));
    assert.match(validateCorrections(map)[0], new RegExp(field));
  });
}
