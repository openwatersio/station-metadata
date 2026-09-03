// src/cli-slugs.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/station-metadata.mjs", import.meta.url));
const slugsPath = fileURLToPath(new URL("../data/slugs.json", import.meta.url));
const tombstonesPath = fileURLToPath(new URL("../data/slug-tombstones.json", import.meta.url));

function run(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function snapshot(path) {
  return existsSync(path) ? readFileSync(path) : undefined;
}

function restore(path, before) {
  if (before === undefined) {
    if (existsSync(path)) unlinkSync(path);
  } else {
    writeFileSync(path, before);
  }
}

test("slugs refuses to run with no catalogue", () => {
  const { code, out } = run(["slugs"]);
  assert.equal(code, 1);
  assert.match(out, /--tides/);
});

test("slugs refuses to run with only one kind", () => {
  const { code, out } = run(["slugs", "--tides", "some-tides.json"]);
  assert.equal(code, 1);
  assert.match(out, /--currents/);
});

test("slugs refuses to write a slug that is not a URL segment", () => {
  // allocateSlugs preserves every existing entry verbatim, so a hand-edited
  // table is the one way a slug that is not /^[a-z0-9-]+$/ reaches the file -
  // and what lands in the file is permanent. The ladder's own output is safe by
  // construction; this is the guard on the way in.
  const dir = mkdtempSync(join(tmpdir(), "slug-shape-"));
  const tides = join(dir, "tides.json");
  const currents = join(dir, "currents.json");
  writeFileSync(tides, JSON.stringify([{ id: "noaa/1", name: "Bad Slug!" }]));
  writeFileSync(currents, JSON.stringify([]));

  const slugsBefore = snapshot(slugsPath);
  const tombstonesBefore = snapshot(tombstonesPath);
  const handEdited = JSON.stringify({ catalogue: {}, tide: { "noaa/1": "Bad Slug!" }, current: {} });
  try {
    writeFileSync(slugsPath, handEdited);
    writeFileSync(tombstonesPath, JSON.stringify({ tide: {}, current: {} }));
    const { code, out } = run(["slugs", "--tides", tides, "--currents", currents]);
    assert.equal(code, 1, out);
    assert.match(out, /\[a-z0-9-\]/);
    assert.match(out, /noaa\/1/);
    // Nothing written: the file is still exactly what the run started from.
    assert.equal(readFileSync(slugsPath, "utf8"), handEdited);
  } finally {
    restore(slugsPath, slugsBefore);
    restore(tombstonesPath, tombstonesBefore);
    unlinkSync(tides);
    unlinkSync(currents);
  }
});

test("the nearby sweep sees a registry-only station, which has a position only the registry knows", () => {
  // readCatalogues merges registry-only stations in so their published slugs
  // are not tombstoned. It used to merge them as `{ id, name }` alone, and a
  // station with no position is skipped by findNearbyPairs - so the one pair
  // the sweep exists to catch, a curated identity duplicating a provider row,
  // was invisible for exactly the stations most likely to be one: the curated
  // half is registry-only by definition. noaa-boundary-pass and noaa/PUG1717
  // are 1.5 m apart and #24 printed them; today's sweep found nothing.
  const dir = mkdtempSync(join(tmpdir(), "slug-sweep-"));
  const tides = join(dir, "tides.json");
  const currents = join(dir, "currents.json");
  writeFileSync(tides, JSON.stringify([]));
  // The registry's own position for noaa-boundary-pass, to the metre.
  writeFileSync(currents, JSON.stringify([
    { id: "noaa/PUG1717", name: "Turn Point", latitude: 48.69121170043945, longitude: -123.24501037597656 },
  ]));

  const slugsBefore = snapshot(slugsPath);
  const tombstonesBefore = snapshot(tombstonesPath);
  try {
    const { code, out } = run(["slugs", "--tides", tides, "--currents", currents, "--accept-departures"]);
    assert.equal(code, 0, out);
    assert.match(out, /noaa-boundary-pass/);
    assert.match(out, /noaa\/PUG1717/);
  } finally {
    restore(slugsPath, slugsBefore);
    restore(tombstonesPath, tombstonesBefore);
    unlinkSync(tides);
    unlinkSync(currents);
  }
});

// The registry owns three stations that appear in none of the four bundled
// catalogue files (chs-arran-rapids, noaa-boundary-pass, chs-malibu-rapids -
// all `current`). This runs the real CLI against the real catalogue files, not
// the merge helper in isolation, because a test on the helper's shape would
// stay green even if readCatalogues never called it.
const resources = process.env.RESOURCES;
test(
  "slugs table includes registry-only stations no catalogue file contains",
  { skip: resources ? false : "RESOURCES env var not set - skipping catalogue-backed test" },
  () => {
    const args = [
      "slugs",
      "--tides",
      `${resources}/stations.json`,
      "--tides",
      `${resources}/chs-stations.json`,
      "--currents",
      `${resources}/currents.json`,
      "--currents",
      `${resources}/chs-current-gates.json`,
    ];
    const slugsBefore = snapshot(slugsPath);
    const tombstonesBefore = snapshot(tombstonesPath);
    try {
      const { code, out } = run(args);
      assert.equal(code, 0, out);
      const table = JSON.parse(readFileSync(slugsPath, "utf8"));
      for (const id of ["chs-arran-rapids", "noaa-boundary-pass", "chs-malibu-rapids"]) {
        assert.ok(id in table.current, `expected ${id} in current table, got: ${Object.keys(table.current).join(", ")}`);
        assert.ok(!(id in table.tide), `${id} should not be in the tide table`);
      }
    } finally {
      // This drives the real CLI, which writes to the package's real data
      // paths - the same ones the shipped table lives at once allocated. So
      // it must leave them exactly as it found them: restore whatever was
      // there before, and only delete a file that did not exist beforehand.
      // Deleting unconditionally was safe only while these paths were
      // untracked; they are committed data now.
      restore(slugsPath, slugsBefore);
      restore(tombstonesPath, tombstonesBefore);
    }
  },
);
