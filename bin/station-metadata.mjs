#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { auditStations, classify, REPORT_THRESHOLD_M } from "../src/audit.js";
import { buildLock, readLock, diffLock } from "../src/lock.js";
import { createBundledResolver } from "../src/index.js";
import { loadCorrections, validateCorrections, validateAgainstStations } from "../src/corrections.js";
import { validatePositions, coverageWarnings, coverageFailures } from "../src/validate-positions.js";
import { loadRegistry, validateRegistry } from "../src/registry.js";
import { isWithinCoverage } from "../src/coastline.js";
import { buildSlugTable, emptyTable, checkSlugTable } from "../src/slug-table.js";
import { DEPARTURE_LIMIT } from "../src/catalogue.js";
import { fileURLToPath } from "node:url";

const corrections = loadCorrections(
  readFileSync(fileURLToPath(new URL("../data/corrections.yaml", import.meta.url)), "utf8"),
);
const registry = loadRegistry(
  readFileSync(fileURLToPath(new URL("../data/registry.yaml", import.meta.url)), "utf8"),
);

const coastlinePath = fileURLToPath(new URL("../data/coastline.geojson", import.meta.url));
const lockPath = fileURLToPath(new URL("../data/audit.lock.json", import.meta.url));

/** SHA-256 of the coastline file, so a lock records which coastline it was built against. */
function coastlineFingerprint() {
  return `sha256-${createHash("sha256").update(readFileSync(coastlinePath)).digest("hex")}`;
}

/** `sha256-<hex>` of a catalogue file's exact bytes, so the table records what it was built from. */
function fingerprint(text) {
  return `sha256-${createHash("sha256").update(text).digest("hex")}`;
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

const slugsPath = fileURLToPath(new URL("../data/slugs.json", import.meta.url));
const tombstonesPath = fileURLToPath(new URL("../data/slug-tombstones.json", import.meta.url));

/** Read a JSON artifact, or a default when it does not exist yet. */
function readArtifact(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

/**
 * Slugs reserved by `formerSlugs` on the hand-curated records.
 *
 * These are live redirects. Reallocating one would make an existing link resolve
 * to a different station. Both files are already loaded at the top of this file.
 */
function reservedSlugs() {
  const reserved = { tide: new Set(), current: new Set() };
  for (const record of [...corrections.values(), ...registry.values()]) {
    if (!Array.isArray(record.formerSlugs)) continue;
    for (const former of record.formerSlugs) {
      // A record with no explicit kind (every corrections entry) could belong to
      // either namespace, so reserve in both: over-reserving costs an uglier slug,
      // under-reserving points a live redirect at a different station.
      if (record.kind === "tide" || record.kind === undefined) reserved.tide.add(former);
      if (record.kind !== "tide") reserved.current.add(former);
    }
  }
  return reserved;
}

/**
 * Read both catalogues, or exit.
 *
 * Both are mandatory. Under allocation semantics a station absent from the
 * input is indistinguishable from one that has departed, so a forgotten
 * argument reads as hundreds of departures and tombstones live stations
 * permanently. The mistake is not recoverable by re-running.
 */
function readCatalogues(command, argv) {
  const paths = { tide: [], current: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tides") paths.tide.push(argv[++i]);
    else if (argv[i] === "--currents") paths.current.push(argv[++i]);
  }

  const incomplete =
    paths.tide.length === 0 ||
    paths.current.length === 0 ||
    paths.tide.includes(undefined) ||
    paths.current.includes(undefined);
  if (incomplete) {
    console.error(`usage: station-metadata ${command} --tides <file> [--tides <file>] --currents <file> [--currents <file>]`);
    console.error("  every catalogue file for both kinds is required. An absent station is");
    console.error("  indistinguishable from a departed one, and a departure tombstones a");
    console.error("  slug permanently.");
    console.error("  The bundled catalogue is four files: NOAA tides and CHS stations are");
    console.error("  both tide; NOAA currents and CHS current gates are both current.");
    process.exit(1);
  }

  const catalogues = {};
  for (const kind of ["tide", "current"]) {
    const stations = [];
    const digests = [];
    for (const path of paths[kind]) {
      stations.push(...readStationsFile(command, path));
      digests.push(fingerprint(readFileSync(path, "utf8")));
    }
    // Ids are the join key for every consumer; a duplicate across two files of
    // one kind would let the second silently overwrite the first's allocation.
    const seen = new Set();
    for (const station of stations) {
      if (seen.has(station.id)) {
        console.error(`${command}: duplicate station id "${station.id}" across ${kind} catalogues`);
        process.exit(1);
      }
      seen.add(station.id);
    }

    // The registry owns a few stations no provider bundle contains at all -
    // CHS rapids nobody publishes a feed for, and a NOAA current station
    // carried here because currents-vault dropped its own identity in this
    // registry's favour (see registry.js). Allocation treats an absent id as
    // a departure and tombstones its slug permanently, so if only catalogue
    // files fed this table, a registry-only station's already-published slug
    // would be lost the first time this command ran. The registry fills that
    // gap, but never overrides: a station a catalogue file also names keeps
    // the catalogue's entry, because that one carries `region` and allocates
    // a better slug.
    for (const [id, record] of registry) {
      if (seen.has(id)) continue;
      if ((record.kind === "tide" ? "tide" : "current") !== kind) continue;
      stations.push({ id, name: record.name });
      seen.add(id);
    }

    // Sorted, so the digest records *which* catalogues were read rather than
    // the order they were typed on the command line. Unsorted, the same four
    // files in a different argv order produce a different string and diff for
    // no reason.
    catalogues[kind] = { stations, digest: [...digests].sort().join("+") };
  }
  return catalogues;
}

if (command === "slugs") {
  const catalogues = readCatalogues("slugs", process.argv.slice(3));
  const previous = readArtifact(slugsPath, emptyTable());
  const tombstones = readArtifact(tombstonesPath, { tide: {}, current: {} });
  const reserved = reservedSlugs();

  const { table, tombstones: nextTombstones, gone } = buildSlugTable({ previous, tombstones, reserved, catalogues });

  if (gone.length > DEPARTURE_LIMIT && !process.argv.includes("--accept-departures")) {
    console.error(`slugs: ${gone.length} stations departed, above the limit of ${DEPARTURE_LIMIT}`);
    console.error("  a truncated or partial catalogue looks exactly like this, and a");
    console.error("  tombstone is permanent - check the input before re-running with");
    console.error("  --accept-departures");
    console.error(`  first few: ${gone.slice(0, 5).join(", ")}`);
    process.exit(1);
  }

  // Every published slug is a URL segment, and the spec guarantees the shape.
  // The ladder passes the id rung through toSlug for exactly this reason, but
  // nothing checked the result before it became permanent - and permanent is
  // the point. Refuse at the write boundary rather than ship one.
  const malformed = [];
  for (const kind of ["tide", "current"]) {
    for (const [id, slug] of Object.entries(table[kind])) {
      if (!/^[a-z0-9-]+$/.test(slug)) malformed.push(`${kind}/${id}: "${slug}"`);
    }
  }
  if (malformed.length > 0) {
    console.error(`slugs: ${malformed.length} allocated slug(s) are not /^[a-z0-9-]+$/ - nothing written`);
    for (const problem of malformed.slice(0, 10)) console.error(`  ${problem}`);
    process.exit(1);
  }

  writeFileSync(slugsPath, JSON.stringify(table, null, 2) + "\n");
  writeFileSync(tombstonesPath, JSON.stringify(nextTombstones, null, 2) + "\n");
  const total = Object.keys(table.tide).length + Object.keys(table.current).length;
  console.log(`wrote ${slugsPath} - ${total} station(s), ${gone.length} tombstoned`);
  process.exit(0);
}

if (command === "check-slugs") {
  const catalogues = readCatalogues("check-slugs", process.argv.slice(3));
  const committed = readArtifact(slugsPath, emptyTable());
  const tombstones = readArtifact(tombstonesPath, { tide: {}, current: {} });

  // What this can catch: a station in the committed table that is absent from
  // the catalogue and not tombstoned - a departure nobody recorded, whose slug
  // is therefore free to be handed to a different station.
  //
  // What it cannot: a moved slug. `previous` here is the committed table and
  // buildSlugTable preserves every entry in it verbatim, so `now !== was` is
  // unreachable from this call site by construction. Detecting a move needs a
  // prior table this commit cannot edit, which is the release-tag comparison in
  // .github/workflows/ci.yml. Two checks, two different prior records.
  const { table } = buildSlugTable({ previous: committed, tombstones, reserved: reservedSlugs(), catalogues });
  const problems = checkSlugTable(committed, table, tombstones);

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`\n${problems.length} problem(s) - a published slug may not be dropped without a tombstone`);
    process.exit(1);
  }
  const total = Object.keys(committed.tide).length + Object.keys(committed.current).length;
  console.log(`check-slugs: ${total} station(s) match the committed table`);
  process.exit(0);
}

console.error("usage: station-metadata <validate|audit|lock|check|slugs|check-slugs> [args]");
console.error("  slugs --tides <f> --currents <f>        allocate slugs for new stations");
console.error("  check-slugs --tides <f> --currents <f>  fail if a published slug went missing");
console.error("  both flags repeat: the bundled catalogue is four files across two kinds");
process.exit(1);
