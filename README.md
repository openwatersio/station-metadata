# Station Metadata

**Names, positions and stable URLs for tide and current stations, corrected by the people who
sail past them.**

## The problem

Tide and current predictions come from NOAA, CHS and other agencies, each with its own station
table. Those tables were written for the agency, not for a sailor's screen:

- Names are ALL CAPS, abbreviated (`NAS`, `ent.`), or simply wrong.
- A station is "Everett" with nothing to say which water it sits on.
- Some positions land hundreds of metres inland, in a parking lot.
- Distances mix statute and nautical miles inside one dataset.
- Some stations, like the CHS current gates on the Inside Passage, have no published record at
  all.
- Nothing gives a station a stable URL, so a link shared today breaks when a name changes.

Every app patches these on its own, and the patches never reach the next app.

## What this does

One shared overlay that every app can resolve through. Give it a provider's station and it
returns a readable name, the water it sits on, a stable slug, search aliases and a reviewed
position:

```bash
npm install @openwaters/station-metadata
```

```js
import { createBundledResolver } from "@openwaters/station-metadata";

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
same overlay, so tides, currents and both countries share one vocabulary. A fix made here reaches
every app built on it.

## Something wrong near you?

If a station in an app built on this (such as [Slackwater](https://slackwater.xyz)) has the wrong
name, sits on the wrong side of the harbour, can't be found by the name locals use, or is missing
altogether:

**[Report it here.](https://github.com/openwatersio/station-metadata/issues/new?template=station.yml)**

Tell us which station, what's wrong, and what it should be. You don't need to know how this
package works or read anything below. A maintainer turns the report into a correction, and the
fix ships to every app at once.

If you'd rather fix it yourself, most corrections are a few lines in `data/corrections.yaml` and
[CONTRIBUTING.md](CONTRIBUTING.md) walks through the file and the checks.

## Using it in an app

Every lookup resolves highest-first through four tiers:

1. **Registry** (`data/registry.yaml`): stations this package owns because there is no upstream
   record to correct. Resolves from an id alone.
2. **Curated override** (`data/corrections.yaml`): wins over provider data.
3. **Derived fallback**: nearest town, flagged `derived: true`, rendered `Nanaimo, BC`. Nothing
   is offered past `DERIVED_MAX_KM`, so a station in empty water gets an empty context rather than
   a town 90 km away.
4. **Source data**: the provider's own name, cleaned. Only ALL-CAPS words are re-cased; distances
   are restated in nautical miles.

**Runs in the browser.** `createBundledResolver` imports its data as JSON, so it needs no
filesystem and works unchanged in a bundle: about 7 KB for corrections, gazetteer and registry,
plus the published slug table (`data/slugs.json`, ~55 KB gzipped). The `yaml` parser tree-shakes
away unless you call `loadCorrections` yourself. For national town coverage pass the ~890 KB
`data/places.json` to `createPlacesResolver`; it belongs in a build step, not a browser bundle.

**Current gates.** Use `currentGates()` to select the registry entries you can fetch a live current
series for, rather than filtering the registry by hand. It keeps tide ports and derived gates out
of a request for current data:

```js
import { currentGates } from "@openwaters/station-metadata";

for (const [id, station] of currentGates({ provider: "chs" })) { /* fetch a live series */ }
```

**Slugs are an API.** A slug goes straight into a shareable URL and never moves. When a station is
legitimately renamed, its old slug is recorded in `formerSlugs`, which is how a consumer builds a
redirect map.

**Checking positions.** The CLI audits a stations file against a bundled coastline and reports
stations more than 200 m inland with a suggested nearest-water point. It reports; it never edits.

```bash
npx station-metadata audit stations.json
npx station-metadata validate stations.json
```

The coastline parse is 8 MB and stays behind the opt-in
`@openwaters/station-metadata/validate-positions` subpath so the root import stays cheap. The raw
shipped files are reachable via the `./data/*` export subpath. Full signatures are in
[`index.d.ts`](index.d.ts).

## Data and licences

- **Coastline**: [OSM land polygons](https://osmdata.openstreetmap.de/data/land-polygons.html),
  ODbL, clipped to the station coverage regions.
- **Places** (`data/places.json`): derived from [GeoNames](https://www.geonames.org/) cities500,
  **CC BY 4.0**. Attribution for this and the coastline is in [NOTICE](NOTICE).
- **Corrections, registry and gazetteer**: hand-written here, MIT with the package.
- **Station identity** (names, contexts, positions): our own facts, independently obtained and
  human-reviewed, not a copy of any provider's station file. No provider-minted identifier ships
  at all. Field-by-field provenance is in [PROVENANCE.md](PROVENANCE.md).

---

MIT. Part of [Open Waters](https://openwaters.io). To change the data or the code, see
[CONTRIBUTING.md](CONTRIBUTING.md).
