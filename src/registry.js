import { parse } from "yaml";
import { namesOverlap } from "./names.js";
import { toSlug } from "./slug.js";
import bundledRegistry from "../data/registry.json" with { type: "json" };

/**
 * Stations whose identity this package owns.
 *
 * Distinct from corrections.yaml, which is an *overlay*: a correction is a
 * delta against something a provider published, so it needs a `reason` and is
 * checked for plausible distance from the published position. A registry
 * entry has no upstream to differ from - it is the record itself. CHS is the
 * first data like this: the name a consumer sees is a hand-written label, and
 * the fitting pipeline emits no position at all.
 *
 * Deliberately imports no coastline: position-in-water checking lives behind
 * ./validate-positions.js so the package root stays cheap.
 */
export function loadRegistry(yamlText) {
  const raw = parse(yamlText) ?? {};
  return new Map(Object.entries(raw));
}

/**
 * The current gates in a registry — the entries a consumer can fetch a live
 * current series for.
 *
 * This exists because the registry curates two bounded classes (see the header
 * above) and *every* consumer that enumerated it re-derived the distinction by
 * hand. Two of them got it wrong the same way, months apart, because the
 * registry grew a class after they were written:
 *
 *   - signalk-currents swept the ten CHS tide reference ports into its
 *     current-station list, found no live current id for any of them, and threw
 *     "no live id for <port>" on every poll cycle on the boat Pi (2026-08-10).
 *   - chs-constituents kept the derived Malibu gate in its name overlay, so
 *     every build logged "found no live IWLS station (name drift?)" for a gate
 *     that is derived *precisely because* CHS publishes no station for it —
 *     training the operator to ignore the warning that catches real renames.
 *
 * Both wanted this exact set. Owning it here means the next class the registry
 * grows is handled once, by the package that grew it.
 *
 * An absent `kind` means "current": the registry was currents-only before tide
 * ports arrived. Selection is an ALLOWLIST rather than `kind !== "tide"` — the
 * bug above WAS an unanticipated kind, and a denylist re-acquires it the next
 * time. (`validateRegistry` rejects an unknown kind, so nothing should reach
 * here; this is the door that already failed once. resolve.js normalises the
 * other way, treating any non-tide value as current — right for labelling a
 * record, wrong for deciding whether to open a network connection.)
 *
 * Derived gates are excluded by default: they are genuinely current gates, but
 * they have no series of their own, so a caller fetching from this list would
 * ask a provider for something that does not exist. Pass `includeDerived` when
 * you want the full set of gates rather than the fetchable ones.
 *
 * @param {object} [options]
 * @param {Map<string, object>} [options.registry] Defaults to the bundled registry.
 * @param {string} [options.provider] Keep only this provider; omit to span all.
 * @param {boolean} [options.includeDerived] Keep derived gates too. Default false.
 * @returns {Map<string, object>} Gates keyed by station id, in registry order.
 */
export function currentGates({
  registry = new Map(Object.entries(bundledRegistry)),
  provider,
  includeDerived = false,
} = {}) {
  const gates = new Map();
  for (const [id, record] of registry) {
    if (provider !== undefined && record.provider !== provider) continue;
    if ((record.kind ?? "current") !== "current") continue;
    if (!includeDerived && record.derived !== undefined) continue;
    gates.set(id, record);
  }
  return gates;
}

const isString = (v) => typeof v === "string";
const isNonEmptyString = (v) => isString(v) && v.trim() !== "";
const isStringArray = (v) => Array.isArray(v) && v.every(isString);
const isValidPosition = (v) =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number");

/**
 * Check a registry for the mistakes contributors make.
 *
 * Hand-edited and PR-able like the corrections file, so malformed input is an
 * expected failure mode and must be reported, never thrown.
 *
 * Pass `corrections` to enable the cross-file rules: a station may not be
 * declared in both files (two sources of authority is the bug), and slugs must
 * be unique across both, because URLs share one namespace.
 *
 * `validateAgainstStations` and MAX_CORRECTION_KM are deliberately NOT applied
 * here. Distance-from-published is undefined when the registry *is* the
 * published value. This absence is intentional, not an oversight.
 */
export function validateRegistry(registry, { corrections = new Map() } = {}) {
  const problems = [];
  const slugs = new Map();
  // Registry-side former slugs, keyed by the slug string - so an id's
  // *current* slug (registry or corrections) can be checked against any
  // station's slug history, not just its own file's current slugs.
  const formerSlugOwners = new Map();

  for (const [id, record] of registry) {
    for (const field of ["name", "provider"]) {
      if (!isNonEmptyString(record[field])) {
        problems.push(
          record[field] !== undefined && !isString(record[field])
            ? `${id}: ${field} must be a string`
            : `${id}: ${field} is required`,
        );
      }
    }
    for (const field of ["context", "slug", "source"]) {
      if (record[field] !== undefined && !isString(record[field])) {
        problems.push(`${id}: ${field} must be a string`);
      }
    }
    for (const field of ["cities", "aliases", "formerSlugs"]) {
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

    if (record.position === undefined) {
      problems.push(`${id}: position is required`);
    } else if (!isValidPosition(record.position)) {
      problems.push(`${id}: position must be a [latitude, longitude] array of two numbers`);
    } else {
      const [lat, lon] = record.position;
      if (lat < -90 || lat > 90) problems.push(`${id}: latitude ${lat} is out of range`);
      if (lon < -180 || lon > 180) problems.push(`${id}: longitude ${lon} is out of range`);
    }

    // `kind` distinguishes a tide reference port from a current gate - the two
    // bounded classes the registry curates (see the file header). Optional: the
    // registry was currents-only until tide ports arrived, so an absent kind
    // reads as "current" (resolve.js applies that default). When set it must be
    // one of the two - a typo like "tidal" would silently mis-route a station.
    if (record.kind !== undefined && record.kind !== "tide" && record.kind !== "current") {
      problems.push(`${id}: kind "${record.kind}" must be "tide" or "current"`);
    }

    // A `derived` block marks a current gate whose slack comes from a reference
    // tide port's high/low water rather than a fitted current series (see the
    // registry header). It carries the reference key and the two per-gate lags;
    // the reference must exist and be a tide port, or slack would derive from
    // the wrong water. Only a current gate may be derived - a tide port is the
    // thing others derive *from*, not a derived station itself.
    if (record.derived !== undefined) {
      const d = record.derived;
      if (typeof d !== "object" || d === null || Array.isArray(d)) {
        problems.push(`${id}: derived must be an object`);
      } else {
        if (record.kind === "tide") {
          problems.push(`${id}: a tide port cannot be derived`);
        }
        if (!isNonEmptyString(d.reference)) {
          problems.push(`${id}: derived.reference is required`);
        } else if (!registry.has(d.reference)) {
          problems.push(`${id}: derived.reference "${d.reference}" is not a station in this registry`);
        } else if (registry.get(d.reference).kind !== "tide") {
          problems.push(`${id}: derived.reference "${d.reference}" must be a tide port (kind: tide)`);
        }
        for (const field of ["hwLagMinutes", "lwLagMinutes"]) {
          if (typeof d[field] !== "number" || !Number.isFinite(d[field])) {
            problems.push(`${id}: derived.${field} must be a number`);
          }
        }
      }
    }

    // A `tideReference` names the tide port a gate is shown beside (a curated
    // proximity pairing, not a derivation). Only an ordinary current gate may
    // carry one: a tide port is the thing referenced, and a derived gate
    // already names its port via derived.reference.
    if (record.tideReference !== undefined) {
      if (!isNonEmptyString(record.tideReference)) {
        problems.push(`${id}: tideReference must be a station key string`);
      } else if (record.kind === "tide") {
        problems.push(`${id}: a tide port cannot carry a tideReference`);
      } else if (record.derived !== undefined) {
        problems.push(`${id}: derived gate already pairs via derived.reference - drop tideReference`);
      } else if (!registry.has(record.tideReference)) {
        problems.push(`${id}: tideReference "${record.tideReference}" is not a station in this registry`);
      } else if (registry.get(record.tideReference).kind !== "tide") {
        problems.push(`${id}: tideReference "${record.tideReference}" must be a tide port (kind: tide)`);
      }
    }

    if (isString(record.name) && isString(record.context) && namesOverlap(record.name, record.context)) {
      problems.push(`${id}: context repeats the name ("${record.name}" / "${record.context}")`);
    }

    if (record.slug !== undefined && isString(record.slug) && !/^[a-z0-9-]+$/.test(record.slug)) {
      problems.push(`${id}: slug "${record.slug}" must be lowercase letters, digits and hyphens`);
    }

    // ponytail: resolve.js derives a routable slug (override.slug ?? toSlug(name))
    // whenever a record sets none, so an unset slug still ends up live and must
    // be guarded the same as an explicit one. Only compute it when there's a
    // usable name (or an explicit slug already) - a record failing the
    // required-name check has no real name to derive from, and toSlug("undefined")
    // would register a bogus collision target for a problem already reported above.
    const effectiveSlug =
      record.slug !== undefined && isString(record.slug)
        ? record.slug
        : isNonEmptyString(record.name)
          ? toSlug(record.name)
          : undefined;

    if (effectiveSlug !== undefined) {
      if (slugs.has(effectiveSlug)) {
        problems.push(`${id}: duplicate slug "${effectiveSlug}", also used by ${slugs.get(effectiveSlug)}`);
      }
      slugs.set(effectiveSlug, id);
    }

    if (corrections.has(id)) {
      problems.push(`${id}: declared in both the registry and corrections - a station has one source of authority`);
    }
  }

  // Corrections side deliberately checks only the *explicit* slug, not the
  // effective one - the corrections overlay has the identical derived-slug gap
  // (validateCorrections never closes it) and must keep behaving the same
  // after this change. Only the registry side gets effective-slug checking.
  for (const [id, record] of corrections) {
    if (isStringArray(record.formerSlugs)) {
      for (const former of record.formerSlugs) formerSlugOwners.set(former, id);
    }
    if (record.slug !== undefined && isString(record.slug) && slugs.has(record.slug)) {
      problems.push(`${id}: slug "${record.slug}" collides with ${slugs.get(record.slug)} in the registry`);
    }
  }

  // Recycled-slug check, spanning both files: a station's *current* slug
  // (registry effective, corrections explicit - the same split kept above)
  // must not equal any station's former slug, or an old link would silently
  // redirect to the wrong place. `formerSlugOwners` is only complete once
  // both loops above have run, so this has to be its own pass.
  for (const [id, record] of registry) {
    const effectiveSlug =
      record.slug !== undefined && isString(record.slug)
        ? record.slug
        : isNonEmptyString(record.name)
          ? toSlug(record.name)
          : undefined;
    if (effectiveSlug !== undefined && formerSlugOwners.has(effectiveSlug) && formerSlugOwners.get(effectiveSlug) !== id) {
      problems.push(`${id}: slug "${effectiveSlug}" collides with a former slug of ${formerSlugOwners.get(effectiveSlug)}`);
    }
  }
  for (const [id, record] of corrections) {
    if (
      record.slug !== undefined &&
      isString(record.slug) &&
      formerSlugOwners.has(record.slug) &&
      formerSlugOwners.get(record.slug) !== id
    ) {
      problems.push(`${id}: slug "${record.slug}" collides with a former slug of ${formerSlugOwners.get(record.slug)}`);
    }
  }

  return problems;
}
