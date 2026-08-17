# Changelog

All notable user-facing changes are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Add validation and immutable context-pack import for Open Knowledge Format
  0.1/0.2 bundles, preserving structured source, trust, freshness, and gap
  diagnostics without activating computations or instructions.
- Add deterministic digest-keyed document links and the read-only,
  closed-world `context_pack_related` MCP observation.
- Add allowlist-only, redacted OKF 0.2 export for named project Markdown and
  promoted shared notes, with a no-write preview and exact-digest atomic apply.
- Add offline retrieval/freshness/gap regression fixtures and an explicit
  decision gate for any future external knowledge-system adapter.

## [2.13.1] - 2026-08-17

### Fixed

- Generate release SBOMs directly as reproducible, schema-validated CycloneDX
  1.6 documents with the pinned official npm generator. This replaces npm's
  invalid CycloneDX 1.5 output and fails publication before attaching a broken
  SBOM.

## [2.13.0] - 2026-08-17

### Added

- Add opt-in, local Git-linked work evidence for all six generated harness
  launchers and native Windows, with bounded start/end state, touched paths,
  append-only trajectory/artifact/reviewed-memory links, lifecycle CLI and two
  local read-only MCP observations.
- Add separately consented, redacted patch artifacts and document their
  start-commit scope, pre-existing-dirty limitation and omitted untracked bodies.

## [2.12.0] - 2026-08-13

### Added

- Add one declarative harness registry for setup choices, project assets,
  launcher generation, diagnostics, native Windows, and lifecycle tooling.
- Add first-class Codex CLI setup with a project-scoped local stdio MCP entry,
  POSIX and native Windows launchers, explicit project-trust guidance, and a
  memory-off path that creates no MCP configuration.
- Add a five-minute quickstart and Codex route to the public learning path.

### Changed

- Derive guided setup policy validation and required-asset diagnosis from the
  shared harness catalog. Codex/Qwen-only setup now reports that no machine
  sync is required instead of suggesting unrelated operating assets.
- Extend bootstrap contributor mode, backup-first uninstall, schema validation,
  package checks, and native Windows coverage to Codex-owned project files.

## [2.11.0] - 2026-08-12

### Added

- Replace the Bash npm entry point with a cross-platform Node CLI while keeping
  the established Unix scripts as compatibility implementations.
- Add native Windows x64 bootstrap and `.cmd`/PowerShell launchers, Claude/Pi/
  Kimi asset synchronization, Node hook transports, diagnostics, PowerShell
  completion, Task Scheduler registration, memory import/export plumbing, and
  backup-first uninstall with a `revert.ps1` manifest.
- Enforce private Windows ACLs for least-authority MCP profiles and context-pack
  state, make pack objects read-only, retry Windows atomic replacements, and
  terminate evaluation adapter descendant trees through `taskkill.exe /T`.
- Add a PowerShell-only Windows CI matrix for Node 22/24/26, including native
  lifecycle tests and a packed global npm installation under paths containing
  spaces and Unicode.

### Changed

- Add PowerShell to shell completion and document Windows x64 as a supported
  native platform. Windows ARM64 remains an x64-emulation target until the
  storage dependency ships a native ARM64 binding.

### Added

- Add `cairn setup` as the recommended guided project entry point, with a fully
  deterministic non-interactive form, explicit Git/harness/memory choices,
  versioned private project state, selected-asset reconciliation, structured
  output, doctor diagnostics, and recovery commands.
- Add a strict provider-neutral setup-policy schema for private overlays, with
  command-line choices taking precedence over policy defaults and constraints
  enforced on every resolved plan.
- Add the maintained Pi local stdio memory extension, dynamic MCP catalog
  discovery, bounded child lifecycle, cancellation, exact response preservation,
  and trusted annotation metadata. Pi 0.84.1 is the validated minimum.

### Changed

- Make project setup report machine sync without running it automatically;
  `cairn sync-pi --apply|--check`, `cairn doctor`, and backup-first uninstall
  remain explicit lifecycle operations.
- Preserve `cairn bootstrap` and `--untracked` as backward-compatible scripted
  primitives while recommending guided setup for new onboarding.

## [2.9.0] - 2026-08-06

### Added

- Publish complete, centralized MCP tool annotations and add project-scoped
  `full`, derived `read-only`, and exact custom tool profiles with strict
  environment precedence and canonical provenance digests.
- Add immutable context-pack manifests, local and commit-pinned Git installs,
  atomic project enablement and confirmed updates, retained object storage,
  integrity diagnostics, and explicit uninstall purge consent.
- Add read-only context-pack list/search/read tools behind separate local and
  authenticated-HTTP consent gates. Documents include full provenance; skills
  remain invisible until their exact project/pack/path/file digest is approved.
- Add deterministic Markdown chunking, optional embedding-ranked retrieval with
  offline substring fallback, shell completion, lifecycle tests, operator docs,
  and learning-path exercises.

Context packs add no runtime dependency, telemetry, background synchronization,
publisher-authenticity claim, ACL system, automatic skill activation, or
  provider-specific runtime integration.

## [2.8.0] - 2026-08-03

### Added

- Add `cairn skill harvest|list|show|review|propose|evaluate|apply|rollback`
  for turning recurring hindsight evidence into explicitly reviewed, bounded,
  independently evaluated, reversible skill-file improvements.
- Add strict proposal-adapter schemas and environment allowlisting, immutable
  baseline/candidate worktree overlays, disjoint exploration and confirmation
  gates, exact-digest application, private backups, and concurrent-edit-safe
  rollback.
- Add installed-style CLI and shell-completion coverage, an end-to-end Git
  worktree evaluation fixture, and documentation for consent, storage,
  inference ownership, evaluation limits, and recovery.

The lifecycle is local and operator-controlled. It performs no proposal call
before evidence approval, evaluation remains disabled unless `CAIRN_EVAL=1`,
and no candidate is applied automatically. Existing MCP tools, memory storage,
remote HTTP clients, and project launchers are unchanged.

## [2.7.0] - 2026-08-02

### Added

- Add a Cairnkeep-owned `cairn graph build|query|status|diff|explain|path`
  workflow, matching Claude Code and OpenCode `/graphify` modes, shell
  completion, local-only code indexing, atomic publication, and snapshot diffs
  without installing Graphify-owned harness assets or re-indexing generated
  graph artifacts; add thin Pi prompt and Kimi Skill adapters that expose
  `/graphify` while delegating exclusively to `cairn graph`, with explicit sync,
  uninstall, package, and shell-completion coverage.

## [2.6.0] - 2026-07-29

### Added

- Add Qwen Code as a supported memory client with a generated project launcher,
  local stdio guidance, and tested authenticated remote HTTP configuration.
- Expand the harness comparison to cover current native plugin and MCP clients,
  while keeping memory-only support separate from the full operating layer.

## [2.5.0] - 2026-07-29

### Added

- Add Kimi Code as a supported memory client with a generated project launcher,
  local stdio guidance, and tested authenticated remote HTTP configuration.
- Add an explicit harness compatibility matrix and a documented validation
  process for future MCP clients.

### Fixed

- Document that Kimi requires a literal MCP URL and a token reference through
  `bearerTokenEnvVar`, preventing invalid `${VAR}` URL configurations without
  writing bearer-token values to project files.

## [2.4.0] - 2026-07-29

### Added

- Add opt-in, local-only, structured Claude Code and OpenCode session
  trajectories with pre-write redaction, reasoning omission, bounded retention
  and no model or network dependency.
- Add `cairn trajectory list|show|prune`, shell completion, and explicit
  `cairn doctor --repair` support for trajectory metadata and indexes.
- Add native Pi trajectory capture through its `session_shutdown` extension,
  `cairn sync-pi`, a generic Pi launcher, uninstall coverage, and the same
  opt-in local redaction, size, and retention boundary as other harnesses.
- Add default-off deterministic hindsight-note distillation, exact repeated
  error lookup, typed local Markdown hierarchy, lifecycle history, explicit
  corroborated shared promotion, and `cairn notes` CLI/completion support.
- Add separately opted-in provider-neutral note prose enrichment and integrate
  all-project incremental distillation into the existing audit timer without
  adding online-agent latency.
- Add default-off typed memory metadata/tags, hard-filtered discovery,
  history-aware structured `memory_import`, and logical project/shared note
  address spaces with journaled crash recovery and doctor integration.
- Add independent default-off compaction continuity for supported Claude Code
  and OpenCode seams, capturing only harness-produced summaries into local,
  redacted, bounded immutable revisions with structured fresh-session recovery.
- Add a separate local artifact store for compaction summaries, diffs, test
  output, and generated-file metadata/snapshots; four gated MCP tools;
  `cairn artifact list|show|delete|prune`; doctor, completion, package, and
  backup-first uninstall coverage; and separately consented HTTP access.
- Add a default-off managed contract for eight existing capabilities, including
  project CLI overrides, compatibility-aware status/digests, exact MCP tool
  omission, guarded installed workflows, and separately consented payload-free
  local callback records.
- Add a default-off, adapter-driven two-pass evaluation harness with immutable
  task sets, paired seeds, confidence intervals, per-capability ablations,
  deterministic offline fixtures, bounded reports, and exact-source runtime
  evidence without claiming an unmeasured quality improvement.
- Add a design-only meta-agent contract describing how future configuration
  proposals could be evaluated through the existing harness without giving
  Cairnkeep ownership of an agent or inference loop.

### Fixed

- Load the native OpenCode capability plugin through its supported single-export
  shape, run its coordinator with Node under OpenCode's Bun host, accept the
  pinned runtime event envelope, and settle terminal callbacks before the host
  can exit.
- Layer `CAIRN_EXTRA_SETTINGS` through OpenCode's supported
  `OPENCODE_CONFIG` environment seam and keep headless graph commands in the
  tool-calling path until their real owner operation completes.
- Pin the Claude Code 2.1.220 `PostCompact` `prompt_id` payload shape alongside
  the retained 2.1.219 adapter while continuing to refuse unknown versions.
- Preserve redacted Pi provider failures as trajectory system events and treat
  a closed trajectory CLI output pipe as a normal consumer exit.
- Make the audit script executable so its rendered systemd service target can
  run directly.
- Bind evaluation note distillation to the admitted task workspace so nested
  task trajectories cannot be missed or replaced by a source-root fallback.
- Upgrade the MCP SDK to 1.30.0 so both package graphs use the upstream-owned,
  patched Hono transport and report zero production vulnerabilities.

Trajectory/compaction capture, artifact access, and note distillation/enrichment remain disabled by default. Existing
MCP tools, memory database paths, and remote HTTP behavior are unchanged. No
memory-quality or efficiency improvement is claimed before the evaluation
harness measures it.

## [2.3.1] - 2026-07-25

### Fixed

- Refresh locked runtime dependencies to include the `fast-uri` host-confusion
  fix and the `body-parser` request-limit fix used by the memory server build.
- Reject high-severity runtime advisories in the public, CI, and release gates.

## [2.3.0] - 2026-07-25

### Added

- Add `cairn completion bash|zsh|fish` for generating completion definitions
  that distributions or users can install through each shell's standard
  mechanism.
- Exercise every generated definition and reject unsupported shell names in
  the repository test suite.

## [2.2.1] - 2026-07-20

### Fixed

- Make default sandbox-volume names path-specific so same-named repositories
  cannot share a workspace accidentally.
- Refuse to merge repository content into a non-empty unmarked workspace
  volume.
- Document that sandbox copies include untracked files and must be treated as
  sensitive persistent data.

## [2.2.0] - 2026-07-20

### Added

- Add unprivileged memory-server and workspace OCI images with rootless Podman
  launchers, authenticated HTTP deployment examples, and persistent storage.
- Add isolated-copy and explicit shared-checkout workspace modes for private
  derived distributions.
- Verify stdio startup, HTTP authentication, memory persistence across
  replacement, and both workspace modes in container CI.

## [2.1.0] - 2026-07-16

### Added

- Add `memory_apply_reviewed` for idempotent application of externally reviewed
  memory revisions with durable provenance and collision-safe history.
- Add `memory_invalidate_reviewed` for revision-matched retraction and durable
  tombstones that prevent delayed writes from resurrecting invalid memory.
- Add end-to-end checks for replay, supersession, manual changes, retraction,
  tombstones, and reserved provenance records.

### Changed

- Make history snapshot keys unique when multiple revisions occur in the same
  millisecond.

The existing memory tools, database locations, and remote HTTP routing contract
are unchanged. Existing clients remain compatible and reviewed-memory records
are created only when an integration explicitly invokes the new tools.

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

[Unreleased]: https://github.com/cairnkeep/cairnkeep/compare/v2.13.1...HEAD
[2.13.1]: https://github.com/cairnkeep/cairnkeep/compare/v2.13.0...v2.13.1
[2.13.0]: https://github.com/cairnkeep/cairnkeep/compare/v2.12.0...v2.13.0
[2.12.0]: https://github.com/cairnkeep/cairnkeep/compare/v2.11.0...v2.12.0
[2.11.0]: https://github.com/cairnkeep/cairnkeep/compare/v2.9.0...v2.11.0
[2.9.0]: https://github.com/cairnkeep/cairnkeep/compare/v2.8.0...v2.9.0
[2.8.0]: https://github.com/cairnkeep/cairnkeep/compare/v2.7.0...v2.8.0
[2.7.0]: https://github.com/cairnkeep/cairnkeep/compare/v2.6.0...v2.7.0
[2.6.0]: https://github.com/cairnkeep/cairnkeep/compare/v2.5.0...v2.6.0
[2.5.0]: https://github.com/cairnkeep/cairnkeep/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/cairnkeep/cairnkeep/compare/v2.3.1...v2.4.0
[2.3.1]: https://github.com/cairnkeep/cairnkeep/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/cairnkeep/cairnkeep/compare/v2.2.1...v2.3.0
[2.2.1]: https://github.com/cairnkeep/cairnkeep/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/cairnkeep/cairnkeep/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/cairnkeep/cairnkeep/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/cairnkeep/cairnkeep/compare/v1.1.3...v2.0.0
[1.1.3]: https://github.com/cairnkeep/cairnkeep/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/cairnkeep/cairnkeep/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/cairnkeep/cairnkeep/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/cairnkeep/cairnkeep/compare/v1.0.5...v1.1.0
[1.0.5]: https://github.com/cairnkeep/cairnkeep/compare/v1.0.4...v1.0.5
