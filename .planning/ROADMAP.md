# Cairnkeep — roadmap

## Milestone: OSS core → parity
Bring the open-source core to feature parity with the originating workflow so it
can be adopted as a drop-in.

### Phase 1 — Configurable git-provider abstraction  *(in progress)*
Make the collaboration commands (`memory-sync`, `repo-review` / `code-review`,
`security-audit`) work against any git host (GitHub, GitLab, Codeberg/Forgejo, …)
selected by one config setting, instead of assuming one. Deliver a provider
config key + a per-provider operation→tool map, and rewire the commands to
resolve through it.

### Phase 2 — Operating-layer verification
Verify the carved commands, agents, and hooks work end-to-end against the
`cairn-memory` MCP: register the server, exercise remember/recall/memory-sync and
the wiki/security/review flows, fix breakage, and confirm the memory hooks
(wakeup/capture/review) round-trip.

### Phase 3 — Docs + parity sign-off
Bring the operating guide into the OSS docs, confirm a fresh `cairn bootstrap`
yields a working same-as-before workflow, and tag a baseline.

## Future milestones
- **Enterprise overlay (private)** — wraps the core with organization-specific
  launchers and config; lives only on the private remote, never here.
- **token-miser integration** — the routing + context-explore sibling, brought in
  as an optional companion.
