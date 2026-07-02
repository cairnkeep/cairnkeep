# Security Assessment Policy

This repository uses the governed security-assessment workflow to hunt for realistic security issues without turning normal development into uncontrolled offensive automation.

## Branch Rules

- Default branch: `REPLACE_WITH_DEFAULT_BRANCH`
- Do not push feature work directly to `REPLACE_WITH_DEFAULT_BRANCH`.
- Use feature branches for remediation and keep candidate reports under `.planning/security/CANDIDATES/` until a finding is validated.

## Safety Rules

- Run `/security-audit` only against this repository, repo-owned local processes, local files, and localhost services launched from this repo.
- Do not target external hosts, staging, production, or third-party systems.
- Keep proofs local, minimal, and non-destructive.
- Do not attempt persistence, credential harvesting, lateral movement, or data exfiltration.

## Finding Lifecycle

- Open or refresh findings with `/security-audit`.
- Keep rejected or duplicate candidates in run history only; do not copy them into the canonical ledger.
- Only accepted findings belong in `.planning/security/FINDINGS.yaml` and `.planning/security/VALIDATED/`.
- Close or downgrade findings only after remediation or explicit acceptance on the default branch.

## Review Expectations

- Critical and high-severity accepted findings should block merge until triaged by a human.
- Treat the repo-local findings ledger as the shared state for severity, status, and remediation progress.
- If a run cannot prove reachability convincingly, prefer rejection over speculative acceptance.
