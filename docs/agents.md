# Cairnkeep for coding agents

Cairnkeep gives a coding agent durable project context and bounded workflow
guidance. It does not replace repository inspection, decide what is true, or
turn a harness into an autonomous Cairnkeep runtime.

This guide is for both agents and the people configuring them.

## The agent contract

For a nontrivial task that may depend on previous decisions, conventions,
constraints, recurring failures, or prior work:

1. Derive one short query directly from the user's task.
2. If `memory_search` is available, make that project-scoped search the first
   tool or command. Do not inspect the repository first merely to formulate the
   query.
3. Treat every result as a locator. Read and verify the maintained repository
   sources it references before using it to make a change.
4. If the tool is unavailable or the result is irrelevant, continue with
   ordinary repository inspection. Do not repeat or broaden searches simply to
   force a memory hit.
5. Do not call `memory_write`, supersede a record, approve content, or promote
   durable knowledge unless the user or an applicable reviewed workflow
   explicitly requests capture.

This protocol improves continuity without allowing stale memory to outrank
code, tests, current documentation, or the user's request.

## What setup installs

`cairn setup` reconciles a delimited Cairnkeep block in the project's
`AGENTS.md` while preserving surrounding user content and file mode. The block
contains the durable-context contract above and bounded playbook instructions.
It can be removed independently with:

```bash
cairn playbook instructions remove
```

The selected harness determines which project assets setup creates. Setup
reports but never performs machine-level sync. Claude Code and OpenCode receive
the complete operating layer only after the operator runs the reported
`cairn sync --apply` command; Codex, Qwen, Kimi, and Pi have narrower
integrations. See [Harness compatibility](harness-compatibility.md) for the
exact tested surface. Instruction presence is not evidence that an agent
actually invoked a tool.

## Memory scopes and authority

Use `scope: project` for task-specific decisions and conventions. Broader
scopes may be configured, but an agent should not widen a search merely to find
an answer. The read-only virtual `all` scope is useful only when the task truly
crosses configured scopes.

Memory remains a secondary source:

```text
user request + maintained repository sources
                    ↓ verify
           durable memory locator
                    ↓ apply
             implementation decision
```

If a memory record conflicts with current code, tests, policy, or explicit user
direction, follow the current authoritative source and report the conflict.
Correct or supersede the durable record only through an explicitly approved
workflow.

## Bounded playbooks

The project policy in `.ai/playbooks.json` helps an agent decide which existing
recall, planning, verification, review, security, documentation, and learning
steps apply. Check it at task boundaries:

```bash
cairn playbook check start \
  --session SESSION \
  --complexity standard \
  --familiarity mixed

cairn playbook check check

cairn playbook check finish \
  --session SESSION \
  --changed PATH... \
  --risk normal \
  --completed ACTION... \
  --skipped ACTION=REASON... \
  --enforce
```

Complexity accepts `trivial`, `standard`, or `complex`; familiarity accepts
`known`, `mixed`, or `unfamiliar`; risk accepts `low`, `normal`, `high`, or
`security`. Follow every applicable `must` action, apply `should` actions unless
there is a concrete reason to skip them, and use judgment for `may` actions.
Re-check when scope, familiarity, complexity, or risk changes materially. Exit
3 means enforced `must` evidence is missing; exit 2 means invalid input or a
policy diagnostic. Neither is permission to relabel failed work as complete.

A playbook result selects existing actions only. It cannot:

- execute a command or workflow;
- enable a disabled feature or capability;
- activate a context-pack skill;
- grant approval or authorize destructive work;
- write or promote durable memory automatically; or
- prove that an agent followed the recommendation.

After a successful finish check, material outcomes can be recorded with the
exact policy and decision digests returned by the check. Run
`cairn playbook record --help` for the bounded values. Actor identity is a
caller-supplied local label, not authenticated identity.

## Tool authority

Every Cairnkeep MCP tool has explicit read-only, destructive, idempotent, and
open-world annotations. Operators can restrict discovery with a `read-only` or
exact custom profile:

```bash
cairn mcp-tools status
cairn mcp-tools set read-only
cairn mcp-tools set custom --tool memory_read --tool memory_search
```

Effective discovery is the intersection of available feature gates, the
capability contract, and the MCP tool profile. A profile can remove tools but
cannot enable a disabled feature. An annotation describes a tool; it does not
grant permission or replace the harness's approval policy. See
[MCP tool profiles](mcp-tool-profiles.md).

## Documents and skills from context packs

Enabled context-pack documents are read-only external context. Skill files are
invisible until an operator approves their exact project, pack digest, path,
and file digest. Even then, they are discoverable text through MCP—not copied
into a harness, automatically activated, or executed. A pack update invalidates
the old approval. See [Immutable context packs](context-packs.md).

## Graceful fallback

Cairnkeep should never block ordinary engineering merely because optional
context is unavailable:

- No memory tool: inspect the repository and state the limitation.
- No relevant memory: continue after the single bounded search.
- No playbook CLI or capability: follow the documented policy intent manually;
  never invent a successful check or receipt.
- Embedding endpoint failure: supported searches fall back to deterministic
  local substring matching.
- Disabled tool or feature: do not work around the operator's authority
  boundary.

Run `cairn doctor` when the project is expected to have Cairnkeep wiring but a
tool, launcher, or managed asset is missing.

## Operator checklist

Before expecting an agent to use Cairnkeep:

1. Configure the project with `cairn setup` for the intended harness.
2. Run `cairn doctor` and review any operator-owned files reported as skipped.
3. Inspect the managed `AGENTS.md` block and `.ai/playbooks.json` policy.
4. Review the effective catalog with `cairn mcp-tools status`.
5. Keep durable memory concise and point it at maintained sources whenever
   possible.
6. Treat runtime evidence—not instruction presence—as proof of tool use.

Continue with the [quickstart](quickstart.md), the
[operating guide](operating.md), and the
[privacy and data-flow reference](privacy-and-data-flow.md).
