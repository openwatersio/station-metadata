/**
 * Type declarations for @openwaters/station-metadata.
 *
 * Kept in step with src/index.js by two checks that need each other:
 * types/surface.ts type-checks consumer-shaped usage of every export, and
 * src/public-surface.test.js asserts every runtime export is declared here.
 * tsc alone cannot catch a declaration that was never written, because
 * nothing references it.
 */

/** A station as the provider publishes it — the input to a resolver. */
export interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

/**
 * A station identified by id alone.
 *
 * Valid input only when the registry owns that id, because the registry
 * supplies the name and position the provider data would otherwise carry.
 * This is the normal way to look up a registry station — CHS current data,
 * for instance, ships no position at all.
 *
 * Types cannot express "only if this id is in the registry", so a resolver
 * accepts either shape and an unknown id falls through to the overlay path,
 * where a missing name resolves to the string "undefined" rather than
 * throwing. Pass a full `Station` for anything the registry does not own.
 */
export interface StationRef {
  id: string;
}

/** A place in the gazetteer, used to derive a context when nothing better exists. */
export interface GazetteerPlace {
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  /**
   * Weights the pick so a town beats a neighbourhood a little closer. Optional:
   * a hand-written gazetteer carries none, and a place without one competes on
   * distance alone. `data/places.json` sets it on every entry.
   */
  population?: number;
}

/** One record in the corrections file. Every field is optional except `reason`, which `position` requires. */
export interface Correction {
  name?: string;
  context?: string;
  slug?: string;
  cities?: string[];
  aliases?: string[];
  /** Slugs this station used to resolve to. A consumer builds a redirect map from these. */
  formerSlugs?: string[];
  /** A corrected `[latitude, longitude]`. Requires `reason`. */
  position?: [number, number];
  /** Why the published position is wrong. Required whenever `position` is set. */
  reason?: string;
  /** Why the published position is *right* despite reading inland. Mutually exclusive with `position`. */
  positionVerified?: string;
}

/** A station after the corrections overlay is applied. */
export interface ResolvedStation {
  id: string;
  name: string;
  context: string;
  slug: string;
  cities: string[];
  aliases: string[];
  latitude: number;
  longitude: number;
  /** True when the position came from a correction rather than the provider. */
  corrected: boolean;
  /** True when the context was derived from the nearest gazetteer place. */
  derived: boolean;
  /** Slugs this station used to resolve to. Always present; empty when none are recorded. */
  formerSlugs: string[];
  /** Present only when the correction sets it. */
  positionVerified?: string;
  /**
   * `"tide"` for a reference port, `"current"` for a gate. Present only for a
   * registry-owned station (a correction/source station carries no class);
   * a registry entry with no `kind` resolves to `"current"`.
   */
  kind?: "tide" | "current";
  /** Published large-tide current speeds, formatted for concise display. */
  magnitudeNote?: string;
  /**
   * The effective reference tide port for a paired tide+current view — the
   * registry key of a current gate's `tideReference`, or, for a gate whose
   * slack is derived, its `derived.reference`. Present only when the gate names
   * one; a tide port and a genuinely unpaired gate carry none.
   */
  tideReference?: string;
}

export type Resolver = (station: Station | StationRef) => ResolvedStation;

/**
 * Corrections keyed by provider station ID. IDs are opaque strings —
 * `noaa/9447659`, `chs-active-pass`, `PUG1717` — so nothing may assume a format.
 */
export type Corrections = Map<string, Correction>;

/** Build a resolver over the corrections and gazetteer this package ships. Runs in Node and in the browser. */
export function createBundledResolver(): Resolver;

/**
 * The same resolver, deriving contexts from the national `data/places.json`
 * rather than the 19-town gazetteer. The list is a parameter because it is
 * ~890 KB and must not load eagerly into a browser bundle:
 *
 *     import places from "@openwaters/station-metadata/data/places.json" with { type: "json" };
 *     const resolve = createPlacesResolver(places);
 */
export function createPlacesResolver(places: GazetteerPlace[]): Resolver;

/** Beyond this many kilometres, no place is offered as a station's context. */
export const DERIVED_MAX_KM: number;

/** Kilometres of closeness a place's size may outweigh, per decade of population above 1000. */
export const RECOGNITION_KM: number;

/** Build a resolver over your own corrections and gazetteer. */
export function createResolver(options?: {
  corrections?: Corrections;
  gazetteer?: GazetteerPlace[];
  registry?: Registry;
}): Resolver;

/** Parse a corrections YAML document into a map keyed by station ID. */
export function loadCorrections(yamlText: string): Corrections;

/** Check a corrections map for the mistakes contributors make. Returns human-readable problems; empty means valid. */
export function validateCorrections(map: Corrections): string[];

/**
 * Check that each corrected position is a plausible distance from the
 * provider's published one. Stations absent from `stations` are skipped.
 */
export function validateAgainstStations(
  map: Corrections,
  stations: Station[] | null | undefined,
  options?: { maxKm?: number },
): string[];

/** How far a correction may move a station from its published position, in kilometres. */
export const MAX_CORRECTION_KM: number;

/** Clean a provider's station name. Only ALL-CAPS runs are re-cased. */
export function cleanName(raw: string): string;

/** Derive a URL slug from a display name. */
export function toSlug(name: string): string;

/** A station to be allocated a slug. */
export interface StationForAllocation {
  id: string;
  name: string;
  region: string;
}

/** Allocate a slug for every station that does not already have one. */
export function allocateSlugs(options: {
  stations: StationForAllocation[];
  existing: Map<string, string>;
  taken: Set<string>;
}): Map<string, string>;

/** One station's pinned position and audit verdict. */
export interface LockEntry {
  position: [number, number];
  verdict: "clear" | "verified" | "ashore" | "unverifiable";
  /** Present only on an `ashore` verdict. */
  metresInland?: number;
}

export interface Lock {
  note: string;
  generated: string;
  coastline: string;
  thresholdM: number;
  stations: Record<string, LockEntry>;
}

export interface LockDiff {
  moved: { id: string; was: [number, number]; now: [number, number] }[];
  added: string[];
  removed: string[];
  unchanged: string[];
}

/**
 * Pin every station's resolved position and audit verdict.
 *
 * `classify` is injected rather than imported so that using the lock API
 * never pulls in the coastline parse.
 */
export function buildLock(
  stations: Station[],
  options: {
    resolve: Resolver;
    classify: (resolved: ResolvedStation, thresholdM?: number) => Omit<LockEntry, "position">;
    coastlineFingerprint: string;
    thresholdM: number;
  },
): Lock;

/** Parse a lock from its on-disk JSON string. */
export function readLock(json: string): Lock;

/** Compare a lock against the current station list. */
export function diffLock(lock: Lock, stations: Station[], options: { resolve: Resolver }): LockDiff;

/** A station whose identity this package owns, rather than corrects. */
export interface RegistryStation {
  name: string;
  position: [number, number];
  provider: string;
  /**
   * Where this station's facts were independently obtained, when it deviates
   * from the defaults documented in PROVENANCE.md. Omit for a station that
   * matches the default (name hand-written, position from the fitting pipeline).
   */
  source?: string;
  context?: string;
  slug?: string;
  cities?: string[];
  aliases?: string[];
  /** Slugs this station used to resolve to. A consumer builds a redirect map from these. */
  formerSlugs?: string[];
  /**
   * `"tide"` for a reference port, `"current"` for a gate — the two bounded
   * classes the registry curates. Optional: the registry was currents-only
   * until tide ports arrived, so an omitted `kind` means `"current"`.
   */
  kind?: "tide" | "current";
  /**
   * Registry key of the CHS reference tide port shown beside this gate in a
   * paired tide+current view — a curated proximity pairing, not a derivation.
   * Only an ordinary current gate carries one: a tide port is the thing
   * referenced, and a derived gate names its port via `derived.reference`.
   * Mutually exclusive with `derived`; validated by `validateRegistry`.
   */
  tideReference?: string;
  /**
   * Marks a current gate CHS publishes no current station for: slack is derived
   * from a reference tide port's high/low water plus a fixed per-gate lag,
   * rather than from a fitted current series. `reference` is the tide port's
   * registry key. Mutually exclusive with `tideReference`.
   */
  derived?: { reference: string; hwLagMinutes: number; lwLagMinutes: number };
}

/** Registry entries keyed by stable station id, e.g. `chs-dodd-narrows`. */
export type Registry = Map<string, RegistryStation>;

/** Parse a registry YAML document into a map keyed by station id. */
export function loadRegistry(yamlText: string): Registry;

/**
 * The three fields `currentGates` reads. Typed as its own shape rather than
 * `RegistryStation` so a consumer holding a narrower record of its own — most
 * do; the registry is wider than any one reader needs — can pass it without
 * widening to a full station it never uses.
 */
export interface GateSelectable {
  provider?: string;
  kind?: string;
  derived?: unknown;
}

/**
 * The current gates in a registry — the entries a consumer can fetch a live
 * current series for. Tide reference ports are excluded (they publish no
 * current series), and so are derived gates unless `includeDerived` is set —
 * a derived gate is a real gate, but it has no series of its own to fetch.
 *
 * Prefer this over filtering `provider` by hand: every consumer that rolled its
 * own re-derived the tide/current split, and two shipped the same bug when the
 * registry grew a class they predated. See the note on `currentGates` in
 * `src/registry.js`.
 *
 * Returns the caller's own record type, so an overlay built on a narrow local
 * shape keeps it. Defaults to the registry this package ships.
 */
export function currentGates<T extends GateSelectable = RegistryStation>(options?: {
  registry?: Map<string, T>;
  provider?: string;
  includeDerived?: boolean;
}): Map<string, T>;

/**
 * Check a registry for the mistakes contributors make. Pass `corrections` to
 * enable the cross-file rules (no station in both files, no slug collisions).
 */
export function validateRegistry(
  registry: Registry,
  options?: { corrections?: Corrections },
): string[];

/** Current slug per station id, as pinned by `station-metadata slugs`. */
export interface SlugsLock {
  note: string;
  generated: string;
  slugs: Record<string, string>;
}

/** Build the slugs lock from the current corrections and registry data. */
export function buildSlugsLock(corrections: Corrections, registry: Registry): SlugsLock;

/** Parse a slugs lock from its on-disk JSON string. */
export function readSlugsLock(json: string): SlugsLock;

/**
 * Check a slugs lock against the current corrections and registry data.
 * Fails when a station's slug differs from the lock and the lock's value is
 * not recorded in that station's `formerSlugs`.
 */
export function checkSlugs(lock: SlugsLock, corrections: Corrections, registry: Registry): string[];
