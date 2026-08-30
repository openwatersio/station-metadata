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

    // A station that comes back reclaims the slug it was buried with, and the
    // tombstone goes. Otherwise it would be allocated a fresh one and end up
    // published twice - live under the new slug, retired under the old - and a
    // consumer serving tombstones as "no longer published" would say that about
    // a station that is right there in the catalogue.
    for (const id of catalogueIds) {
      if (previousForKind.has(id)) continue;
      const buried = nextTombstones[kind][id];
      if (buried === undefined) continue;
      previousForKind.set(id, buried);
      delete nextTombstones[kind][id];
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
