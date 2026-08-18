# Curriculum Coverage Map

**Baseline:** Cairnkeep 2.15.3
**Last reviewed:** 2026-08-18

This map prevents the course from drifting behind the product. It assigns each
user-facing surface to a lesson and records whether the lesson is complete or
still a production brief. A feature may be shipped while its lesson is still a
brief; the status must remain visible rather than implying that the exercise has
been rehearsed.

## Coverage

| Product surface | Introduced | Practised or operated | Learning status |
|---|---|---|---|
| Local stdio memory and MCP registration | L00-L02 | L03-L04 | L00-L03 Ready; L04 Brief |
| Guided project setup, launchers, and bootstrap compatibility/contributor mode | L02-L03 | L05 and L23 | L02-L03 and L23 Ready; L05 Brief |
| Declarative harness registry and Codex project-scoped MCP setup | L03 | L03 and L23 | Ready; project trust remains explicit |
| Memory scopes, keys, search, supersession, and history | L04 | L04-L05 | Brief |
| Wiki, alignment, and repository quality workflows | L05-L06 | L05-L06 | Brief |
| Optional local code graph, graph inspection, and harness delegates | L18 | L18 | Brief; default off |
| Storage placement, export/import, and authenticated remote memory | L07 | L07-L08 | Brief |
| Document RAG | L00 | L09 | Brief; optional |
| token-miser exploration and routing | L00 | L10 | Brief; optional |
| Rootless containers and persistent service operation | L01 | L11 | L01 Ready; L11 Brief |
| Private managed distributions | L12 | L12 | Brief; optional |
| Structured trajectories and Pi capture adapter | L13 | L13 | Brief; default off |
| Hindsight-note distillation, lookup, enrichment, and promotion | L13 | L13-L14 | Brief; default off |
| Compaction continuity and immutable artifacts | L13 | L13 | Brief; default off |
| Git-linked work evidence | L13 | L13 | Lab + recording outline; default off |
| Typed memory nodes, filters, address spaces, and structured import | L14 | L14 | Brief; default off |
| Managed eight-capability contract and payload-free callbacks | L15 | L15-L16 | Brief; default off |
| Deterministic two-pass evaluation and one-capability ablation | L16 | L16 | Brief; default off |
| Shell completion | L02 | L02 | Ready; optional convenience |
| Bounded meta-agent configuration loop | L17 | None | Design-only; not shipped |
| Reviewed, evaluated, reversible skill-file improvement | L19 | L19 | Ready; explicit and default off |
| Complete MCP annotations and least-authority tool profiles | L20 | L20 | Ready; default profile remains full |
| Immutable context packs and exact-digest skill approval | L21 | L21 | Ready; default off |
| Native Windows x64 CLI, hooks, ACLs, scheduling, and recovery | L22 | L22 | Ready; PowerShell-native |
| Guided project setup, selected harness state, and Git-less limitations | L03 | L03 and L23 | Ready |
| Pi local stdio memory bridge, trusted annotation details, and explicit lifecycle | L23 | L23 | Ready; Pi 0.84.1 validated minimum |
| OKF 0.1/0.2 validation/import, provenance, links, regressions, and reviewed 0.2 export | L24 | L24 | Ready; local/offline by default |
| Bounded project playbooks, generic memory retrieval guidance, enforcement, and private receipts | L25 | L25 | Ready; balanced/local by default; invocation requires runtime evidence; actor identity unverified |

## Release Review

For every minor release:

1. Compare the changelog and `cairn help` with this table.
2. Assign every new command, store, network flow, or runtime default to a
   lesson before release.
3. Re-run commands in every Ready lesson against the release candidate.
4. Update `Tested with` only after those commands pass.
5. Keep untested additions as Brief, even when the underlying feature ships.
6. Re-record only scripts whose observable behavior or mental model changed.

## Course Spine

The public `cairnkeep-course-labs` repository is the executable spine; this
repository remains the canonical source for explanations and scripts.

| Checkpoint | Lessons | Purpose |
|---|---|---|
| `course-00-app` | L00-L02 | Plain synthetic application before Cairnkeep |
| `course-01-bootstrap` | L03 | Guided local setup, Codex project configuration, and isolated environment |
| `course-02-memory` | L04-L05 | Memory lifecycle and derived knowledge |
| `course-03-quality` | L06 | Repository review and deliberately vulnerable fixture |
| `course-04-operation` | L07-L12 | Storage, routing, integrations, containers, overlays |
| `course-05-evidence` | L13-L14 | Evidence lifecycle and typed memory |
| `course-06-governance` | L15 | Capability precedence and restart boundaries |
| `course-07-evaluation` | L16-L17 | Package-owned offline fixture and design boundary |
| `course-08-graph` | L18 | Optional local structural graph workflow |
| `course-09-skill` | L19 | Validated skill improvement in a disposable project |
| `course-10-trust-context` | L20-L21 and L24 | MCP authority profiles, offline context-pack lifecycle, and reviewed OKF exchange |
| `course-11-windows` | L22 | Native PowerShell lifecycle, ACL inspection, and reversible uninstall |
| `course-12-guided-setup` | L23 | Deterministic setup, Pi local stdio, recovery, and backup-first uninstall |
| `course-13-playbooks` | L25 | Policy profiles, lifecycle decisions, enforcement, receipts, and ownership-safe instructions |

## Command Ownership

Every top-level CLI command has a teaching destination. This table is checked
against `cairn help` so a new command cannot bypass a curriculum decision.

| Command | Primary lesson |
|---|---|
| `cairn bootstrap` | L03 compatibility challenge |
| `cairn setup` | L03 for Claude/Codex; advanced Pi lifecycle in L23 |
| `cairn memory-server` | L02 |
| `cairn sync` | L02 |
| `cairn sync-pi` | L13 and L23 |
| `cairn sync-kimi` | L02 |
| `cairn doctor` | L03; advanced repair in L13-L14 |
| `cairn playbook` | L25 |
| `cairn trajectory` | L13 |
| `cairn artifact` | L13 |
| `cairn evidence` | L13 |
| `cairn capabilities` | L15 |
| `cairn mcp-tools` | L20 |
| `cairn pack` | L21 and L24 |
| `cairn notes` | L13 |
| `cairn eval` | L16 |
| `cairn skill` | L19 |
| `cairn graph` | L18 |
| `cairn memory` | L07-L08 |
| `cairn audit-timer` | L05 and L13 |
| `cairn uninstall` | L02 and L11-L12 |
| `cairn completion` | L02 |
| `cairn version` | L02 |
| `cairn help` | L02 |

## Claim Boundary

The bundled evaluation fixtures prove framework mechanics only. They do not
show that Cairnkeep improves quality, efficiency, cost, or latency. Course
material may teach how to design and inspect an experiment, but it must not make
a product-performance claim without separately validated live evidence.
