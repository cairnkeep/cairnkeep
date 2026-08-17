---
description: Evaluate Cairnkeep's project playbook at task start, scope changes, or finish
argument-hint: "start|check|finish [cairn playbook check options]"
allowed-tools: Bash
---

<!-- managed-by:cairnkeep -->
# Cairnkeep playbook check

Run exactly one local command:

```text
cairn playbook check $ARGUMENTS
```

Accept `start`, `check`, or `finish` followed only by check options documented by
`cairn playbook --help`. Safely quote every argument. Return the decision
and explain which `must`, `should`, and `may` actions you will follow. Never
claim that this command executed an action or granted approval.
