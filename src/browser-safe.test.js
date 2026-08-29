import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * The package root must reach no Node builtin.
 *
 * This is the regression test for a real outage: `createBundledResolver` used
 * `node:fs` and `node:url`, a bundler externalized them to stubs, and the
 * first call threw `fileURLToPath is not a function` — blanking
 * slackwater.sailingnaturali.com with nothing in the console pointing here.
 *
 * The existing public-surface test proves the exports *exist*; this one
 * proves the root can actually *run* somewhere without a filesystem. It walks
 * the static import graph rather than executing anything, because the failure
 * was a build-time externalization, not a runtime branch — the offending
 * import is visible in the source, and catching it there needs no browser.
 *
 * Anything that genuinely needs Node (the CLI, the audit chain, the build
 * scripts) lives outside this graph and is unaffected.
 */

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/** Import specifiers in a source file: static imports, re-exports, and dynamic import(). */
function importsOf(source) {
  const specifiers = [];
  const patterns = [
    /(?:^|\n)\s*import\s+(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s+[\s\S]*?\sfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Every module reachable from `entry` by static import, plus the specifiers each one pulls in. */
function walk(entry) {
  const seen = new Set();
  const found = [];
  const queue = [entry];

  while (queue.length) {
    const url = queue.pop();
    if (seen.has(url.href)) continue;
    seen.add(url.href);

    const source = readFileSync(fileURLToPath(url), "utf8");
    for (const specifier of importsOf(source)) {
      found.push({ from: url.pathname.split("/").pop(), specifier });
      // Only relative specifiers are ours to follow. Bare ones are npm
      // packages, which resolve through their own entry points and are the
      // consumer's bundler's problem, not this graph's.
      if (specifier.startsWith(".")) queue.push(new URL(specifier, url));
    }
  }
  return found;
}

test("nothing reachable from the package root imports a Node builtin", () => {
  const offenders = walk(new URL("./index.js", import.meta.url)).filter(({ specifier }) =>
    BUILTINS.has(specifier),
  );

  assert.deepEqual(
    offenders,
    [],
    `package root reaches Node builtin(s): ${offenders
      .map(({ from, specifier }) => `${from} imports "${specifier}"`)
      .join(", ")} — this breaks browser consumers`,
  );
});

test("the walker actually finds builtins, so a clean result means something", () => {
  // Guards the test above against silently passing because the regex stopped
  // matching. bin/station-metadata.mjs is legitimately Node-only, so it is
  // a stable positive control.
  const cliImports = walk(new URL("../bin/station-metadata.mjs", import.meta.url));
  const builtinsFound = cliImports.filter(({ specifier }) => BUILTINS.has(specifier));

  assert.ok(
    builtinsFound.length > 0,
    "expected the Node-only CLI to show builtin imports; the walker is broken",
  );
});
