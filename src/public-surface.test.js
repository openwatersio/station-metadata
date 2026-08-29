import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as index from "./index.js";

const srcDir = fileURLToPath(new URL(".", import.meta.url));

test("the published package and CLI use the Open Waters station-metadata identity", () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  );

  assert.equal(manifest.name, "@openwaters/station-metadata");
  assert.deepEqual(manifest.bin, { "station-metadata": "bin/station-metadata.mjs" });
  assert.equal(manifest.repository.url, "git+https://github.com/openwatersio/station-metadata.git");
  assert.equal(manifest.bugs.url, "https://github.com/openwatersio/station-metadata/issues");
  assert.equal(manifest.homepage, "https://github.com/openwatersio/station-metadata#readme");
  assert.deepEqual(manifest.publishConfig, { access: "public" });
  assert.equal(
    existsSync(fileURLToPath(new URL("../bin/station-corrections.mjs", import.meta.url))),
    false,
  );
});

/**
 * Modules whose entire export surface is deliberately excluded from index.js.
 * Each one transitively imports coastline.js, which parses the 3.6 MB
 * coastline at *import time* - re-exporting any of these from index.js would
 * make importing the package root pay that cost. audit.js and coastline.js
 * are audit-only internals; validate-positions.js is opt-in only, reachable
 * by a consumer who explicitly wants it via the "./validate-positions"
 * subpath export instead of through the package root.
 */
const COASTLINE_DEPENDENT_MODULES = new Set(["audit.js", "coastline.js", "validate-positions.js"]);

/** Named exports that are internal implementation details, not public API, even though their module is otherwise public. */
const INTERNAL_EXPORTS = new Set([
  "namesOverlap", // names.js: helper shared by resolve.js and validateCorrections, not a consumer-facing utility
  "sharesMeaningfulWord", // names.js: helper used only by validateAgainstStations, not a consumer-facing utility
  "distanceKm", // distance.js: shared leaf so resolve.js and corrections.js need not import each other; not API anyone asked for
]);

test("every public-API module's named exports are re-exported from index.js", async () => {
  // This is the regression test for the bug class this guards against: a
  // module gains an export (like lock.js's buildLock/readLock/diffLock did)
  // and nobody wires it into index.js, so it ships unreachable from the
  // package root. Walking every src/*.js file's actual exports - rather than
  // hand-listing what "should" be there - means a forgotten export fails
  // this test instead of shipping silently.
  const files = readdirSync(srcDir).filter(
    (f) => f.endsWith(".js") && !f.endsWith(".test.js") && f !== "index.js",
  );
  assert.ok(files.length > 0, "sanity check: expected to find sibling modules to scan");

  for (const file of files) {
    if (COASTLINE_DEPENDENT_MODULES.has(file)) continue;
    const mod = await import(`./${file}`);
    for (const name of Object.keys(mod)) {
      if (INTERNAL_EXPORTS.has(name)) continue;
      assert.ok(name in index, `${file} exports "${name}" but index.js does not re-export it`);
    }
  }
});

test("every runtime export from index.js is declared in index.d.ts", () => {
  // The runtime half of shipping types. types/surface.ts proves the
  // declarations are *correct* under tsc; this proves they are *complete* -
  // tsc cannot notice a declaration that was never written, because nothing
  // references it. Together they close the drift issue #4 describes.
  const declarations = readFileSync(fileURLToPath(new URL("../index.d.ts", import.meta.url)), "utf8");

  for (const name of Object.keys(index)) {
    assert.match(
      declarations,
      new RegExp(`\\bexport\\s+(?:declare\\s+)?(?:function|const|class)\\s+${name}\\b`),
      `index.js exports "${name}" but index.d.ts does not declare it`,
    );
  }
});
