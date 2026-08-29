# Station Metadata Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transfer the station-identity repository to Open Waters, publish it as `@openwaters/station-metadata`, migrate every active consumer, and deprecate the Sailing Naturali package.

**Architecture:** Preserve the existing public Git repository and station-data/runtime API while changing the repository, npm, and CLI identities in one controlled cutover. Publish and prove the new package before changing consumers; deprecate the old package only after every known consumer is green.

**Tech Stack:** Node.js 22/24, npm, Node test runner, TypeScript, GitHub Actions, GitHub REST API, npm trusted publishing with OIDC, Swift/Xcode consumer tooling, Python/pytest consumer tooling.

**Spec:** `docs/superpowers/specs/2026-08-29-station-metadata-cutover-design.md`

## Global Constraints

- GitHub target is `openwatersio/station-metadata`; npm target is `@openwaters/station-metadata`. Never introduce an `@openwatersio/*` npm scope.
- Publish `3.0.0` manually for the first-package bootstrap, then publish no-behavior `3.0.1` through OIDC.
- `station-metadata` is the only supported CLI name. Do not ship package or CLI aliases.
- Runtime exports, registry schema, station keys, slugs, and all generated station artifacts remain unchanged.
- Preserve the existing Sailing Naturali copyright in `LICENSE`.
- The old npm package stays installable until the new package, provenance, and every known consumer are verified.
- Work in isolated worktrees. Never move a shared checkout's branch.
- Open Waters repositories use branch-and-PR and require another maintainer to merge. Never merge an Open Waters PR opened by this work.
- Before each `gh` operation, run `rtk gh auth status` separately. Run every `gh` command separately.
- Before each push, fetch and confirm `origin/main..HEAD` contains only this task's commits.
- Prefix every shell command with `rtk`; prefix every segment in a command chain.

---

## File map

### Station Metadata repository

- Modify `package.json` and `package-lock.json`: package identity, version, bin, repository URLs, author, public publishing.
- Rename `bin/station-corrections.mjs` to `bin/station-metadata.mjs`: CLI implementation path only; behavior stays fixed.
- Rename `bin/station-corrections.test.mjs` to `bin/station-metadata.test.mjs`: CLI tests follow the implementation filename.
- Modify `src/public-surface.test.js`: lock the new package and CLI identities.
- Modify `README.md`, `index.d.ts`, `NOTICE`, and `PROVENANCE.md`: public identity, Open Waters ownership, attribution, and provenance boundary.
- Create `AGENTS.md`, `CLAUDE.md`, and `CONTRIBUTING.md`: standalone Open Waters instructions.
- Create `.github/CODEOWNERS` and `.github/dependabot.yml`: ownership and dependency maintenance.
- Modify `.github/workflows/ci.yml` and `.github/workflows/publish.yml`: renamed CLI, full-SHA Actions, package dry run, OIDC release.
- Create `docs/README.md`: live-doc policy and Git-history retrieval.
- Delete shipped plans/specs under `docs/superpowers/` after retaining the approved cutover design and implementation plan until completion.

### Runtime consumers

- `chs-constituents/package.json`, `package-lock.json`, `src/derived.ts`, `src/registry.ts`.
- `signalk-currents/package.json`, `package-lock.json`, `src/registry-stations.ts`, `README.md`.
- `slackwater-web/package.json`, `package-lock.json`, `src/chsStations.ts`.
- `slackwater-ios/tools/package.json`, `tools/package-lock.json`, `tools/bundle.mjs`, `tools/gen-chs-gates.mjs`.
- `currents-mcp/tests/test_registry_drift.py`, `README.md`; vendored JSON remains unchanged.

### Maintained ownership surfaces

- `sailingnaturali/.github/profile/README.md`: remove the repository from the SNI-owned table.
- `openwatersio/.github/profile/README.md`: add Station Metadata under Tides with repository and npm links.
- `infrastructure/workspace-CLAUDE.md`: move the repository entry to Open Waters and retain the historical package only as deprecated.
- `currents-vault/README.md`: update the station-metadata ownership/link language.
- `engineering/_posts/2026-07-23-*.md`, `engineering/_posts/2026-08-11-*.md`, `engineering/_posts/2026-08-26-*.md`: update maintained canonical repository/package links.
- `openwatersio/slackwater-ios#221`: record the clean npm break and final completion.

---

### Task 1: Lock the new package and CLI identity

**Files:**

- Modify: `src/public-surface.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Rename: `bin/station-corrections.mjs` → `bin/station-metadata.mjs`
- Rename: `bin/station-corrections.test.mjs` → `bin/station-metadata.test.mjs`

**Interfaces:**

- Consumes: existing root exports, validation subpath, and CLI behavior.
- Produces: npm package `@openwaters/station-metadata@3.0.0` with bin `station-metadata` at `bin/station-metadata.mjs`.

- [ ] **Step 1: Add a failing package-identity test**

Extend the existing `node:fs` import in `src/public-surface.test.js`:

```js
import { existsSync, readdirSync, readFileSync } from "node:fs";
```

Add this test:

```js
test("the published package and CLI use the Open Waters station-metadata identity", () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  );

  assert.equal(manifest.name, "@openwaters/station-metadata");
  assert.deepEqual(manifest.bin, { "station-metadata": "bin/station-metadata.mjs" });
  assert.equal(manifest.repository.url, "git+https://github.com/openwatersio/station-metadata.git");
  assert.equal(manifest.bugs.url, "https://github.com/openwatersio/station-metadata/issues");
  assert.equal(manifest.homepage, "https://github.com/openwatersio/station-metadata#readme");
  assert.deepEqual(manifest.publishConfig, { access: "public" });
  assert.equal(
    existsSync(fileURLToPath(new URL("../bin/station-corrections.mjs", import.meta.url))),
    false,
  );
});
```

- [ ] **Step 2: Run the test and confirm the old identity fails**

Run:

```bash
rtk node --test src/public-surface.test.js
```

Expected: FAIL because the manifest name is `@sailingnaturali/station-corrections`.

- [ ] **Step 3: Rename the CLI files**

Run:

```bash
rtk git mv bin/station-corrections.mjs bin/station-metadata.mjs
rtk git mv bin/station-corrections.test.mjs bin/station-metadata.test.mjs
```

In `bin/station-metadata.test.mjs`, change:

```js
const bin = fileURLToPath(new URL("./station-metadata.mjs", import.meta.url));
```

Rename temporary fixture prefixes and comments from `station-corrections` to
`station-metadata`; do not change CLI behavior or command names such as `audit`,
`validate`, `lock`, or `check-slugs`.

- [ ] **Step 4: Update package identity**

Apply these manifest values in `package.json`:

```json
{
  "name": "@openwaters/station-metadata",
  "version": "3.0.0",
  "description": "Provider-neutral tide and current station identity, metadata, search aliases, and corrected positions",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/openwatersio/station-metadata.git"
  },
  "author": "Open Waters",
  "bugs": {
    "url": "https://github.com/openwatersio/station-metadata/issues"
  },
  "homepage": "https://github.com/openwatersio/station-metadata#readme",
  "publishConfig": {
    "access": "public"
  },
  "bin": {
    "station-metadata": "bin/station-metadata.mjs"
  }
}
```

Retain the existing dependencies, exports, files list, scripts, side-effects declaration,
engine behavior, and MIT licence.

- [ ] **Step 5: Regenerate the lockfile without changing dependencies**

Run:

```bash
rtk npm install --package-lock-only
```

Inspect `package-lock.json`. Expected: root name/version change only; dependency versions
stay fixed.

- [ ] **Step 6: Run the focused and full tests**

Run:

```bash
rtk node --test src/public-surface.test.js bin/station-metadata.test.mjs
rtk npm test
```

Expected: 0 failures and TypeScript declarations pass.

- [ ] **Step 7: Commit the identity change**

Run:

```bash
rtk git add package.json package-lock.json src/public-surface.test.js bin/station-metadata.mjs bin/station-metadata.test.mjs
rtk git commit -m "Rename the package to station metadata"
```

---

### Task 2: Make the repository standalone and public-ready

**Files:**

- Create: `AGENTS.md`
- Create: `CLAUDE.md`
- Create: `CONTRIBUTING.md`
- Create: `.github/CODEOWNERS`
- Create: `.github/dependabot.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/publish.yml`
- Modify: `README.md`
- Modify: `index.d.ts`
- Modify: `NOTICE`
- Modify: `PROVENANCE.md`
- Create: `docs/README.md`
- Delete: `docs/superpowers/plans/2026-07-21-phase2a-drop-provider-id.md`
- Delete: `docs/superpowers/plans/2026-07-21-station-registry.md`
- Delete: `docs/superpowers/specs/2026-07-21-chs-station-registry-design.md`

**Interfaces:**

- Consumes: target identities from Task 1 and the unchanged station-data contract.
- Produces: standalone Open Waters contributor/release instructions and complete package attribution.

- [ ] **Step 1: Write repository-local instructions**

Create `AGENTS.md` with these enforceable sections:

```markdown
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
```

Create `CLAUDE.md` containing only:

```markdown
# Claude Code

Read and follow [AGENTS.md](AGENTS.md).
```

- [ ] **Step 2: Write human contribution instructions**

Create `CONTRIBUTING.md` covering:

- Node.js 22+ and `npm ci` setup;
- YAML source / generated JSON workflow;
- the exact six validation commands from `AGENTS.md`;
- slug and provenance review requirements;
- pull-request-only contributions;
- the requirement that the Open Waters CLA check pass before merge;
- the rule that maintainers release only through protected GitHub Releases and OIDC.

Do not include private account identifiers, SNI paths, personal credential locations, or
local-host policy.

- [ ] **Step 3: Add ownership and dependency maintenance**

Create `.github/CODEOWNERS`:

```text
* @bkeepers @clarkbw
/.github/ @bkeepers @clarkbw
/data/ @bkeepers @clarkbw
```

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

- [ ] **Step 4: Pin Actions and update workflow commands**

Resolve the immutable SHAs before editing:

```bash
rtk gh auth status
rtk gh api repos/actions/checkout/git/ref/tags/v5 --jq .object.sha
rtk gh auth status
rtk gh api repos/actions/setup-node/git/ref/tags/v5 --jq .object.sha
```

Replace `actions/checkout@v5` and `actions/setup-node@v5` in both workflows with the
returned 40-character SHAs and retain `# v5` comments. Change CLI paths in both workflows
to `bin/station-metadata.mjs`. Add `npm pack --dry-run` after `npm run check:data` in both
workflows. Keep publish permissions exactly:

```yaml
permissions:
  contents: read
  id-token: write
```

- [ ] **Step 5: Update public documentation and notices**

In `README.md`:

- use heading `# Station Metadata`;
- describe shared station identity/metadata rather than agency mistakes;
- replace installs/imports with `@openwaters/station-metadata`;
- replace CLI invocations with `station-metadata`;
- replace repository links with `openwatersio/station-metadata`;
- replace the Sailing Naturali footer with Open Waters;
- retain the full runtime/API/data explanations.

In `index.d.ts`, replace package examples with `@openwaters/station-metadata`.

In `NOTICE`, retain the Sailing Naturali copyright and GeoNames attribution. Add a second
third-party-data section for `data/coastline.geojson`: OpenStreetMap land polygons,
Open Database License, source `https://osmdata.openstreetmap.de/data/land-polygons.html`,
and attribution to OpenStreetMap contributors.

In `PROVENANCE.md`, retain the factual authoring and no-provider-file rules. Replace
categorical legal conclusions with the operational boundary: independently author and
review the registry; never redistribute a provider station export or provider-minted ID.

- [ ] **Step 6: Apply docs hygiene**

Create `docs/README.md` explaining that `docs/superpowers/specs` and
`docs/superpowers/plans` contain live work only, and that removed documents can be read
with:

```bash
git log --all -- docs/superpowers
git show 6e5558f:docs/superpowers/plans/2026-07-21-phase2a-drop-provider-id.md
```

Delete the three completed 2026-07-21 documents listed in this task. Keep the 2026-08-29
design and plan until the cutover completion commit.

- [ ] **Step 7: Verify instructions, data, and package surface**

Run:

```bash
rtk npm test
rtk npm run check:data
rtk node bin/station-metadata.mjs validate
rtk node bin/station-metadata.mjs check-slugs
rtk npm pack --dry-run
rtk git diff --check
```

Compare data to the pre-cutover commit:

```bash
rtk git diff --exit-code origin/main -- data
```

Expected: every command exits 0 and the data diff is empty.

Scan active package/repository files:

```bash
rtk rg -n "@sailingnaturali/station-corrections|sailingnaturali/station-corrections|providerId|providerBin" package.json package-lock.json README.md index.d.ts NOTICE PROVENANCE.md AGENTS.md CLAUDE.md CONTRIBUTING.md .github src bin data
```

Expected: no matches except an explicit prohibition in `AGENTS.md` may name the concept
without containing an identifier value.

- [ ] **Step 8: Commit the public repository surface**

Run:

```bash
rtk git add AGENTS.md CLAUDE.md CONTRIBUTING.md .github README.md index.d.ts NOTICE PROVENANCE.md docs
rtk git commit -m "Prepare Station Metadata for Open Waters"
```

---

### Task 3: Update the private cutover proposal

**Files:** None.

**Interfaces:**

- Consumes: approved identity and release decisions.
- Produces: private issue `openwatersio/slackwater-ios#221` as the coordination record.

- [ ] **Step 1: Fetch the live private issue body**

Run separately:

```bash
rtk gh auth status
rtk gh issue view 221 --repo openwatersio/slackwater-ios --json body,url
```

- [ ] **Step 2: Update the issue body**

Preserve the complete live body and make these exact policy changes:

- target repository: `openwatersio/station-metadata`;
- target npm package: `@openwaters/station-metadata`;
- target CLI: `station-metadata`;
- first release: `3.0.0`; OIDC proof release: `3.0.1`;
- migrate all known consumers and deprecate `@sailingnaturali/station-corrections`;
- remove language that retains the Sailing Naturali package for the cutover;
- change the checked decision to:

```markdown
- [x] Approve `station-corrections` → `openwatersio/station-metadata`, publish `@openwaters/station-metadata` with the `station-metadata` CLI as a clean break at `3.0.0`, migrate known consumers, and deprecate `@sailingnaturali/station-corrections`.
```

Write the complete body to a temporary file with `apply_patch`, run `gh issue edit
--body-file`, then delete the temporary file with `apply_patch`.

- [ ] **Step 3: Expand the existing npm-access comment**

Update comment `5453598284` to:

```markdown
### npm access dependency

- [ ] @bkeepers add Bryan to the `@openwaters` npm organization with access to create and publish `@openwaters/station-metadata` and `@openwaters/noaa-current-stations`, then configure each trusted publisher before its dependency-repository cutover.
```

Run separately:

```bash
rtk gh auth status
rtk gh api --method PATCH repos/openwatersio/slackwater-ios/issues/comments/5453598284 -f $'body=### npm access dependency\n\n- [ ] @bkeepers add Bryan to the `@openwaters` npm organization with access to create and publish `@openwaters/station-metadata` and `@openwaters/noaa-current-stations`, then configure each trusted publisher before its dependency-repository cutover.'
```

- [ ] **Step 4: Verify the live issue**

Run separately and inspect the booleans:

```bash
rtk gh auth status
rtk gh issue view 221 --repo openwatersio/slackwater-ios --json body --jq '{newPackage: (.body | contains("@openwaters/station-metadata")), newCli: (.body | contains("`station-metadata` CLI")), cleanBreak: (.body | contains("clean break at `3.0.0`")), oldRetentionGone: (.body | contains("retaining `@sailingnaturali/station-corrections` for this cutover") | not)}'
```

Expected: all four values are `true`.

---

### Task 4: Land the preparation on the source repository

**Files:** All Station Metadata files from Tasks 1–2 plus the committed design/plan.

**Interfaces:**

- Consumes: green repository preparation.
- Produces: source `main` ready for direct GitHub transfer.

- [ ] **Step 1: Rebase onto the latest source main**

Run:

```bash
rtk git fetch origin
rtk git rebase origin/main
rtk git log --oneline origin/main..HEAD
```

Expected: only the design, plan, identity, and public-readiness commits from this cutover.

- [ ] **Step 2: Re-run the complete pre-transfer checks**

Run:

```bash
rtk npm ci
rtk npm test
rtk npm run check:data
rtk node bin/station-metadata.mjs validate
rtk node bin/station-metadata.mjs check-slugs
rtk npm pack --dry-run
rtk git diff --exit-code origin/main -- data
rtk git diff --check origin/main..HEAD
```

Expected: 0 failures; no data diff; no whitespace errors.

- [ ] **Step 3: Push the prepared history to source main**

Run separately:

```bash
rtk gh auth status
```

Then:

```bash
rtk git push origin HEAD:main
```

Do not force-push.

---

### Task 5: Transfer and secure the GitHub repository

**Files:** GitHub repository settings; local remote configuration.

**Interfaces:**

- Consumes: prepared source `main` and target-name availability.
- Produces: public `openwatersio/station-metadata` with protected development/release paths.

- [ ] **Step 1: Reconfirm authority and target availability**

Run separately:

```bash
rtk gh auth status
rtk gh repo view sailingnaturali/station-corrections --json nameWithOwner,isPrivate,viewerPermission
```

Run separately:

```bash
rtk gh auth status
rtk gh repo view openwatersio/station-metadata --json nameWithOwner
```

Expected: source is public with `ADMIN`; target returns not found. Stop if the target exists.

- [ ] **Step 2: Transfer and rename in one operation**

Run separately:

```bash
rtk gh auth status
rtk gh api --method POST repos/sailingnaturali/station-corrections/transfer -f new_owner=openwatersio -f new_name=station-metadata
```

Wait for GitHub to complete the transfer, then verify separately:

```bash
rtk gh auth status
rtk gh repo view openwatersio/station-metadata --json nameWithOwner,isPrivate,url,defaultBranchRef
```

Expected: public repository, default branch `main`.

- [ ] **Step 3: Update the local remote and active checkout**

In the cutover worktree and shared source checkout, run:

```bash
rtk git remote set-url origin https://github.com/openwatersio/station-metadata.git
rtk git fetch origin
```

Create `~/src/openwatersio` if absent and clone the canonical repository as
`~/src/openwatersio/station-metadata`. Do not delete or prune existing SNI worktrees while
another session may own them.

- [ ] **Step 4: Set repository metadata and Actions defaults**

Run separately:

```bash
rtk gh auth status
rtk gh repo edit openwatersio/station-metadata --description "Provider-neutral tide and current station identity, metadata, search aliases, and corrected positions" --homepage https://www.npmjs.com/package/@openwaters/station-metadata --enable-issues --delete-branch-on-merge
```

Run separately:

```bash
rtk gh auth status
rtk gh api --method PUT repos/openwatersio/station-metadata/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
```

- [ ] **Step 5: Protect main and release tags**

Create `/tmp/station-metadata-main-ruleset.json` with `apply_patch`:

```json
{
  "name": "Protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "required_approving_review_count": 1,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": true,
        "required_status_checks": [{ "context": "test" }]
      }
    }
  ]
}
```

Create `/tmp/station-metadata-tags-ruleset.json` with `apply_patch`:

```json
{
  "name": "Protect release tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/tags/v*"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ]
}
```

Run each GitHub call separately, with a separate auth check immediately before it:

```bash
rtk gh auth status
rtk gh api --method POST repos/openwatersio/station-metadata/rulesets --input /tmp/station-metadata-main-ruleset.json
rtk gh auth status
rtk gh api --method POST repos/openwatersio/station-metadata/rulesets --input /tmp/station-metadata-tags-ruleset.json
rtk gh auth status
rtk gh api repos/openwatersio/station-metadata/rulesets
```

Verify both rulesets are active, then delete the temporary JSON files with `apply_patch`.

- [ ] **Step 6: Enable security features and verify the redirect**

Enable Dependabot alerts/security updates, secret scanning, push protection, and private
vulnerability reporting where the repository/account supports them. Read each setting
back through the GitHub API.

Verify separately:

```bash
rtk gh auth status
rtk gh repo view sailingnaturali/station-corrections --json nameWithOwner,url
```

Expected: GitHub resolves the old path to `openwatersio/station-metadata`.

---

### Task 6: Bootstrap npm and prove OIDC publishing

**Files:**

- Modify: `package.json` (`3.0.1` only after bootstrap)
- Modify: `package-lock.json` (`3.0.1` only after bootstrap)

**Interfaces:**

- Consumes: protected Open Waters repository and tested `3.0.0` tag.
- Produces: `@openwaters/station-metadata@3.0.1` as npm `latest` with GitHub OIDC provenance.

- [ ] **Step 1: Read the npm publishing skill and verify access**

Read `/Users/clarkbw/.codex/skills/npm-oidc-publish/SKILL.md` completely and follow its
new-package first-publish instructions.

Run:

```bash
rtk npm whoami
rtk npm org ls openwaters
rtk npm access list packages @openwaters
rtk npm view @openwaters/station-metadata version
```

Expected: the active account is an Open Waters org member with package-write access, and
the final command returns npm `E404` before bootstrap. Stop and leave the old package
untouched if access is absent or the package already exists unexpectedly.

- [ ] **Step 2: Create and verify the protected `v3.0.0` source tag**

Run:

```bash
rtk git status --short
rtk npm ci
rtk npm test
rtk npm run check:data
rtk node bin/station-metadata.mjs validate
rtk node bin/station-metadata.mjs check-slugs
rtk npm pack --dry-run
```

Expected: clean tree and all checks pass.

Create and push the annotated tag:

```bash
rtk git tag -a v3.0.0 -m "Station Metadata 3.0.0"
rtk git push origin v3.0.0
```

- [ ] **Step 3: Perform the one manual npm publish**

From the tagged commit, run interactively:

```bash
rtk npm publish --access public
```

Enter npm's OTP when prompted. Do not create a GitHub Release for `v3.0.0` because the
release workflow would attempt to republish the existing version.

Verify:

```bash
rtk npm view @openwaters/station-metadata@3.0.0 name version repository dist-tags
```

- [ ] **Step 4: Configure the npm trusted publisher**

In npm package settings, configure:

- organization/package: `@openwaters/station-metadata`;
- GitHub owner: `openwatersio`;
- repository: `station-metadata`;
- workflow filename: `publish.yml`;
- environment: leave blank unless the GitHub workflow is changed to name one.

- [ ] **Step 5: Prepare the no-behavior `3.0.1` release**

Create an isolated Open Waters worktree/branch `release/3.0.1`. Change only version fields
in `package.json` and `package-lock.json` to `3.0.1`.

Run:

```bash
rtk npm ci
rtk npm test
rtk npm run check:data
rtk node bin/station-metadata.mjs validate
rtk node bin/station-metadata.mjs check-slugs
rtk npm pack --dry-run
rtk git diff --exit-code origin/main -- data
```

Commit and push the branch, then open an Open Waters PR. Do not merge it. Wait for another
maintainer's approval and merge.

- [ ] **Step 6: Publish `3.0.1` through OIDC**

After the release PR merges, fetch `origin/main`, tag the exact merge commit `v3.0.1`, and
publish the GitHub Release. Wait for the `publish` workflow to complete.

Verify separately:

```bash
rtk gh auth status
rtk gh run list --repo openwatersio/station-metadata --workflow publish.yml --limit 3
```

Verify npm:

```bash
rtk npm view @openwaters/station-metadata@3.0.1 name version repository dist-tags --json
```

Inspect npm provenance and confirm repository, workflow, commit, and tag all name the
Open Waters release. Stop before consumer migration if provenance is absent or mismatched.

---

### Task 7: Migrate `chs-constituents`

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/derived.ts`
- Modify: `src/registry.ts`

**Interfaces:**

- Consumes: `@openwaters/station-metadata@^3.0.1` root and data subpath exports.
- Produces: unchanged CHS fitting behavior using the Open Waters metadata package.

- [ ] **Step 1: Create an isolated consumer worktree**

Fetch `origin/main` and create branch/worktree `deps/station-metadata` from that commit.

- [ ] **Step 2: Change the package dependency**

Run:

```bash
rtk npm install @openwaters/station-metadata@^3.0.1
```

Remove `@sailingnaturali/station-corrections` from the manifest if npm does not remove it
automatically.

- [ ] **Step 3: Change imports**

In `src/derived.ts` and `src/registry.ts`, replace only the package specifier:

```ts
"@openwaters/station-metadata"
```

and its existing `data/*` subpath where used. Keep imported symbol names unchanged.

- [ ] **Step 4: Verify and land**

Run:

```bash
rtk npm test
rtk npm run build
rtk rg -n "@sailingnaturali/station-corrections" package.json package-lock.json src
```

Expected: tests/build pass; search returns no matches. Commit only these four files, fetch
and rebase on `origin/main`, then push `HEAD:main` without force.

---

### Task 8: Migrate `signalk-currents`

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/registry-stations.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: `@openwaters/station-metadata@^3.0.1`.
- Produces: unchanged current-station resolution and Open Waters metadata links.

- [ ] **Step 1: Create isolated branch/worktree `deps/station-metadata` from `origin/main`**

- [ ] **Step 2: Install and change imports**

Run:

```bash
rtk npm install @openwaters/station-metadata@^3.0.1
```

In `src/registry-stations.ts`, replace the package specifier while retaining imported
symbols. In `README.md`, replace active package/repository links with the Open Waters
identities.

- [ ] **Step 3: Verify and land**

Run:

```bash
rtk npm test
rtk npm run build
rtk rg -n "@sailingnaturali/station-corrections|sailingnaturali/station-corrections" package.json package-lock.json src README.md
```

Expected: tests/build pass; no old references. Commit the four files, rebase on the latest
`origin/main`, and push `HEAD:main` without force.

---

### Task 9: Migrate deprecated `slackwater-web`

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/chsStations.ts`

**Interfaces:**

- Consumes: `@openwaters/station-metadata@^3.0.1`.
- Produces: reproducible final deprecated build with no legacy package dependency.

- [ ] **Step 1: Create isolated branch/worktree `deps/station-metadata` from `origin/main`**

- [ ] **Step 2: Install and change the import**

Run:

```bash
rtk npm install @openwaters/station-metadata@^3.0.1
```

Replace the package specifier in `src/chsStations.ts`; keep imported symbol names fixed.

- [ ] **Step 3: Verify and land**

Run:

```bash
rtk npm test
rtk npm run build
rtk rg -n "@sailingnaturali/station-corrections" package.json package-lock.json src
```

Expected: tests/build pass; no old references. Commit the three files, rebase on the latest
`origin/main`, and push `HEAD:main` without force. Do not revive deployment or transfer the
deprecated repository.

---

### Task 10: Migrate `slackwater-ios` tools

**Files:**

- Modify: `tools/package.json`
- Modify: `tools/package-lock.json`
- Modify: `tools/bundle.mjs`
- Modify: `tools/gen-chs-gates.mjs`

**Interfaces:**

- Consumes: `@openwaters/station-metadata@^3.0.1`.
- Produces: byte-identical generated station resources from the new package identity.

- [ ] **Step 1: Create the mandatory Slackwater worktree**

Fetch `origin/main`; create sibling worktree/branch `deps/station-metadata`. Never work on
the shared checkout or push to `main`.

- [ ] **Step 2: Snapshot generated resource hashes**

From `tools/`, run:

```bash
rtk npm test
rtk shasum -a 256 ../Slackwater/Resources/stations.json ../Slackwater/Resources/currents.json ../Slackwater/Resources/chs-stations.json ../Slackwater/Resources/chs-tombstones.json ../Slackwater/Resources/chs-gates.json ../Slackwater/Resources/chs-current-gates.json
```

Record the six hashes in the task log; do not add a hash file to the repository.

- [ ] **Step 3: Install and change imports**

From `tools/`, run:

```bash
rtk npm install @openwaters/station-metadata@^3.0.1
```

Replace package and data-subpath specifiers in `tools/bundle.mjs` and
`tools/gen-chs-gates.mjs`. Keep imported symbols and generated data behavior unchanged.

- [ ] **Step 4: Verify tool output and app tests**

From `tools/`, run:

```bash
rtk npm test
```

Recompute the same six resource hashes with the exact `shasum` command from Step 2.
Expected: every hash matches.

From repository root, run:

```bash
rtk test ./scripts/test.sh
rtk rg -n "@sailingnaturali/station-corrections" tools
```

Expected: tests pass; no old package references.

- [ ] **Step 5: Commit, push, and open the internal PR**

Commit only the four tool files. Fetch and rebase on `origin/main`, verify
`origin/main..HEAD` contains only this commit, push the branch, and open a PR against
`main`. The repository is private/internal, so open the PR without an extra publication
approval. Do not merge it; wait for another maintainer.

---

### Task 11: Update `currents-mcp` vendoring ownership

**Files:**

- Modify: `tests/test_registry_drift.py`
- Modify: `README.md`
- Verify unchanged: `src/currents_mcp/_registry.json`

**Interfaces:**

- Consumes: canonical checkout at `~/src/openwatersio/station-metadata`.
- Produces: local drift detection against the new owner without a network dependency.

- [ ] **Step 1: Create isolated branch/worktree `deps/station-metadata` from `origin/main`**

- [ ] **Step 2: Update the drift test**

Change the module docstring to name `@openwaters/station-metadata`. Replace `REAL` with:

```python
REAL = (
    Path(__file__).resolve().parents[3]
    / "openwatersio"
    / "station-metadata"
    / "data"
    / "registry.json"
)
```

Change the skip reason and failure message to `station-metadata`.

- [ ] **Step 3: Update README ownership links**

Replace the active GitHub/package references with
`openwatersio/station-metadata` and `@openwaters/station-metadata`. Do not edit completed
implementation plans.

- [ ] **Step 4: Verify and land**

Run:

```bash
rtk uv run pytest tests/test_registry_drift.py
rtk uv run pytest
rtk git diff --exit-code origin/main -- src/currents_mcp/_registry.json
```

Expected: all tests pass and vendored JSON has no diff. Commit the test and README, rebase
on the latest `origin/main`, and push `HEAD:main` without force.

---

### Task 12: Update organization and maintained documentation surfaces

**Files:**

- Modify: `sailingnaturali/.github/profile/README.md`
- Modify: `openwatersio/.github/profile/README.md`
- Modify: `infrastructure/workspace-CLAUDE.md`
- Modify: `currents-vault/README.md`
- Modify: `engineering/_posts/2026-07-23-canadian-chs-tide-current-station-data-licensing-no-provider-id-runtime-name-correlation-feist-cch.md`.
- Modify: `engineering/_posts/2026-08-11-tidal-gate-with-no-current-station-derived-slack-reference-tide-port-hw-lw-lag-chs-harmonic-fit-water-level-wlp-signalk-mcp.md`.
- Modify: `engineering/_posts/2026-08-26-current-station-coordinate-is-a-label-not-the-hydraulic-control-dodd-narrows-chs-position-off-throat-continuity-cross-section-area-over-prediction-station-registry.md`.

**Interfaces:**

- Consumes: canonical repository/package identities.
- Produces: accurate current ownership maps and durable links.

- [ ] **Step 1: Update Sailing Naturali surfaces**

Using isolated worktrees for each repository:

- remove the Station Corrections row from `sailingnaturali/.github/profile/README.md`;
- move the workspace repo-map entry in `infrastructure/workspace-CLAUDE.md` to the Open
  Waters section as `station-metadata`, with npm package `@openwaters/station-metadata`;
- update `currents-vault/README.md` to name Station Metadata and its Open Waters links;
- update direct repository/package links in these maintained engineering articles:
  `2026-07-23-canadian-chs-tide-current-station-data-licensing-no-provider-id-runtime-name-correlation-feist-cch.md`,
  `2026-08-11-tidal-gate-with-no-current-station-derived-slack-reference-tide-port-hw-lw-lag-chs-harmonic-fit-water-level-wlp-signalk-mcp.md`, and
  `2026-08-26-current-station-coordinate-is-a-label-not-the-hydraulic-control-dodd-narrows-chs-position-off-throat-continuity-cross-section-area-over-prediction-station-registry.md`.

Do not edit generated standups, completed plans, or old worktree copies.

- [ ] **Step 2: Update the Open Waters profile**

Clone `openwatersio/.github` under `~/src/openwatersio/.github`, create branch
`docs/station-metadata`, and add under `## 🌙 Tides`:

```markdown
- [station-metadata](https://github.com/openwatersio/station-metadata) — provider-neutral tide/current station identity, metadata, search aliases, and corrected positions ([npm](https://www.npmjs.com/package/@openwaters/station-metadata))
```

Push and open an Open Waters PR. Do not merge it.

- [ ] **Step 3: Verify and land SNI changes**

For each SNI repository, run its normal doc/site checks where defined, inspect
`git diff --check`, commit only the named files, rebase on latest `origin/main`, and push
`HEAD:main` without force.

For `engineering`, run:

```bash
rtk bundle exec jekyll build
```

If Bundler is not installed in the repository environment, run the repository's documented
build command instead and record the exact result.

---

### Task 13: Deprecate the old package and close the private work item

**Files:** None, except removal of the shipped design/plan from Station Metadata current tip.

**Interfaces:**

- Consumes: green Open Waters package, verified provenance, migrated consumers.
- Produces: one supported package identity and a completed private coordination record.

- [ ] **Step 1: Verify no active consumer retains the old dependency**

Search canonical active checkouts only:

```bash
rtk rg -n "@sailingnaturali/station-corrections" chs-constituents signalk-currents slackwater-web slackwater-ios currents-mcp
```

Expected: no active package/import/docs matches. Historical plans and stale worktrees are
outside this check.

- [ ] **Step 2: Re-verify npm and GitHub release state**

Run:

```bash
rtk npm view @openwaters/station-metadata dist-tags version repository --json
rtk npm view @sailingnaturali/station-corrections dist-tags version --json
```

Run separately:

```bash
rtk gh auth status
rtk gh release view v3.0.1 --repo openwatersio/station-metadata --json tagName,targetCommitish,url
```

Expected: new `latest` is `3.0.1`; old package still resolves; release is at the proven
commit.

- [ ] **Step 3: Deprecate every old version**

Run:

```bash
rtk npm deprecate "@sailingnaturali/station-corrections@*" "Moved to @openwaters/station-metadata: https://github.com/openwatersio/station-metadata"
```

Verify the deprecation message with `npm view`.

- [ ] **Step 4: Archive the shipped cutover docs**

In an isolated Station Metadata branch, delete:

- `docs/superpowers/specs/2026-08-29-station-metadata-cutover-design.md`
- `docs/superpowers/plans/2026-08-29-station-metadata-cutover.md`

Update `docs/README.md` with their Git-history retrieval commits. Open an Open Waters PR
and wait for another maintainer to merge it.

- [ ] **Step 5: Mark the private proposal items complete**

Update issue `openwatersio/slackwater-ios#221` to check the station-metadata transfer,
package publication, consumer migration, OIDC proof, and legacy deprecation tasks. Link
the canonical repository, npm package, `v3.0.1` release, and relevant consumer PR.

- [ ] **Step 6: Final verification**

Verify:

- old GitHub URL redirects to `openwatersio/station-metadata`;
- `main` and `v*` rulesets are active;
- CI is green at the exact `v3.0.1` commit;
- npm provenance names Open Waters and the correct workflow/tag;
- all four runtime consumers use `@openwaters/station-metadata`;
- station data and the `currents-mcp` vendored registry are byte-identical across the
  cutover;
- the private issue remains in the private Slackwater archive.

Record the evidence in the final task report; do not create another permanent report file.
