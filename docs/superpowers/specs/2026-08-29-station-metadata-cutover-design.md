# Station Metadata ownership and package cutover

**Status:** Approved design

## Objective

Move the public station-identity repository into Open Waters, give the repository,
npm package, and CLI the accurate `station-metadata` identity, migrate every active
consumer, and leave no release dependency on Sailing Naturali.

The cutover preserves the library's runtime API, registry schema, station data, Git
history, releases, issues, and pull requests. It changes ownership and distribution
identity rather than station behavior.

## Target identities

| Surface | Target |
| --- | --- |
| GitHub | `openwatersio/station-metadata` |
| npm | `@openwaters/station-metadata` |
| CLI | `station-metadata` |
| First release | `3.0.0` |
| OIDC proof release | `3.0.1`, no behavior change |
| Legacy npm package | `@sailingnaturali/station-corrections`, deprecated after migration |

`openwatersio` is the GitHub organization. `@openwaters` is the npm organization.
No `@openwatersio/*` npm scope is introduced.

## Chosen approach

Transfer and rename the existing GitHub repository. The repository is already public,
so a clean snapshot would not remove any disclosure. A direct transfer preserves 23
tags, 22 releases, issue and pull-request history, and GitHub redirects from
`sailingnaturali/station-corrections`.

Publish one package identity going forward. The Open Waters package does not carry a
`station-corrections` package or CLI alias. Pinned consumers can still install the last
Sailing Naturali release, but the legacy package receives no further releases.

## Repository surface

Prepare the cutover from a worktree based on the latest `origin/main`.

- Set the manifest name to `@openwaters/station-metadata` and version to `3.0.0`.
- Set the executable name to `station-metadata` and rename its implementation and test
  files to match.
- Point repository, homepage, and issue metadata at
  `openwatersio/station-metadata`.
- Set `publishConfig.access` to `public`.
- Present the project as Open Waters in README and package metadata while retaining the
  existing Sailing Naturali copyright grant in `LICENSE`.
- Update package examples, type-header examples, validation messages, and public docs to
  use the new package and CLI identities.
- Keep runtime exports, function names, data schemas, registry keys, slugs, and generated
  station artifacts unchanged.

The package tarball continues to contain the library, CLI, compiled station artifacts,
coastline clip, GeoNames places extract, declarations, `NOTICE`, and `PROVENANCE.md`.

## Public instructions and repository policy

The transferred repository must work as a standalone clone and must not inherit Sailing
Naturali workspace policy.

- `AGENTS.md` is the canonical build, test, architecture, data-provenance, and review
  instruction file.
- `CLAUDE.md` points clients to `AGENTS.md`; it does not duplicate the rules.
- `CONTRIBUTING.md` documents setup, data edits, checks, pull requests, the Open Waters
  CLA requirement, and release boundaries.
- `CODEOWNERS` names the Open Waters maintainers for code, workflows, and station data.
- Dependabot covers npm and GitHub Actions.
- Third-party Actions are pinned to full commit SHAs.

Completed implementation plans and specs leave the current tip. `docs/README.md`
describes the live-doc policy and links to archived material through Git history. This
design remains live until the cutover ships, then follows the same archive policy.

## Data and licensing boundary

No station data changes as part of the rename. The generated JSON must remain
byte-identical to the pre-cutover release.

`NOTICE` covers every redistributed third-party dataset:

- the GeoNames `cities500` extract under CC BY 4.0; and
- the shipped OpenStreetMap land-polygons coastline clip under ODbL.

`PROVENANCE.md` describes how the identity records are authored and the operational rule
against redistributing provider station files. It avoids presenting the repository as
legal advice. The registry carries no provider-minted identifiers, prediction samples,
fitted constituents, harmonic amplitudes or phases, datums, current axes, or other
CHS-derived model output.

## GitHub cutover

1. Land the repository preparation on the source repository while the legacy npm package
   remains available.
2. Transfer `sailingnaturali/station-corrections` to `openwatersio` and rename it to
   `station-metadata` in the same operation.
3. Update the canonical local remote and create the active checkout under
   `~/src/openwatersio/station-metadata` without deleting any in-use Sailing Naturali
   worktree.
4. Apply Open Waters metadata, topics, CODEOWNERS, security settings, and branch/tag
   rules.
5. Require pull requests and CI on `main`; prevent force pushes and deletion of `main`
   and `v*` tags.
6. Keep Actions tokens read-only by default. The publish job receives only
   `contents: read` and `id-token: write`.

The existing GitHub redirect protects old repository URLs during consumer migration, but
active source and documentation move to the canonical Open Waters URL.

## npm bootstrap and release

The first publish is the only operation that cannot use the trusted publisher because the
package does not yet exist.

1. Confirm the publishing account belongs to the `@openwaters` npm organization and can
   create public packages. Stop if that access is absent.
2. From the exact tested `v3.0.0` commit, inspect `npm pack --dry-run` and publish
   `@openwaters/station-metadata@3.0.0` manually with npm's required OTP.
3. Configure the npm trusted publisher for
   `openwatersio/station-metadata`, workflow `publish.yml`.
4. Bump only the version to `3.0.1`, create the protected tag and GitHub Release, and let
   the release workflow publish through OIDC.
5. Verify the registry reports `3.0.1` as `latest`, the package repository points at Open
   Waters, and npm provenance names the exact Open Waters repository, workflow, commit,
   and tag.

The `3.0.0` manual bootstrap has no GitHub Release because publishing that release would
re-run the OIDC workflow against an existing version. Its protected source tag remains.
`3.0.1` is the first complete GitHub Release and the proof of the steady-state release
path.

## Consumer migration

Migrate active consumers only after the Open Waters package is installable and its OIDC
release is proven.

| Consumer | Change |
| --- | --- |
| `slackwater-ios` | Replace the tools dependency and imports; regenerate its tools lockfile; use its mandatory branch-and-PR workflow. |
| `slackwater-web` | Replace the dependency and imports despite its deprecated status so its last build remains reproducible. |
| `signalk-currents` | Replace the dependency and imports; update active README links. |
| `chs-constituents` | Replace the dependency and imports; update repository provenance links. |
| `currents-mcp` | Update the vendored-registry ownership text and drift check to the `~/src/openwatersio/station-metadata` checkout convention. The vendored JSON stays byte-identical. |
| Open Waters/SNI metadata | Update the organization profile, workspace map, active READMEs, package links, and maintained engineering articles. |

Regenerate only lockfiles whose package identity changes. Historical implementation plans
and generated standups are not rewritten; the GitHub redirect keeps their links valid.

## Verification

Before transfer and before each publish:

- `npm test`
- `npm run check:data`
- `node bin/station-metadata.mjs validate`
- `node bin/station-metadata.mjs check-slugs`
- `npm pack --dry-run`
- inspect the tarball file list and scan it for legacy package/repository references,
  provider-minted identifiers, secrets, and prohibited CHS-derived output
- compare `data/*.json`, `data/*.yaml`, and slug/audit locks with the pre-cutover commit;
  identity and generated data must be byte-identical

After publishing:

- install `@openwaters/station-metadata@3.0.1` into a clean temporary project and exercise
  the root import, data export, validation subpath, and CLI
- verify npm provenance and the GitHub release/tag commit
- run each changed consumer's normal tests and build
- search active repositories for `@sailingnaturali/station-corrections` and canonical
  `sailingnaturali/station-corrections` URLs; only deliberate historical references may
  remain
- verify the old GitHub URL redirects and the old npm package remains installable

## Failure containment

The old npm package remains published and supported until the new release and every known
consumer are green.

- Missing `@openwaters` npm access stops the cutover before the first publish.
- A failed first publish stops trusted-publisher configuration and consumer migration.
- Failed OIDC provenance stops consumer migration and deprecation.
- A failed consumer test is fixed in that consumer before proceeding; it does not trigger
  compatibility aliases or dual publishing.
- The GitHub transfer does not require a code rollback because redirects preserve the old
  URL and the repository is already public.

Deprecate every released version of `@sailingnaturali/station-corrections` only after the
Open Waters package, OIDC release, and known consumers pass. The deprecation message points
to `@openwaters/station-metadata` and the Open Waters repository.

## Completion criteria

- `openwatersio/station-metadata` is public and governed by Open Waters policy.
- `@openwaters/station-metadata@3.0.1` is `latest` and carries npm OIDC provenance.
- `station-metadata` is the only supported CLI name.
- All known runtime consumers use `@openwaters/station-metadata`.
- The legacy Sailing Naturali package is deprecated and receives no releases.
- Station data is byte-identical across the cutover.
- The repository and package contain no private SNI instructions, secrets,
  provider-minted identifiers, or prohibited CHS-derived output.
- Private proposal issue `openwatersio/slackwater-ios#221` records the completed decision
  and links to the new repository and release.
