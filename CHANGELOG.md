# Changelog

All notable user-facing changes are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-07-15

### Breaking

- Require Node.js 22 or newer. Node.js 18 and 20 are end-of-life upstream;
  Cairnkeep 1.x remains available for machines that cannot upgrade yet.

### Changed

- Upgrade the runtime schema dependency to Zod 4 in both package manifests.
- Build with TypeScript 7 against Node.js 22 type definitions.
- Exercise Node.js 22, 24, and 26 on Linux, retain real macOS installation
  coverage, and verify the packed package at the Node.js 22 runtime floor.

The memory database format, default storage location, remote HTTP protocol,
and project scaffold format are unchanged. Upgrading does not migrate or delete
stored memories.

## [1.1.3] - 2026-07-14

### Fixed

- Allow the standard `$schema` self-reference in strict overlay manifests and
  verify that the shipped example uses only declared top-level properties.

## [1.1.2] - 2026-07-14

### Added

- Define a provider-neutral managed-distribution contract for private overlays.
- Ship a versioned overlay manifest schema and local-first example.
- Document wrapper commands, profile locks, data-routing diagnostics, private
  registry delivery, package hygiene, fleet migration, and rollback practices.

## [1.1.1] - 2026-07-14

### Fixed

- Ship and resolve the default document-RAG sync helper from the npm package,
  with user-owned XDG config/state paths and legacy-path compatibility.
- Make repository CI install locked root dependencies before running checks.
- Make the clean macOS bootstrap test create its target directory explicitly.

### Changed

- Add release-to-npm automation with provenance, tarball, and SBOM artifacts.
- Document supported clients, platforms, storage placement, and optional data
  flows more explicitly.
- Add community contribution, support, and conduct templates.

## [1.1.0] - 2026-07-13

### Added

- Add authenticated remote HTTP memory with stable per-project session routing.
- Add explicit client routing headers for scopes and document-RAG workspaces.
- Document local, remote, export, backup, and bearer-token deployment models.

## [1.0.5] - 2026-07-13

### Fixed

- Make the npm tarball install self-contained and verify it on clean systems.
- Preserve executable permissions and Bash 3.2 portability on macOS.
- Add backup-first uninstall and SQLite-safe memory export/import guidance.

[2.0.0]: https://github.com/cairnkeep/cairnkeep/compare/v1.1.3...v2.0.0
[1.1.3]: https://github.com/cairnkeep/cairnkeep/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/cairnkeep/cairnkeep/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/cairnkeep/cairnkeep/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/cairnkeep/cairnkeep/compare/v1.0.5...v1.1.0
[1.0.5]: https://github.com/cairnkeep/cairnkeep/compare/v1.0.4...v1.0.5
