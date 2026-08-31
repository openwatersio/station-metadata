// No Node builtins here: this module is reachable from the package root.

/**
 * Stations close enough together to be the same water entered twice.
 *
 * ## Why this exists
 *
 * The slug ladder manufactures uniqueness. When a catalogue holds one station
 * twice - a curated identity plus the provider's own row - the second copy
 * loses the base slug and falls to the region rung, so `vancouver` and
 * `vancouver-bc` are both allocated and both look deliberate. 4.0.0 shipped
 * four of these. A slug-uniqueness check cannot find them, because the slugs
 * *are* unique; uniqueness passing is not evidence of anything. Position is the
 * only signal that survives the ladder.
 *
 * ## Why a grid rather than the obvious loop
 *
 * Comparing every station against every other is ~7.3M haversines for the tide
 * catalogue alone, and issue #2 is this repo already paying for a linear
 * geometric scan: `inlandMetres` tests each probe against all 11,510 coastline
 * features and costs ~800 ms on an inland point. The fix named there - index
 * first, compare second - is cheaper to apply now than to retrofit, so this
 * buckets into ~0.01 deg cells (about 1.1 km of latitude) and compares each
 * cell against its 8 neighbours. Any pair within the threshold is guaranteed to
 * share a cell or sit in adjacent ones, so nothing is missed.
 *
 * ## Reading the output
 *
 * A pair is a *candidate*, never a verdict. Two genuinely distinct stations can
 * sit metres apart - `noaa/jx0302` and `noaa/jx0303` are lighted buoys 4.4 m
 * apart with different flood directions and different M2 amplitudes. Distance
 * cannot decide; a person has to look. So callers report these for review
 * rather than failing on them.
 */

/** Metres below which two stations are worth a second look. */
export const NEARBY_METRES = 100;

/** Cell size in degrees. Must be large enough that NEARBY_METRES cannot span two cells. */
const CELL = 0.01;

const EARTH_RADIUS_METRES = 6371000;
const radians = (degrees) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineMetres(a, b) {
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METRES * 2 * Math.asin(Math.sqrt(h));
}

const positioned = (station) =>
  typeof station?.latitude === "number" && typeof station?.longitude === "number";

/**
 * Candidate duplicate identities within one kind, nearest first.
 *
 * Stations without a position are skipped rather than treated as colliding at
 * (0, 0) - a missing position is a different problem and belongs to a different
 * check. Returns `{ a, b, metres }`, with `a` the lower id, so a caller diffing
 * one run against another sees a stable ordering.
 */
export function findNearbyPairs(stations, { metres = NEARBY_METRES } = {}) {
  const cells = new Map();
  for (const station of stations) {
    if (!positioned(station)) continue;
    const key = `${Math.floor(station.latitude / CELL)},${Math.floor(station.longitude / CELL)}`;
    const cell = cells.get(key);
    if (cell === undefined) cells.set(key, [station]);
    else cell.push(station);
  }

  const pairs = [];
  const seen = new Set();
  for (const [key, cell] of cells) {
    const [row, column] = key.split(",").map(Number);
    const neighbourhood = [];
    for (let dRow = -1; dRow <= 1; dRow++) {
      for (let dColumn = -1; dColumn <= 1; dColumn++) {
        const neighbour = cells.get(`${row + dRow},${column + dColumn}`);
        if (neighbour !== undefined) neighbourhood.push(...neighbour);
      }
    }
    for (const one of cell) {
      for (const other of neighbourhood) {
        if (one.id === other.id) continue;
        const [a, b] = one.id < other.id ? [one, other] : [other, one];
        const pair = `${a.id}|${b.id}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        const distance = haversineMetres(a, b);
        if (distance <= metres) pairs.push({ a: a.id, b: b.id, metres: distance });
      }
    }
  }

  return pairs.sort((x, y) => x.metres - y.metres || (x.a < y.a ? -1 : 1));
}
