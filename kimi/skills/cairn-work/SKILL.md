---
name: cairn-work
description: Evaluate Cairnkeep's bounded workflow playbook at task lifecycle boundaries
type: flow
---

<!-- managed-by:cairnkeep -->
# Cairnkeep playbook check

Invoke Bash exactly once with `cairn playbook check $ARGUMENTS`. Accept only
`start`, `check`, or `finish` plus documented check options. Return the decision
verbatim, then state how you will handle its `must`, `should`, and `may`
actions. Policy evaluation never executes an action or grants approval.
