<purpose>
Review memory candidates staged by the SessionEnd hook (memory-capture.sh) and
accept (write to AgentFS) or discard them. This is the accept gate between
autonomous extraction and durable writes.
</purpose>

<required_reading>
@$HOME/.config/opencode/templates/wiki-policy.md.template
</required_reading>

<process>

## 0. Initialize Repo Context

Resolve the repo root and staging dir:

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT"
STAGING="$ROOT/.planning/memory-staging"
```

Parse `--all` from `$ARGUMENTS` (default: newest session only).
If `$STAGING` is missing or has no `*.json`, report "No staged memory candidates to review" and stop.

## 1. Load Staged Candidates

- default: read the newest `*.json` only
- `--all`: read every `*.json`, oldest first

Each file is the JSON from `mcp-memory-server extract`:
`{ model, count, candidates: [{ key, value, category, importance, rationale }] }`

## 2. Review Each Candidate (judgment gate)

For each candidate, apply acceptance rules:
- **Accept**: durable, branch-safe, short fact/decision/pitfall/convention that future sessions benefit from and is not already in AgentFS. Check duplicates with `memory_search` on the candidate's key/terms.
- **Discard**: branch-local/speculative, a restatement of canonical code/config, trivial/transient, or already in AgentFS.

Classify scope: `project` (default), `domain-engineering` (reusable patterns), `identity` (user facts only).

## 3. Write Accepted Candidates

For each accepted candidate, call the cairn-memory MCP:
```
memory_write(scope="<scope>", key="<key>", value="<value>", promote_to="<category if applicable>")
```
If it supersedes an existing entry (same key, updated value), use `memory_supersede(scope, key, value, reason)`.

## 4. Clear Staging

Delete staged files whose candidates have been fully reviewed (accepted or discarded). With `--all`, clear the entire staging dir once done.

## 5. Report

Summary: N reviewed, N accepted (→ AgentFS), N discarded, N superseded. Accepted facts are now durable across both harnesses.

</process>

<success_criteria>
- [ ] Staging dir read; candidates parsed
- [ ] Each candidate judged (durable, branch-safe, non-duplicate)
- [ ] Accepted candidates written via memory_write / memory_supersede
- [ ] Reviewed staging files cleared
- [ ] No speculative, branch-local, or trivial claims written to AgentFS
</success_criteria>
