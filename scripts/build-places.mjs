/**
 * Build data/places.json — the national place list the derived-context tier
 * labels stations from ("~Nanaimo, BC").
 *
 * Sources, both downloaded here and neither redistributed whole:
 *   - GeoNames cities500 (https://download.geonames.org/export/dump/), CC BY 4.0.
 *     Attribution is recorded in PROVENANCE.md and NOTICE.
 *   - Natural Earth 1:10m coastline + lakes (public domain), used ONLY as a
 *     filter — no Natural Earth geometry reaches the output.
 *
 * This is NOT data/gazetteer.json. That file is 19 hand-curated Salish towns
 * answering "where is the *user*", where a name is a stable key for a saved
 * choice. This one answers "what do we call the water this *station* is in",
 * wants exhaustive coverage, and its names are labels nobody stores.
 *
 * Usage:
 *   node scripts/build-places.mjs [output.json]
 *
 * Requires `unzip` on PATH (macOS and every CI image ship it).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const output = process.argv[2] ?? join(here, "..", "data", "places.json");
const cache = join(here, "..", ".cache");

const CITIES = "https://download.geonames.org/export/dump/cities500.zip";
const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const WATER = [`${NE}/ne_10m_coastline.geojson`, `${NE}/ne_10m_lakes.geojson`];

/**
 * The countries NOAA and CHS publish stations in. A place outside them can
 * never be the answer for a station in this package's world, and carrying it
 * would triple the file for nothing.
 */
const COUNTRIES = new Set(["US", "CA", "PR", "VI", "GU", "AS", "MP"]);

/**
 * GeoNames admin1 for Canada is a numeric code; for the US it is already the
 * two-letter state. The territories have no useful admin1 and their country
 * code IS the postal abbreviation, so they stand in for themselves.
 */
const CA_PROVINCE = {
  "01": "AB", "02": "BC", "03": "MB", "04": "NB", "05": "NL", "07": "NS",
  "08": "ON", "09": "PE", "10": "QC", "11": "SK", "12": "YT", "13": "NT",
  "14": "NU",
};

/**
 * Feature codes that name a place a person would recognise. The exclusions
 * carry the weight: PPLX is a *section* of a city ("Burnside-Gorge"), and
 * labelling a Victoria gauge with a neighbourhood is the failure this filter
 * exists to prevent. PPLQ/PPLW/PPLH are abandoned, destroyed and historical —
 * a chart label pointing at a town that is gone is worse than no label.
 */
const KEEP = new Set(["PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5", "PPLC", "PPLG"]);

/**
 * Water-proximity filter, in whole degrees-of-a-quarter. A place is kept when
 * its own 0.25° cell or any cell within WATER_RINGS of it holds a coastline or
 * lakeshore vertex — roughly "within 55 km of water".
 *
 * It has to exceed DERIVED_MAX_KM (40) in resolve.js, not merely match it: the
 * nearest place to a coastal station can itself sit inland, and a filter tuned
 * exactly to the cap would drop the legitimate answer for a station on a long
 * inlet. Lakes are in the union because the St. Lawrence and the Great Lakes
 * carry 267 of the CHS stations this labels — but only the biggest lakes
 * (Natural Earth scalerank 0–1: the Great Lakes, Winnipeg, Great Slave, Great
 * Bear). Every lake in the file put a gauge-less pond town in New Jersey and
 * Michigan into the output and added 400 KB to a file every consumer imports.
 */
const CELL = 0.25;
const WATER_RINGS = 2;
const LAKE_MAX_SCALERANK = 1;

function download(url, file) {
  const path = join(cache, file);
  if (existsSync(path)) return path;
  mkdirSync(cache, { recursive: true });
  console.log(`fetching ${url}`);
  execFileSync("curl", ["-sSfL", "-o", path, url]);
  return path;
}

/** Every 0.25° cell holding a coastline or lakeshore vertex. */
function waterCells() {
  const cells = new Set();
  const add = (coords) => {
    // Point / LineString / Polygon / Multi* all bottom out in [lon, lat] pairs.
    if (typeof coords[0] === "number") {
      cells.add(`${Math.floor(coords[1] / CELL)},${Math.floor(coords[0] / CELL)}`);
      return;
    }
    for (const part of coords) add(part);
  };
  for (const url of WATER) {
    const file = download(url, url.split("/").pop());
    for (const feature of JSON.parse(readFileSync(file, "utf8")).features) {
      const { scalerank } = feature.properties ?? {};
      // Coastline features carry no scalerank worth filtering on; lakes do.
      if (url.includes("lakes") && (scalerank ?? 99) > LAKE_MAX_SCALERANK) continue;
      add(feature.geometry.coordinates);
    }
  }
  return cells;
}

function nearWater(cells, latitude, longitude) {
  const i = Math.floor(latitude / CELL);
  const j = Math.floor(longitude / CELL);
  for (let di = -WATER_RINGS; di <= WATER_RINGS; di += 1) {
    for (let dj = -WATER_RINGS; dj <= WATER_RINGS; dj += 1) {
      if (cells.has(`${i + di},${j + dj}`)) return true;
    }
  }
  return false;
}

const zip = download(CITIES, "cities500.zip");
const rows = execFileSync("unzip", ["-p", zip, "cities500.txt"], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
}).split("\n");

const cells = waterCells();
console.log(`${cells.size} water cells`);

const places = [];
for (const row of rows) {
  if (!row) continue;
  // GeoNames dump columns: name(1) lat(4) lon(5) featureCode(7) country(8)
  // admin1(10) population(14).
  const f = row.split("\t");
  if (!KEEP.has(f[7]) || !COUNTRIES.has(f[8])) continue;
  const region = f[8] === "CA" ? CA_PROVINCE[f[10]]
    : f[8] === "US" ? (/^[A-Z]{2}$/.test(f[10]) ? f[10] : null)
    : f[8];
  if (!region) continue;
  const latitude = Number(f[4]);
  const longitude = Number(f[5]);
  if (!nearWater(cells, latitude, longitude)) continue;
  places.push({
    name: f[1],
    region,
    // 4 decimals is ~11 m — far finer than a town's own centre is meaningful
    // to, and it takes ~100 KB off the file every consumer imports.
    latitude: Number(latitude.toFixed(4)),
    longitude: Number(longitude.toFixed(4)),
    population: Number(f[14]) || 0,
  });
}

// Sorted so a rebuild that finds the same places produces the same bytes, and
// a diff shows what actually changed upstream.
places.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1
  : a.region < b.region ? -1 : a.region > b.region ? 1
  : a.latitude - b.latitude));

writeFileSync(output, JSON.stringify(places));
const byRegion = {};
for (const p of places) byRegion[p.region] = (byRegion[p.region] ?? 0) + 1;
console.log(`${places.length} places, ${(JSON.stringify(places).length / 1024).toFixed(0)} KB`);
console.log(Object.entries(byRegion).sort((a, b) => b[1] - a[1]).slice(0, 8)
  .map(([r, n]) => `  ${String(n).padStart(5)}  ${r}`).join("\n"));
