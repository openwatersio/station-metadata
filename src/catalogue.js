// No Node builtins here: this module is reachable from the package root.

/**
 * The number of departures above which a run must stop and ask.
 *
 * A fixed count rather than a proportion of the table. A proportion scales with
 * the thing it is protecting: as the catalogue grows, a truncated file stays
 * under any percentage and the guard quietly stops guarding. Real departures
 * are rare and individually reviewable; hundreds at once is a bad argument, not
 * a provider event.
 */
export const DEPARTURE_LIMIT = 10;

/**
 * Ids allocated previously and absent from the catalogue now.
 *
 * Under allocation semantics a missing station is indistinguishable from a
 * departed one, which is why the caller must treat a large result as bad input
 * rather than as news.
 */
export function departures(previousIds, catalogueIds) {
  const present = new Set(catalogueIds);
  return [...previousIds].filter((id) => !present.has(id)).sort();
}
