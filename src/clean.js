/** Words that stay lowercase inside a name, but not at the start. */
const MINOR = new Set(["of", "the", "at", "on", "in", "and", "de", "la", "el"]);

/**
 * Tokens whose capitalisation is already correct and must survive title-casing.
 *
 * The twelve multi-letter compass points, because NOAA distinguishes a station
 * from its landmark with a bearing ("Discovery Island, 7.6 mi. SSE of") and a
 * title-cased "Sse" is nonsense on a card. The single-letter points need no
 * entry: titleCaseWord only sees words of two letters or more.
 *
 * Then the caps abbreviations NOAA writes into station names - light buoy,
 * railroad, the Intracoastal Waterway, nautical miles - each of which came out
 * as "Lb", "Rr", "Icww", "Nm".
 */
const KEEP = new Set([
  "NNE", "NE", "ENE", "ESE", "SE", "SSE", "SSW", "SW", "WSW", "WNW", "NW", "NNW",
  "US", "BC", "USCG", "LB", "ICW", "ICWW", "RR", "NM",
]);

/** 1 statute mile = 1.609344 km; 1 nautical mile = 1.852 km. */
const NM_PER_MILE = 1.609344 / 1.852;

/**
 * A distance and its unit, in any of the spellings NOAA uses: "7.6 mi.",
 * "0.8mile", "1.0 n.mi.", "0.4 nmi.", "0.3 nautical mile", "3nm.".
 *
 * The leading number is required - it is what separates a measurement from a
 * place called Six Mile Reef or Miles Point.
 */
const DISTANCE = /(\d+(?:\.\d+)?)\s*(n\.?\s?mi\.?|nautical\s+miles?|nm\.?|mi\.|miles?)(?![a-z])/gi;

/** Abbreviations worth spelling out. Deliberately short — only the noisy ones. */
const EXPAND = [
  [/\bNAS\b/g, "Naval Air Station"],
  [/\bSt\. Park\b/gi, "State Park"],
  [/\bent\./gi, "Entrance"],
  [/\bI\.(?=$|,)/g, "Island"],
  [/\bIs\./gi, "Islands"],
  [/\bPt\./gi, "Point"],
  [/\bCk\./gi, "Creek"],
];

function titleCaseWord(word, first) {
  const bare = word.replace(/[^A-Za-z]/g, "");
  if (KEEP.has(bare.toUpperCase())) return word;
  const lower = word.toLowerCase();
  if (!first && MINOR.has(lower)) return lower;
  // Hyphens, slashes, and apostrophes each start a new capital: "spee-bi-dah", "o'brien".
  return lower.replace(/(^|[-/('’])([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase());
}

/**
 * State a distance in nautical miles, however the provider wrote it.
 *
 * NOAA mixes units within one dataset - "Cattle Point, 1.2 nm SE of" sits
 * beside "Browns Point, 1.6 miles North of" - so a consumer rendering the
 * qualifier next to its own computed range shows one card in two units. This
 * is the same class of edit as EXPAND above: the provider's prose, said the
 * way a chart says it.
 *
 * Runs before the casing pass, so the "nm" it emits is lowercase and never
 * looks like a word that shouts.
 *
 * ponytail: a river station's "2 miles above entrance" is a river mile by
 * convention and gets converted too. No station in covered waters is written
 * that way; revisit if the registry ever reaches the Chesapeake.
 */
function toNauticalMiles(name) {
  return name.replace(DISTANCE, (_, value, unit) => {
    // Already nautical: only the spelling changes, so the number is re-emitted
    // verbatim rather than round-tripped. Number() drops a trailing ".0" on a
    // converted value, so a whole number of miles stays whole.
    if (unit[0].toLowerCase() === "n") return `${value} nm`;
    return `${Number((Number(value) * NM_PER_MILE).toFixed(1))} nm`;
  });
}

/**
 * Clean a provider's station name.
 *
 * Only words that are entirely upper case are re-cased, and only the ones KEEP
 * does not claim. Mixed-case names were written by a human and may contain
 * capitalisation we cannot reconstruct — re-casing those breaks more than it
 * fixes.
 */
export function cleanName(raw) {
  let name = String(raw).trim().replace(/\s+/g, " ");
  for (const [pattern, replacement] of EXPAND) name = name.replace(pattern, replacement);
  name = toNauticalMiles(name);
  return name
    .split(" ")
    .map((word, index) => {
      const letters = word.replace(/[^A-Za-z]/g, "");
      const shouting = letters.length > 1 && letters === letters.toUpperCase();
      return shouting ? titleCaseWord(word, index === 0) : word;
    })
    .join(" ");
}
