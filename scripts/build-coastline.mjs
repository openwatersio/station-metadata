/**
 * Clip a high-resolution coastline to the Salish Sea and write GeoJSON.
 *
 * Source: OSM land polygons (https://osmdata.openstreetmap.de/data/land-polygons.html),
 * ODbL, metre-resolution. Natural Earth 1:10m was measured and rejected: it
 * classifies the Anacortes inland point as water and Friday Harbor as land.
 *
 * Usage:
 *   1. download and unzip land-polygons-split-4326 from the URL above
 *   2. node scripts/build-coastline.mjs <path-to-shapefile-dir> data/coastline.geojson
 *
 * Requires `ogr2ogr` (GDAL) on PATH: brew install gdal
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRegistry } from "../src/registry.js";

const [, , sourceDir, output] = process.argv;
if (!sourceDir || !output) {
  console.error("usage: build-coastline.mjs <shapefile-dir> <output.geojson>");
  process.exit(1);
}

/**
 * The proven Salish Sea clip — Juan de Fuca through the Strait of Georgia.
 * `[minLon, minLat, maxLon, maxLat]`. This is a *floor*: the clip only ever
 * grows outward from it, never in. The NOAA stations consumers audit (Olympia
 * at 47.05°N down to the Strait) live inside it but are not in this repo's
 * data, so deriving the clip purely from the registry would silently shrink
 * the south and break their audit. The registry can only push the boundary
 * further out.
 */
const SALISH_SEA_FLOOR = [-125.5, 47.0, -122.0, 50.5];

/**
 * A margin around the outermost registry station, in degrees (~28 km here).
 * The on-land audit's nearest-water ring search reaches 20 km, so an edge
 * station that lands on a shore still has coastline around it to snap to.
 * ponytail: 0.25° is the knob — raise it if a northern gate ever wants a
 * suggestion the clip can't reach, lower it to trim bundle size.
 */
const REGISTRY_MARGIN_DEG = 0.25;

/**
 * Clip boxes = the Salish Sea floor plus a box around every registry position,
 * merged where they touch. Derived from the data so the clip cannot fall behind
 * the registry as it grows — the drift issue #9 was about.
 *
 * SEVERAL boxes, not one. A single grown bbox worked while every gate was in the
 * Salish Sea; once the registry went national it would ask for one rectangle from
 * Haida Gwaii to PEI — the whole southern half of the country, at metre
 * resolution, to cover a dozen passes. Disjoint boxes clip only the water people
 * actually transit, and `coverage` (below) tells the loader which rectangles the
 * answer is good in, so nothing claims coverage over the 3,000 km between them.
 */
function clipBoxes() {
  const registry = loadRegistry(
    readFileSync(fileURLToPath(new URL("../data/registry.yaml", import.meta.url)), "utf8"),
  );
  const boxes = [SALISH_SEA_FLOOR.slice()];
  for (const [, record] of registry) {
    if (!Array.isArray(record.position) || record.position.length !== 2) continue;
    const [lat, lon] = record.position;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    boxes.push([
      lon - REGISTRY_MARGIN_DEG,
      lat - REGISTRY_MARGIN_DEG,
      lon + REGISTRY_MARGIN_DEG,
      lat + REGISTRY_MARGIN_DEG,
    ]);
  }
  return mergeOverlapping(boxes);
}

/**
 * How close two boxes must come before they are clipped as one region, in
 * degrees. Not a cosmetic setting: it is what keeps a *coast* contiguous
 * instead of shipping a string of postage stamps with holes between the gates.
 *
 * 1.0° is calibrated, not picked — it is the smallest value that reproduces the
 * exact rectangle the single-bbox build shipped for the Salish Sea and the
 * northern BC gates, so this change costs no consumer any coverage it had. It is
 * also comfortably below the 1.27° that separates the north-coast gates, which
 * is what keeps them a region of their own rather than swallowing 300 km of
 * open water.
 *
 * ponytail: raise it if a future gate lands in a gap and wants its neighbours'
 * water; lower it to trim bundle size, and re-measure against the old clip.
 */
const MERGE_GAP_DEG = 1.0;

/**
 * Union boxes that overlap or come within `MERGE_GAP_DEG` into their bounding
 * box, repeatedly, until none do. Two gates 30 km apart share one clip instead
 * of paying for the overlap twice, and a chain of them (the Discovery Islands
 * up to Queen Charlotte Strait) collapses into a single region.
 *
 * ponytail: O(n²) per pass over a registry of tens of stations, run by hand
 * when the coastline is rebuilt. Sweep-line it if this ever holds thousands.
 */
function mergeOverlapping(boxes) {
  const g = MERGE_GAP_DEG;
  const touches = (a, b) =>
    a[0] - g <= b[2] && b[0] - g <= a[2] && a[1] - g <= b[3] && b[1] - g <= a[3];
  const merged = [];
  for (const box of boxes) {
    let grown = box;
    let hit = true;
    while (hit) {
      hit = false;
      for (let i = merged.length - 1; i >= 0; i--) {
        if (!touches(grown, merged[i])) continue;
        const other = merged.splice(i, 1)[0];
        grown = [
          Math.min(grown[0], other[0]),
          Math.min(grown[1], other[1]),
          Math.max(grown[2], other[2]),
          Math.max(grown[3], other[3]),
        ];
        hit = true;
      }
    }
    merged.push(grown);
  }
  return merged;
}

const BOXES = clipBoxes();
for (const b of BOXES) console.log(`clip box (registry-derived): ${b.map((n) => n.toFixed(4)).join(", ")}`);

/** The clip regions as one WKT MULTIPOLYGON — what `-clipsrc` takes. */
const clipWkt =
  "MULTIPOLYGON(" +
  BOXES.map(([w, s, e, n]) =>
    `((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`,
  ).join(",") +
  ")";

execFileSync(
  "ogr2ogr",
  [
    "-f", "GeoJSON",
    "-clipsrc", clipWkt,
    // Simplify to ~10 m. Enough to keep every island and inlet that matters,
    // small enough to ship. Do not raise this without re-running the golden points.
    "-simplify", "0.0001",
    output,
    sourceDir,
  ],
  { stdio: "inherit" },
);

// Record the clip regions in the file itself. The loader used to recover the
// covered rectangle by walking every coordinate, which is right for one box and
// wrong for several: the walk returns the rectangle *spanning* them, and would
// answer "covered" for the open Prairies. The build knows the real answer, so
// it writes it down.
const geojson = JSON.parse(readFileSync(output, "utf8"));
geojson.coverage = BOXES;
writeFileSync(output, JSON.stringify(geojson));

console.log(`wrote ${output} (${BOXES.length} clip region(s))`);
