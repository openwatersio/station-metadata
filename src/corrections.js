import { parse } from "yaml";
import { distanceKm } from "./distance.js";
import { namesOverlap, sharesMeaningfulWord } from "./names.js";

/**
 * Parse the corrections file into a Map keyed by provider station ID.
 *
 * IDs are opaque strings — `noaa/9447659`, `chs-active-pass`, `PUG1717` — so
 * nothing here may assume a format.
 */
export function loadCorrections(yamlText) {
  const raw = parse(yamlText) ?? {};
  return new Map(Object.entries(raw));
}

const isString = (v) => typeof v === "string";
const isStringArray = (v) => Array.isArray(v) && v.every(isString);
const isValidPosition = (v) =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number");

/**
 * Check a corrections map for the mistakes contributors actually make.
 * This file is hand-edited and PR-able, so malformed input (wrong type, not
 * just a bad value) is an expected failure mode and must be reported, never
 * thrown - every field is type-checked before use.
 * Returns human-readable problems; an empty array means valid.
 */
export function validateCorrections(map) {
  const problems = [];
  const slugs = new Map();
  // Slug a station used to have, e.g. before issue #6 reattached its name -
  // → the id that once used it, so a later id claiming that string is a
  // recycled-slug collision (see the second pass below), not a fresh one.
  const formerSlugOwners = new Map();

  for (const [id, record] of map) {
    for (const field of ["name", "context", "slug", "reason", "positionVerified"]) {
      if (record[field] !== undefined && !isString(record[field])) {
        problems.push(`${id}: ${field} must be a string`);
      }
    }
    for (const field of ["aliases", "cities", "formerSlugs"]) {
      if (record[field] !== undefined && !isStringArray(record[field])) {
        problems.push(`${id}: ${field} must be an array of strings`);
      }
    }

    if (isStringArray(record.formerSlugs)) {
      for (const former of record.formerSlugs) {
        if (!/^[a-z0-9-]+$/.test(former)) {
          problems.push(`${id}: formerSlugs entry "${former}" must be lowercase letters, digits and hyphens`);
        }
        formerSlugOwners.set(former, id);
      }
    }

    if (record.position !== undefined) {
      if (!isValidPosition(record.position)) {
        problems.push(`${id}: position must be a [latitude, longitude] array of two numbers`);
      } else {
        const [lat, lon] = record.position;
        if (!isString(record.reason) || record.reason.trim() === "") {
          problems.push(`${id}: position is corrected but no reason is given`);
        }
        if (lat < -90 || lat > 90) {
          problems.push(`${id}: latitude ${lat} is out of range`);
        }
        if (lon < -180 || lon > 180) {
          problems.push(`${id}: longitude ${lon} is out of range`);
        }
      }
    }

    if (record.positionVerified !== undefined) {
      if (record.position !== undefined) {
        problems.push(`${id}: position and positionVerified cannot both be set - a position cannot be both wrong and confirmed right`);
      }
      if (!isString(record.positionVerified) || record.positionVerified.trim() === "") {
        problems.push(`${id}: positionVerified must be a non-empty string`);
      }
    }

    if (isString(record.name) && isString(record.context) && namesOverlap(record.name, record.context)) {
      problems.push(`${id}: context repeats the name ("${record.name}" / "${record.context}")`);
    }

    if (isString(record.context) && Array.isArray(record.cities) && record.cities.includes(record.context)) {
      // A curated context names the water or landmark a station sits in; a
      // town is what the derived tier already says, and "Nanaimo" under Dodd
      // Narrows read as a derived label missing its province. Search keeps
      // the town through `cities`.
      problems.push(`${id}: context "${record.context}" is a town in cities - name the water or landmark instead`);
    }

    if (record.slug !== undefined && isString(record.slug)) {
      if (!/^[a-z0-9-]+$/.test(record.slug)) {
        problems.push(`${id}: slug "${record.slug}" must be lowercase letters, digits and hyphens`);
      }
      if (slugs.has(record.slug)) {
        problems.push(`${id}: duplicate slug "${record.slug}", also used by ${slugs.get(record.slug)}`);
      }
      slugs.set(record.slug, id);
    }
  }

  // Second pass, not folded into the loop above: a collision between a
  // current slug and a formerSlugs entry can be discovered from either side
  // depending on which record the map happens to visit first, so both
  // `slugs` and `formerSlugOwners` need to be fully populated before either
  // is checked against the other.
  for (const [id, record] of map) {
    if (
      record.slug !== undefined &&
      isString(record.slug) &&
      formerSlugOwners.has(record.slug) &&
      formerSlugOwners.get(record.slug) !== id
    ) {
      problems.push(
        `${id}: slug "${record.slug}" collides with a former slug of ${formerSlugOwners.get(record.slug)} - a recycled slug would silently redirect old links to the wrong station`,
      );
    }
  }

  return problems;
}

/**
 * How far a correction may move a station from its published position.
 *
 * A correction is a fix, not a relocation. The gauge is where it is; what is
 * wrong is the coordinate written down for it. Real fixes are metres to
 * hundreds of metres — nudging a pier-mounted gauge off a chart-drawn shore.
 * A few kilometres is a plausibly botched coordinate. Past that you are
 * almost certainly pointing at a different place, which is the mistake this
 * catches: the correction lands in water, so `validatePositions` is happy,
 * but it is the wrong water.
 *
 * Tune it; do not remove it. Same shape as audit.js's REPORT_THRESHOLD_M.
 */
export const MAX_CORRECTION_KM = 5;

/**
 * Check each correction against the published station it claims to describe.
 *
 * Kept separate from `validateCorrections` because it needs something that
 * file cannot know: the published station list. Callers that have it (CI,
 * which already loads a stations file for `audit`) pass it in; those that do
 * not simply skip this check. That is the whole reason the corrections file
 * does not record the published position itself — duplicating upstream data
 * means carrying a copy that drifts silently the moment the provider moves a
 * gauge, and the lock already exists to make that move visible.
 *
 * Two checks, both needing the same lookup:
 *  - a corrected `position` is a plausible distance from the published one
 *    (a fix, not a relocation);
 *  - a curated `name` shares at least one meaningful word with the published
 *    name. This is the issue #6 bug: `name: Anacortes` curated onto a
 *    Swinomish Channel gauge, a station that is not Anacortes and shares no
 *    word with it. A curated name replaces the source name outright, so
 *    nothing else would ever catch it being attached to the wrong station.
 *
 * Stations absent from `stations` are skipped rather than reported. A caller
 * may legitimately validate against a partial list (tides but not currents),
 * and an orphan warning there would be noise, not a finding.
 *
 * Malformed positions are skipped — `validateCorrections` reports those.
 */
export function validateAgainstStations(map, stations, { maxKm = MAX_CORRECTION_KM } = {}) {
  const problems = [];
  const published = new Map();
  for (const station of stations ?? []) {
    if (station && typeof station.id === "string") published.set(station.id, station);
  }

  for (const [id, record] of map) {
    const station = published.get(id);
    if (!station) continue;

    if (isString(record.name) && isString(station.name) && !sharesMeaningfulWord(record.name, station.name)) {
      problems.push(
        `${id}: name "${record.name}" shares no meaningful word with the published name "${station.name}" — check this correction is attached to the right station`,
      );
    }

    if (!isValidPosition(record.position)) continue;
    if (typeof station.latitude !== "number" || typeof station.longitude !== "number") continue;

    const [lat, lon] = record.position;
    const km = distanceKm(station.latitude, station.longitude, lat, lon);
    if (km > maxKm) {
      problems.push(
        `${id}: corrected position is ${km.toFixed(1)} km from the published ${station.latitude}, ${station.longitude} — a correction should be a fix, not a relocation (limit ${maxKm} km)`,
      );
    }
  }

  return problems;
}
