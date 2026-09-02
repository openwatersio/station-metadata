# Contributing

Most people who find a wrong station should just
[open an issue](https://github.com/openwatersio/station-metadata/issues/new?template=station.yml).
This document is for the smaller group who want to make the change themselves, and for anyone
who wants to understand how the data fits together.

## Fixing a station in five minutes

1. Use Node.js 22 or newer. Clone the repo and run `npm ci`.
2. Edit `data/corrections.yaml` (or `data/registry.yaml` for a station with no upstream record;
   see [The registry](#the-registry) for which file a station belongs in).
3. Run `npm run build:data`. The YAML is the source of truth and the JSON next to it is a
   committed artifact compiled from it, so browsers can import the data without a filesystem.
   Commit both together; CI fails if they drift.
4. Run the checks:

   ```bash
   npm test
   npm run check:data
   node bin/station-metadata.mjs validate
   node bin/station-metadata.mjs check-slugs
   ```

5. Open a pull request. Do not push to `main`. CI, review, and the Open Waters CLA check must
   pass before merge.

A position change needs a `reason`. A slug change needs the old slug recorded in `formerSlugs`
and the slug lock regenerated (`node bin/station-metadata.mjs slugs`). Everything else is a
one-line edit.

## The corrections file

`data/corrections.yaml` overlays a provider's own record. Anything here wins over the published
data.

```yaml
noaa/9447659:
  name: Everett
  context: Port Gardner
  slug: everett
  cities: [Everett, Marysville]
  aliases: [port gardner, everett marina]

noaa/9442396:
  name: La Push
  context: Quillayute River
  positionVerified: >-
    Sited up the Quillayute River. The coastline maps ocean only, so a riverine
    gauge reads inland by construction — the published position is correct.
```

| Field | Meaning |
|---|---|
| `name` / `context` | The two-line display. Context is whatever most usefully distinguishes the place: a water body, island group, region, county, or characteristic. |
| `slug` | Canonical URL segment. Lives here so a name fix and its URL move together. |
| `cities` | Nearest settlements, for search. Not for display. |
| `aliases` | What someone might type. Local names, former names, misspellings. |
| `formerSlugs` | Slugs this station used to resolve to. See [Slugs](#slugs). |
| `position` | A corrected `[lat, lon]`. Requires `reason`. |
| `positionVerified` | A reason the published position is *right* despite reading inland. Mutually exclusive with `position`. Passed through to the resolved object when set. |

**Context must never restate the name.** `Everett · Everett` is what a nearest-town derivation
produces at a station named for its town, and it tells the reader nothing. Validation rejects a
context containing the full station name as a whole-word phrase, so `Everett Harbor` and
`Port of Everett` are refused, while `Port Townsend` / `Port Angeles`, different places sharing a
word, passes.

**A correction is a fix, not a relocation.** When `validate` is given a stations file it also
checks that a corrected position is within **5 km** of the one the provider published. The gauge
is where it is; what is wrong is the coordinate written down for it. This check needs the
published station list, which the corrections file deliberately does not duplicate (a copy of
upstream data drifts the moment upstream moves), so it only runs when a caller supplies one.

## How a lookup resolves

Every lookup resolves highest-first:

1. **Registry** (`data/registry.yaml`). Stations whose identity this package owns rather than
   corrects, because there is no upstream to correct. Resolves from an id alone.
2. **Curated override** (`data/corrections.yaml`).
3. **Derived fallback**: nearest place, flagged `derived: true`, rendered `Nanaimo, BC`. The pick
   is nearest-with-a-population-credit, so a town beats a neighbourhood a kilometre closer (a
   Victoria gauge reads `Victoria, BC`, not `Tillicum, BC`). Nothing is offered past
   `DERIVED_MAX_KM`: a station in empty water gets an empty context, on purpose, so a consumer can
   fall through to its own coarse label rather than print a town 90 km away.
   `createBundledResolver` derives from the 19-town `data/gazetteer.json`; `createPlacesResolver`
   takes the national `data/places.json`.
4. **Source data**: the provider's own name, cleaned.

Cleaning only re-cases words that are **entirely** upper case. Mixed-case names were typed by a
human and may carry capitalisation we cannot reconstruct: `Spee-Bi-Dah`, `La Push`, `McArthur`
pass through untouched. Abbreviations that read badly are expanded: `NAS` → Naval Air Station,
`ent.` → Entrance, `St. Park` → State Park. Abbreviations that are already right are left alone:
every compass point (`SSE` is a bearing, not a word to title-case), plus `LB`, `ICW`, `ICWW`,
`RR`, `NM`, `US`, `BC`, `USCG`.

Distance is stated in nautical miles whatever unit the provider wrote: `7.6 mi.` → `6.6 nm`,
`0.4 nmi.` → `0.4 nm`. NOAA mixes units inside one dataset, so without this a card can show the
station's own qualifier in statute miles above a range the app computed in nautical.

## The registry

Some stations have no upstream record to correct. CHS tidal-current gates are the case this was
built for: the fitting pipeline emits a hand-written label and no position at all, so there is
nothing to overlay onto. The record here *is* the station.

```yaml
chs-dodd-narrows:
  name: Dodd Narrows
  context: Nanaimo
  position: [49.13546639419797, -123.81735084108287]
  provider: chs
  source: GSC West Coast Topo-Bathymetric DEM v2 hydraulic control section
```

The registry holds **two bounded, hand-curated classes**, told apart by `kind`:

- **Current gates** (`kind: current`; an omitted `kind` also resolves as `current`). A current
  station joins when *safe transit requires timing slack*: the gates on the Inside Passage route,
  not every interesting current.
- **Tide reference ports** (`kind: tide`). A tide station joins when *CHS itself designates it a
  reference port*, an external rule we did not invent, and one that keeps a hand-written list
  small enough to stay honest rather than becoming a mirror of CHS's whole station table.

Both rules are expansion-friendly and rule-governed; neither is a cap. `kind` is the only field
that differs by class.

**Selecting gates.** Consumers call `currentGates()` rather than filtering the registry by hand.
It returns the entries you can fetch a live current series for: tide ports out, and derived gates
out too (they have no series of their own; pass `includeDerived: true` for the full gate set).
It owns the tide/current and fetchable/derived boundaries so every consumer stays aligned with the
registry's classes.

**Pairing a gate to a tide port.** A current gate can name a `tideReference`: the registry key of
the tide reference port whose water a paired tide+current view shows beside it (say
`chs-seymour-narrows` → `chs-campbell-river`). It is the *nearest* reference port in the same tidal
regime, and it is **optional**: a gate with no honestly-near port stays unpaired and a consumer
shows currents alone. A gate CHS publishes no current station for instead carries a `derived`
block, `reference` (the tide port) plus `hwLagMinutes` / `lwLagMinutes`, and reads its slack from
that port's high and low water. The two are mutually exclusive; a tide port carries neither.
`resolve()` surfaces the effective reference (explicit or derived) as `tideReference` on the
resolved record. See [PROVENANCE.md](PROVENANCE.md) for how a pairing is sourced.

**No provider-minted identifier ships.** The key, `chs-dodd-narrows`, is the public id: stable and
safe in a URL. The provider's own opaque handle is resolved at runtime by whoever holds a licence
to that provider's API; it is never redistributed here. Joining this record to that live data is
done by **name** (fold the name, then fall back to `aliases`, which exist so a provider rename does
not go dark: CHS publishes Masset Sound as "Masset Channel") or by **position** within a
tolerance. Either works, but only after you **filter the provider's list to the series you want**;
that filter, not the choice of key, is what makes the join unambiguous. See
[PROVENANCE.md](PROVENANCE.md) for why, and for the collisions that lie in wait if you skip it.

**One file per station.** A station may not appear in both files; two sources of authority for
one station is the bug, not a feature. Slugs must be unique across both, because URLs share one
namespace, and `formerSlugs` is valid in both for the same reason.

**Positions.** A corrected `position` in the corrections file is checked for plausible distance
from what the provider published; a registry position is not, because it *is* the published
value. That absence is deliberate. Authored registry positions require a `source` when they
depart from the documented defaults.

**Coverage.** The bundled coastline clip is derived from the registry's own extent, so every
registry position must sit within a coverage region. A registry station outside coverage is a
`validate` **failure**, not a note: the package owns its position, so one the on-land audit
cannot reach is a claim it cannot back. The clip is **several disjoint regions**, not one
rectangle, which covers gates on both coasts without clipping metre-resolution coastline across
the country between them. Boxes within a degree of each other merge, so a coast stays contiguous.
The regions are recorded in the coastline file itself, and `isWithinCoverage` tests them
individually; asking only the outer bounds would answer "covered" for Winnipeg.

## Stations that read as on land

```bash
npx station-metadata audit stations.json
npx station-metadata validate [stations.json]
```

The audit tests every resolved position against the bundled coastline and reports those more than
**200 m** inland, with a suggested nearest-water point. It reports and suggests; **it never
edits.** Nearest water is frequently the wrong side of a spit or the wrong bay, so a human picks
the real spot and writes the reason.

That threshold is not arbitrary. Two categories read as inland and are perfectly correct:

- **Pier-mounted gauges.** Almost all of them; you need a structure over water. A chart-derived
  coastline draws the pier as land. The Friday Harbor gauge measures 31 m inland and is right.
- **Riverine stations.** The coastline product maps the *ocean*, so a gauge up a river reads
  inland by construction.

A genuinely misplaced station is hundreds of metres out. 200 m sits in the gap. Known-good cases
get a `positionVerified` reason and the audit stops reporting them; an audit that never reaches
zero is one nobody reads.

A station outside the clipped coastline is not in the ashore count either way: there is no land
data to check it against, so it is not silently read as clear. `audit` prints a separate
`N station(s) outside coastline coverage - not checked` line for these.

## A decommissioned gauge is still a station

Most Salish Sea stations we correct read as `removed` in NOAA's metadata: 32 of the 41 NOAA
stations audited here. That flag means the physical water-level **gauge** was pulled, not that the
station is gone. NOAA still publishes harmonic tide predictions for every one of them, which is
exactly why a prediction app bundles them. `removed` is the normal state of a subordinate station,
not a reason to drop or flag it. This package carries no decommissioned/operational field for that
reason; it would mislabel the majority of the corpus while distinguishing nothing a consumer can
act on.

## Slugs

A slug is an API: it goes straight into a shareable URL (`slackwater-web` routes `/tide/<slug>`),
so changing one silently is a breaking change shipped as a patch. A slug published in
`data/slugs.json` never moves.

```bash
npx station-metadata slugs        # writes data/slugs.lock.json
npx station-metadata check-slugs  # exit 1 if a slug moved without being recorded
```

`data/slugs.lock.json` pins the current slug per station, because CI cannot tell a slug *changed*
without knowing the previous value. `check-slugs` fails when a station's slug differs from the
lock and the old value is not in that station's `formerSlugs`. Separately, `validate` rejects a
new slug that collides with another station's current slug **or** its `formerSlugs` (a recycled
slug would silently redirect old links to the wrong station, worse than a 404), plus a malformed
`formerSlugs` entry. Move a slug and record its old value in `formerSlugs` in the same change,
then regenerate the lock.

One judgment no check can make: only record a former slug when the new slug points at the **same
place**. A genuine rename qualifies; a mislabel does not. Redirecting a mislabelled slug preserves
a wrong link, where a 404 is the more honest outcome. A downstream consumer owns the redirect
either way.

## Pinning audit results

```bash
npx station-metadata lock stations.json    # writes data/audit.lock.json
npx station-metadata check stations.json   # exit 1 if a station has moved since the lock
```

`lock` pins every station's *resolved* position and audit verdict (`clear`, `verified`, or
`ashore`) against the bundled coastline. The point is change detection, not speed: NOAA can
silently move a gauge, and without a lock that only shows up as a surprise months later. With one
committed, `check` (the CI guard) turns it into a line in a diff the moment it happens. Because
the lock pins the *resolved* position, a human editing `corrections.yaml` shows up as "moved"
too; that is a data change worth reviewing, not a false alarm. `audit` reuses a pinned verdict for
any station whose resolved position and the lock's coastline/threshold all still match.

## What never goes in

Never add provider-minted identifiers, provider station exports, predictions, fitted
constituents, amplitudes/phases, datums, current axes, credentials, or generated CHS model
output. Registry facts are independently authored and reviewed, never copied from a provider
station export. [PROVENANCE.md](PROVENANCE.md) has the field-by-field reasoning.

Runtime imports stay browser-safe. The coastline parse remains behind the explicit
`validate-positions` subpath.

## Rebuilding the bundled data

- **Coastline**: `node scripts/build-coastline.mjs <shapefile-dir> data/coastline.geojson`
  (needs GDAL). Source is [OSM land polygons](https://osmdata.openstreetmap.de/data/land-polygons.html).
  Natural Earth 1:10m was measured and rejected: it reads the Anacortes area as water and Friday
  Harbor as land, generalising the San Juans away entirely. The golden-point tests in
  `src/coastline.test.js` are the acceptance criterion for the data; if one fails, fix the data,
  not the test.
- **Places**: `npm run build:places`. The GeoNames filter is in `scripts/build-places.mjs`.
- **Slug table**: `npm run check:slugs` needs the four catalogue paths in `NOAA_TIDES`,
  `CHS_TIDES`, `NOAA_CURRENTS` and `CHS_GATES`.

## Releasing

Maintainers release only from a protected `vX.Y.Z` GitHub Release. `publish.yml` owns npm
publishing through OIDC trusted publishing; never add an npm token to the workflow.
