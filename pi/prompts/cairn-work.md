---
description: Evaluate Cairnkeep's bounded workflow playbook
argument-hint: "start|check|finish [cairn playbook check options]"
---

<!-- managed-by:cairnkeep -->
# Cairnkeep playbook check

Invoke the shell tool exactly once with `cairn playbook check $ARGUMENTS`.
Accept only `start`, `check`, or `finish` plus documented check options. Return
the decision verbatim, then state how you will handle its `must`, `should`, and
`may` actions. Do not treat the decision as execution or approval.
