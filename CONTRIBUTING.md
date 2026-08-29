# Contributing

Use Node.js 22 or newer and install the locked dependencies with `npm ci`.

Edit the YAML files in `data/`; they are the source of truth. Run `npm run build:data`
and commit the generated JSON with the YAML source. Preserve registry keys and slugs as
public APIs. Record a legitimate slug rename in `formerSlugs`, regenerate the slug lock,
and review the station's provenance. Independently author and review registry facts;
never copy a provider station export or add a provider-minted identifier.

Before opening a pull request, run all six validation commands:

```bash
npm ci
npm test
npm run build:data
npm run check:data
node bin/station-metadata.mjs validate
node bin/station-metadata.mjs check-slugs
```

Contributions are pull-request-only; do not push to `main`. CI, review, and the Open
Waters CLA check must pass before merge.

Maintainers release only from a protected `vX.Y.Z` GitHub Release. The publish workflow
uses npm trusted publishing through OIDC; do not add an npm token.
