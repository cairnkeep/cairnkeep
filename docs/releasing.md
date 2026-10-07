# Releasing

Publishing is driven by a GitHub Release. Maintainers do not publish the package
from a workstation.

## Advisory Scorecard recovery

The repository's Actions policy must allow the exact pinned
`ossf/scorecard-action@<full-SHA-from-scorecard.yml>` reference. An entry ending
in `scorecard-action/*` does not allow the root action. Keep SHA pinning required;
do not enable all third-party actions to recover this one workflow.

If GitHub rejects a run before creating any jobs and refuses to retry it, fix
the repository allowlist and start a fresh advisory analysis explicitly:

```bash
gh workflow run scorecard.yml --ref main
```

This does not bypass required platform, CodeQL or dependency-review gates and
does not require republishing the npm package.

## Release contract

1. Update the root `package.json` version and `CHANGELOG.md` on a pull request.
2. Run `npm ci`, `npm run check:public`, and
   `npm --prefix mcp-memory-server test`.
3. Merge only after every required CI and security check passes. CodeQL and
   dependency review are blocking; OpenSSF Scorecard is advisory evidence.
4. Publish a GitHub Release whose tag is exactly `v<package.json version>`.
5. After every platform and runtime job passes, CI builds one release candidate
   keyed by the exact Git tree. It contains the npm tarball, reproducible
   CycloneDX 1.6 SBOM, checksums, and a tree/version manifest. CI retains it for
   30 days.
6. The `Publish release` workflow checks out the immutable tag, resolves its
   tree, and accepts a candidate only from a successful `CI` run for that exact
   tree. It verifies the manifest and checksums instead of rebuilding or
   repeating the complete test suite.
7. After candidate verification, npm publication and the memory-server and
   workspace container publications run in parallel. npm retains provenance;
   the containers retain their per-image SBOM and provenance attestations.
8. The workflow attaches the verified SBOM, npm tarball, and SHA-256 checksums
   to the GitHub Release. It publishes versioned `linux/amd64` and
   `linux/arm64` images to GHCR and updates `latest` for a stable release or
   `next` for a prerelease.
9. Verify both image digests, SBOM attestations, provenance attestations, and an
   anonymous pull before announcing the release.

The native-Windows lanes retain stable check names for branch protection. Each
lane exercises the Windows CLI and packed global install on its Node version,
while the complete memory-server smoke catalog is deterministically balanced
across the three lanes. The Linux Node 22/24/26 matrix independently runs the
complete catalog on every supported runtime. This preserves coverage while
removing three serial copies of the slow Windows suite from the critical path.

Stable versions must use a stable GitHub Release and publish to npm's `latest`
tag. SemVer prerelease versions must use a GitHub prerelease and publish to
`next`. A mismatch fails before publication.

The workflow is safe to rerun: it re-verifies the same CI candidate, skips
`npm publish` and each versioned OCI image when that exact version is already
present, retries attestations against the resolved image digests, and moves
only the `latest` or `next` channel tag. A versioned image tag is never rebuilt
or moved. If the tree-addressed candidate has expired, rerun CI for the exact
release commit before retrying publication; the workflow never substitutes a
different version or tree.

## Repository configuration

The repository must provide an `NPM_TOKEN` Actions secret authorized to publish
`@cairnkeep/cli`. Keep that credential out of local files and rotate it according
to the npm account's security policy. Workflow defaults grant only
`contents: read`; publication authority is explicit and job-scoped:

| Job | Token permissions | Purpose |
|---|---|---|
| `prepare` | `contents: read`, `actions: read` | Check the tag and download the successful exact-tree CI candidate; no publication or signing authority |
| `npm` | `contents: write`, `id-token: write` | Attach verified release assets and request npm provenance; registry publication uses the separate `NPM_TOKEN` |
| `containers` | `contents: read`, `packages: write`, `attestations: write`, `id-token: write`, `artifact-metadata: write` | Read source, publish OCI images, sign/upload provenance and create the pinned action's registry storage record |

Each job declares its complete permission map. Unspecified token permissions
are denied rather than inherited; see [GitHub's permission semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).
The container grant retains `artifact-metadata: write` because the pinned
[attestation implementation](https://github.com/actions/attest/blob/508db95dd578ae2727ebd6217d5ba78e4fbda05d/README.md#usage)
creates a storage record. Do not remove required provenance permissions merely
to improve an advisory score.

The parsed-YAML baseline rejects workflow-wide writes, unexpected publication
jobs and any missing or excessive grant in these maps. Its positive control
and mutation tests verify the declared contract, not GitHub's execution or a
future privileged publication. Keep the required platform/security gates and
verify the next normal release's publication and attestations separately.
CI-only permission changes do not require republishing an immutable version.

GitHub creates each new GHCR package as private. After the first container
release, a package administrator must change both `cairnkeep` and
`cairnkeep-workspace` to Public in their Package settings. This is a one-time,
irreversible visibility change for each package; subsequent releases remain
automatic. Confirm an unauthenticated pull after changing visibility.

Treat a published version as immutable. If a release is wrong, fix it in a new
version rather than moving its tag or replacing the npm package.

Repository Actions are restricted to the maintained allowlist and every
non-local action reference must use a full commit SHA. `npm run
security:baseline` enforces that contract, rejects `pull_request_target`, and
asserts that CodeQL, dependency review, and advisory Scorecard workflows remain
present. See [Security assurance and threat model](security-assurance.md) for
the wider threat model and residual risks.
