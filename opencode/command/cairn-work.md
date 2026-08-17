---
description: Evaluate Cairnkeep's project playbook at task start, scope changes, or finish
---

<!-- managed-by:cairnkeep -->
# Cairnkeep playbook check

Run exactly one local command: `cairn playbook check $ARGUMENTS`.

Accept `start`, `check`, or `finish` followed only by documented check options.
Safely quote every argument. Return the decision and explain which `must`,
`should`, and `may` actions you will follow. This is policy evaluation only: it
does not execute an action or grant approval.
