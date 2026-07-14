# Changelog

All notable user-facing changes are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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

[1.1.1]: https://github.com/cairnkeep/cairnkeep/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/cairnkeep/cairnkeep/compare/v1.0.5...v1.1.0
[1.0.5]: https://github.com/cairnkeep/cairnkeep/compare/v1.0.4...v1.0.5
