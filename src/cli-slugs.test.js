// src/cli-slugs.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
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
