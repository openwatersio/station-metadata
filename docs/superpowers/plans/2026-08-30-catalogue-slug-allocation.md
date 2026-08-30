# Catalogue Slug Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one permanent slug per station for the whole bundled catalogue (4,687 stations), so iOS, the Worker and the web share one URL vocabulary.

**Architecture:** A slug is allocated once from a station's name and then never derived again. The published table is the allocation record: generation reads it, preserves every entry, and allocates only for stations that have none. Departed slugs are tombstoned rather than freed, because reusing one makes an old link resolve to the wrong water.

**Tech Stack:** Node ESM, `node:test`, `node:assert/strict`, no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-30-catalogue-slug-allocation-design.md`

## Global Constraints

- **No new runtime dependencies.** The package ships `yaml` and two `@turf` modules; this work adds none.
- **`sideEffects: false` must stay true.** No module does anything observable at import time.
- **Slugs match `^[a-z0-9-]+$`** — enforced at `src/registry.js:210`. Every allocated slug must satisfy it.
- **Digest format is `sha256-<hex>`**, matching `coastlineFingerprint()` in `bin/station-metadata.mjs:27`. Not `sha256:`.
- **No wall-clock fields in generated artifacts.** They break a rebuild diff. Catalogue digests carry provenance instead.
- **Tests are `node --test`** with `import { test } from "node:test"` and `assert from "node:assert/strict"`, colocated as `src/<name>.test.js`.
- **Version target is `4.0.0`.** Exports change and a shipped data file is replaced.

### Spec clarification this plan resolves

The spec describes `slugs.lock.json` becoming the allocation record *and* introduces `data/slugs.json` as the published artifact. **These are one file.** `slugs.lock.json` is replaced by `slugs.json`; shipping both would be two overlapping mechanisms for one job. This is the breaking change that justifies `4.0.0`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/slug.js` | Unchanged. `toSlug(name)` is the only derivation primitive. |
| `src/allocate.js` | **New.** Pure allocation for one kind: the rung ladder and its determinism. Knows nothing about files, kinds or catalogues. |
| `src/slug-table.js` | **New.** The artifact: read, build across kinds, check. Replaces `src/slugs-lock.js`. |
| `src/catalogue.js` | **New.** The departure guard. Pure — no Node builtins, because it is reachable from the package root. |
| `src/fingerprint.js` | **New.** `node:crypto` digest. Imported only by `bin/`, never re-exported from `src/index.js`. |
| `bin/station-metadata.mjs` | Modified. `slugs` and `check-slugs` take mandatory per-kind catalogue paths. |
| `data/slugs.json` | **New generated artifact.** Replaces `data/slugs.lock.json`. |
| `data/slug-tombstones.json` | **New generated artifact.** Departed slugs, never reallocated. |
| `src/index.js` | Modified. Exports the new API in place of the old. |

`allocate.js` is deliberately separate from `slug-table.js`: the ladder is the part with subtle correctness properties and it should be testable without constructing a catalogue, a lock or a filesystem.

---

## Task 1: The allocation ladder

**Files:**
- Create: `src/allocate.js`
- Test: `src/allocate.test.js`

**Interfaces:**
- Consumes: `toSlug` from `src/slug.js`
- Produces: `allocateSlugs({ stations, existing, taken }) -> Map<id, slug>`
  - `stations`: array of `{ id, name, region }`
  - `existing`: `Map<id, slug>` already allocated; preserved untouched
  - `taken`: `Set<slug>` unavailable in this kind (tombstones and former slugs)
  - Returns a new Map; does not mutate its arguments.

- [ ] **Step 1: Write the failing tests**

```js
// src/allocate.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateSlugs } from "./allocate.js";

const S = (id, name, region = "") => ({ id, name, region });

test("allocates the base slug from the name", () => {
  const out = allocateSlugs({
    stations: [S("noaa/1", "Friday Harbor", "WA")],
    existing: new Map(),
    taken: new Set(),
  });
  assert.equal(out.get("noaa/1"), "friday-harbor");
});

test("preserves an existing allocation even when the name changes", () => {
  // The #122 case: a downloaded correction must not move a published slug.
  const out = allocateSlugs({
    stations: [S("noaa/1", "Seattle, Elliott Bay", "WA")],
    existing: new Map([["noaa/1", "seattle"]]),
    taken: new Set(),
  });
  assert.equal(out.get("noaa/1"), "seattle");
});

test("on collision the lowest station id takes the base slug", () => {
  const out = allocateSlugs({
    stations: [S("noaa/9", "Aberdeen", "Scotland"), S("noaa/1", "Aberdeen", "WA")],
    existing: new Map(),
    taken: new Set(),
  });
  assert.equal(out.get("noaa/1"), "aberdeen");
  assert.equal(out.get("noaa/9"), "aberdeen-scotland");
});

test("allocation is order-independent within a batch", () => {
  const stations = [S("noaa/3", "Albany", "NY"), S("noaa/1", "Albany", "Western Australia"), S("noaa/2", "Albany", "NY")];
  const a = allocateSlugs({ stations, existing: new Map(), taken: new Set() });
  const b = allocateSlugs({ stations: [...stations].reverse(), existing: new Map(), taken: new Set() });
  assert.deepEqual([...a].sort(), [...b].sort());
});

test("a station with no region skips the region rung", () => {
  const out = allocateSlugs({
    stations: [S("noaa/1", "Pier", ""), S("noaa/2", "Pier", "")],
    existing: new Map(),
    taken: new Set(),
  });
  assert.equal(out.get("noaa/1"), "pier");
  assert.equal(out.get("noaa/2"), "pier-noaa-2");
});

test("the id rung passes the id through toSlug", () => {
  // A raw id contains ':' and '/', which fails the ^[a-z0-9-]+$ check at
  // registry.js:210. This is the rung where that would surface.
  const out = allocateSlugs({
    stations: [S("current:noaa/A", "Pier", ""), S("current:noaa/B", "Pier", "")],
    existing: new Map(),
    taken: new Set(),
  });
  for (const slug of out.values()) assert.match(slug, /^[a-z0-9-]+$/);
  assert.equal(out.get("current:noaa/B"), "pier-current-noaa-b");
});

test("a taken slug is never allocated", () => {
  const out = allocateSlugs({
    stations: [S("noaa/1", "Everett", "WA")],
    existing: new Map(),
    taken: new Set(["everett"]),
  });
  assert.notEqual(out.get("noaa/1"), "everett");
  assert.equal(out.get("noaa/1"), "everett-wa");
});

test("a station with an unusable name falls back to its id", () => {
  const out = allocateSlugs({
    stations: [S("noaa/1", "!!!", "")],
    existing: new Map(),
    taken: new Set(),
  });
  assert.equal(out.get("noaa/1"), "noaa-1");
});

test("throws rather than reuse when every rung is exhausted", () => {
  assert.throws(
    () =>
      allocateSlugs({
        stations: [S("noaa/1", "Pier", "WA")],
        existing: new Map(),
        taken: new Set(["pier", "pier-wa", "pier-noaa-1"]),
      }),
    /exhausted/,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/allocate.test.js`
Expected: FAIL — `Cannot find module './allocate.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/allocate.js
import { toSlug } from "./slug.js";

/**
 * Allocate a slug for every station that does not already have one.
 *
 * A slug is an API: once shared in a URL, changing it silently breaks the link.
 * So a name proposes a slug exactly once, at allocation, and after that the
 * allocation is the record and the name is free to change. That is what makes
 * over-the-air name corrections safe.
 *
 * Candidates are processed sorted by station id, and that sort is the whole of
 * the determinism: it is intrinsic to the station, so shuffling the catalogue
 * cannot change who wins a contested slug. The order-dependence this replaces
 * is what produced a hand-maintained FORMER_SLUGS constant downstream.
 *
 * `taken` carries slugs that are unavailable but belong to no live station in
 * this kind - tombstones and former slugs. Reusing one would make an old link
 * resolve to a different station, which is worse than a dead link: it is wrong
 * rather than absent, and it looks right.
 */
export function allocateSlugs({ stations, existing, taken }) {
  const allocated = new Map(existing);
  const used = new Set(taken);
  for (const slug of allocated.values()) used.add(slug);

  const pending = stations
    .filter((station) => !allocated.has(station.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const station of pending) {
    // An unusable name (empty, or punctuation only) still needs a slug, and the
    // id is the only other thing every station is guaranteed to have.
    const base = toSlug(station.name ?? "") || toSlug(station.id);
    const region = toSlug(station.region ?? "");

    const ladder = [base];
    if (region) ladder.push(`${base}-${region}`);
    ladder.push(`${base}-${toSlug(station.id)}`);

    const slug = ladder.find((candidate) => !used.has(candidate));
    if (slug === undefined) {
      // The id rung is unique by construction, so reaching here means a slug
      // was reserved that collides with it. Refuse rather than reuse.
      throw new Error(`${station.id}: slug ladder exhausted (${ladder.join(", ")})`);
    }

    allocated.set(station.id, slug);
    used.add(slug);
  }

  return allocated;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/allocate.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add src/allocate.js src/allocate.test.js
git commit -m "feat: allocate slugs once, deterministically, by station id"
```

---

## Task 2: Catalogue reading, fingerprinting and the departure guard

**Files:**
- Create: `src/catalogue.js`
- Test: `src/catalogue.test.js`

**Interfaces:**
- Produces:
  - from `src/catalogue.js` (pure, root-exportable):
    - `departures(previousIds, catalogueIds) -> string[]` — sorted ids present before and absent now
    - `DEPARTURE_LIMIT` — the count above which a run must be refused
  - from `src/fingerprint.js` (**Node-only, never root-exported**):
    - `fingerprint(text) -> string` — `sha256-<hex>` of the exact bytes

**Why two files.** `src/browser-safe.test.js` walks the static import graph from
`src/index.js` and fails on any Node builtin. It is the regression test for a real
outage: `createBundledResolver` used `node:fs`, a bundler externalized it, and the
PWA went blank with nothing in the console pointing here. A `node:crypto` import
reachable from the root would fail that test and reopen that failure class, so the
digest lives in a module only `bin/` imports.

- [ ] **Step 1: Write the failing tests**

```js
// src/catalogue.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { departures, DEPARTURE_LIMIT } from "./catalogue.js";
import { fingerprint } from "./fingerprint.js";

test("fingerprint matches the repo's existing sha256-<hex> convention", () => {
  const fp = fingerprint("hello");
  assert.match(fp, /^sha256-[0-9a-f]{64}$/);
  assert.equal(fp, fingerprint("hello"));
  assert.notEqual(fp, fingerprint("hello "));
});

test("departures are ids present before and absent now, sorted", () => {
  const gone = departures(["noaa/3", "noaa/1", "noaa/2"], ["noaa/2"]);
  assert.deepEqual(gone, ["noaa/1", "noaa/3"]);
});

test("no departures when the catalogue only grows", () => {
  assert.deepEqual(departures(["noaa/1"], ["noaa/1", "noaa/2"]), []);
});

test("the departure limit is a fixed count, not a proportion", () => {
  // A proportion scales with the lock, which is the thing it protects: a
  // truncated catalogue stays under a percentage as the catalogue grows.
  assert.equal(typeof DEPARTURE_LIMIT, "number");
  assert.ok(DEPARTURE_LIMIT > 0 && DEPARTURE_LIMIT < 100);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/catalogue.test.js`
Expected: FAIL — `Cannot find module './catalogue.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/fingerprint.js
import { createHash } from "node:crypto";

/**
 * `sha256-<hex>` of the exact bytes, matching coastlineFingerprint in bin/.
 *
 * Deliberately NOT re-exported from src/index.js: node:crypto reachable from the
 * package root fails src/browser-safe.test.js and reopens the bundler
 * externalization outage that test exists to prevent. Only bin/ imports this.
 */
export function fingerprint(text) {
  return `sha256-${createHash("sha256").update(text).digest("hex")}`;
}
```

```js
// src/catalogue.js
// No Node builtins here: this module is reachable from the package root.

/**
 * The number of departures above which a run must stop and ask.
 *
 * A fixed count rather than a proportion of the table. A proportion scales with
 * the thing it is protecting: as the catalogue grows, a truncated file stays
 * under any percentage and the guard quietly stops guarding. Real departures
 * are rare and individually reviewable; hundreds at once is a bad argument, not
 * a provider event.
 */
export const DEPARTURE_LIMIT = 10;

/**
 * Ids allocated previously and absent from the catalogue now.
 *
 * Under allocation semantics a missing station is indistinguishable from a
 * departed one, which is why the caller must treat a large result as bad input
 * rather than as news.
 */
export function departures(previousIds, catalogueIds) {
  const present = new Set(catalogueIds);
  return [...previousIds].filter((id) => !present.has(id)).sort();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/catalogue.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/catalogue.js src/fingerprint.js src/catalogue.test.js
git commit -m "feat: fingerprint a catalogue and detect implausible departures"
```

- [ ] **Step 6: Prove the root stayed browser-safe**

Run: `node --test src/browser-safe.test.js`
Expected: PASS. If it fails, `fingerprint` has leaked into the root import graph.

---

## Task 3: The slug table — build, read, tombstone

**Files:**
- Create: `src/slug-table.js`
- Test: `src/slug-table.test.js`
- Delete: `src/slugs-lock.js`, `src/slugs-lock.test.js`

**Interfaces:**
- Consumes: `allocateSlugs` (Task 1), `departures` (Task 2)
- Produces:
  - `buildSlugTable({ previous, tombstones, reserved, catalogues }) -> { table, tombstones, gone }`
    - `previous`: the parsed previous `slugs.json`, or `emptyTable()`
    - `tombstones`: parsed `slug-tombstones.json`, or `{ tide: {}, current: {} }`
    - `reserved`: `{ tide: Set<slug>, current: Set<slug> }` — slugs unavailable for
      reasons outside the table, i.e. `formerSlugs` on registry and corrections
      records. A deliberate rename's old slug is still serving redirects and must
      never be handed to a different station.
    - `catalogues`: `{ tide: { stations, digest }, current: { stations, digest } }`
  - `emptyTable() -> { catalogue: {}, tide: {}, current: {} }`
  - `readSlugTable(json) -> object`
  - `checkSlugTable(previous, current, tombstones) -> string[]` — problems, empty when clean.
    A prior id missing from `current` is legitimate **only** if `tombstones` holds it
    with the identical slug; without the tombstones argument every accepted departure
    would fail this check forever.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/slug-table.test.js`
Expected: FAIL — `Cannot find module './slug-table.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/slug-table.js
import { allocateSlugs } from "./allocate.js";
import { departures } from "./catalogue.js";

/** The kinds a station can be. Kind is a URL namespace, so uniqueness is enforced within one. */
const KINDS = ["tide", "current"];

/** An empty table, for a first run or a caller with nothing on disk. */
export function emptyTable() {
  return { catalogue: {}, tide: {}, current: {} };
}

/** Parse a table from its on-disk JSON. */
export function readSlugTable(json) {
  return JSON.parse(json);
}

/**
 * Build the table from the previous one and the current catalogues.
 *
 * Incremental by design: every previous allocation is preserved, and only
 * stations with no slug are allocated. The previous table is an input, not
 * something regenerated - that is what makes a published slug permanent.
 *
 * Returns the new table, the updated tombstones, and the ids that departed, so
 * the caller can refuse an implausible number of them before writing anything.
 */
export function buildSlugTable({ previous, tombstones, reserved, catalogues }) {
  const table = emptyTable();
  const nextTombstones = { tide: { ...tombstones.tide }, current: { ...tombstones.current } };
  const gone = [];

  for (const kind of KINDS) {
    const { stations, digest } = catalogues[kind];
    const previousForKind = new Map(Object.entries(previous[kind] ?? {}));
    const catalogueIds = stations.map((station) => station.id);

    const departed = departures(previousForKind.keys(), catalogueIds);
    for (const id of departed) {
      // Retained, never freed: handing this name to a different station would
      // make an old link resolve to the wrong water.
      nextTombstones[kind][id] = previousForKind.get(id);
      previousForKind.delete(id);
      gone.push(id);
    }

    const allocated = allocateSlugs({
      stations,
      existing: previousForKind,
      // Two sources of unavailability, both meaning "some old link still points
      // here": a departed station's slug, and a slug a live station used to have.
      taken: new Set([...Object.values(nextTombstones[kind]), ...(reserved?.[kind] ?? [])]),
    });

    // Sorted so the artifact is stable under any catalogue ordering.
    table[kind] = Object.fromEntries([...allocated].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    table.catalogue[kind] = { digest, stations: stations.length };
  }

  return { table, tombstones: nextTombstones, gone: gone.sort() };
}

/**
 * Compare a table against an immutable prior one.
 *
 * The prior table must come from somewhere the current commit cannot edit -
 * git, at the previous release tag. Once the table is an input rather than a
 * derivation, comparing it against the data it produced proves nothing: an edit
 * touching both is self-consistent and undetectable.
 */
export function checkSlugTable(previous, current, tombstones) {
  const problems = [];
  for (const kind of KINDS) {
    for (const [id, was] of Object.entries(previous[kind] ?? {})) {
      const now = (current[kind] ?? {})[id];
      if (now === undefined) {
        // Departing is allowed; losing the name is not. The slug must still be
        // held, unchanged, in the tombstones - otherwise it is free to be
        // reallocated and an old link would resolve to a different station.
        const buried = (tombstones?.[kind] ?? {})[id];
        if (buried === was) continue;
        problems.push(
          buried === undefined
            ? `${kind}/${id}: slug "${was}" disappeared without being tombstoned`
            : `${kind}/${id}: tombstoned as "${buried}" but was published as "${was}"`,
        );
      } else if (now !== was) {
        problems.push(`${kind}/${id}: slug moved from "${was}" to "${now}"`);
      }
    }
  }
  return problems;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/slug-table.test.js`
Expected: PASS, 11 tests

- [ ] **Step 5: Remove the module this replaces**

```bash
git rm src/slugs-lock.js src/slugs-lock.test.js
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: FAIL — `src/index.js` still exports the deleted module. Fixed in Task 4.

- [ ] **Step 7: Commit**

```bash
git add src/slug-table.js src/slug-table.test.js
git commit -m "feat: the slug table is the allocation record, and tombstones its departures"
```

---

## Task 4: Wire the exports

**Files:**
- Modify: `src/index.js:17`
- Modify: `index.d.ts`
- Modify: `types/surface.ts:27-29,130-132,140`

**Interfaces:**
- Consumes: everything from Tasks 1-3
- Produces: the package's public API for slugs

- [ ] **Step 1: Replace the export line**

In `src/index.js`, replace:

```js
export { buildSlugsLock, readSlugsLock, checkSlugs } from "./slugs-lock.js";
```

with:

```js
export { allocateSlugs } from "./allocate.js";
export { departures, DEPARTURE_LIMIT } from "./catalogue.js";
export { buildSlugTable, emptyTable, readSlugTable, checkSlugTable } from "./slug-table.js";
```

**Do not add `fingerprint` here.** It imports `node:crypto`; the root must reach no
Node builtin. `src/browser-safe.test.js` enforces this and exists because a
bundler once externalized such an import and blanked a production site.

- [ ] **Step 2: Update `index.d.ts`**

Remove the `buildSlugsLock`, `readSlugsLock` and `checkSlugs` declarations and add:

```ts
export interface CatalogueStation {
  id: string;
  name?: string;
  region?: string;
}

export interface SlugTable {
  catalogue: Record<string, { digest: string; stations: number }>;
  tide: Record<string, string>;
  current: Record<string, string>;
}

export type Tombstones = { tide: Record<string, string>; current: Record<string, string> };

export function allocateSlugs(input: {
  stations: CatalogueStation[];
  existing: Map<string, string>;
  taken: Set<string>;
}): Map<string, string>;

export function departures(previousIds: Iterable<string>, catalogueIds: Iterable<string>): string[];
export const DEPARTURE_LIMIT: number;

export function emptyTable(): SlugTable;
export function readSlugTable(json: string): SlugTable;
export function buildSlugTable(input: {
  previous: SlugTable;
  tombstones: Tombstones;
  catalogues: Record<string, { stations: CatalogueStation[]; digest: string }>;
}): { table: SlugTable; tombstones: Tombstones; gone: string[] };
export function checkSlugTable(previous: SlugTable, current: SlugTable, tombstones: Tombstones): string[];
```

- [ ] **Step 3: Update `types/surface.ts`**

It imports and exercises the deleted API at `:27-29`, `:130-132` and `:140`, so
`npm run test:types` fails until it is updated. Replace the three imports with
`buildSlugTable, emptyTable, readSlugTable, checkSlugTable` and the three usage
lines with:

```ts
const slugTable: SlugTable = buildSlugTable({
  previous: emptyTable(),
  tombstones: { tide: {}, current: {} },
  reserved: { tide: new Set<string>(), current: new Set<string>() },
  catalogues: {
    tide: { stations: [{ id: "noaa/1", name: "Everett", region: "WA" }], digest: "sha256-x" },
    current: { stations: [], digest: "sha256-y" },
  },
}).table;
const rereadTable: SlugTable = readSlugTable(JSON.stringify(slugTable));
const slugProblems: string[] = checkSlugTable(slugTable, rereadTable, { tide: {}, current: {} });
```

and update the export list at `:140` to `slugTable, rereadTable, slugProblems`.

- [ ] **Step 4: Run the suite and the type check**

Run: `npm test`
Expected: PASS — both `node --test` and `tsc -p tsconfig.json`, including
`src/browser-safe.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/index.js index.d.ts types/surface.ts
git commit -m "feat!: replace the slugs lock API with the slug table"
```

---

## Task 5: The CLI requires a catalogue and refuses implausible departures

**Files:**
- Modify: `bin/station-metadata.mjs` — the `slugs` branch at `:226` and `check-slugs` at `:233`
- Test: `src/cli-slugs.test.js` (new)

**Interfaces:**
- Consumes: `buildSlugTable`, `emptyTable`, `checkSlugTable` (Task 3), `fingerprint` (Task 2), `DEPARTURE_LIMIT` (Task 2)
- Produces:
  - `station-metadata slugs --tides <f> [--tides <f>] --currents <f> [--currents <f>]`
  - `station-metadata check-slugs` with the same flags

  Repeatable per-kind flags rather than two positionals, because the catalogue is
  **four files across two kinds**: NOAA tides (2,765) and CHS stations (1,058) are
  both `tide`; NOAA currents (842) and CHS current gates (22) are both `current`.
  Two positionals silently omit 1,080 stations.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test src/cli-slugs.test.js`
Expected: FAIL — the current `slugs` command ignores arguments and writes a lock

- [ ] **Step 3: Replace the `slugs` branch**

In `bin/station-metadata.mjs`, replace the whole `if (command === "slugs") { ... }` block with:

```js
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
    const kind = record.kind === "tide" ? "tide" : "current";
    for (const former of record.formerSlugs) reserved[kind].add(former);
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
    catalogues[kind] = { stations, digest: digests.join("+") };
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

  writeFileSync(slugsPath, JSON.stringify(table, null, 2) + "\n");
  writeFileSync(tombstonesPath, JSON.stringify(nextTombstones, null, 2) + "\n");
  const total = Object.keys(table.tide).length + Object.keys(table.current).length;
  console.log(`wrote ${slugsPath} - ${total} station(s), ${gone.length} tombstoned`);
  process.exit(0);
}
```

Add the imports at the top of the file:

```js
import { buildSlugTable, emptyTable, checkSlugTable } from "../src/slug-table.js";
import { fingerprint, DEPARTURE_LIMIT } from "../src/catalogue.js";
```

and remove the `slugs-lock.js` import at `:6`.

- [ ] **Step 4: Replace the `check-slugs` branch**

```js
if (command === "check-slugs") {
  const catalogues = readCatalogues("check-slugs", process.argv.slice(3));
  const committed = readArtifact(slugsPath, emptyTable());
  const tombstones = readArtifact(tombstonesPath, { tide: {}, current: {} });

  const { table } = buildSlugTable({ previous: committed, tombstones, reserved: reservedSlugs(), catalogues });
  const problems = checkSlugTable(committed, table, tombstones);

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`\n${problems.length} problem(s) - a published slug may not move`);
    process.exit(1);
  }
  const total = Object.keys(committed.tide).length + Object.keys(committed.current).length;
  console.log(`check-slugs: ${total} station(s) match the committed table`);
  process.exit(0);
}
```

- [ ] **Step 5: Update the usage line**

Replace the final `console.error("usage: ...")` with:

```js
console.error("usage: station-metadata <validate|audit|lock|check|slugs|check-slugs> [args]");
console.error("  slugs --tides <f> --currents <f>        allocate slugs for new stations");
console.error("  check-slugs --tides <f> --currents <f>  fail if a published slug moved");
console.error("  both flags repeat: the bundled catalogue is four files across two kinds");
```

- [ ] **Step 6: Run the tests**

Run: `node --test src/cli-slugs.test.js && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add bin/station-metadata.mjs src/cli-slugs.test.js
git commit -m "feat!: require both catalogues and refuse implausible departures"
```

---

## Task 6: CI checks the committed table against the previous release

**Files:**
- Modify: `package.json` — scripts
- Modify: `.github/workflows/ci.yml`
- Delete: `data/slugs.lock.json`

**Interfaces:**
- Consumes: the CLI from Task 5
- Produces: `npm run check:slugs`

- [ ] **Step 1: Add the script**

In `package.json`, add to `scripts`:

```json
"check:slugs": "node bin/station-metadata.mjs check-slugs --tides \"$NOAA_TIDES\" --tides \"$CHS_TIDES\" --currents \"$NOAA_CURRENTS\" --currents \"$CHS_GATES\""
```

- [ ] **Step 2: Replace the existing CI invocation**

`.github/workflows/ci.yml:34` already runs `node bin/station-metadata.mjs
check-slugs` **with no arguments**. Task 5 makes both catalogues mandatory, so
that line now exits 1 on every PR before anything else runs. It must be
*replaced*, not supplemented.

Delete line 34 and its preceding comment, then add:

```yaml
      - name: Check no published slug moved since the last release
        run: |
          # The prior record must be one this commit cannot edit. Comparing the
          # working tree against itself proves nothing once the table is an
          # input rather than a derivation.
          git fetch --tags --quiet
          PREV=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || true)
          if [ -z "$PREV" ]; then echo "no previous tag; skipping"; exit 0; fi
          git show "$PREV:data/slugs.json" > /tmp/previous-slugs.json 2>/dev/null || {
            echo "no slug table at $PREV; skipping"; exit 0; }
          node -e '
            const { checkSlugTable } = await import("./src/slug-table.js");
            const fs = await import("node:fs");
            const prev = JSON.parse(fs.readFileSync("/tmp/previous-slugs.json", "utf8"));
            const now = JSON.parse(fs.readFileSync("data/slugs.json", "utf8"));
            const tombstones = JSON.parse(fs.readFileSync("data/slug-tombstones.json", "utf8"));
            const problems = checkSlugTable(prev, now, tombstones);
            if (problems.length) { for (const p of problems) console.error("  " + p); process.exit(1); }
            console.log("no published slug moved since " + process.env.PREV);
          ' --input-type=module
        env:
          PREV: ${{ github.sha }}
```

- [ ] **Step 3: Verify the old invocation is gone**

Run: `grep -n "check-slugs" .github/workflows/ci.yml`
Expected: no bare `check-slugs` invocation remains — only the release-tag
comparison added above.

- [ ] **Step 4: Remove the file this replaces**

`data/slugs.lock.json` is deleted only after Task 7 has migrated its contents
into `data/slugs.json`. Deleting it here would discard the 37 existing
allocations, which is exactly the failure this whole design prevents.

```bash
git rm data/slugs.lock.json   # AFTER Task 7 step 2 confirms migration
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "ci: fail when a published slug moves since the last release"
```

---

## Task 7: Migrate the existing allocations, then allocate the rest

**Files:**
- Create: `data/slugs.json`, `data/slug-tombstones.json`
- Modify: `package.json` — version to `4.0.0`
- Delete: `data/slugs.lock.json` (only after step 3 passes)

This task produces content, not code. **Review its diff as content.** The first allocation is the only moment these names can be chosen; after station pages ship, every one is permanent.

**The migration must happen before the allocation.** `data/slugs.lock.json` holds 37 allocations that are already published. If the first run starts from an empty table, they are reallocated from scratch and may move — the exact failure this entire design exists to prevent, committed in the very first commit that claims to prevent it.

- [ ] **Step 1: Seed `slugs.json` from the existing lock**

The lock is a flat `id -> slug` map with no kind. Kind comes from *which catalogue
the id appears in*, which is exact and needs no heuristic about id prefixes.

```bash
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const R = "../slackwater-ios/Slackwater/Resources/";
const load = (f) => JSON.parse(readFileSync(R + f, "utf8"));
const kindOf = new Map();
for (const s of [...load("stations.json"), ...load("chs-stations.json")]) kindOf.set(s.id, "tide");
for (const s of [...load("currents.json"), ...load("chs-current-gates.json")]) kindOf.set(s.id, "current");

const lock = JSON.parse(readFileSync("data/slugs.lock.json", "utf8"));
const seeded = { catalogue: {}, tide: {}, current: {} };
const orphans = [];
for (const [id, slug] of Object.entries(lock.slugs)) {
  const kind = kindOf.get(id);
  if (!kind) { orphans.push(id); continue; }
  seeded[kind][id] = slug;
}
writeFileSync("data/slugs.json", JSON.stringify(seeded, null, 2) + "\n");
const total = Object.keys(seeded.tide).length + Object.keys(seeded.current).length;
console.log(`seeded ${total} of ${Object.keys(lock.slugs).length} locked allocations`);
if (orphans.length) console.log(`orphans (in the lock, in no catalogue): ${orphans.join(", ")}`);
'
```

Expected: `seeded 37 of 37 locked allocations`.

**If any id is reported as an orphan, stop.** It means a curated station is not in
any bundled catalogue, so migrating it needs a decision — tombstone it, or add the
catalogue it belongs to — and guessing would either lose a published slug or
allocate a second one for the same station.

- [ ] **Step 2: Run the allocation against all four catalogue files**

```bash
node bin/station-metadata.mjs slugs \
  --tides    ../slackwater-ios/Slackwater/Resources/stations.json \
  --tides    ../slackwater-ios/Slackwater/Resources/chs-stations.json \
  --currents ../slackwater-ios/Slackwater/Resources/currents.json \
  --currents ../slackwater-ios/Slackwater/Resources/chs-current-gates.json
```

Expected: `wrote .../data/slugs.json - 4687 station(s), 0 tombstoned`

**4,687 is the assertion.** 2,765 NOAA tide + 1,058 CHS = 3,823 tide; 842 NOAA
current + 22 CHS gates = 864 current. Any other total means a file was omitted, and
omitting a file at this step tombstones nothing yet but allocates nothing for those
stations either — they would be allocated later, out of order, after other stations
had taken the good names.

- [ ] **Step 2: Verify every slug is valid and unique within its kind**

```bash
node -e '
  const t = require("./data/slugs.json");
  for (const kind of ["tide", "current"]) {
    const slugs = Object.values(t[kind]);
    const bad = slugs.filter(s => !/^[a-z0-9-]+$/.test(s));
    const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
    console.log(kind, slugs.length, "slugs,", bad.length, "invalid,", new Set(dupes).size, "duplicated");
    if (bad.length || dupes.length) process.exit(1);
  }
'
```

Expected: `tide 3823 slugs, 0 invalid, 0 duplicated` and `current 864 slugs, 0 invalid, 0 duplicated`

- [ ] **Step 4: Confirm every one of the 37 kept its slug**

Not a sample. All 37, read from the lock itself rather than from a hand-copied
list, because a hand-copied list is exactly where a missed CHS entry would hide.

```bash
node -e '
  const lock = require("./data/slugs.lock.json");
  const t = require("./data/slugs.json");
  let moved = 0;
  for (const [id, want] of Object.entries(lock.slugs)) {
    const got = t.tide[id] ?? t.current[id];
    if (got !== want) { console.log("MOVED", id, want, "->", got); moved++; }
  }
  console.log(`${Object.keys(lock.slugs).length} checked, ${moved} moved`);
  if (moved) process.exit(1);
'
```

Expected: `37 checked, 0 moved`. Any `MOVED` means the preservation path is broken — stop and fix Task 1 rather than accepting the diff.

- [ ] **Step 5: Read the allocations that fell through to the id rung**

```bash
node -e '
  const t = require("./data/slugs.json");
  for (const [kind, ids] of Object.entries({tide: t.tide, current: t.current}))
    for (const [id, slug] of Object.entries(ids))
      if (slug.includes(id.replace(/[^a-z0-9]+/gi, "-").toLowerCase())) console.log(kind, id, slug);
'
```

Read them. The measured expectation from the design work was about eight, all
tide, from names that collide even after `region` — `aberdeen` in WA and Scotland,
`albany` in NY and Western Australia. Adding CHS may add a few more. If any is
genuinely bad, add an explicit `slug:` to `registry.yaml` for that station and
re-run **now**: after publication it cannot be changed without a redirect.

- [ ] **Step 6: Remove the lock the table replaces**

Only now, with the migration verified in step 4.

```bash
git rm data/slugs.lock.json
```

- [ ] **Step 7: Bump the version**

Set `"version": "4.0.0"` in `package.json`.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: PASS, including `src/browser-safe.test.js` and the type check

- [ ] **Step 9: Commit**

```bash
git add data/slugs.json data/slug-tombstones.json package.json
git commit -m "feat!: allocate slugs for the whole bundled catalogue"
```

---

## Done when

- `npm test` passes, including the type check and `src/browser-safe.test.js`
- `data/slugs.json` holds **4,687** slugs — 3,823 tide, 864 current — all matching `^[a-z0-9-]+$`, unique within each kind
- All 37 previously locked slugs are unchanged, verified against the lock itself
- `station-metadata slugs` with a missing catalogue argument exits 1
- CI fails if a published slug moves relative to the previous release tag
- `data/slugs.lock.json` and `src/slugs-lock.js` are gone
