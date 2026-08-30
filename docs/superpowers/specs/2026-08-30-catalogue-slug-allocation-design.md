# Catalogue slug allocation

**Status:** design, not built
**Follows:** `2026-08-29-station-metadata-cutover-design.md`, which deliberately kept
slugs unchanged. This is the next chapter, not a contradiction of it.
**Unblocks:** station pages on `slackwater.xyz`, and through them
`openwatersio/slackwater-ios` #187.

## Objective

Publish one slug per station for the whole bundled catalogue — 4,687 stations,
not just the 37 curated entries — and make a published slug permanent.

Today `slugs.lock.json` covers the curated 37. The bundled catalogue — **4,687
stations**: 2,765 NOAA tide, 842 NOAA current, 1,058 CHS and 22 CHS current gates
— gets its slugs from a name-slugify plus an order-dependent collision ladder
that lives only in the deprecated PWA's TypeScript. Swift cannot reach it and a
Worker would be a third implementation. That gap is what blocks station pages.

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
- **It needs an immutable prior record to do that.** Once the lock is an input
  rather than a derivation, comparing it against the data it produced proves
  nothing: an edit that changes the lock and the generated artifact together is
  self-consistent and undetectable. The prior record is **git** — the lock as of
  the last release tag, read with `git show <tag>:data/slugs.lock.json`. CI
  compares the working tree against that, so the old value always exists and
  cannot be edited in the same commit as the change it is meant to catch.
- `formerSlugs` keeps its existing shape: a per-record array of strings, each
  matching `^[a-z0-9-]+$`, already validated at `src/registry.js:127`. Kind
  scoping is implicit — the array lives on a record that has a kind, and a former
  slug is only ever consulted within that kind's namespace.
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

Stations already in the lock skip all of this and keep what they hold. What
follows applies only to stations with no slug.

Candidates are processed **sorted by station id**, ascending, byte-wise. That
sort is the whole of the determinism: it is intrinsic to the station and does not
depend on catalogue order.

1. **Base:** `toSlug(name)`.
2. **If the base is free within the kind, take it.** When several new stations
   want the same base, **the lowest station id takes it** and the rest continue
   to rung 3. Explicit, because "ties broken by id" did not say who won.
3. **Region:** `${base}-${toSlug(region)}`. If a station has **no region**, or
   the region slugifies to empty, skip to rung 4. If two stations produce the
   same regional slug, the lowest id takes it and the rest continue to rung 4.
4. **Id:** `${base}-${toSlug(id)}`. Unique by definition, and terminal.

### Why `region`, and how far it gets

An earlier draft folded in "the qualifier the provider publishes". **No such field
exists.** Every bundled station carries `id, name, region, aliases, latitude,
longitude, timezone` plus its kind-specific fields, and nothing else. NOAA bakes
the distance and bearing into the *name* — "4.3 nm NE of Point Brazil" — so
`toSlug(name)` already produces the qualified form and the remaining
disambiguator is `region`, present on 100% of stations.

Measured against the bundled catalogue rather than assumed:

| kind | stations | base-slug collisions | still colliding after `region` |
|---|---|---|---|
| tide | 2,765 | 65 slugs / 137 stations | **4 slugs / 8 stations** |
| current | 842 | 64 slugs / 149 stations | **0** |

So rung 4 exists for eight tide stations. It is not dead code — `aberdeen` is
Washington and Scotland, `albany` is New York and Western Australia — but it is
rare enough that its output being ugly is acceptable, which is what justifies
appending an id at all.

That the residuals are Scotland and Western Australia is also a reminder that this
catalogue is global, not regional.

**The id must go through `toSlug`.** Station ids contain `:` and `/` —
`current:noaa/PUG1515` appended raw yields `seattle-current:noaa/PUG1515`, which
fails the `^[a-z0-9-]+$` check at `src/registry.js:210`. Through `toSlug` it
becomes `current-noaa-pug1515`. This is the difference between a working rung and
one that produces slugs the package's own validator rejects.

### The scope of the determinism guarantee

Order-independence holds **within a single allocation batch**: shuffling the
catalogue produces an identical table.

Across incremental runs the result is **history-dependent, by design**. Allocating
A then B does not necessarily equal allocating B then A, because whoever arrives
first holds the base slug forever. That is the point — it is what makes a
published slug permanent — but it means the table cannot be reproduced from the
current catalogue alone. The lock is the record, and it is not regenerable from
scratch once anything is published.

## Tombstones: a slug is never reused

Today `checkSlugs` errors when a lock entry has no station in the data and tells
you to regenerate, which frees the slug.

Under allocation semantics that is dangerous. If a station leaves the catalogue
and its slug is freed, a future station can take it, and an old link then
resolves to **the wrong water** — silently, plausibly, with a real curve on the
page. A dead link is a non-event. A link that confidently shows Deception Pass to
someone who asked for Dodd Narrows is a safety-shaped bug for anyone timing a
transit.

So a departed station's slug is **retained and never reallocated** — moved to a
sibling `data/slug-tombstones.json` rather than marked inline. `slackwater-ios`
already carries `chs-tombstones.json`; the pattern exists in this ecosystem.

A sibling file rather than an inline marker because `slugs.json` guarantees it
covers *exactly* the catalogue it was generated against, and a tombstone is by
definition a station no longer in that catalogue. Inline tombstones would make
that guarantee false, and a consumer iterating live stations would have to know
to filter. Two files, two honest guarantees.

Consumers may serve a tombstoned slug as "this station is no longer published"
rather than a bare 404. That is their choice; this package's obligation is only
never to hand the name to a different station.

## Generation and CI

### The catalogue argument is mandatory

Today the CLI takes `[stations.json]` — optional. Under allocation semantics that
is a data-destroying default. **A station absent from the input is
indistinguishable from a station that has departed**, so an accidental partial
run — a truncated file, one kind's catalogue instead of both, a forgotten
argument — reads as hundreds of departures and tombstones live stations.
Tombstones are permanent. The mistake is not recoverable by re-running.

So `station-metadata slugs` **requires an explicit catalogue path for every
kind** and refuses to run otherwise, and records each catalogue's digest and
station count in the artifact as provenance.

The digest is recorded, not gated on. A legitimate catalogue update changes it
every time, so comparing digests would fail on exactly the runs that should
succeed. What actually catches bad input is the departure guard below, because
the failure being defended against is *stations going missing*, not the
catalogue changing.

And it **refuses on implausible departure**: if more than a small number of
stations present in the lock are absent from the input, the run aborts and
requires an explicit acknowledgement naming the expected count. Real departures
are rare and individually reviewable; mass departure is a bad argument, and the
cost of being wrong is asymmetric — a blocked run is a minor annoyance, an
erroneous tombstone is permanent.

### Generation

The catalogue arrives as **CLI input at generation time** and the result is
committed as a generated artifact.
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
  "catalogue": {
    "tides":    { "digest": "sha256-…", "stations": 2043 },
    "currents": { "digest": "sha256-…", "stations": 856 }
  },
  "tide":    { "noaa/9447130": "seattle" },
  "current": { "current:noaa/PUG1515": "deception-pass" }
}
```

**No wall-clock `generated` field.** `slugs-lock.js:40` writes
`new Date().toISOString()` today, which is fine while nothing diffs the file —
`check:data` covers only `corrections.json` and `registry.json`. The moment CI
diffs a rebuild, a date makes it fail every day for no reason. The catalogue
digests carry the same "what was this built from" information and are
reproducible. The existing date in `slugs.lock.json` goes too, since this change
rewrites that file anyway.

The full published schema is: live slugs per kind in `slugs.json`, catalogue
digests alongside them, departed slugs in `slug-tombstones.json`, and
`formerSlugs` on the station records where it already lives. Those four are what
a consumer needs to resolve a slug, serve a redirect, and refuse a reused name.

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
- `checkSlugs` fails on a hand-moved slug with no `formerSlugs` entry, compared
  against the lock at the previous release tag rather than against regenerated data
- `slugs` refuses to run with no catalogue argument, with one kind's catalogue
  missing, and when departures exceed the plausibility threshold
- Rung 4 passes the station id through `toSlug`: an allocated slug always matches
  `^[a-z0-9-]+$`, asserted against an id containing `:` and `/`
- Where several new stations share a base, the lowest station id receives it
- A station with no region skips rung 3 and allocates at rung 4
- The eight known tide collisions that survive `region` each allocate distinctly
- The artifact contains no wall-clock field: two builds from one catalogue are
  byte-identical

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

Both items previously open here were settled in review: tombstones go to a
sibling file, and the catalogue argument is mandatory. See those sections.

One residual, for implementation rather than design: the departure threshold that
aborts a run. It wants to be low enough to catch a truncated catalogue and high
enough not to block a genuine provider cull. A fixed small count is probably
right; a percentage of the lock is not, since it scales with the thing it is
meant to protect.
