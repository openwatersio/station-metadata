# Station Metadata

Public Open Waters source of truth for provider-neutral tide/current station identity,
display metadata, stable slugs, search aliases, positions, and current-gate/tide-port
relationships.

## Commands

- `npm ci`
- `npm test`
- `npm run build:data`
- `npm run check:data`
- `node bin/station-metadata.mjs validate`
- `node bin/station-metadata.mjs check-slugs`

## Data rules

- Edit YAML sources; commit their generated JSON together.
- Preserve registry keys and slugs as public APIs. Record legitimate slug renames in
  `formerSlugs` and regenerate the slug lock.
- Never add provider-minted identifiers, provider station exports, predictions, fitted
  constituents, amplitudes/phases, datums, current axes, credentials, or generated CHS
  model output.
- A position correction requires its reason; authored registry positions require a
  source when they depart from the documented defaults.
- Keep runtime imports browser-safe. Coastline parsing remains behind the explicit
  validation subpath.

## Contribution and release rules

- Work on a branch and open a pull request; do not push to `main`.
- CI, review, and the Open Waters CLA check must pass before merge.
- Release from a protected `vX.Y.Z` GitHub Release only. `publish.yml` owns npm publishing
  through OIDC; never add an npm token to the workflow.
