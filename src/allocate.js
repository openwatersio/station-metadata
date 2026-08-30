import { toSlug } from "./slug.js";

/**
 * Allocate a slug for every station that does not already have one.
 *
 * A slug is an API: once shared in a URL, changing it silently breaks the link.
 * So a name proposes a slug exactly once, at allocation, and after that the
 * allocation is the record and the name is free to change. That is what makes
 * over-the-air name corrections safe.
 *
 * Candidates are processed sorted by station id, and that sort is the whole of
 * the determinism: it is intrinsic to the station, so shuffling the catalogue
 * cannot change who wins a contested slug. The order-dependence this replaces
 * is what produced a hand-maintained FORMER_SLUGS constant downstream.
 *
 * `taken` carries slugs that are unavailable but belong to no live station in
 * this kind - tombstones and former slugs. Reusing one would make an old link
 * resolve to a different station, which is worse than a dead link: it is wrong
 * rather than absent, and it looks right.
 */
export function allocateSlugs({ stations, existing, taken }) {
  const allocated = new Map(existing);
  const used = new Set(taken);
  for (const slug of allocated.values()) used.add(slug);

  const pending = stations
    .filter((station) => !allocated.has(station.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const station of pending) {
    // An unusable name (empty, or punctuation only) still needs a slug, and the
    // id is the only other thing every station is guaranteed to have.
    const base = toSlug(station.name ?? "") || toSlug(station.id);
    const region = toSlug(station.region ?? "");

    const ladder = [base];
    if (region) ladder.push(`${base}-${region}`);
    ladder.push(`${base}-${toSlug(station.id)}`);

    const slug = ladder.find((candidate) => !used.has(candidate));
    if (slug === undefined) {
      // The id rung is unique by construction, so reaching here means a slug
      // was reserved that collides with it. Refuse rather than reuse.
      throw new Error(`${station.id}: slug ladder exhausted (${ladder.join(", ")})`);
    }

    allocated.set(station.id, slug);
    used.add(slug);
  }

  return allocated;
}
