---
description: Run a governed local security audit against one scoped attack surface and write repo-local artifacts
argument-hint: "[--full] [--focus <path>] [--threat-model <name>] [--verify-only] [--create-confidential-issue] [--issue-project <group/project>]"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
---

<objective>
Run one governed local security assessment against the current repository: select one narrow target, investigate it, validate at most one candidate finding, and preserve the outcome under `.planning/security/`.

Output artifacts:
- `.planning/security/REPORTS/<timestamp>.md`
- `.planning/security/CANDIDATES/<timestamp>-candidate.md`
- `.planning/security/VALIDATED/SEC-xxxx-<slug>.md` for accepted findings
- optional `.planning/security/ISSUES/<timestamp>-confidential-issue.md`
- optional update to `.planning/security/FINDINGS.yaml`

Flag handling:
- `--full` — inspect the broader repository instead of the changed surface only
- `--focus <path>` — bias target selection toward one file or subtree
- `--threat-model <name>` — label and bias the run; defaults to `changed-surface`
- `--verify-only` — write the audit artifacts without mutating `.planning/security/FINDINGS.yaml`
- `--create-confidential-issue` — create a repo-local confidential issue draft when an accepted finding exists
- `--issue-project <group/project>` — record the intended git-provider destination for that issue draft

This is a governed local-only workflow. It must stay inside the current repository, repo-owned local processes, local files, and localhost services launched from this repo.

Recommended `--threat-model` values: `changed-surface` (default), `authenticated-http-request`, `privilege-escalation`, `session-upgrade`, `deserialization`, `archive-extraction`, `path-traversal`, `subprocess-injection`, `config-file-injection`, `localhost-service-abuse`, `native-crash`, `memory-corruption`. Use a short concrete phrase that helps the selector and investigator reason about attacker capability or failure mode.
</objective>

<context>
Arguments: $ARGUMENTS

Scaffold templates live at `$HOME/.claude/templates/security-*.template` (installed by `scripts/sync-claude-assets.sh`). The bootstrap also seeds `.planning/security/POLICY.md` and `.planning/security/FINDINGS.yaml` into each project.

Operating model:
- one scoped target per run
- one candidate finding per run at most
- rejected outcomes stay in the run history, not in the canonical ledger
- accepted findings may update `.planning/security/FINDINGS.yaml` unless `--verify-only` is set
- repo-local drafts are preferred over speculative issue filing side effects
</context>

<process>

## 0. Initialize repo context

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT" ]; then
  echo "Not inside a git repository. /security-audit must run from a project repo."
  exit 1
fi
cd "$ROOT"
```

Parse flags from `$ARGUMENTS` (`--full`, `--focus`, `--threat-model`, `--verify-only`, `--create-confidential-issue`, `--issue-project`).

Rules:
- `audit_mode` is `full` when `--full` is set, otherwise `diff`
- default `threat_model` to `changed-surface` when no explicit value is supplied
- `--issue-project` is optional metadata; do not fail the run only because it is missing

Capture: current UTC `timestamp`, `branch`, repo basename as `project_name`, `default_branch` (try `origin/HEAD`, then `origin/main`, `main`, `master`, then `HEAD`), `base_ref` (= `default_branch` in diff mode, else `full-repo`), `head_ref` (= `branch`).

```bash
mkdir -p .planning/security/REPORTS .planning/security/CANDIDATES .planning/security/VALIDATED .planning/security/ISSUES .planning/security/tmp
```

Scaffold when missing:
- `.planning/security/FINDINGS.yaml` from `$HOME/.claude/templates/security-finding-register.yaml.template` with project name and default branch filled in
- `.planning/security/POLICY.md` from `$HOME/.claude/templates/security-policy.md.template` with default branch filled in

Paths: `findings_path`, `policy_path`, `report_path = .planning/security/REPORTS/{timestamp}.md`, `candidate_path = .planning/security/CANDIDATES/{timestamp}-candidate.md`.

## 1. Build the audit scope

Always read `AGENTS.md` (if present), `.planning/security/POLICY.md`, `.planning/security/FINDINGS.yaml`.

Build `scope_summary`:
- diff mode: summarize the changed surface from the current branch relative to `default_branch`, plus staged/unstaged changes
- full mode: summarize the main attack-surface-bearing directories and entrypoints
- when `--focus <path>` is present, keep the summary anchored to that path even in full mode

Build `changed_paths` as a concise path list for the selector.

## 2. Choose one target

Spawn the `security-target-selector` subagent via the Task tool with `subagent_type: "security-target-selector"`. The prompt is the assignment block:

```text
<audit_assignment>
project_root: {ROOT}
audit_mode: {audit_mode}
focus_path: {focus_path or "null"}
threat_model: {threat_model}
policy_path: {ROOT}/.planning/security/POLICY.md
findings_path: {ROOT}/.planning/security/FINDINGS.yaml
scope_summary: {scope_summary}
changed_paths: {changed_paths}
</audit_assignment>
```

If the selector returns `NO_TARGET`: write `report_path` from `security-report.md.template` with accepted/rejected counts `0`, explain no grounded target was selected, and stop after reporting in chat.

## 3. Investigate the target

Spawn the `security-investigator` subagent via the Task tool with `subagent_type: "security-investigator"` and prompt:

```text
<audit_assignment>
project_root: {ROOT}
audit_mode: {audit_mode}
threat_model: {threat_model}
selected_file: {selected_file}
investigation_target: {investigation_target}
likely_entry_point: {likely_entry_point}
risk_class: {risk_class}
policy_path: {ROOT}/.planning/security/POLICY.md
findings_path: {ROOT}/.planning/security/FINDINGS.yaml
candidate_path: {ROOT}/.planning/security/CANDIDATES/{timestamp}-candidate.md
</audit_assignment>
```

If the investigator returns `NO_FINDING`: write `report_path` with `Accepted findings: 0` and `Rejected candidates: 1`, include the rejection reason and candidate path, and stop after reporting in chat.

## 4. Validate the candidate

Compute `next_finding_id` from `.planning/security/FINDINGS.yaml` (next unused `SEC-xxxx`).

Spawn the `security-validator` subagent via the Task tool with `subagent_type: "security-validator"` and prompt:

```text
<audit_assignment>
project_root: {ROOT}
policy_path: {ROOT}/.planning/security/POLICY.md
findings_path: {ROOT}/.planning/security/FINDINGS.yaml
candidate_path: {ROOT}/.planning/security/CANDIDATES/{timestamp}-candidate.md
next_finding_id: {next_finding_id}
validated_dir: {ROOT}/.planning/security/VALIDATED
</audit_assignment>
```

## 5. Write durable outcome

Always write `report_path` from `security-report.md.template` and fill: project name, audit scope, base ref, head ref, threat model, focus path, timestamp, selected file and investigation target (when a target existed), accepted/rejected counts, accepted finding details (when accepted), rejection rationale (when rejected).

If validation returned `ACCEPTED`:
- if `--verify-only` is not set, append one new entry to `.planning/security/FINDINGS.yaml`, concise and consistent with the existing ledger shape
- include the validated report path under `evidence.reports` and `validation.report_path`
- set `last_security_audit.at`, `.branch`, and `.report`

If validation returned `REJECTED`: do not mutate `.planning/security/FINDINGS.yaml`.

## 6. Optional confidential issue draft

If `--create-confidential-issue` is set and validation returned `ACCEPTED`: write `.planning/security/ISSUES/{timestamp}-confidential-issue.md` from `security-issue.md.template`, fill `issue-project` (or `unassigned`), and preserve the validated + audit report paths.

## 7. Report results

In chat: state `accepted` / `rejected` / `no target`; show the selected file and investigation target when applicable; link the durable report path; mention candidate and validated paths when they exist; mention whether `.planning/security/FINDINGS.yaml` was updated or skipped because of `--verify-only`.

</process>

<success_criteria>
- [ ] Repo root resolved and `.planning/security/` scaffold exists
- [ ] Exactly one target selected or explicitly rejected as unnecessary
- [ ] Candidate report written for investigated runs
- [ ] Candidate validated against duplicate and reachability bars
- [ ] Durable report written under `.planning/security/REPORTS/`
- [ ] Findings ledger updated only for accepted findings and only when not in `--verify-only` mode
- [ ] Optional confidential issue draft written when requested and an accepted finding exists
</success_criteria>
