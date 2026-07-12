# Constraints

Extracted from SPEC-classified docs. One entry per constraint with type (api-contract | schema | nfr | protocol).

---

## CON-git-provider-abstraction
source: .planning/ROADMAP.md (Phase 1 — Configurable git-provider abstraction)
type: api-contract
status: delivered (Phase 1 marked done in source)

Collaboration commands (`memory-sync`, `repo-review` / `code-review`, `security-audit`) must work against any git host (GitHub, GitLab, Codeberg/Forgejo, ...) selected by one config setting, never assuming a specific host.

Contract:
- A provider config key selects the git host
- A per-provider operation→tool map defines how each operation resolves
- Commands resolve all git-host operations through this map, never directly

---

## CON-mcp-e2e-verification
source: .planning/ROADMAP.md (Phase 2 — Operating-layer verification)
type: protocol
status: pending

The carved commands, agents, and hooks must work end-to-end against the `cairn-memory` MCP:
- Server registration succeeds
- remember / recall / memory-sync exercised successfully
- wiki / security / review flows exercised successfully
- Memory hooks (wakeup / capture / review) round-trip

---

## CON-bootstrap-parity
source: .planning/ROADMAP.md (Phase 3 — Docs + parity sign-off)
type: nfr
status: pending

A fresh `cairn bootstrap` must yield a working same-as-before workflow (drop-in parity with the originating workflow). The operating guide must be part of the OSS docs, and a baseline must be tagged at sign-off.
