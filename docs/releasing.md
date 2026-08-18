# Releasing

Publishing is driven by a GitHub Release. Maintainers do not publish the package
from a workstation.

## Release contract

1. Update the root `package.json` version and `CHANGELOG.md` on a pull request.
2. Run `npm ci`, `npm run check:public`, and
   `npm --prefix mcp-memory-server test`.
3. Merge only after every required CI check passes.
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
to the npm account's security policy. The workflow grants `actions: read`,
`contents: write`, `packages: write`, `attestations: write`, and
`id-token: write`. Read access resolves the successful tree-addressed CI
artifact; the last two permissions are required for registry-backed build
provenance.

GitHub creates each new GHCR package as private. After the first container
release, a package administrator must change both `cairnkeep` and
`cairnkeep-workspace` to Public in their Package settings. This is a one-time,
irreversible visibility change for each package; subsequent releases remain
automatic. Confirm an unauthenticated pull after changing visibility.

Treat a published version as immutable. If a release is wrong, fix it in a new
version rather than moving its tag or replacing the npm package.
