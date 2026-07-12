<purpose>
Run one governed local security assessment against the current repository. Select one narrow target, investigate it, validate at most one candidate finding, and preserve the outcome under `.planning/security/`.
</purpose>

<required_reading>
@$HOME/.config/opencode/templates/security-policy.md.template
@$HOME/.config/opencode/templates/security-report.md.template
@$HOME/.config/opencode/templates/security-finding-register.yaml.template
@$HOME/.config/opencode/templates/security-issue.md.template
</required_reading>

<available_agent_types>
Valid subagent types for this workflow:
- security-target-selector
- security-investigator
- security-validator
</available_agent_types>

<process>

## 0. Initialize Repo Context

Resolve the repo root:

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT" ]; then
  echo "Not inside a git repository. /security-audit must run from a project repo."
  exit 1
fi
cd "$ROOT"
```

Parse flags from `$ARGUMENTS`:
- `--full`
- `--focus <path>`
- `--threat-model <name>`
- `--verify-only`
- `--create-confidential-issue`
- `--issue-project <group/project>`

Rules:
- `audit_mode` is `full` when `--full` is set, otherwise `diff`
- default `threat_model` to `changed-surface` when no explicit value is supplied
- `--issue-project` is optional metadata; do not fail the run only because it is missing

Capture:
- current UTC `timestamp`
- `branch`
- repo basename as `project_name`
- `default_branch` using `origin/HEAD`, then `origin/main`, `main`, `master`, then `HEAD`
- `base_ref` as `default_branch` in diff mode, otherwise `full-repo`
- `head_ref` as `branch`

Create directories:

```bash
mkdir -p .planning/security/REPORTS .planning/security/CANDIDATES .planning/security/VALIDATED .planning/security/ISSUES .planning/security/tmp
```

Scaffold when missing:
- `.planning/security/FINDINGS.yaml` from `security-finding-register.yaml.template` with project name and default branch filled in
- `.planning/security/POLICY.md` from `security-policy.md.template` with default branch filled in

Paths:
- `findings_path = {ROOT}/.planning/security/FINDINGS.yaml`
- `policy_path = {ROOT}/.planning/security/POLICY.md`
- `report_path = {ROOT}/.planning/security/REPORTS/{timestamp}.md`
- `candidate_path = {ROOT}/.planning/security/CANDIDATES/{timestamp}-candidate.md`

## 1. Build The Audit Scope

Always read:
- `AGENTS.md` if present
- `.planning/security/POLICY.md`
- `.planning/security/FINDINGS.yaml`

Build `scope_summary`:
- in diff mode, summarize the changed surface from the current branch relative to `default_branch`, plus any staged or unstaged changes
- in full mode, summarize the main attack-surface-bearing directories and entrypoints
- when `--focus <path>` is present, keep the summary anchored to that path even in full mode

Build `changed_paths` as a concise path list for the selector.

## 2. Choose One Target

Preferred path: spawn `security-target-selector`.

```text
◆ Selecting one high-signal security target...
```

Spawn with:

```text
Task(
  prompt="Read $HOME/.config/opencode/agents/security-target-selector.md for instructions. FIRST ACTION: change into {ROOT}.\n\n<audit_assignment>\nproject_root: {ROOT}\naudit_mode: {audit_mode}\nfocus_path: {focus_path or \"null\"}\nthreat_model: {threat_model}\npolicy_path: {ROOT}/.planning/security/POLICY.md\nfindings_path: {ROOT}/.planning/security/FINDINGS.yaml\nscope_summary: {scope_summary}\nchanged_paths: {changed_paths}\n</audit_assignment>",
  subagent_type="security-target-selector",
  description="Security audit: target selector"
)
```

If the selector returns `NO_TARGET`:
- write `report_path` from `security-report.md.template`
- set accepted and rejected counts to `0`
- explain that no grounded target was selected for this run
- stop after reporting the result in chat

## 3. Investigate The Target

Preferred path: spawn `security-investigator`.

```text
◆ Investigating selected target...
```

Spawn with:

```text
Task(
  prompt="Read $HOME/.config/opencode/agents/security-investigator.md for instructions. FIRST ACTION: change into {ROOT}.\n\n<audit_assignment>\nproject_root: {ROOT}\naudit_mode: {audit_mode}\nthreat_model: {threat_model}\nselected_file: {selected_file}\ninvestigation_target: {investigation_target}\nlikely_entry_point: {likely_entry_point}\nrisk_class: {risk_class}\npolicy_path: {ROOT}/.planning/security/POLICY.md\nfindings_path: {ROOT}/.planning/security/FINDINGS.yaml\ncandidate_path: {ROOT}/.planning/security/CANDIDATES/{timestamp}-candidate.md\n</audit_assignment>",
  subagent_type="security-investigator",
  description="Security audit: investigator"
)
```

If the investigator returns `NO_FINDING`:
- write `report_path` with `Accepted findings: 0` and `Rejected candidates: 1`
- include the rejection reason and the candidate path
- stop after reporting the result in chat

## 4. Validate The Candidate

Compute `next_finding_id` from `.planning/security/FINDINGS.yaml` by taking the next unused `SEC-xxxx` identifier.

Preferred path: spawn `security-validator`.

```text
◆ Validating candidate against exploitability and duplicate bars...
```

Spawn with:

```text
Task(
  prompt="Read $HOME/.config/opencode/agents/security-validator.md for instructions. FIRST ACTION: change into {ROOT}.\n\n<audit_assignment>\nproject_root: {ROOT}\npolicy_path: {ROOT}/.planning/security/POLICY.md\nfindings_path: {ROOT}/.planning/security/FINDINGS.yaml\ncandidate_path: {ROOT}/.planning/security/CANDIDATES/{timestamp}-candidate.md\nnext_finding_id: {next_finding_id}\nvalidated_dir: {ROOT}/.planning/security/VALIDATED\n</audit_assignment>",
  subagent_type="security-validator",
  description="Security audit: validator"
)
```

## 5. Write Durable Outcome

Always write `report_path` from `security-report.md.template` and fill:
- project name, audit scope, base ref, head ref, threat model, focus path, timestamp
- selected file and investigation target when a target existed
- accepted and rejected counts
- accepted finding details when validation accepted a finding
- rejection rationale when the run ended with a rejected candidate

If validation returned `ACCEPTED`:
- if `--verify-only` is not set, append one new entry to `.planning/security/FINDINGS.yaml`
- keep the entry concise and consistent with the existing ledger shape
- include the validated report path under `evidence.reports` and `validation.report_path`
- set `last_security_audit.at`, `last_security_audit.branch`, and `last_security_audit.report`

If validation returned `REJECTED`:
- do not mutate `.planning/security/FINDINGS.yaml`

## 6. Optional Confidential Issue Draft

If `--create-confidential-issue` is set and validation returned `ACCEPTED`:
- write `.planning/security/ISSUES/{timestamp}-confidential-issue.md` from `security-issue.md.template`
- fill `issue-project` when provided, otherwise use `unassigned`
- preserve the validated report path and audit report path in the draft
- treat the markdown draft as the durable artifact even if no external tracker is updated in this run

## 7. Report Results

In chat:
- state whether the run ended with `accepted`, `rejected`, or `no target`
- show the selected file and investigation target when applicable
- link the durable report path
- mention the candidate path and validated path when they exist
- mention whether `.planning/security/FINDINGS.yaml` was updated or skipped because of `--verify-only`

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
