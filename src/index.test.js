import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

test("createBundledResolver resolves a known station regardless of cwd", async () => {
  const originalCwd = process.cwd();
  // A cwd-relative path (the bug this guards against) would fail here even
  // though it happens to work from the repo root.
  process.chdir(tmpdir());
  try {
    const { createBundledResolver } = await import("./index.js");
    const resolve = createBundledResolver();
    const r = resolve({ id: "noaa/9447659", name: "Everett", latitude: 47.98, longitude: -122.223 });
    assert.equal(r.name, "Everett");
    assert.equal(r.context, "Port Gardner");
  } finally {
    process.chdir(originalCwd);
  }
});

test("the bundled resolver resolves a registry station from its id", async () => {
  const { createBundledResolver } = await import("./index.js");
  const resolve = createBundledResolver();
  const r = resolve({ id: "chs-dodd-narrows" });
  assert.equal(r.name, "Dodd Narrows");
  assert.equal(r.context, "Northumberland Channel");
  assert.equal(r.latitude, 49.13546639419797);
  assert.equal(r.longitude, -123.81735084108287);
  assert.equal(r.corrected, false);

  const { loadRegistry } = await import("./index.js");
  const yaml = readFileSync(new URL("../data/registry.yaml", import.meta.url), "utf8");
  const dodd = loadRegistry(yaml).get("chs-dodd-narrows");
  assert.equal(dodd.source, "GSC West Coast Topo-Bathymetric DEM v2 hydraulic control section");
});

test("the bundled resolver still resolves an overlay station", async () => {
  const { createBundledResolver } = await import("./index.js");
  const resolve = createBundledResolver();
  const r = resolve({ id: "noaa/9447659", name: "Everett", latitude: 47.98, longitude: -122.223 });
  assert.equal(r.name, "Everett");
  assert.equal(r.context, "Port Gardner");
});

test("relative NOAA names include the waterway they reference", async () => {
  const { createBundledResolver } = await import("./index.js");
  const resolve = createBundledResolver();
  const cases = [
    ["noaa/8537535", "1 n.mi. above entrance, N.J.", "1 nm above entrance, Mad Horse Creek"],
    ["noaa/8537731", "0.8 n.mi. above entrance", "0.8 nm above entrance, Alloway Creek"],
    ["noaa/8537753", "2.5 n.mi. above entrance", "2.5 nm above entrance, Alloway Creek"],
    ["noaa/8677566", "8 miles above mouth", "7.0 nm above mouth, Little Satilla River"],
    ["noaa/8677833", "2.5 miles above mouth", "2.2 nm above mouth, Little Satilla River"],
    ["noaa/8722481", "3 miles above A1A highway bridge", "2.6 nm above A1A highway bridge, Loxahatchee River"],
    ["noaa/TEC3531", "Below Spring Bluff", "Below Spring Bluff, Little Satilla River"],
  ];

  for (const [id, name, expected] of cases) {
    assert.equal(resolve({ id, name, latitude: 0, longitude: 0 }).name, expected, id);
  }
});

test("index.js never references the coastline module", () => {
  // Importing the library must not pull in the 3.6 MB coastline (only
  // audit-related code needs it). A static check on the source is enough:
  // this file only ever imports resolve.js, corrections.js, clean.js and
  // slug.js, none of which touch coastline.js either.
  const source = readFileSync(fileURLToPath(new URL("./index.js", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /from\s+["'][^"']*coastline/);
});
