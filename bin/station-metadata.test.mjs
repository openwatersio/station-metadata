import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { coverageBounds } from "../src/coastline.js";

const bin = fileURLToPath(new URL("./station-metadata.mjs", import.meta.url));
const lockPath = fileURLToPath(new URL("../data/audit.lock.json", import.meta.url));

// spawnSync (not execFileSync) because it returns stdout/stderr on *every*
// exit code - execFileSync only surfaces stderr when the process throws
// (non-zero exit), so a passing command's stderr - e.g. "validate"'s
// coverage notes on a clean exit 0 - would otherwise come back empty.
function run(args) {
  const { status, stdout, stderr } = spawnSync("node", [bin, ...args], { encoding: "utf8" });
  return { status, stdout, stderr };
}

function runAudit(path) {
  return run(["audit", path]);
}

// station-metadata lock/check always write/read the package's own
// data/audit.lock.json (not a path derived from the stations file), so any
// test that runs `lock` or `check` mutates the repo's real lock. Snapshot it
// first and restore in a finally so these tests don't corrupt it and are
// safe to run in any order.
function withRealLockBackup(fn) {
  const backup = readFileSync(lockPath, "utf8");
  try {
    return fn();
  } finally {
    writeFileSync(lockPath, backup);
  }
}

function withFixtureStations(stations, fn) {
  const dir = mkdtempSync(join(tmpdir(), "station-metadata-test-"));
  const path = join(dir, "stations.json");
  writeFileSync(path, JSON.stringify(stations));
  try {
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Not in corrections.yaml, so createBundledResolver() resolves these purely
// from the raw coordinates + gazetteer fallback - no curated override needed.
// 48.9, -123.2 is mid Strait of Georgia (0 m inland - clear); 48.515, -122.62
// measures ~433 m inland against the bundled coastline (ashore, past
// REPORT_THRESHOLD_M) - see src/audit.test.js and src/coastline.test.js for
// the same golden points.
const WATER_STATION = { id: "test/water", name: "WATER STATION", latitude: 48.9, longitude: -123.2 };
const ASHORE_STATION = { id: "test/ashore", name: "ASHORE STATION", latitude: 48.515, longitude: -122.62 };
const FIXTURE_STATIONS = [WATER_STATION, ASHORE_STATION];

// Strip the "N cached, M checked" summary line before comparing cached vs
// uncached output - that line is expected to legitimately differ (it reports
// how the answer was produced, not what the answer is); everything else must
// match exactly.
function stripCacheSummary(stdout) {
  return stdout.replace(/\n\d+ cached, \d+ checked\n/, "\n");
}

test("audit prints a clear message and exits non-zero on a missing stations file", () => {
  const dir = mkdtempSync(join(tmpdir(), "station-metadata-test-"));
  const path = join(dir, "missing.json");
  const { status, stderr } = runAudit(path);
  rmSync(dir, { recursive: true, force: true });

  assert.notEqual(status, 0);
  assert.match(stderr, /missing\.json/);
  assert.doesNotMatch(stderr, /at Object|at Module|node:internal/);
});

test("audit prints a clear message and exits non-zero on malformed JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "station-metadata-test-"));
  const path = join(dir, "bad.json");
  writeFileSync(path, "{ this is not json");
  const { status, stderr } = runAudit(path);
  rmSync(dir, { recursive: true, force: true });

  assert.notEqual(status, 0);
  assert.match(stderr, /bad\.json/);
  assert.doesNotMatch(stderr, /at Object|at Module|node:internal/);
});

test("audit rejects a stations file that is a JSON object instead of an array", () => {
  const dir = mkdtempSync(join(tmpdir(), "station-metadata-test-"));
  const path = join(dir, "object.json");
  writeFileSync(path, JSON.stringify({ id: "noaa/1", name: "Not An Array" }));
  const { status, stderr } = runAudit(path);
  rmSync(dir, { recursive: true, force: true });

  assert.notEqual(status, 0);
  assert.match(stderr, /array/i);
});

test("audit resolves stations through the same bundled resolver library consumers get", () => {
  // A hand-rolled createResolver({ corrections }) omits the gazetteer, so it
  // resolves differently from createBundledResolver() - not visible in
  // today's audit output (which never reads context), but a real
  // inconsistency the CLI must not have.
  const source = readFileSync(bin, "utf8");
  assert.match(source, /createBundledResolver\(\)/);
});

test("audit rejects a stations file that is a JSON string instead of an array", () => {
  const dir = mkdtempSync(join(tmpdir(), "station-metadata-test-"));
  const path = join(dir, "string.json");
  writeFileSync(path, JSON.stringify("just a string"));
  const { status, stderr } = runAudit(path);
  rmSync(dir, { recursive: true, force: true });

  assert.notEqual(status, 0);
  assert.match(stderr, /array/i);
});

test("lock writes a lock listing every station", () => {
  withRealLockBackup(() => {
    withFixtureStations(FIXTURE_STATIONS, (path) => {
      const { status, stdout } = run(["lock", path]);
      assert.equal(status, 0);
      assert.match(stdout, /2 station/);

      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      assert.deepEqual(Object.keys(lock.stations).sort(), ["test/ashore", "test/water"]);
    });
  });
});

test("check exits 0 on a matching lock, and 1 naming a station that moved", () => {
  withRealLockBackup(() => {
    withFixtureStations(FIXTURE_STATIONS, (path) => {
      run(["lock", path]);

      const clean = run(["check", path]);
      assert.equal(clean.status, 0);

      // Move the water station onto land - a real upstream position change,
      // not just a threshold/coastline mismatch.
      writeFileSync(
        path,
        JSON.stringify([{ ...WATER_STATION, latitude: 48.515, longitude: -122.62 }, ASHORE_STATION]),
      );
      const dirty = run(["check", path]);
      assert.equal(dirty.status, 1);
      assert.match(dirty.stderr, /MOVED\s+test\/water/);
    });
  });
});

test("cached and uncached audit produce identical findings", () => {
  withRealLockBackup(() => {
    withFixtureStations(FIXTURE_STATIONS, (path) => {
      // No lock present yet - forces the full, uncached audit path.
      rmSync(lockPath, { force: true });
      const uncached = run(["audit", path]);
      assert.equal(uncached.status, 0);
      assert.match(uncached.stdout, /0 cached/);

      // Now with a valid lock in place, the water station is served from
      // cache while the ashore station still gets a full re-check (see the
      // "Cached-but-ashore" comment in the CLI) - this is the interesting
      // path: it must still produce the same findings.
      run(["lock", path]);
      const cached = run(["audit", path]);
      assert.equal(cached.status, 0);
      assert.match(cached.stdout, /1 cached/);

      assert.equal(stripCacheSummary(cached.stdout), stripCacheSummary(uncached.stdout));
    });
  });
});

test("a lock with a different threshold or coastline is not trusted", () => {
  withRealLockBackup(() => {
    withFixtureStations(FIXTURE_STATIONS, (path) => {
      run(["lock", path]);
      const validLock = JSON.parse(readFileSync(lockPath, "utf8"));

      writeFileSync(lockPath, JSON.stringify({ ...validLock, thresholdM: 999 }));
      const wrongThreshold = run(["check", path]);
      assert.equal(wrongThreshold.status, 1);
      assert.match(wrongThreshold.stderr, /threshold/i);

      writeFileSync(lockPath, JSON.stringify({ ...validLock, coastline: "sha256-deadbeef" }));
      const wrongCoastline = run(["check", path]);
      assert.equal(wrongCoastline.status, 1);
      assert.match(wrongCoastline.stderr, /coastline/i);
    });
  });
});

test("a station that moves from clear to ashore is re-audited, not trusted from the lock", () => {
  withRealLockBackup(() => {
    withFixtureStations([WATER_STATION], (path) => {
      run(["lock", path]);
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      assert.equal(lock.stations["test/water"].verdict, "clear");

      // Same id, moved from water onto land past the threshold.
      writeFileSync(path, JSON.stringify([{ ...WATER_STATION, latitude: 48.515, longitude: -122.62 }]));
      const audit = run(["audit", path]);
      assert.equal(audit.status, 0);
      assert.match(audit.stdout, /test\/water/);
      assert.match(audit.stdout, /m inland/);
      assert.match(audit.stdout, /1 of 1 ashore/);
    });
  });
});

test("validate passes with every registry station within the coastline clip", () => {
  const result = run(["validate"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /corrections and registry files are valid/);
  // The clip is derived from the registry extent (#9), so the northern CHS
  // gates that used to fall outside it are now covered - no coverage gap.
  assert.doesNotMatch(result.stderr, /outside coastline coverage/);
});

// A point beyond the coastline in every direction, whatever the current clip -
// derived from the bounds so it can't go stale as the clip grows north (#9).
// Audit cannot tell water from land out here, so it must say "not checked",
// not silently report a "clear" it never computed. (Weynton Passage, the old
// fixture, is now inside the registry-derived clip.)
const outside = coverageBounds();
const OUT_OF_COVERAGE_STATION = {
  id: "test/offshore",
  name: "OFFSHORE STATION",
  latitude: outside.maxLat + 1,
  longitude: outside.minLon - 1,
};

test("audit reports stations outside coastline coverage as not checked, not cleared", () => {
  withRealLockBackup(() => {
    withFixtureStations([WATER_STATION, OUT_OF_COVERAGE_STATION], (path) => {
      rmSync(lockPath, { force: true });
      const { status, stdout } = run(["audit", path]);
      assert.equal(status, 0);
      // The in-coverage water station is clear and not counted as ashore -
      // and the out-of-coverage station isn't folded into the denominator
      // either, since it was never evaluated for ashore-ness at all.
      assert.match(stdout, /0 of 1 ashore/);
      assert.match(stdout, /1 station.* outside coastline coverage - not checked/i);
    });
  });
});

// The two coverage tests above both rmSync the lock first, forcing the
// uncached path - so the interaction that actually broke (an out-of-coverage
// station carrying a *cached* "unverifiable" verdict from a real lock) was
// never exercised. classify() pins "unverifiable" for it, which is not
// "ashore", so the old cache condition ("unchanged && verdict !== ashore")
// happily cached it - while a second loop also counted it in
// outsideCoverage. Same station, two buckets, and the "X of Y ashore" line's
// denominator quietly re-absorbed it into "checked".
test("a locked, unchanged station outside coastline coverage is cached nowhere - only in the not-checked bucket", () => {
  withRealLockBackup(() => {
    withFixtureStations([WATER_STATION, OUT_OF_COVERAGE_STATION], (path) => {
      run(["lock", path]);
      const { status, stdout } = run(["audit", path]);
      assert.equal(status, 0);

      assert.match(stdout, /1 cached, 0 checked/);
      assert.match(stdout, /0 of 1 ashore/);
      assert.match(stdout, /1 station.* outside coastline coverage - not checked/i);
    });
  });
});
