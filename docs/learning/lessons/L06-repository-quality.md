# L06 - Repository review and security

**Status:** Brief
**Track:** Practitioner
**Planned time:** 45 minutes

## Outcome

Run `/repo-review` and `/security-audit` against a bounded target, validate
findings, and keep generated reports separate from automatic code changes.

## Planned lesson

- When to use repository review versus a security audit.
- Target selection, repository boundaries, and safe local-only policy.
- Investigator and validator roles.
- Severity, evidence, reproduction, false positives, and remediation ordering.
- Reviewing `REVIEW.md` and `.planning/security/` before acting.
- Why a report is not permission to modify unrelated code.

## Hands-on lab

Use a deliberately vulnerable toy service containing a correctness defect, an
authorization defect, and one tempting false positive. Run both workflows,
reproduce valid findings, reject the false positive, and apply fixes on a
solution branch.

## Acceptance criteria

- The learner finds both real defects and does not report the planted false
  positive as confirmed.
- Every accepted finding contains evidence and a reproduction path.
- No scan reaches outside the disposable repository or its local processes.
- The lab passes after remediation and fails in its tagged starter state.

## Planned video

This is the flagship value demonstration. Show one serious synthetic defect
from discovery through validation and fix. Target 15 minutes; publish the full
45-minute exercise as a workshop.

## Source material

- [Operating guide](../../operating.md#the-workflow)
- Course-labs repository to be created in Wave 2
