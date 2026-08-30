# Catalogue slug allocation

**Status:** design, not built
**Follows:** `2026-08-29-station-metadata-cutover-design.md`, which deliberately kept
slugs unchanged. This is the next chapter, not a contradiction of it.
**Unblocks:** station pages on `slackwater.xyz`, and through them
`openwatersio/slackwater-ios` #187.

## Objective

Publish one slug per station for the whole bundled catalogue, not just the 37
curated entries, and make a published slug permanent.

Today `slugs.lock.json` covers the curated set. The ~2,271 bundled NOAA tide and
current stations get their slugs from a name-slugify plus an order-dependent
collision ladder that lives only in the deprecated PWA's TypeScript. Swift cannot
reach it and a Worker would be a third implementation. That gap is what blocks
station pages.

## Why the lock is not merely extended

The existing machinery derives a slug from a name and then checks that it did not
move. That is the wrong shape for a URL vocabulary, and the reason is #122.

`#122` pushes name and position corrections over the air. NOAA slugs are derived
from names. Ship both without changing this and a downloaded correction silently
moves a slug, breaking links already sitting in people's group chats. A dead
share link has no error state: the receiver simply does not get the station.

So the relationship inverts. **A name proposes a slug once, at allocation. After
that the slug is the record and the name is free to change.**

## What changes semantically

`slugs.lock.json` stops being an assertion about derivation and becomes the
**allocation record**.

- `buildSlugsLock` becomes incremental: read the existing lock, preserve every
  entry, allocate only for stations that have none.
- A slug moves only when someone edits the lock by hand and records the old value
  in `formerSlugs`. `checkSlugs` therefore guards against manual moves rather
  than derivation drift.
- The file's embedded note — "a build artifact, not hand-edited input" — becomes
  false and is rewritten. It also still says `station-corrections`, stale since
  the rename.

## The artifact

A generated `data/slugs.json`, shipped in the tarball, partitioned by kind:

```json
{
  "tide":    { "noaa/9447130": "seattle" },
  "current": { "current:noaa/PUG1515": "deception-pass" }
}
```

Swift reads JSON and cannot run a ladder, so iOS needs a table regardless. One
table is what stops the Worker and the app from re-deriving and drifting.

### Kind is a namespace, not a suffix

Uniqueness is enforced **within** a kind, not globally. A tide station and a
current station at the same place may both be `dodd-narrows`; consumers
distinguish them by route (`/tides/…` versus `/currents/…`).

This deletes the PWA ladder's rung 2, which appended `-current` to separate the
two. With the kind carried by the route that suffix is redundant, and it produced
URLs like `/currents/point-wilson-current`.

## Allocation

For a station with no slug in the lock:

1. **Base:** `toSlug(name)`, the existing function.
2. **On collision within the kind:** fold in the qualifier the provider already
   publishes (for example `point-wilson-2-7-mi-ne-of`).
3. **On collision still:** append the station id, which is unique by definition.

Ties are broken by station id, never by iteration order. Allocating the same
catalogue twice in any order produces the same table — the order-dependence that
produced the PWA's local `FORMER_SLUGS` constant does not survive this.

Stations already in the lock skip all of it and keep what they hold.

## Tombstones: a slug is never reused

Today `checkSlugs` errors when a lock entry has no station in the data and tells
you to regenerate, which frees the slug.

Under allocation semantics that is dangerous. If a station leaves the catalogue
and its slug is freed, a future station can take it, and an old link then
resolves to **the wrong water** — silently, plausibly, with a real curve on the
page. A dead link is a non-event. A link that confidently shows Deception Pass to
someone who asked for Dodd Narrows is a safety-shaped bug for anyone timing a
transit.

So a departed station's entry is **retained and marked as a tombstone**, never
reallocated. `slackwater-ios` already carries `chs-tombstones.json`; the pattern
exists in this ecosystem.

Consumers may serve a tombstoned slug as "this station is no longer published"
rather than a bare 404. That is their choice; this package's obligation is only
never to hand the name to a different station.

## Generation and CI

The catalogue arrives as **CLI input at generation time** — the CLI already
accepts a stations file — and the result is committed as a generated artifact.
This matches the existing `build:data` / `check:data` pattern, where
`corrections.json` and `registry.json` are regenerated and diffed in CI.

No npm dependency on the catalogue packages and no runtime coupling: the package
does not become catalogue-aware at import time, only at generation time.

CI runs the check and fails on any allocation that was not committed, the same
way `check:data` already fails on an uncommitted rebuild.

## Bootstrap: the one moment slugs are free

The first full allocation is the only time these names can be chosen. After
station pages ship, every one is permanent.

- The curated 37 keep exactly what they hold. They are published.
- The PWA's ~174 NOAA slugs are **not** preserved. It is deprecated and out of
  development, and no other consumer has published NOAA slugs. Its local
  `FORMER_SLUGS` constant is not migrated.
- Everything else is allocated fresh by the rule above.

## What this owes its consumers

- **iOS** — a JSON table it can bundle at build, keyed by the station ids it
  already persists for favourites, recents and the widget intent.
- **The Worker** — the same table, plus `formerSlugs` and tombstones, from which
  it generates permanent redirects. `formerSlugs` records a rename; it does not
  serve one. Anything that serves must come from this data.
- **Nothing from openwaters.io** — its station URLs are source-namespaced ids
  rather than slugs, so this regeneration cannot move them.

## Coverage guarantee, and how to detect skew

`slugs.json` covers **exactly the catalogue it was generated against** — no more,
no less. It is not a claim about any consumer's bundle.

That distinction matters to anything using the table as a membership test. A
consumer bundling a newer catalogue has stations with no row; one bundling an
older catalogue sees rows for stations it does not have. Neither is an error, and
neither is detectable from the table's contents alone.

So the artifact records what it was built from:

```json
{
  "generated": "2026-08-30",
  "catalogue": { "currents": "…", "tides": "…" },
  "tide": { },
  "current": { }
}
```

Consumers compare that against the catalogue release they bundle and fail loudly
on a mismatch rather than silently treating an absent row as "no such station".

**A membership test wants the consumer's own artifact, not this table.** For
`slackwater.xyz` the authoritative list of stations that have a page is its
generated sitemap — one entry per prerendered page, by construction. Anything
asking "does Slackwater have this station" should key on that. This table answers
"what is this station's slug", which is a different question.

## Versioning

A major, `4.0.0`. The lock file's meaning changes and consumers read these files
directly, so a minor would understate it even though the curated 37 are untouched.

## Testing

- Allocation is order-independent: shuffling the catalogue produces an identical
  table
- An existing lock entry is preserved when its station's name changes — the #122
  case, asserted directly
- A collision within a kind resolves by qualifier, then by id
- The same slug is permitted across kinds and rejected within one
- A departed station's slug is tombstoned, and a new station colliding with a
  tombstone does not receive it
- The curated 37 are byte-identical before and after the first full allocation
- `checkSlugs` fails on a hand-moved slug with no `formerSlugs` entry

## Risks

- **Irreversible.** Once published and linked, the table cannot be regenerated
  differently. Review the first allocation as content, not as a build artifact —
  a bad slug is permanent in a way a bad function is not.
- **Qualifier quality is provider-supplied.** Some NOAA qualifiers make poor URLs.
  The curated registry is the escape hatch: a station that deserves a better slug
  gets an explicit one before first allocation, not after.
- **Catalogue version pinning is by convention**, not by dependency. Regenerating
  against a different catalogue release than the one consumers bundle allocates
  slugs for stations they do not have. Harmless — extra rows — but worth naming.

## Open items

- Tombstone representation: a reserved marker inside `slugs.json`, or a sibling
  file mirroring `chs-tombstones.json`. Either satisfies the never-reuse rule.
- Whether `station-metadata slugs` should refuse to run without an explicit
  catalogue argument, so a partial catalogue cannot quietly allocate a partial
  table.
