# L23 - Guided setup and Pi memory

**Status:** Ready
**Track:** Quickstart and Operator
**Time:** 35 minutes
**Tested with:** Cairnkeep 2.10.0 package baseline plus the provisional,
unreleased v2.11 setup tree; Pi 0.84.1 provisional minimum; Node.js 22, 24,
and 26

This lesson exercises functionality in the current tree that is sequenced after
pending v2.10. It is not a v2.11 tag, package publication, or release claim.

## Outcome

You can classify a missing or empty target, replay setup without a TTY, explain
the limitations of Git-less mode, verify Pi's local stdio memory bridge, and
recover or uninstall every managed asset without hidden machine changes.

## Prerequisites

- Node.js 22 or newer, npm, and Git for the main exercise.
- Pi 0.84.1 or newer. Version 0.84.1 is the provisional minimum, not a final
  compatibility claim.
- A disposable parent directory containing no credentials, secrets, private
  state, or identifying project data.

## Exercise

Start with a missing target. The explicit flags make this deterministic and
safe to replay from a non-interactive or non-TTY process:

```bash
lab=/tmp/cairnkeep-guided-setup-lab
cairn setup "$lab" --git init --harness pi --memory local --yes
cd "$lab"
cairn doctor
```

Setup performs its classification before it creates `.ai`, `.planning`, or
`.agentfs`. It initializes Git only because `--git init` authorizes that action,
records the selected Pi harness in private `.ai/cairnkeep.json`, and reports
created, updated, unchanged, and skipped assets. Repeating the same `cairn
setup` command should report the managed files as unchanged.

Project setup never changes the Pi installation. Apply and check machine assets
explicitly, then diagnose the project again:

```bash
cairn sync-pi --apply
cairn sync-pi --check
cairn doctor
./.ai/start-pi.sh
```

In the disposable Pi session, list the registered Cairnkeep tools and make one
harmless read-only memory call. The extension starts `cairn memory-server` as a
local stdio child in this project; it does not select HTTP or a remote server.
Cancel one in-flight call and confirm a later read still works. Exit Pi normally
and confirm shutdown completes rather than leaving a memory-server child
running. Cancellation is per call and an awaited session shutdown owns child
termination.

The bridge discovers the effective server catalog. Full, read-only, and custom
MCP profiles therefore expose only the tools allowed by the server. It preserves
tool names, stable order, input and output schemas, original content,
`structuredContent`, `_meta`, and the exact Phase 21 annotations in trusted
bridge metadata and result `details`. Pi 0.84.1 has no native annotations field
in its public tool API: do not interpret this preservation as native
model-facing annotation propagation and do not invent such a field.

To see the intentional Git-less boundary in another empty disposable target:

```bash
limited=/tmp/cairnkeep-guided-setup-limited
cairn setup "$limited" --git none --harness pi --memory local --yes
cd "$limited"
cairn doctor
```

The result is `limited`, not `complete`. Launchers and local stdio memory remain
available, but repository-identity and Git-dependent features do not. An
existing non-Git tree is never initialized without explicit `--git init`.

## Recovery exercise

Delete one setup-owned launcher only in the disposable project, diagnose it,
then replay the exact recovery command:

```bash
cd /tmp/cairnkeep-guided-setup-lab
rm .ai/start-pi.sh
cairn doctor
cairn setup . --git init --harness pi --memory local --yes
cairn sync-pi --apply
cairn sync-pi --check
cairn doctor
```

Doctor reports project-state drift separately from missing or drifted Pi
machine assets. Setup repairs only recorded project assets; `cairn sync-pi
--apply` repairs only the package-owned Pi extension and prompt paths.

Preview backup-first removal before confirming it:

```bash
cairn uninstall --dry-run /tmp/cairnkeep-guided-setup-lab
cairn uninstall --yes /tmp/cairnkeep-guided-setup-lab
```

Inspect the printed backup bundle and generated revert script. Durable memory
and context packs remain unless their separate purge flags are supplied.

## Common failures

| Symptom | Cause | Recovery |
|---|---|---|
| Setup refuses a missing target | The non-interactive command omitted an explicit choice or `--yes` | Supply the target, `--git`, `--harness`, `--memory`, and `--yes` together |
| Setup refuses `--git existing` | The target is not inside a Git work tree | Choose an existing repository, or explicitly authorize `--git init`; use `--git none` only when limited mode is intended |
| Doctor reports missing or drifted Pi assets | Project setup selected Pi but machine sync is incomplete | Run `cairn sync-pi --apply`, then `cairn sync-pi --check` and `cairn doctor` |
| A cancelled call ends the session | The Pi/bridge version does not satisfy the per-call cancellation contract | Preserve sanitized diagnostics, close the session, and do not claim release readiness |
| Pi exits but a child process remains | Shutdown did not complete or the tested extension drifted | Preserve process-state evidence, run the sync check, and treat the release gate as failed |
| A client expects native annotation hints | Pi's public tool API has no annotations field | Inspect trusted bridge metadata/result `details`; never claim native propagation |

## Privacy and trust boundary

`.ai/cairnkeep.json` is private setup state. It records selected modes,
harnesses, and setup-owned asset digests—not credentials, secrets, endpoints, or
absolute paths. The Pi bridge is a local child-process boundary: it inherits the
operator environment needed by the local server, retains only bounded stderr
for failure diagnostics, and does not log tool arguments or results.

Use only synthetic values in exercises and evidence. Do not publish executable
paths, usernames, hostnames, repository names, environment values, child output,
memory content, or private state. The bridge adds tools only; it does not run
prompts, approve skills, create an autonomous loop, or add remote access.

## Release boundary

Ready means this lesson and its deterministic contracts pass against the current
tree. Final release readiness separately requires a non-skipping acceptance run
against separate Pi 0.84.1 minimum and explicitly versioned registry-current
installations, plus the documented Node.js, Bash 3.2, and native Windows matrix.
Those executable paths must differ, but both may report 0.84.1 while that is the
current release; a future registry advance requires its new exact version.
