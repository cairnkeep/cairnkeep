---
name: graphify
description: Build, query, and inspect the local project graph exclusively through Cairnkeep
type: flow
---

<!-- managed-by:cairnkeep -->
# Cairnkeep graph

Handle this request through Cairnkeep's public graph owner. The invocation
arguments are:

```text
$ARGUMENTS
```

Accept exactly one of these forms:

- `build`
- `build --force`
- `query <term>`
- `status`
- `diff`
- `explain <symbol>`
- `path <from> <to>`

Invoke the Bash tool exactly once with the corresponding `cairn graph ...`
command. Pass each term or symbol as one safely quoted argument. Return the
command output verbatim and stop.

If the arguments do not match a supported form, show the supported forms and
stop without invoking a tool. Do not call the Graphify executable, edit graph
artifacts, spawn another agent, or implement graph logic in this Skill.
