#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { auditStations, classify, REPORT_THRESHOLD_M } from "../src/audit.js";
import { buildLock, readLock, diffLock } from "../src/lock.js";
import { buildSlugsLock, readSlugsLock, checkSlugs } from "../src/slugs-lock.js";
import { createBundledResolver } from "../src/index.js";
import { loadCorrections, validateCorrections, validateAgainstStations } from "../src/corrections.js";
import { validatePositions, coverageWarnings, coverageFailures } from "../src/validate-positions.js";
import { loadRegistry, validateRegistry } from "../src/registry.js";
import { isWithinCoverage } from "../src/coastline.js";
import { fileURLToPath } from "node:url";

const corrections = loadCorrections(
  readFileSync(fileURLToPath(new URL("../data/corrections.yaml", import.meta.url)), "utf8"),
);
const registry = loadRegistry(
  readFileSync(fileURLToPath(new URL("../data/registry.yaml", import.meta.url)), "utf8"),
);

const coastlinePath = fileURLToPath(new URL("../data/coastline.geojson", import.meta.url));
const lockPath = fileURLToPath(new URL("../data/audit.lock.json", import.meta.url));
const slugsLockPath = fileURLToPath(new URL("../data/slugs.lock.json", import.meta.url));

/** SHA-256 of the coastline file, so a lock records which coastline it was built against. */
function coastlineFingerprint() {
  return `sha256-${createHash("sha256").update(readFileSync(coastlinePath)).digest("hex")}`;
}

/** Read, parse and shape-check a stations file, or print a clear message and exit 1. Shared by every command that takes a stations.json argument. */
function readStationsFile(command, stationsPath) {
  if (!stationsPath) {
    console.error(`usage: station-metadata ${command} <stations.json>`);
    process.exit(1);
  }
  let raw;
  try {
    raw = readFileSync(stationsPath, "utf8");
  } catch (err) {
    console.error(`${command}: could not read ${stationsPath} (${err.code === "ENOENT" ? "no such file" : err.message})`);
    process.exit(1);
  }

  let stations;
  try {
    stations = JSON.parse(raw);
  } catch (err) {
    console.error(`${command}: ${stationsPath} is not valid JSON (${err.message})`);
    process.exit(1);
  }

  if (!Array.isArray(stations) || stations.some((s) => typeof s !== "object" || s === null || Array.isArray(s))) {
    console.error(`${command}: ${stationsPath} must contain a JSON array of station objects`);
    process.exit(1);
  }
  return stations;
}

const [command, stationsPath] = process.argv.slice(2);

if (command === "validate") {
  // The stations file is optional: without it the two checks that need only
  // the corrections file still run. With it, a correction can also be checked
  // against the position it is correcting - the one check the corrections
  // file alone cannot express, because it does not record where the provider
  // said the station was.
  const stations = stationsPath ? readStationsFile("validate", stationsPath) : null;
  const problems = [
    ...validateCorrections(corrections),
    ...validatePositions(corrections),
    ...validateRegistry(registry, { corrections }),
    ...validatePositions(registry),
    // A registry station outside the coastline is a failure, not a note: the
    // package owns its position, so one the audit can never reach is unbacked
    // (#9). The build clip derives from the registry extent, so this stays
    // green as long as the coastline is rebuilt when the registry grows.
    ...coverageFailures(registry),
    ...(stations ? validateAgainstStations(corrections, stations) : []),
  ];
  for (const problem of problems) console.error(problem);

  // A *correction* outside the clip is unconfirmable, not wrong - it points at
  // an external provider station whose true location the package does not own.
  // Printed so nobody reads a clean run as "all positions checked".
  for (const warning of coverageWarnings(corrections)) {
    console.error(`note: ${warning}`);
  }
  if (!stations) {
    console.error("note: no stations file given - skipping the distance-from-published check");
  }
  console.error(problems.length ? `\n${problems.length} problem(s)` : "corrections and registry files are valid");
  process.exit(problems.length ? 1 : 0);
}

if (command === "audit") {
  const stations = readStationsFile("audit", stationsPath);
  const rawResolve = createBundledResolver();
  // Memoized so the lockValid branch below - which resolves each station
  // once inside diffLock and again in its own follow-up loop - does the
  // actual resolve() work only once per station. Keyed by object identity,
  // safe because `stations` is a stable array reused across both passes.
  const resolvedCache = new Map();
  const resolve = (station) => {
    let resolved = resolvedCache.get(station);
    if (!resolved) {
      resolved = rawResolve(station);
      resolvedCache.set(station, resolved);
    }
    return resolved;
  };

  // Reuse a pinned verdict for a station whose resolved position and the
  // audit inputs (coastline, threshold) all still match the lock. Any
  // mismatch on coastline or threshold invalidates every entry at once -
  // both alter every verdict, so nothing in a stale lock can be trusted.
  let lock = null;
  try {
    lock = readLock(readFileSync(lockPath, "utf8"));
  } catch {
    // ponytail: no lock yet (or unreadable) - fall back to a full audit below.
  }
  const lockValid = lock && lock.coastline === coastlineFingerprint() && lock.thresholdM === REPORT_THRESHOLD_M;

  // Partition out-of-coverage stations first, before the cached/checked
  // split below. auditStations calls inlandMetres directly, which returns 0
  // outside the clipped coastline - so a station out there was never really
  // evaluated for ashore-ness. It must land in exactly one summary bucket
  // (not checked), never also in cached or checked - and the "X of Y ashore"
  // line's denominator must only ever be stations that were actually
  // evaluated, or "Y - X" silently re-absorbs an unverifiable station as
  // "clear". That is the same gap classify() closed (see src/audit.js) for
  // per-station verdicts; this is the CLI's own summary making the same
  // mistake at the aggregate level.
  const inCoverage = [];
  let outsideCoverage = 0;
  for (const station of stations) {
    const resolved = resolve(station);
    if (isWithinCoverage(resolved.latitude, resolved.longitude)) {
      inCoverage.push(station);
    } else {
      outsideCoverage++;
    }
  }

  let findings;
  let cached = 0;
  let checked;
  if (lockValid) {
    const unchanged = new Set(diffLock(lock, inCoverage, { resolve }).unchanged);
    const toCheck = [];
    for (const station of inCoverage) {
      const resolved = resolve(station);
      if (unchanged.has(resolved.id) && lock.stations[resolved.id].verdict !== "ashore") {
        cached++;
      } else {
        // Cached-but-ashore still gets a full re-check: the lock only pins
        // metresInland, not the nearest-water suggestion this prints.
        toCheck.push(station);
      }
    }
    findings = auditStations(toCheck, { resolve });
    checked = toCheck.length;
  } else {
    findings = auditStations(inCoverage, { resolve });
    checked = inCoverage.length;
  }

  for (const finding of findings) {
    console.log(`${finding.id.padEnd(16)} ${finding.name.padEnd(24)} ${finding.metresInland} m inland`);
    console.log(
      finding.suggestion
        ? `  nearest water: ${finding.suggestion.latitude}, ${finding.suggestion.longitude}`
        : "  nearest water: none found within range - needs a human look",
    );
  }

  // cached + checked + outsideCoverage is a clean partition of stations.length
  // - every station lands in exactly one bucket - and the ashore line below
  // is only ever a fraction of cached + checked, never of the full input.
  console.log(`\n${cached} cached, ${checked} checked`);
  console.log(`${findings.length} of ${cached + checked} ashore`);
  console.log(`${outsideCoverage} station(s) outside coastline coverage - not checked`);
  process.exit(0);
}

if (command === "lock") {
  const stations = readStationsFile("lock", stationsPath);
  const resolve = createBundledResolver();
  const lock = buildLock(stations, { resolve, classify, coastlineFingerprint: coastlineFingerprint(), thresholdM: REPORT_THRESHOLD_M });
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  console.log(`wrote ${lockPath} - ${stations.length} station(s)`);
  process.exit(0);
}

if (command === "check") {
  const stations = readStationsFile("check", stationsPath);
  const resolve = createBundledResolver();

  let lock;
  try {
    lock = readLock(readFileSync(lockPath, "utf8"));
  } catch (err) {
    console.error(`check: could not read ${lockPath} (${err.code === "ENOENT" ? "no such file - run \`station-metadata lock\` first" : err.message})`);
    process.exit(1);
  }

  if (lock.coastline !== coastlineFingerprint() || lock.thresholdM !== REPORT_THRESHOLD_M) {
    console.error("check: coastline data or threshold has changed since the lock was written - every verdict is stale, re-run `station-metadata lock`");
    process.exit(1);
  }

  const diff = diffLock(lock, stations, { resolve });
  for (const m of diff.moved) console.error(`MOVED    ${m.id}: ${m.was} -> ${m.now}`);
  for (const id of diff.added) console.error(`ADDED    ${id}`);
  for (const id of diff.removed) console.error(`REMOVED  ${id}`);

  const problems = diff.moved.length + diff.added.length + diff.removed.length;
  if (problems) {
    console.error(`\n${problems} problem(s) - regenerate with \`station-metadata lock\` once reviewed`);
    process.exit(1);
  }
  console.log(`check: ${diff.unchanged.length} station(s) match the lock`);
  process.exit(0);
}

if (command === "slugs") {
  const lock = buildSlugsLock(corrections, registry);
  writeFileSync(slugsLockPath, JSON.stringify(lock, null, 2) + "\n");
  console.log(`wrote ${slugsLockPath} - ${Object.keys(lock.slugs).length} station(s)`);
  process.exit(0);
}

if (command === "check-slugs") {
  let lock;
  try {
    lock = readSlugsLock(readFileSync(slugsLockPath, "utf8"));
  } catch (err) {
    console.error(`check-slugs: could not read ${slugsLockPath} (${err.code === "ENOENT" ? "no such file - run \`station-metadata slugs\` first" : err.message})`);
    process.exit(1);
  }

  const problems = checkSlugs(lock, corrections, registry);
  for (const problem of problems) console.error(problem);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s) - regenerate with \`station-metadata slugs\` once the change is reviewed and recorded in formerSlugs`);
    process.exit(1);
  }
  console.log(`check-slugs: ${Object.keys(lock.slugs).length} station(s) match the lock`);
  process.exit(0);
}

console.error("usage: station-metadata <validate|audit|lock|check|slugs|check-slugs> [stations.json]");
console.error("  validate [stations.json]  stations file is optional; supplying it also checks");
console.error("                            each correction's distance from the published position");
process.exit(1);
