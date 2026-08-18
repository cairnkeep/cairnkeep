# Cairnkeep feature guide

**Baseline:** Cairnkeep 2.15.3

This is the step-back map for choosing and operating Cairnkeep features. The
[course labs](https://github.com/cairnkeep/cairnkeep-course-labs) provide one
synthetic Trail Ledger project with tagged states from a plain application to
offline evaluation. Detailed contracts remain in the linked operating,
storage, privacy, and lesson documents.

Guided setup and the maintained Pi memory extension shipped in v2.11. The v2.12
harness registry adds first-class Codex project setup without granting project
trust. See [L03](lessons/L03-first-project.md) and
[L23](lessons/L23-guided-setup.md) for the tested boundaries.
Version 2.13 adds local Git-linked work evidence around all generated harness
launchers; [L13](lessons/L13-session-evidence.md) covers its privacy and
retention contract.
Version 2.14 adds OKF 0.1/0.2 import, structured provenance,
deterministic links, and reviewed OKF 0.2 export; see
[L24](lessons/L24-okf-exchange.md).
Version 2.15 adds local bounded playbooks and private outcome receipts; see
[L25](lessons/L25-playbooks.md).
Version 2.15.3 makes generic task-derived, project-scoped retrieval precede
repository inventory or search and adds executable playbook receipt guidance
with command-scoped help. Retrieval remains a locator and actual tool
invocation must be verified from runtime evidence.

## The three-layer model

1. **Memory server:** an MCP process that owns scoped durable storage. The
   default stdio setup runs on the current machine; installation never
   discovers or selects a remote host.
2. **Project scaffold:** launchers, private environment, and `.planning/`
   policy/derived-knowledge files reconciled by `cairn setup`; `cairn bootstrap`
   remains the deterministic compatibility primitive.
3. **Operating layer:** harness commands, agents, and hooks installed by
   `cairn sync --apply` or the harness-specific equivalent.

Run setup in that order, then confirm `cairn doctor`, `cairn sync --check`, and
`cairn memory path` before trusting the installation.

## Recommended adoption sequence

| Stage | Add | Stop here when |
|---|---|---|
| 1 | Local memory, review, recall, history | Durable project context is the only goal |
| 2 | Wiki, alignment, graph, repository/security review | Tracked derived knowledge and quality workflows are sufficient |
| 3 | Backup, migration, multiple-machine routing | Storage placement and recovery are predictable |
| 4 | Document RAG or context exploration | An optional external corpus or faster repository exploration is justified |
| 5 | Trajectories, notes, compaction, artifacts, Git work evidence | Local session evidence has an explicit retention purpose |
| 6 | Typed nodes and capability governance | Filtering and centrally inspectable feature state are needed |
| 7 | Evaluation and ablation | A concrete change needs bounded measurement |
| 8 | Validated skill improvement | Repeated resolved hindsight warrants a measured skill change |
| 9 | Least-authority MCP profiles | A client should receive fewer tools than the default catalog |
| 10 | Immutable context packs and OKF exchange | Reviewed external context should be pinned or exchanged without becoming memory |
| 11 | Bounded project playbooks | Agents should select proportional workflow checks under inspectable local policy |

Every stage is independently useful. Stages 4-8 are opt-in and are not
prerequisites for ordinary memory.

## Core and derived knowledge

| Surface | Interface | Default and storage | Verify or reverse | Course checkpoint |
|---|---|---|---|---|
| Scoped memory | `/remember`, `/recall`, MCP memory tools | Available after MCP registration; named/global DBs under `CAIRN_AGENTFS_BASE_DIR`, project DB under `<server-cwd>/.agentfs/` | Recall in a new session; use reviewed delete/supersession rather than filesystem removal | `course-02-memory` |
| Memory lifecycle | `/memory-review`, `memory_supersede`, `memory_history`, reviewed apply/invalidate tools | Durable history; no automatic promotion | Inspect key history and provenance | `course-02-memory` |
| Wiki and alignment | `/wiki-ingest`, `/wiki-query`, `/wiki-lint`, alignment files | Written only when invoked; reviewable `.planning/` artifacts | Re-run lint, inspect source citations, revert tracked changes normally | `course-02-memory` |
| Local code graph | `cairn graph build|query|status|diff|explain|path`; `/graphify` delegates | Default off; optional isolated `graphify` executable; incremental work under `graphify-out/`, published view under `.planning/graphs/` | Ignore both derived locations; check status and source before trusting a result; use `--force` only after intentional deletion; uninstall adapters separately | `course-08-graph` |
| Repository quality | `/repo-review`, `/security-audit` | On-demand workflow; findings are hypotheses until reproduced | Require file/line evidence and regression tests | `course-03-quality` |
| Guided project setup | `cairn setup PATH --git init\|existing\|none --harness LIST --memory local\|none --yes` | Reconciles only selected project assets from one harness registry; private `.ai/cairnkeep.json`; machine sync is never automatic | Repeat deterministically, run doctor, or replay its recovery command; Git-less mode remains limited | `course-12-guided-setup` |
| Codex project memory | Select `--harness codex --memory local` | Writes `.codex/config.toml` plus POSIX/native Windows launchers; local stdio; user-wide configuration and trust remain untouched | Review the MCP table, accept Codex project trust, run doctor, and relaunch; uninstall is backup-first | `course-01-bootstrap` |
| Workflow playbooks and durable-context guidance | `cairn playbook check start|check|finish`; project `minimal`, `balanced`, or `strict` policy; managed `AGENTS.md` retrieval protocol | Balanced by default; private `.ai/playbooks.json`; one task-derived project search when applicable; optional receipts in `.agentfs/playbooks/`; checks are offline and execute nothing | Verify the actual memory tool event and maintained source, inspect status/digests, enforce truthful `must` evidence, inspect receipts, reset overrides, remove only the managed `AGENTS.md` block | `course-13-playbooks` |

## Storage and optional topology

| Surface | Enable | Data/network boundary | Verify or reverse | Course checkpoint |
|---|---|---|---|---|
| Backup/restore | `cairn memory path|export|import` | Export is WAL-safe for named/global DBs and requires `sqlite3`; import backs up replaced DBs and is not a merge | Restore first into a disposable store, then run doctor/recall | `course-04-operation` |
| Remote memory | Explicit authenticated HTTP server plus explicit client URL/token | Storage belongs to the server host; project headers route but are not authorization | Inspect effective routing and run legacy/project canaries; revert client registration to stdio | `course-04-operation` |
| Multiple machines | Deliberate local-per-machine or shared-server policy | No automatic account, host, or endpoint discovery | Predict the server process and DB path from each launcher before use | `course-04-operation` |
| Document RAG | Configure the optional RAG endpoint/key and workspace | Selected documents may leave the repository for the configured service | Verify citations and sync status; unset configuration to return to standalone memory | `course-04-operation` |
| Context exploration | Configure an operator-owned exploration binary or route endpoint | Source/context goes only to the selected local or remote component | Check citations/cache; remove variables and relaunch | `course-04-operation` |
| Containers | Rootless memory or workspace launcher | Named volumes persist; shared checkout mode is read/write, sandbox mode copies into a volume | Inspect mounts/volumes; remove only explicitly named disposable resources | `course-04-operation` |
| Managed overlays | Separate distribution manifest, wrapper, profile lock, fleet and rollback gates | Policy and secrets belong in the private distribution/machine config, never core | `overlay info`, doctor, fleet dry run/current state, rollback | `course-04-operation` |
| MCP tool profiles | `cairn mcp-tools set full|read-only|custom` | Strict mode-`0600` project config; process overrides take precedence; profile only removes tools | Inspect catalog/status digest; reset and restart MCP | `course-10-trust-context` |
| Context packs | Manual local or commit-pinned Git install plus project enablement | Immutable objects and atomic pointers under `CAIRN_PACK_BASE_DIR`; no background sync | Validate, inspect digest, check/apply update, disable/remove | `course-10-trust-context` |
| OKF exchange | `cairn pack validate-okf`, `import-okf`, and preview-confirm `export-okf` | Local import/export by default; explicit file/shared-note allowlist; redacted output | Inspect diagnostics/provenance/output list; exact-digest apply; disable/remove imported pack | `course-10-trust-context` |
| Pi local stdio memory | Select Pi during setup, then explicitly run `cairn sync-pi --apply` | Local memory-server child; dynamic effective tool catalog; annotations retained in trusted details, not a native Pi field | `cairn sync-pi --check`, `cairn doctor`, cancel one call, then observe awaited shutdown with no orphan | `course-12-guided-setup` |

## Evidence, governance, and measurement

| Surface | Explicit opt-in | Restart | Inspect and clean up | Course checkpoint |
|---|---|---|---|---|
| Trajectories | `CAIRN_TRAJECTORY_CAPTURE=1` | Relaunch harness | `cairn trajectory list|show|prune`; local, redacted, bounded, reasoning omitted | `course-05-evidence` |
| Hindsight notes | `CAIRN_NOTE_DISTILLATION=1` | No online callback; run job separately | `cairn notes distill|search-error|doctor|promote`; promotion requires corroboration/confirmation | `course-05-evidence` |
| Note enrichment | Distillation plus separate enrichment flag, endpoint, key, and model | No server restart for the offline job | Failure leaves deterministic note usable; unset enrichment flag | `course-05-evidence` |
| Compaction continuity | `CAIRN_COMPACTION_CAPTURE=1` | Sync assets and relaunch harness | Inspect provenance/age; remove retained local artifacts explicitly | `course-05-evidence` |
| Artifact tools | `CAIRN_ARTIFACT_STORE=1`; HTTP needs a second flag and existing HTTP auth | Restart MCP server when tool exposure changes | `cairn artifact list|show|delete|prune` with dry runs | `course-05-evidence` |
| Git-linked work evidence | `CAIRN_WORK_EVIDENCE=1`; optional patch also needs `CAIRN_WORK_EVIDENCE_PATCH=1` and the artifact store | Relaunch through a generated harness launcher | `cairn evidence list|show|delete|prune|doctor`; local only, no restore/apply | `course-05-evidence` |
| Typed nodes/import | `CAIRN_TYPED_MEMORY_NODES=1` | Restart MCP server; tool schema changes | Hard-filter search; dry-run, replay-safe import; `cairn doctor --repair` only for derived state | `course-05-evidence` |
| Capability contract | `CAIRN_CAPABILITY_CONTRACT=1` | MCP changes require restart; operating changes apply next invocation | `cairn capabilities list|status|enable|disable|reset|logging`; digest identifies state only | `course-06-governance` |
| Evaluation | `CAIRN_EVAL=1` for the coordinator process | No harness chosen by Cairnkeep | `validate` before `run`; inspect report, missingness and evidence scope; dry-run prune/delete | `course-07-evaluation` |
| Validated skill improvement | Reviewed recurring hindsight; proposal adapter; `CAIRN_EVAL=1` for evaluation | No server restart; explicit subprocesses only | `cairn skill list|show`; exact-digest apply; concurrent-edit-safe rollback | `course-09-skill` |
| General meta-agent loop | Not shipped | Not applicable | Playbooks select bounded existing actions; no generic configuration loop, command language, or scheduler | `course-07-evaluation` |
| Pack retrieval and skills | `CAIRN_CONTEXT_PACKS=1`; HTTP needs separate consent; skills need exact-digest approval | Restart MCP server | `cairn pack skills`; revoke approval or disable pack; no automatic execution | `course-10-trust-context` |

## Harness and maintenance checks

- Use a generated launcher so project environment and hooks are repeatable.
- For Codex, review `.codex/config.toml` and accept project trust; no machine
  sync is required for the memory-only integration.
- Run `cairn sync --check` after every core upgrade; apply only reported drift.
- Run `cairn sync-pi --check` when the Pi memory/trajectory/graph/playbook assets are installed.
- Run `cairn sync-kimi --check` when the optional Kimi graph/playbook Skills are installed.
- Use `cairn doctor --repair` only after preserving the affected store and only
  for repairable derived indexes/metadata.
- Use `cairn uninstall --dry-run` before uninstall; durable memory is retained
  unless purge is explicitly requested.
- Revisit the [storage guide](../storage.md) and
  [privacy/data-flow guide](../privacy-and-data-flow.md) before enabling a new
  network or retention path.
