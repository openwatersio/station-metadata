import { cleanName } from "./clean.js";
import { toSlug } from "./slug.js";
import { namesOverlap } from "./names.js";
import { distanceKm } from "./distance.js";

/**
 * Split a cleaned name on NOAA's comma-qualifier convention: "Friday Harbor,
 * San Juan Island" is the place, then where it is. Later segments (Bremerton
 * often carries two) join with a middot rather than being discarded.
 *
 * "Puget Sound" is dropped rather than kept as context - it is true of nearly
 * everything this package covers and tells a local nothing.
 */
function splitQualifier(cleaned) {
  const [primary, ...rest] = cleaned.split(",").map((part) => part.trim());
  const context = rest
    .filter(Boolean)
    .filter((part) => part.toLowerCase() !== "puget sound")
    .join(" · ");
  return { primary, context };
}

/**
 * Build a resolver over a corrections map and a gazetteer.
 *
 * Resolution order, highest first:
 *   0. registry — a station this package owns resolves fully from its id
 *      alone; provider data on the incoming station is ignored outright
 *   1. curated override — anything in the corrections file wins
 *   2. source data — the provider's own name, cleaned and, if it carries a
 *      comma qualifier, split into a name and a context
 *   3. derived fallback — nearest gazetteer place, so context is never empty
 */
export function createResolver({ corrections = new Map(), gazetteer = [], registry = new Map() } = {}) {
  return function resolve(station) {
    const owned = registry.get(station.id);
    if (owned) return resolveOwned(station.id, owned);

    const override = corrections.get(station.id) ?? {};
    const split = splitQualifier(cleanName(station.name));
    const name = override.name ?? split.primary;
    const slug = override.slug ?? toSlug(name);

    // A context that restates the name tells the reader nothing - true whether
    // it comes from the raw name's own qualifier or from a nearest-town
    // derivation. Same rule validateCorrections applies to a human-written
    // context, so "Everett Marina" suppresses "near Everett, WA" too, not just
    // an exact match.
    let context = override.context ?? "";
    let derived = false;
    if (!context && split.context && !namesOverlap(name, split.context)) {
      context = split.context;
    }
    if (!context) {
      const nearest = nearestPlace(station, gazetteer);
      if (nearest && !namesOverlap(name, nearest.name)) {
        context = `near ${nearest.name}, ${nearest.region}`;
        derived = true;
      }
    }

    const position = override.position ?? [station.latitude, station.longitude];

    const aliases = new Set([
      name.toLowerCase(),
      slug,
      ...(override.aliases ?? []).filter((a) => typeof a === "string").map((a) => a.toLowerCase()),
    ]);

    const result = {
      id: station.id,
      name,
      context,
      slug,
      cities: override.cities ?? [],
      aliases: [...aliases],
      latitude: position[0],
      longitude: position[1],
      corrected: Boolean(override.position),
      derived,
      formerSlugs: override.formerSlugs ?? [],
    };
    // Only present when the correction sets it - an always-there
    // `positionVerified: undefined` key is an output no one asked for.
    if (override.positionVerified !== undefined) result.positionVerified = override.positionVerified;
    return result;
  };
}

/**
 * Resolve a station the registry owns.
 *
 * Returns the same shape as the overlay path so consumers see one type.
 * `corrected` and `derived` are both false and both accurate: nothing was
 * corrected, because there is no published value to correct, and the context
 * was curated rather than derived from the gazetteer.
 *
 * Provider data on the incoming station is ignored outright - if the registry
 * owns a station, it is the authority, and quietly preferring a caller's name
 * would reintroduce exactly the ambiguity the registry exists to remove.
 *
 * `createResolver` is public API and accepts a caller-supplied registry, so a
 * malformed `position` here is a trust-boundary problem, not an internal bug:
 * throw a clear, actionable error rather than a raw TypeError from indexing
 * `undefined`, and rather than silently substituting a fallback position - a
 * registry station with no position is a real error to fix, not paper over.
 */
function resolveOwned(id, owned) {
  const position = owned.position;
  if (!Array.isArray(position) || typeof position[0] !== "number" || typeof position[1] !== "number") {
    throw new Error(`registry station "${id}" has no valid position - run validateRegistry before resolving`);
  }

  const name = owned.name;
  const slug = owned.slug ?? toSlug(name);
  const aliases = new Set([
    name.toLowerCase(),
    slug,
    ...(owned.aliases ?? []).filter((a) => typeof a === "string").map((a) => a.toLowerCase()),
  ]);
  const result = {
    id,
    name,
    context: owned.context ?? "",
    slug,
    cities: owned.cities ?? [],
    aliases: [...aliases],
    latitude: position[0],
    longitude: position[1],
    corrected: false,
    derived: false,
    formerSlugs: owned.formerSlugs ?? [],
    // The registry was currents-only until tide reference ports arrived, so an
    // entry with no `kind` is a current gate. Defaulting here (not in the data)
    // keeps the 19 existing entries untouched while the resolved record always
    // carries an explicit kind for a consumer to filter on.
    kind: owned.kind === "tide" ? "tide" : "current",
  };
  // The effective reference tide port for a paired tide+current view: a gate's
  // explicit `tideReference`, or - for a gate CHS publishes no current station
  // for - its `derived.reference`. One field so the consumer reads one thing;
  // the raw distinction (proximity pairing vs slack derivation) stays in the
  // registry for the slack path. Conditionally present, like positionVerified:
  // a tide port and a genuinely unpaired gate carry none.
  const tideReference = owned.tideReference ?? owned.derived?.reference;
  if (tideReference !== undefined) result.tideReference = tideReference;
  return result;
}

function nearestPlace(station, gazetteer) {
  let best = null;
  let bestKm = Infinity;
  for (const place of gazetteer) {
    const km = distanceKm(station.latitude, station.longitude, place.latitude, place.longitude);
    if (km < bestKm) {
      bestKm = km;
      best = place;
    }
  }
  return best;
}
