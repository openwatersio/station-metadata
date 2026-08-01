import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName } from "./clean.js";

test("calms names that shout", () => {
  assert.equal(cleanName("CHERRY POINT"), "Cherry Point");
  assert.equal(cleanName("PORT TOWNSEND"), "Port Townsend");
  assert.equal(cleanName("SPEE-BI-DAH"), "Spee-Bi-Dah");
});

test("leaves human-cased names untouched", () => {
  // These carry capitalisation we could not reconstruct if we flattened them.
  for (const name of ["Spee-Bi-Dah", "La Push", "Friday Harbor", "McArthur Bank", "O'Brien Point"]) {
    assert.equal(cleanName(name), name);
  }
});

test("apostrophes do not start a new capital", () => {
  assert.equal(cleanName("O'BRIEN POINT"), "O'Brien Point");
  assert.equal(cleanName("O’BRIEN POINT"), "O’Brien Point");
});

test("keeps acronyms that are not shouting", () => {
  assert.equal(cleanName("NAS Whidbey Island"), "Naval Air Station Whidbey Island");
});

// NOAA distinguishes a station from its landmark with a bearing, and writes that
// bearing in caps. Title-casing it produced "7.6 mi. Sse" on a station card.
test("every compass point survives title-casing", () => {
  const points = ["NNE", "NE", "ENE", "ESE", "SE", "SSE", "SSW", "SW", "WSW", "WNW", "NW", "NNW"];
  for (const point of points) {
    // In a qualifier, where they actually appear.
    assert.equal(cleanName(`Smith Island, 3.4 nm ${point} of`), `Smith Island, 3.4 nm ${point} of`);
    // And inside a name that shouts, where the rest is re-cased around them.
    assert.equal(cleanName(`SMITH ISLAND, 3.4 NM ${point} OF`), `Smith Island, 3.4 nm ${point} of`);
  }
});

test("the single-letter compass points are never re-cased in the first place", () => {
  assert.equal(cleanName("Ediz Hook Light, 1.2 nm N of"), "Ediz Hook Light, 1.2 nm N of");
  assert.equal(cleanName("Alki Point, 1 nm W of"), "Alki Point, 1 nm W of");
  assert.equal(cleanName("Sandy Point, 2.1 nm N.E. of"), "Sandy Point, 2.1 nm N.E. of");
});

test("keeps the abbreviations NOAA writes in caps", () => {
  assert.equal(cleanName("Bangor, Hood Canal LB B"), "Bangor, Hood Canal LB B");
  assert.equal(cleanName("Chesapeake Bay Bridge, 0.5 nm S of (LB91)"), "Chesapeake Bay Bridge, 0.5 nm S of (LB91)");
  assert.equal(cleanName("Shinn Point, ICWW"), "Shinn Point, ICWW");
  assert.equal(cleanName("Ashepoo Coosaw Cutoff, ICW marker 169"), "Ashepoo Coosaw Cutoff, ICW marker 169");
  assert.equal(cleanName("Seaboard Coast Line RR, Pinner Point"), "Seaboard Coast Line RR, Pinner Point");
});

test("states distance in nautical miles, whatever unit the provider used", () => {
  // 1 statute mile = 1.609344 km; 1 nautical mile = 1.852 km.
  assert.equal(cleanName("Discovery Island, 7.6 mi. SSE of"), "Discovery Island, 6.6 nm SSE of");
  assert.equal(cleanName("Browns Point, 1.6 miles North of"), "Browns Point, 1.4 nm North of");
  assert.equal(cleanName("Alki Point, 1 mile West of"), "Alki Point, 0.9 nm West of");
  assert.equal(cleanName("Chernof Point, 0.8mile off"), "Chernof Point, 0.7 nm off");
  // One decimal on a converted value, so it agrees with the nautical
  // qualifiers NOAA writes that way already ("3.0 nm NE of").
  assert.equal(cleanName("Ediz Hook Light, 1.2 miles N of"), "Ediz Hook Light, 1.0 nm N of");
  assert.equal(cleanName("Naselle River, 8 miles above swing bridge"), "Naselle River, 7.0 nm above swing bridge");
});

test("spells every nautical unit the one way, without touching the number", () => {
  assert.equal(cleanName("Cattle Point, 1.2 nm SE of"), "Cattle Point, 1.2 nm SE of");
  assert.equal(cleanName("Deer Island Light, 1.0 n.mi. WSW of"), "Deer Island Light, 1.0 nm WSW of");
  assert.equal(cleanName("Compass Island, 0.4 nmi. ENE of"), "Compass Island, 0.4 nm ENE of");
  assert.equal(cleanName("Scrag Island, 0.3 nautical mile SW of"), "Scrag Island, 0.3 nm SW of");
  assert.equal(cleanName("Plum Island, 3nm. North of"), "Plum Island, 3 nm North of");
});

test("converting distance is idempotent, and leaves prose alone", () => {
  const converted = cleanName("Discovery Island, 7.6 mi. SSE of");
  assert.equal(cleanName(converted), converted);
  // No number, no distance: a place is not a measurement.
  assert.equal(cleanName("Six Mile Reef, 2 nm south of"), "Six Mile Reef, 2 nm south of");
  assert.equal(cleanName("Miles Point"), "Miles Point");
});

test("expands the abbreviations that read badly", () => {
  assert.equal(cleanName("Swinomish Channel ent."), "Swinomish Channel Entrance");
  assert.equal(cleanName("Deception Pass St. Park"), "Deception Pass State Park");
  assert.equal(cleanName("Hanbury Point, San Juan I."), "Hanbury Point, San Juan Island");
});

test("collapses whitespace", () => {
  assert.equal(cleanName("  Port   Angeles "), "Port Angeles");
});
