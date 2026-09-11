const FIELDS = ["locality", "region", "regionCode", "country", "countryCode"];

export function locationOf(place, ...overrides) {
  const location = {
    locality: place?.name ?? "",
    region: place?.region ?? "",
    regionCode: place?.regionCode ?? "",
    country: place?.country ?? "",
    countryCode: place?.countryCode ?? "",
  };
  for (const override of overrides) {
    for (const field of FIELDS) {
      if (typeof override?.[field] === "string") location[field] = override[field];
    }
  }
  return location;
}

const COUNTRY_CODES = new Set("US CA PR VI GU AS MP".split(" "));
const REGION_CODES = new Set([
  ..."AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC"
    .split(" ").map((code) => `US-${code}`),
  ..."AB BC MB NB NL NS NT NU ON PE QC SK YT".split(" ").map((code) => `CA-${code}`),
]);

export function validateLocation(location) {
  if (location === undefined) return [];
  if (typeof location !== "object" || location === null || Array.isArray(location)) {
    return ["location must be an object"];
  }

  const problems = [];
  for (const field of FIELDS) {
    if (location[field] !== undefined && typeof location[field] !== "string") {
      problems.push(`location.${field} must be a string`);
    }
  }
  if (typeof location.countryCode === "string" && location.countryCode !== "" && !/^[A-Z]{2}$/.test(location.countryCode)) {
    problems.push("location.countryCode must be an ISO 3166-1 alpha-2 code");
  } else if (typeof location.countryCode === "string" && location.countryCode !== "" && !COUNTRY_CODES.has(location.countryCode)) {
    problems.push("location.countryCode must be a supported ISO 3166-1 alpha-2 code");
  }
  if (typeof location.regionCode === "string" && location.regionCode !== "" && !/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(location.regionCode)) {
    problems.push("location.regionCode must be an ISO 3166-2 code");
  } else if (typeof location.regionCode === "string" && location.regionCode !== "") {
    const prefix = location.regionCode.slice(0, 2);
    if (!REGION_CODES.has(location.regionCode)) {
      problems.push("location.regionCode must be a supported ISO 3166-2 code");
    } else if (location.countryCode && prefix !== location.countryCode) {
      problems.push("location.regionCode must start with countryCode");
    }
  }
  return problems;
}
