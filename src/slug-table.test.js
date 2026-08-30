// src/slug-table.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlugTable, emptyTable, readSlugTable, checkSlugTable } from "./slug-table.js";

const cat = (stations, digest = "sha256-x") => ({ stations, digest });
const S = (id, name, region = "") => ({ id, name, region });

test("builds a table partitioned by kind, with catalogue provenance", () => {
  const { table } = buildSlugTable({
    previous: emptyTable(),
    tombstones: { tide: {}, current: {} },
    reserved: { tide: new Set(), current: new Set() },
    catalogues: {
      tide: cat([S("noaa/1", "Friday Harbor", "WA")], "sha256-a"),
      current: cat([S("current:noaa/2", "Deception Pass", "WA")], "sha256-b"),
    },
  });
  assert.equal(table.tide["noaa/1"], "friday-harbor");
  assert.equal(table.current["current:noaa/2"], "deception-pass");
  assert.equal(table.catalogue.tide.digest, "sha256-a");
  assert.equal(table.catalogue.tide.stations, 1);
});

test("the same slug is allowed across kinds", () => {
  // Kind is a namespace: /tides/dodd-narrows and /currents/dodd-narrows are
  // different pages, so both may hold the name.
  const { table } = buildSlugTable({
    previous: emptyTable(),
    tombstones: { tide: {}, current: {} },
    reserved: { tide: new Set(), current: new Set() },
    catalogues: {
      tide: cat([S("noaa/1", "Dodd Narrows")]),
      current: cat([S("current:noaa/1", "Dodd Narrows")]),
    },
  });
  assert.equal(table.tide["noaa/1"], "dodd-narrows");
  assert.equal(table.current["current:noaa/1"], "dodd-narrows");
});

test("a departed station's slug is tombstoned, not freed", () => {
  const previous = { ...emptyTable(), tide: { "noaa/1": "everett" } };
  const { table, tombstones, gone } = buildSlugTable({
    previous,
    tombstones: { tide: {}, current: {} },
    reserved: { tide: new Set(), current: new Set() },
    catalogues: { tide: cat([]), current: cat([]) },
  });
  assert.deepEqual(gone, ["noaa/1"]);
  assert.equal("noaa/1" in table.tide, false);
  assert.equal(tombstones.tide["noaa/1"], "everett");
});

test("a tombstoned slug is never handed to a different station", () => {
  const { table } = buildSlugTable({
    previous: emptyTable(),
    tombstones: { tide: { "noaa/old": "everett" }, current: {} },
    reserved: { tide: new Set(), current: new Set() },
    catalogues: { tide: cat([S("noaa/new", "Everett", "WA")]), current: cat([]) },
  });
  assert.notEqual(table.tide["noaa/new"], "everett");
  assert.equal(table.tide["noaa/new"], "everett-wa");
});

test("a former slug is never handed to a different station", () => {
  // formerSlugs records a rename and the Worker serves a redirect from it. If a
  // new station could take that name, the redirect would start pointing at the
  // wrong water.
  const { table } = buildSlugTable({
    previous: emptyTable(),
    tombstones: { tide: {}, current: {} },
    reserved: { tide: new Set(["everett"]), current: new Set() },
    catalogues: { tide: cat([S("noaa/new", "Everett", "WA")]), current: cat([]) },
  });
  assert.equal(table.tide["noaa/new"], "everett-wa");
});

test("the table round-trips through JSON and carries no wall-clock field", () => {
  const { table } = buildSlugTable({
    previous: emptyTable(),
    tombstones: { tide: {}, current: {} },
    reserved: { tide: new Set(), current: new Set() },
    catalogues: { tide: cat([S("noaa/1", "Everett")]), current: cat([]) },
  });
  const json = JSON.stringify(table);
  assert.deepEqual(readSlugTable(json), table);
  assert.equal("generated" in table, false);
  // Two builds of one catalogue must be byte-identical, or a rebuild diff in CI
  // fails every day for no reason.
  const again = buildSlugTable({
    previous: emptyTable(),
    tombstones: { tide: {}, current: {} },
    reserved: { tide: new Set(), current: new Set() },
    catalogues: { tide: cat([S("noaa/1", "Everett")]), current: cat([]) },
  });
  assert.equal(JSON.stringify(again.table), json);
});

test("checkSlugTable reports a slug that moved", () => {
  const before = { ...emptyTable(), tide: { "noaa/1": "everett" } };
  const after = { ...emptyTable(), tide: { "noaa/1": "everett-wa" } };
  const problems = checkSlugTable(before, after, { tide: {}, current: {} });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /noaa\/1.*everett.*everett-wa/);
});

test("checkSlugTable is silent when a station is merely added", () => {
  const before = { ...emptyTable(), tide: { "noaa/1": "everett" } };
  const after = { ...emptyTable(), tide: { "noaa/1": "everett", "noaa/2": "la-push" } };
  assert.deepEqual(checkSlugTable(before, after, { tide: {}, current: {} }), []);
});

test("checkSlugTable reports a slug that vanished without being tombstoned", () => {
  const before = { ...emptyTable(), tide: { "noaa/1": "everett" } };
  const after = emptyTable();
  const problems = checkSlugTable(before, after, { tide: {}, current: {} });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /noaa\/1/);
});

test("checkSlugTable accepts a departure that was properly tombstoned", () => {
  // Without this, every accepted departure fails the release-tag check forever.
  const before = { ...emptyTable(), tide: { "noaa/1": "everett" } };
  const after = emptyTable();
  assert.deepEqual(checkSlugTable(before, after, { tide: { "noaa/1": "everett" }, current: {} }), []);
});

test("checkSlugTable rejects a tombstone that changed the slug", () => {
  const before = { ...emptyTable(), tide: { "noaa/1": "everett" } };
  const after = emptyTable();
  const problems = checkSlugTable(before, after, { tide: { "noaa/1": "everett-wa" }, current: {} });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /published as "everett"/);
});
