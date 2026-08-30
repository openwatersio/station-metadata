# Contributing

Use Node.js 22 or newer and install the locked dependencies with `npm ci`.

Edit the YAML files in `data/`; they are the source of truth. Run `npm run build:data`
and commit the generated JSON with the YAML source. Preserve registry keys and slugs as
public APIs. A published slug in `data/slugs.json` never moves; record a legitimate
rename in `formerSlugs` and review the station's provenance. Independently author and review registry facts;
never copy a provider station export or add a provider-minted identifier.

Before opening a pull request, run all five validation commands:

```bash
npm ci
npm test
npm run build:data
npm run check:data
node bin/station-metadata.mjs validate
```

`npm run check:slugs` needs the four catalogue files (`NOAA_TIDES`, `CHS_TIDES`,
`NOAA_CURRENTS`, `CHS_GATES`), which this repo does not ship. Run it if you have them;
CI's release-tag comparison is what guards a published slug on every pull request.

Contributions are pull-request-only; do not push to `main`. CI, review, and the Open
Waters CLA check must pass before merge.

Maintainers release only from a protected `vX.Y.Z` GitHub Release. The publish workflow
uses npm trusted publishing through OIDC; do not add an npm token.
