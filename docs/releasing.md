# Releasing

Publishing is driven by a GitHub Release. Maintainers do not publish the package
from a workstation.

## Release contract

1. Update the root `package.json` version and `CHANGELOG.md` on a pull request.
2. Run `npm ci`, `npm run check:public`, and
   `npm --prefix mcp-memory-server test`.
3. Merge only after every required CI check passes.
4. Publish a GitHub Release whose tag is exactly `v<package.json version>`.
5. The `Publish release` workflow checks out that immutable tag, repeats the
   tests, and publishes `@cairnkeep/cli` with npm provenance.
6. The workflow attaches the npm tarball, a CycloneDX SBOM, and SHA-256 checksums
   to the GitHub Release.

Stable versions must use a stable GitHub Release and publish to npm's `latest`
tag. SemVer prerelease versions must use a GitHub prerelease and publish to
`next`. A mismatch fails before publication.

The workflow is safe to rerun: it skips `npm publish` when that exact version is
already present, then regenerates and replaces the release artifacts.

## Repository configuration

The repository must provide an `NPM_TOKEN` Actions secret authorized to publish
`@cairnkeep/cli`. Keep that credential out of local files and rotate it according
to the npm account's security policy. The workflow grants only `contents: write`
and `id-token: write`; the latter is required for npm provenance.

Treat a published version as immutable. If a release is wrong, fix it in a new
version rather than moving its tag or replacing the npm package.
