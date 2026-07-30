# station-corrections

**Everything the agencies got wrong about tide and current stations, in one reviewable file.**

Published station data is a survey artifact, not a product. Names arrive shouting (`CHERRY POINT`)
or trailing qualifiers (`Swinomish Channel ent., Padilla Bay`). Many carry no context at all, so
a list of them reads half-broken. And some positions land on dry ground — the complaint that
dogs every marine app in these waters.

This package maps a station ID to what a person would actually say, plus a position that is
actually in the water.

```bash
npm install @sailingnaturali/station-corrections
```

```js
import { createBundledResolver } from "@sailingnaturali/station-corrections";

const resolve = createBundledResolver();

resolve({ id: "noaa/9447659", name: "Everett", latitude: 47.98, longitude: -122.223 });
// {
//   name: "Everett",
//   context: "Port Gardner",     ← curated; the published data has none
//   slug: "everett",
//   cities: ["Everett", "Marysville"],
//   aliases: ["everett", "port gardner", "everett marina"],
//   latitude: 47.98, longitude: -122.223,
//   corrected: false, derived: false,
// }
```

It is provider-agnostic: `noaa/9447659`, `chs-active-pass` and `PUG1717` all resolve through the
same overlay, so tides, currents and both countries share one vocabulary.

TypeScript declarations ship with the package — no ambient declaration needed.

**Runs in the browser.** `createBundledResolver` imports its data as JSON rather than reading
files, so it needs no filesystem and works unchanged in a bundle. It weighs about 7 KB bundled;
the `yaml` parser tree-shakes away unless you call `loadCorrections` yourself.

To resolve against your own corrections or gazetteer instead of the bundled ones, use
`createResolver({ corrections, gazetteer })` directly with `loadCorrections`. Advanced consumers
that need the raw shipped files can reach them via the `./data/*` export subpath, e.g.
`import("@sailingnaturali/station-corrections/data/corrections.yaml")` with an import attribute,
or `createRequire(import.meta.url).resolve(...)` to get a filesystem path.

Checking that a corrected `position` actually lands in water (`validatePositions`) is exposed the
same opt-in way, via `import { validatePositions } from "@sailingnaturali/station-corrections/validate-positions"`
— it is not re-exported from the package root because it pulls in the 3.6 MB coastline parse, and
the root import must stay cheap. A consumer validating their own corrections file, the same way the
CLI's `validate` command does, imports this subpath directly.

## Four tiers

Every lookup resolves highest-first:

1. **Registry** — `data/registry.yaml`. Stations whose identity this package owns rather than
   corrects, because there is no upstream to correct. Resolves from an id alone.
2. **Curated override** — anything in `data/corrections.yaml` wins over provider data.
3. **Derived fallback** — nearest place from the bundled gazetteer, so context is never empty.
   Flagged `derived: true`.
4. **Source data** — the provider's own name, cleaned.

Cleaning only re-cases names that are **entirely** upper case. Mixed-case names were typed by a
human and may carry capitalisation we cannot reconstruct — `Spee-Bi-Dah`, `La Push`, `McArthur`
pass through untouched. Abbreviations that read badly are expanded: `NAS` → Naval Air Station,
`ent.` → Entrance, `St. Park` → State Park.

## The corrections file

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
| `name` / `context` | The two-line display. Context is whatever most usefully distinguishes the place — a water body, island group, region, county, or characteristic. |
| `slug` | Canonical URL segment. Lives here so a name fix and its URL move together. |
| `cities` | Nearest settlements, for search. Not for display. |
| `aliases` | What someone might type. Local names, former names, misspellings. |
| `formerSlugs` | Slugs this station used to resolve to. A slug is an API — this is how a consumer builds a redirect map for links shared under the old one. See [Pinning slugs with a lock](#pinning-slugs-with-a-lock). |
| `position` | A corrected `[lat, lon]`. Requires `reason`. |
| `positionVerified` | A reason the published position is *right* despite reading inland. Mutually exclusive with `position`. Passed straight through to the resolved object when set, and omitted from it otherwise. |

**Context must never restate the name.** `Everett · Everett` is what a nearest-town derivation
produces at a station named for its town, and it tells the reader nothing. Validation rejects a
context containing the full station name as a whole-word phrase, so `Everett Harbor` and
`Port of Everett` are refused — while `Port Townsend` / `Port Angeles`, different places sharing
a word, passes.

## The registry

Some stations have no upstream record to correct. CHS tidal-current gates are the case this was
built for: the fitting pipeline emits a hand-written label and no position at all, so there is
nothing to overlay onto — the record here *is* the station.

```yaml
chs-dodd-narrows:
  name: Dodd Narrows
  context: Nanaimo
  position: [49.1344, -123.8171]
  provider: chs
```

The registry holds **two bounded, hand-curated classes**, told apart by `kind`:

- **Current gates** (`kind: current`, or omitted — the registry was gates-only first). A current
  station joins when *safe transit requires timing slack* — the gates on the Inside Passage route,
  not every interesting current.
- **Tide reference ports** (`kind: tide`). A tide station joins when *CHS itself designates it a
  reference port* — an external rule we did not invent, and one that keeps a hand-written list
  small enough to stay honest rather than becoming a mirror of CHS's whole station table.

Both rules are expansion-friendly and rule-governed; neither is a cap. A consumer reads `kind` to
pick the right CHS series (currents vs tides) when resolving a station to live data. `kind` is the
only field that differs by class — everything else is the same shape.

**Pairing a gate to a tide port.** A current gate can name a `tideReference` — the registry key of
the tide reference port whose water a paired tide+current view shows beside it (say
`chs-seymour-narrows` → `chs-campbell-river`). It is the *nearest* reference port in the same tidal
regime, and it is **optional**: a gate with no honestly-near port stays unpaired and a consumer
shows currents alone. A gate CHS publishes no current station for instead carries a `derived`
block — `reference` (the tide port) plus `hwLagMinutes` / `lwLagMinutes` — and reads its slack from
that port's high and low water. The two are mutually exclusive; a tide port carries neither.
`resolve()` surfaces the effective reference (explicit or derived) as `tideReference` on the
resolved record, so the paired view reads one field. See [PROVENANCE.md](PROVENANCE.md) for how a
pairing is sourced.

The registry ships **no provider-minted identifier.** The key, `chs-dodd-narrows`, is the public
id — stable and safe in a URL. Joining this record to a provider's live data (a CHS gate's
current fitting, say) is done by **name**, and the provider's own opaque handle is resolved at
runtime by whoever holds a licence to that provider's API; it is never redistributed here. See
[PROVENANCE.md](PROVENANCE.md) for why. A station may not appear in both files — two sources of
authority for one station is the bug, not a feature — and slugs must be unique across both,
because URLs share one namespace. `formerSlugs` (see the corrections table above) is valid here
too, for the same reason: both files feed the one slug namespace a consumer routes on.

A corrected `position` is checked for plausible distance from what the provider published; a
registry position is not, because it *is* the published value. That absence is deliberate.

**Coverage.** The bundled coastline clip is derived from the registry's own extent (see
[Finding stations that are on land](#finding-stations-that-are-on-land)), so every registry
position sits within it — the northern gates (Blackney, Johnstone Strait, Weynton) that once fell
outside the Salish Sea box are now covered. A registry station outside coverage is a `validate`
**failure**, not a note: the package owns its position, so one the on-land audit can never reach
is a claim it cannot back.

## Finding stations that are on land

```bash
npx station-corrections audit stations.json
npx station-corrections validate [stations.json]
```

The audit tests every resolved position against a bundled coastline and reports those more than
**200 m** inland, with a suggested nearest-water point. It reports and suggests; **it never
edits.** Nearest water is frequently the wrong side of a spit or the wrong bay, so a human picks
the real spot and writes the reason.

That threshold is not arbitrary. Two categories read as inland and are perfectly correct:

- **Pier-mounted gauges.** Almost all of them — you need a structure over water. A chart-derived
  coastline draws the pier as land. The Friday Harbor gauge measures 31 m inland and is right.
- **Riverine stations.** The coastline product maps the *ocean*, so a gauge up a river reads
  inland by construction.

A genuinely misplaced station is hundreds of metres out. 200 m sits in the gap. Known-good cases
get a `positionVerified` reason and the audit stops reporting them — an audit that never reaches
zero is one nobody reads.

A station outside the clipped coastline (see Coverage, above) is not in the ashore count either
way: there is no land data to check it against, so it is not silently read as clear. `audit`
prints a separate `N station(s) outside coastline coverage - not checked` line for these.

## A decommissioned gauge is still a station

Most Salish Sea stations we correct read as `removed` in NOAA's metadata — 32 of the 41 NOAA
stations audited here. That flag means the physical water-level **gauge** was pulled, not that the
station is gone: NOAA still publishes harmonic tide predictions for every one of them, which is
exactly why a prediction app bundles them. `removed` is the normal state of a subordinate station,
not a reason to drop or flag it. This package carries no decommissioned/operational field for that
reason — it would mislabel the majority of the corpus while distinguishing nothing a consumer can
act on. The only stations that ever needed attention were the two whose *position* couldn't be
placed (issue #1), and that is a placement problem, resolved in the corrections file.

## Pinning results with a lock

```bash
npx station-corrections lock stations.json    # writes data/audit.lock.json
npx station-corrections check stations.json   # exit 1 if a station has moved since the lock
```

`lock` pins every station's *resolved* position and audit verdict (`clear`, `verified`, or
`ashore`) against the bundled coastline. The point isn't speed — it's change detection: NOAA can
silently move a gauge, and without a lock that only shows up as a surprise months later. With one
committed, `check` (the CI guard) turns it into a line in a diff the moment it happens. Because
the lock pins the *resolved* position, a human editing `corrections.yaml` shows up as "moved"
too — that's a data change worth reviewing, not a false alarm. `audit` reuses a pinned verdict
for any station whose resolved position and the lock's coastline/threshold all still match,
reporting how many were cached versus freshly checked.

## Pinning slugs with a lock

```bash
npx station-corrections slugs        # writes data/slugs.lock.json
npx station-corrections check-slugs  # exit 1 if a slug moved without being recorded
```

A slug is an API: it goes straight into a shareable URL (`slackwater-web` routes `/tide/<slug>`),
so changing one silently is a breaking change shipped as a patch. `data/slugs.lock.json` pins the
current slug per station; CI cannot tell a slug *changed* without knowing the previous value.
`check-slugs` fails when a station's slug differs from the lock and the old value is not in that
station's `formerSlugs` — and separately, `validate` already rejects a new slug that collides with
another station's current slug **or** its `formerSlugs` (a recycled slug would silently redirect
old links to the wrong station, worse than a 404), plus a malformed `formerSlugs` entry. Move a
slug and record its old value in `formerSlugs` in the same change, then regenerate the lock.

One judgment no check can make: only record a former slug when the new slug points at the **same
place**. A genuine rename qualifies; a mislabel does not — redirecting a mislabelled slug preserves
a wrong link, where a 404 is the more honest outcome (this is why the `anacortes` slug was retired
without one). Slug changes are rare, and a downstream consumer owns the redirect either way.

## Contributing a correction

Edit `data/corrections.yaml`, then run `npm run build:data` — the YAML is the source of truth,
and `data/corrections.json` is a committed artifact compiled from it so browsers can import the
data without a filesystem. CI fails if the two are out of step.

Corrections are pull requests, and CI checks them mechanically: schema validity, `reason`
present whenever `position` is, unique slugs (current and former), no context that restates its
name, that a corrected `position` actually lands in water against the bundled coastline, and
(`check-slugs`) that a moved slug was recorded in `formerSlugs`.

Pass a stations file — `station-corrections validate stations.json` — and one more check runs:
that a corrected position is within **5 km** of the one the provider published. A correction is
a fix, not a relocation; the gauge is where it is, and what is wrong is the coordinate written
down for it. This one needs the published station list, which the corrections file deliberately
does not duplicate (a copy of upstream data drifts the moment upstream moves), so it only runs
when a caller supplies it.

If a station looks wrong in an app built on this, a one-line PR fixes it for everyone.

## Data and licences

- **Coastline** — [OSM land polygons](https://osmdata.openstreetmap.de/data/land-polygons.html),
  ODbL, clipped to the Salish Sea. Natural Earth 1:10m was measured and rejected: it reads the
  Anacortes area as water and Friday Harbor as land, generalising the San Juans away entirely.
- **Corrections and gazetteer** — hand-written here, MIT with the package.
- **Station identity** (names, contexts, positions) — our own facts, independently
  obtained and human-reviewed, not a copy of any provider's station file. No provider-minted
  identifier ships at all. Field-by-field provenance and the reasoning are in
  [PROVENANCE.md](PROVENANCE.md).

Rebuild the coastline with `node scripts/build-coastline.mjs <shapefile-dir> data/coastline.geojson`
(needs GDAL). The golden-point tests in `src/coastline.test.js` are the acceptance criterion for
the data — if one fails, fix the data, not the test.

## Develop

```bash
npm install
npm test           # node --test, then tsc over the shipped declarations
npm run build:data # recompile data/corrections.json after editing the YAML
```

---

MIT. Part of [Sailing Naturali](https://sailingnaturali.com).
