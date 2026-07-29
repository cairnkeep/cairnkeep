# L15 - Capability governance

**Status:** Brief
**Track:** Evidence and Evaluation; Operator
**Planned time:** 35 minutes

## Outcome

Inspect effective capability state, apply and reset a project override, and
predict when a harness or memory-server restart is required.

## Planned lesson

- The default-off managed contract around eight existing capability owners.
- Compatibility defaults, project overrides, process overrides, and precedence.
- `list`, `status`, `enable`, `disable`, `reset`, and payload-free callback
  logging.
- Tool omission for disabled MCP capabilities versus invocation-time checks for
  offline jobs and operating workflows.
- Configuration digests as state identity, not approval or quality evidence.
- Why enabling the master contract does not enable graph or note distillation.

## Hands-on lab

Use a disposable project with the master contract enabled. Save JSON status,
disable `context.explore`, restart the memory server, verify effective state,
then reset the override and restart again. Toggle callback logging separately
and confirm that payload-free evidence still requires local trajectory capture.

```bash
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities list
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities status --json
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities disable context.explore
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities reset context.explore
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities logging enable
```

## Acceptance criteria

- The learner records the before and after configuration digests.
- A disabled MCP capability disappears only after a server restart.
- `reset` restores inherited state; it is not described as `enable`.
- No callback record contains prompts, tool arguments, results, or memory values.
- Disabling an optional capability does not break standalone memory.

## Source material

- [Operating guide: managed capability contract](../../operating.md#managed-capability-contract-opt-in)
- [Privacy and data flow](../../privacy-and-data-flow.md#capability-callback-flow)
- [Capability contract schema](../../../schemas/capability-contract.schema.json)
