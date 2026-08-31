/**
 * Type-level twin of src/public-surface.test.js.
 *
 * That test proves the exports exist at runtime; this one proves the shipped
 * declarations describe them correctly. It is checked by `tsc --noEmit`, not
 * executed — the point is that it compiles.
 *
 * Written the way a consumer writes it, because the bug this guards against
 * is exactly what happened in slackwater-web: a hand-written ambient
 * declaration that drifted from the real API with nothing to catch it.
 */
import {
  createBundledResolver,
  createResolver,
  loadCorrections,
  validateCorrections,
  validateAgainstStations,
  cleanName,
  toSlug,
  buildLock,
  readLock,
  diffLock,
  MAX_CORRECTION_KM,
  currentGates,
  loadRegistry,
  validateRegistry,
  buildSlugTable,
  emptyTable,
  readSlugTable,
  checkSlugTable,
  findNearbyPairs,
  haversineMetres,
  NEARBY_METRES,
  type Station,
  type ResolvedStation,
  type Resolver,
  type Corrections,
  type GazetteerPlace,
  type Lock,
  type Registry,
  type RegistryStation,
  type SlugTable,
  type NearbyPair,
} from "../index.js";
import { validatePositions, coverageWarnings } from "../validate-positions.js";
import { classify } from "../src/audit.js";

const station: Station = { id: "noaa/9447659", name: "EVERETT", latitude: 47.98, longitude: -122.223 };

// The README's headline example must type-check as written.
const resolve: Resolver = createBundledResolver();
const resolved: ResolvedStation = resolve(station);

const name: string = resolved.name;
const context: string = resolved.context;
const cities: string[] = resolved.cities;
const aliases: string[] = resolved.aliases;
const corrected: boolean = resolved.corrected;
const lat: number = resolved.latitude;
const formerSlugs: string[] = resolved.formerSlugs;
// Optional, so it must not be assignable to a bare string.
const verified: string | undefined = resolved.positionVerified;

// The browser recipe: own corrections and gazetteer.
const corrections: Corrections = loadCorrections("noaa/1:\n  name: Test\n");
const gazetteer: GazetteerPlace[] = [
  { name: "Everett", region: "WA", latitude: 47.98, longitude: -122.2 },
];
const own: Resolver = createResolver({ corrections, gazetteer });
// Both options are optional.
const bare: Resolver = createResolver();
const noArgs: Resolver = createResolver({});

const problems: string[] = [
  ...validateCorrections(corrections),
  ...validatePositions(corrections),
  ...validateAgainstStations(corrections, [station]),
  ...validateAgainstStations(corrections, null),
  ...validateAgainstStations(corrections, [station], { maxKm: 2 }),
];

const limit: number = MAX_CORRECTION_KM;
const cleaned: string = cleanName("EVERETT");
const slug: string = toSlug("Friday Harbor");

const lock: Lock = buildLock([station], {
  resolve,
  classify,
  coastlineFingerprint: "sha256-abc",
  thresholdM: 200,
});
const reread: Lock = readLock(JSON.stringify(lock));
const diff = diffLock(reread, [station], { resolve });
const movedIds: string[] = diff.moved.map((m) => m.id);
const unchanged: string[] = diff.unchanged;

const reg: Registry = loadRegistry("chs-x:\n  name: X\nnoaa-x:\n  name: Y\n");
const entry: RegistryStation | undefined = reg.get("chs-x");
const regProblems: string[] = [
  ...validateRegistry(reg),
  ...validateRegistry(reg, { corrections }),
];
const fromRegistry: Resolver = createResolver({ corrections, gazetteer, registry: reg });
// The registry's headline call: id alone, no name or position. This shipped
// broken in 1.4.0 - Resolver required a full Station, so the README's own
// example did not compile. Exercised here so it cannot regress again.
const byIdAlone: ResolvedStation = fromRegistry({ id: "chs-dodd-narrows" });
const bundledById: ResolvedStation = resolve({ id: "chs-dodd-narrows" });

// The paired-view fields: a gate's effective tide reference on the resolved
// record, and the raw pairing fields on a registry entry. All optional.
const pairedRef: string | undefined = byIdAlone.tideReference;
const rawRef: string | undefined = entry?.tideReference;
const derivedRef: string | undefined = entry?.derived?.reference;
const derivedLag: number | undefined = entry?.derived?.hwLagMinutes;

// currentGates: every argument optional, and the bundled-registry no-arg call.
const gatesBundled: Registry = currentGates();
const gatesChs: Registry = currentGates({ provider: "chs" });
const gatesAll: Registry = currentGates({ registry: reg, provider: "chs", includeDerived: true });
// A consumer's own narrower record must pass without widening to RegistryStation,
// and must come back as its own type — chs-constituents' overlay is built on a
// {name, provider, kind} shape that deliberately carries no position.
interface NarrowRecord { name: string; provider: string; kind?: string }
const narrow = new Map<string, NarrowRecord>([["chs-x", { name: "X", provider: "chs" }]]);
const gatesNarrow: Map<string, NarrowRecord> = currentGates({ registry: narrow, provider: "chs" });
const narrowName: string | undefined = gatesNarrow.get("chs-x")?.name;

// validatePositions and coverageWarnings are widened to accept either file -
// exercise both shapes, not just Corrections.
const registryPositionProblems: string[] = validatePositions(reg);
const correctionsCoverage: string[] = coverageWarnings(corrections);
const registryCoverage: string[] = coverageWarnings(reg);

const slugTable: SlugTable = buildSlugTable({
  previous: emptyTable(),
  tombstones: { tide: {}, current: {} },
  reserved: { tide: new Set<string>(), current: new Set<string>() },
  catalogues: {
    tide: { stations: [{ id: "noaa/1", name: "Everett", region: "WA" }], digest: "sha256-x" },
    current: { stations: [], digest: "sha256-y" },
  },
}).table;
const rereadTable: SlugTable = readSlugTable(JSON.stringify(slugTable));
const slugProblems: string[] = checkSlugTable(slugTable, rereadTable, { tide: {}, current: {} });
// The fourth argument is optional, and takes any iterable of slugs - a Set from
// the CLI, an array from the CI step that reads the committed artifacts.
const slugProblemsReserved: string[] = checkSlugTable(
  slugTable,
  rereadTable,
  { tide: {}, current: {} },
  { tide: new Set(["old-everett"]), current: [] },
);

const nearby: NearbyPair[] = findNearbyPairs(
  [
    { id: "chs-victoria", latitude: 48.424, longitude: -123.371 },
    { id: "chs-victoria-harbour", latitude: 48.424363, longitude: -123.370828 },
    { id: "no-position" },
  ],
  { metres: NEARBY_METRES },
);
const nearbyMetres: number = haversineMetres(
  { latitude: 48.424, longitude: -123.371 },
  { latitude: 48.424363, longitude: -123.370828 },
);

// Reference every binding so noUnusedLocals stays on for real mistakes.
export const surface = {
  resolved, name, context, cities, aliases, corrected, lat, verified, formerSlugs,
  own, bare, noArgs, byIdAlone, bundledById, problems, limit, cleaned, slug, reread, movedIds, unchanged,
  reg, entry, regProblems, fromRegistry, pairedRef, rawRef, derivedRef, derivedLag,
  registryPositionProblems, correctionsCoverage, registryCoverage,
  slugTable, rereadTable, slugProblems, slugProblemsReserved, nearby, nearbyMetres,
  gatesBundled, gatesChs, gatesAll, gatesNarrow, narrowName,
};
