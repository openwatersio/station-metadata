import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";

const coastline = JSON.parse(
  readFileSync(fileURLToPath(new URL("../data/coastline.geojson", import.meta.url)), "utf8"),
);

// One bbox per feature, computed once, so isOnLand's scan of ~11k features is
// four comparisons each and the ring walk (and turf's per-call setup) only
// runs for the handful of features a probe could actually be inside (#2).
// ponytail: a flat bbox scan, not a spatial index; add flatbush if this shows
// up again once the coastline grows past ~100k features.
for (const feature of coastline.features) feature.bbox = bboxOf(feature.geometry.coordinates);

/** [minLon, minLat, maxLon, maxLat] of any GeoJSON coordinate nesting, extending `box` if given. */
function bboxOf(coords, box = [Infinity, Infinity, -Infinity, -Infinity]) {
  if (typeof coords[0] === "number") {
    const [lon, lat] = coords;
    if (lon < box[0]) box[0] = lon;
    if (lat < box[1]) box[1] = lat;
    if (lon > box[2]) box[2] = lon;
    if (lat > box[3]) box[3] = lat;
    return box;
  }
  for (const part of coords) bboxOf(part, box);
  return box;
}

/** Is this position on land? */
export function isOnLand(lat, lon) {
  const at = point([lon, lat]);
  return coastline.features.some((feature) => {
    const [minLon, minLat, maxLon, maxLat] = feature.bbox;
    return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat &&
      booleanPointInPolygon(at, feature);
  });
}

let bounds = null;
let regions = null;

/**
 * The rectangles the bundled coastline actually covers — one per clip region.
 *
 * The build writes them into the file (`coverage`), because it is the only
 * thing that knows them: the clip is several disjoint boxes now that the
 * registry spans the country, and no walk over the coordinates can tell a
 * gap between two regions from water inside one.
 *
 * Falls back to the coordinate extent for a coastline built before `coverage`
 * existed — correct there, since that build clipped to exactly one box.
 */
export function coverageRegions() {
  if (regions) return regions;
  regions = Array.isArray(coastline.coverage) && coastline.coverage.length
    ? coastline.coverage.map(([minLon, minLat, maxLon, maxLat]) => ({
        minLat, maxLat, minLon, maxLon,
      }))
    : [computedExtent()];
  return regions;
}

function computedExtent() {
  const [minLon, minLat, maxLon, maxLat] = coastline.features.reduce(
    (box, feature) => bboxOf(feature.geometry.coordinates, box),
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  return { minLat, maxLat, minLon, maxLon };
}

/**
 * The single rectangle enclosing every covered region.
 *
 * Only honest as an *outer* limit: with disjoint regions, a position inside
 * these bounds may still be somewhere the coastline cannot answer for. Ask
 * `isWithinCoverage` whether a position is covered — never this.
 * Computed once on first use.
 */
export function coverageBounds() {
  if (bounds) return bounds;
  const all = coverageRegions();
  bounds = {
    minLat: Math.min(...all.map((r) => r.minLat)),
    maxLat: Math.max(...all.map((r) => r.maxLat)),
    minLon: Math.min(...all.map((r) => r.minLon)),
    maxLon: Math.max(...all.map((r) => r.maxLon)),
  };
  return bounds;
}

/**
 * Is this position somewhere the coastline can actually answer for?
 *
 * Outside the clip there are no land polygons, so `isOnLand` returns false
 * and `inlandMetres` returns 0 - indistinguishable from verified open water.
 * Every caller that treats "not on land" as "in water" must check this first,
 * or it is reporting a result it never computed.
 */
export function isWithinCoverage(lat, lon) {
  return coverageRegions().some(
    (r) => lat >= r.minLat && lat <= r.maxLat && lon >= r.minLon && lon <= r.maxLon,
  );
}

const EARTH_M = 6_371_000;

function metresBetween(aLat, aLon, bLat, bLon) {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return EARTH_M * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Expanding ring search for the nearest water point, starting at a fine
 * radius so short distances (a gauge a few metres up a pier) are measured
 * accurately rather than snapping to the first ring's radius.
 *
 * Deliberately coarse beyond that: this only ever produces a *suggestion*
 * for a human to check, because nearest water is frequently the wrong side
 * of a spit or the wrong bay entirely.
 */
function ringSearchWater(lat, lon) {
  for (let radiusM = 5; radiusM <= 20_000; radiusM *= 1.3) {
    const dLat = (radiusM / EARTH_M) * (180 / Math.PI);
    const dLon = dLat / Math.cos((lat * Math.PI) / 180);
    for (let bearing = 0; bearing < 360; bearing += 10) {
      const rad = (bearing * Math.PI) / 180;
      const testLat = lat + dLat * Math.cos(rad);
      const testLon = lon + dLon * Math.sin(rad);
      if (!isOnLand(testLat, testLon)) {
        return {
          latitude: testLat,
          longitude: testLon,
          metres: Math.round(metresBetween(lat, lon, testLat, testLon)),
        };
      }
    }
  }
  return null;
}

/** Nearest water to a position. */
export function nearestWater(lat, lon) {
  if (!isOnLand(lat, lon)) return { latitude: lat, longitude: lon, metres: 0 };

  const found = ringSearchWater(lat, lon);
  if (!found) throw new Error(`no water within 20 km of ${lat}, ${lon}`);
  return {
    latitude: Number(found.latitude.toFixed(4)),
    longitude: Number(found.longitude.toFixed(4)),
    metres: found.metres,
  };
}

/** Distance inland in metres: 0 in water, Infinity when no water is found within the search radius, otherwise distance to nearest water. */
export function inlandMetres(lat, lon) {
  if (!isOnLand(lat, lon)) return 0;
  const found = ringSearchWater(lat, lon);
  // ponytail: unlike nearestWater (which must throw - its callers need an answer),
  // inlandMetres promises "always a number" so a batch audit survives one bad row.
  return found ? found.metres : Infinity;
}
