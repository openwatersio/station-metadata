// src/cli-slugs.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/station-metadata.mjs", import.meta.url));

function run(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
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
