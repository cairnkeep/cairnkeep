---
description: Run a governed local security audit against one scoped attack surface and write repo-local artifacts
argument-hint: "[--full] [--focus <path>] [--threat-model <name>] [--verify-only] [--create-confidential-issue] [--issue-project <group/project>]"
tools:
  read: true
  write: true
  edit: true
  bash: true
  grep: true
  glob: true
  agent: true
  question: true
---

<objective>
Run one governed local security assessment against the current repository.

Output artifacts:
- `.planning/security/REPORTS/<timestamp>.md`
- `.planning/security/CANDIDATES/<timestamp>-candidate.md`
- `.planning/security/VALIDATED/SEC-xxxx-<slug>.md` for accepted findings
- optional `.planning/security/ISSUES/<timestamp>-confidential-issue.md`
- optional update to `.planning/security/FINDINGS.yaml`

Flag handling:
- `--full` — inspect the broader repository instead of the changed surface only
- `--focus <path>` — bias target selection toward one file or subtree
- `--threat-model <name>` — label and bias the run with a concrete threat model or attack surface description; defaults to `changed-surface`
- `--verify-only` — write the audit artifacts without mutating `.planning/security/FINDINGS.yaml`
- `--create-confidential-issue` — create a repo-local confidential issue draft when an accepted finding exists
- `--issue-project <group/project>` — record the intended git-provider destination for that issue draft

This is a governed local-only workflow. It must stay inside the current repository, repo-owned local processes, local files, and localhost services launched from this repo.

Recommended `--threat-model` values:
- `changed-surface` — default broad review of the changed attack surface when no stronger prior exists
- `authenticated-http-request` — authenticated API or web request abuse path
- `privilege-escalation` — boundary crossing between roles, users, or capabilities
- `session-upgrade` — session fixation, upgrade, or post-login boundary problems
- `deserialization` — parser or decoder abuse in structured input handling
- `archive-extraction` — tar/zip/extraction path traversal or unsafe unpacking
- `path-traversal` — untrusted path resolution or file access escape
- `subprocess-injection` — unsafe shell or subprocess composition
- `config-file-injection` — generated config or template injection into downstream interpreters
- `localhost-service-abuse` — repo-owned local daemon or localhost trust-boundary misuse
- `native-crash` — native parser, memory-safety, or crash-triggering input path
- `memory-corruption` — stronger native-memory-safety focus when corruption is the specific concern

Usage rule:
- use a short, concrete phrase that helps the selector and investigator reason about attacker capability or failure mode
- prefer the values above for consistency across repos and findings
</objective>

<execution_context>
@$HOME/.config/opencode/workflows/security-audit-workflow.md
</execution_context>

<context>
Arguments: $ARGUMENTS

Default behavior:
- scaffold `.planning/security/` when missing
- choose exactly one narrow target for this run
- investigate that target deeply enough to confirm or reject one candidate finding
- validate the candidate with a stricter duplicate and reachability bar
- write durable repo-local artifacts for the outcome

Important rules:
- one scoped target per run
- one candidate finding per run at most
- rejected outcomes stay in the run history, not in the canonical ledger
- accepted findings may update `.planning/security/FINDINGS.yaml` unless `--verify-only` is set
- repo-local drafts are preferred over speculative issue filing side effects
</context>

<process>
Execute the security-audit workflow from @$HOME/.config/opencode/workflows/security-audit-workflow.md end-to-end.
</process>
