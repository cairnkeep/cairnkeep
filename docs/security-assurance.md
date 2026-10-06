# Security assurance and threat model

This document describes Cairnkeep's security boundaries, the controls that
enforce them, and the risks that remain. It is an engineering contract, not a
certification. Report suspected vulnerabilities through the private process in
[SECURITY.md](../SECURITY.md).

## Security objectives

Cairnkeep aims to:

- keep project memory, local evidence, credentials, and approvals scoped to the
  intended project and operator;
- make network exposure explicit, authenticated, bounded, and closed by
  default;
- prevent persisted portable paths from changing meaning across POSIX and
  Windows;
- separate read-only observation from mutation and require explicit enablement
  for optional authority;
- make releases traceable to one reviewed Git tree with pinned build actions,
  dependency checks, an SBOM, and provenance.

Availability of the host, secrecy after an operating-system account compromise,
and correctness of an external model or harness are outside those objectives.

## Assets and trust boundaries

| Asset | Boundary | Principal controls |
|---|---|---|
| Project memory and local evidence | Project root and `.agentfs/` | Canonical project identity, contained paths, private files, scoped stores |
| Credentials and endpoint configuration | Process environment and `.ai/.env` | Local-only defaults, private-file checks, redacted diagnostics |
| MCP mutation authority | Effective tool catalog | Complete tool annotations, capability gates, read-only/custom profiles |
| Remote MCP transport | Authenticated HTTP listener | Fail-closed bearer auth, Host allowlist, opt-in CORS, body/header/time limits |
| Context-pack and skill content | Immutable digest-pinned objects | Portable path validation, content digests, explicit enablement and skill approval |
| Release artifacts | Reviewed Git tree and GitHub Actions | SHA-pinned actions, dependency review, CodeQL, SBOM, checksums and provenance |

The local stdio server trusts the account that launches it and the selected
project directory. An authenticated HTTP deployment is one trusted storage
domain: project-routing headers select a store but are not a user ACL. Harness
plugins and external retrieval/model services are separate principals and must
be enabled and evaluated independently.

## Threats and mitigations

| Threat | Mitigation and verification | Residual risk |
|---|---|---|
| Traversal, alternate separators, drive paths, ADS, forbidden Windows characters/device aliases, invalid Unicode, or case collisions in portable data | One cross-platform path validator is used by context packs, OKF, artifacts, and evaluations; deterministic adversarial cases run in the smoke suite | Filesystems can have additional locale- or mount-specific semantics; containment checks remain required at every write |
| Symlink or special-file substitution | Canonical roots, non-symlink regular-file checks, atomic replacement, and existing symlink/race regression tests | A hostile process running as the same account can race or replace resources outside Cairnkeep's process boundary |
| Unauthenticated or rebound HTTP access | HTTP refuses to start without a token, compares it in constant time, validates `Host`, denies CORS by default, and bounds headers, request time, keep-alive time, and bodies to 8 MiB | Bearer tokens are not user identities; deploy TLS at the ingress for non-loopback traffic |
| Excessive MCP authority | Explicit MCP annotations, restrictive profiles, capability intersection, and separate HTTP consent for sensitive optional tools | The default profile remains `full` for compatibility; operators should choose `read-only` or `custom` for observation-only clients |
| Malicious repository or context content influencing an agent | Memory results are locators, skills need digest-bound approval, pack content stays read-only, and maintained source must be verified | Prompt injection is not solved; the harness/model must continue treating retrieved text as untrusted data |
| Credential leakage through diagnostics | Security diagnostics report only presence, strength, file safety, and transport posture; tests assert token values never appear | A compromised process or account can read its own environment and files |
| Dependency or CI compromise | Production audits, dependency review, CodeQL, advisory Scorecard, selected Actions, mandatory full-SHA pins, release-candidate checks, SBOMs and attestations | These controls reduce risk but do not prove dependency or publisher authenticity |

## Local posture check

Run the read-only check from a configured project:

```sh
cairn security doctor --project .
cairn security doctor --project . --json
```

The command inspects project-root canonicalization and its immediate replacement
boundary, private managed files, the
effective MCP profile, HTTP token strength and token-file permissions, Host
allowlisting, least authority, and remote-transport encryption. It reads token
length, repetition, and header-safe syntax only; it never emits token content. `FAIL` makes the
command exit non-zero. `WARN` is an explicit risk decision and does not fail;
`SKIP` means the corresponding optional surface is disabled or absent.

HTTP Bearer values must use the RFC-compatible ASCII token alphabet
(`A-Z`, `a-z`, digits, `-._~+/`, with optional trailing `=`). Controls,
whitespace, Unicode, and multiline values fail closed before the listener starts.

The selected project's `.ai/.env` is parsed as literal assignments without
execution through a descriptor-bound 64 KiB read; ambient variables override
file values, and the generated launchers preserve that precedence. Relative
token-file paths are resolved from the selected project.
Symlinked `.ai` directories, replaceable project roots, unsafe private files,
and ambiguous shell expressions fail closed. POSIX checks require trusted
ownership as well as restrictive mode bits; an unquoted value is limited to a
small non-shell metacharacter alphabet, so quote values containing spaces or
punctuation.

`cairn doctor` remains the operational dependency/store check. Run both before
exposing HTTP, after changing tool authority, and before a security-sensitive
release.

## Repository and release controls

The public repository enables dependency vulnerability alerts and automated
security updates, secret scanning with push protection, selected GitHub
Actions, and required full-length action SHA pins. Pull requests run CodeQL and
dependency review. OpenSSF Scorecard runs on the default branch as advisory
evidence; it is not an authorization oracle.

The release workflow consumes the already-tested candidate for the exact Git
tree. It verifies the candidate manifest and checksums, publishes npm with
provenance, produces CycloneDX 1.6 and container SBOMs, and attests container
provenance. A digest proves content integrity, not publisher identity; verify
the repository, release tag, registry namespace, and provenance together.

## Deliberate non-goals and residual risks

- Cairnkeep is not a sandbox, endpoint-security product, secret manager, TLS
  terminator, or multi-user authorization service.
- It cannot make a malicious harness, model, plugin, repository, or retrieved
  document trustworthy.
- Local databases are protected by operating-system permissions, not
  application-level encryption.
- Same-account processes and host administrators remain trusted.
- Security checks are point-in-time evidence. Re-run them after configuration,
  dependency, network, or filesystem changes.

## Verification evidence

The maintained gates are `npm run security:baseline`, both production
`npm audit` checks, `scripts/test-security-baseline.sh`, the memory-server
security-assurance and HTTP-guard smoke tests, native-Windows tests, and the
complete public test matrix. The baseline gate also rejects
`pull_request_target` and every unpinned non-local GitHub Action.
