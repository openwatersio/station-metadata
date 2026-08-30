import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateSlugs } from "./allocate.js";

const S = (id, name, region = "") => ({ id, name, region });

test("allocates the base slug from the name", () => {
  const out = allocateSlugs({
    stations: [S("noaa/1", "Friday Harbor", "WA")],
    existing: new Map(),
    taken: new Set(),
  });
  assert.equal(out.get("noaa/1"), "friday-harbor");
});

test("preserves an existing allocation even when the name changes", () => {
  // The #122 case: a downloaded correction must not move a published slug.
  const out = allocateSlugs({
    stations: [S("noaa/1", "Seattle, Elliott Bay", "WA")],
    existing: new Map([["noaa/1", "seattle"]]),
    taken: new Set(),
  });
  assert.equal(out.get("noaa/1"), "seattle");
});

test("on collision the lowest station id takes the base slug", () => {
  const out = allocateSlugs({
    stations: [S("noaa/9", "Aberdeen", "Scotland"), S("noaa/1", "Aberdeen", "WA")],
    existing: new Map(),
    taken: new Set(),
  });
  assert.equal(out.get("noaa/1"), "aberdeen");
  assert.equal(out.get("noaa/9"), "aberdeen-scotland");
});

test("allocation is order-independent within a batch", () => {
  const stations = [S("noaa/3", "Albany", "NY"), S("noaa/1", "Albany", "Western Australia"), S("noaa/2", "Albany", "NY")];
  const a = allocateSlugs({ stations, existing: new Map(), taken: new Set() });
  const b = allocateSlugs({ stations: [...stations].reverse(), existing: new Map(), taken: new Set() });
  assert.deepEqual([...a].sort(), [...b].sort());
});

test("a station with no region skips the region rung", () => {
  const out = allocateSlugs({
    stations: [S("noaa/1", "Pier", ""), S("noaa/2", "Pier", "")],
    existing: new Map(),
    taken: new Set(),
  });
  assert.equal(out.get("noaa/1"), "pier");
  assert.equal(out.get("noaa/2"), "pier-noaa-2");
});

test("the id rung passes the id through toSlug", () => {
  // A raw id contains ':' and '/', which fails the ^[a-z0-9-]+$ check at
  // registry.js:210. This is the rung where that would surface.
  const out = allocateSlugs({
    stations: [S("current:noaa/A", "Pier", ""), S("current:noaa/B", "Pier", "")],
    existing: new Map(),
    taken: new Set(),
  });
  for (const slug of out.values()) assert.match(slug, /^[a-z0-9-]+$/);
  assert.equal(out.get("current:noaa/B"), "pier-current-noaa-b");
});

test("a taken slug is never allocated", () => {
  const out = allocateSlugs({
    stations: [S("noaa/1", "Everett", "WA")],
    existing: new Map(),
    taken: new Set(["everett"]),
  });
  assert.notEqual(out.get("noaa/1"), "everett");
  assert.equal(out.get("noaa/1"), "everett-wa");
});

test("a station with an unusable name falls back to its id", () => {
  const out = allocateSlugs({
    stations: [S("noaa/1", "!!!", "")],
    existing: new Map(),
    taken: new Set(),
  });
  assert.equal(out.get("noaa/1"), "noaa-1");
});

test("throws rather than reuse when every rung is exhausted", () => {
  assert.throws(
    () =>
      allocateSlugs({
        stations: [S("noaa/1", "Pier", "WA")],
        existing: new Map(),
        taken: new Set(["pier", "pier-wa", "pier-noaa-1"]),
      }),
    /exhausted/,
  );
});
