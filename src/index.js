import { createResolver } from "./resolve.js";
import corrections from "../data/corrections.json" with { type: "json" };
import gazetteer from "../data/gazetteer.json" with { type: "json" };
import registry from "../data/registry.json" with { type: "json" };

export { createResolver, DERIVED_MAX_KM, RECOGNITION_KM } from "./resolve.js";
export {
  loadCorrections,
  validateCorrections,
  validateAgainstStations,
  MAX_CORRECTION_KM,
} from "./corrections.js";
export { allocateSlugs } from "./allocate.js";
export { cleanName } from "./clean.js";
export { toSlug } from "./slug.js";
export { buildLock, readLock, diffLock } from "./lock.js";
export { currentGates, loadRegistry, validateRegistry } from "./registry.js";
export { departures, DEPARTURE_LIMIT } from "./catalogue.js";
export { buildSlugTable, emptyTable, readSlugTable, checkSlugTable } from "./slug-table.js";

/**
 * Build a resolver over the corrections and gazetteer this package ships.
 *
 * The data arrives as JSON import attributes rather than `readFileSync`, so
 * this module reaches no Node builtin and works unchanged in a browser
 * bundle. It used to read the files off disk; in a bundler `node:url` gets
 * externalized to a stub and the first call threw `fileURLToPath is not a
 * function`, blanking the consuming app with nothing pointing back here.
 * `src/browser-safe.test.js` fails if a Node builtin becomes reachable again.
 *
 * `data/corrections.json` is compiled from the YAML for exactly this reason —
 * a browser cannot read a file off disk, and every runtime can import JSON.
 * See `scripts/build-data.mjs`.
 *
 * All three files are a few KB and load eagerly with this module. The data kept
 * deliberately out of reach is the 3.6 MB coastline, which lives behind
 * ./audit.js and ./validate-positions.js and is never imported from here.
 */
export function createBundledResolver() {
  return createResolver({
    corrections: new Map(Object.entries(corrections)),
    registry: new Map(Object.entries(registry)),
    gazetteer,
  });
}

/**
 * The same resolver, deriving contexts from the national `data/places.json`
 * instead of the 19-town gazetteer — "~Nanaimo, BC" where the bundled resolver
 * has nothing to say.
 *
 * The places list is a PARAMETER, not an import, and that is the whole point.
 * At ~890 KB it is the second thing after the coastline that must not load
 * eagerly with this module: `createBundledResolver` is called at runtime in a
 * browser (slackwater-web's src/tides.ts), whose entry bundle is 580 KB, and
 * importing places here would nearly triple it for an offline-first PWA's
 * first paint. Consumers that want national contexts are build-time
 * generators, and they can afford to read the file:
 *
 *     import places from "@openwaters/station-metadata/data/places.json" with { type: "json" };
 *     const resolve = createPlacesResolver(places);
 *
 * Corrections and the registry still win over a derived context, exactly as
 * they do in `createBundledResolver` — this changes the bottom tier only.
 */
export function createPlacesResolver(places) {
  return createResolver({
    corrections: new Map(Object.entries(corrections)),
    registry: new Map(Object.entries(registry)),
    gazetteer: places,
  });
}
