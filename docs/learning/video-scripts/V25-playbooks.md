# V25 - Bounded workflow playbooks

**Companion lesson:** [L25](../lessons/L25-playbooks.md)
**Target length:** 9 minutes

## Recording outline

1. Open with the boundary: Cairnkeep selects existing workflow actions; the
   harness remains the agent runtime and every approval remains in force.
2. Run guided setup in a synthetic project. Show `.ai/playbooks.json` mode and
   the delimited Cairnkeep block inside an `AGENTS.md` that already has user
   content.
3. Compare `minimal`, `balanced`, and `strict` with `cairn playbook status`.
   Customize one canonical action and show that an arbitrary command or unknown
   field is rejected.
4. Run `check start` for a complex unfamiliar task. Explain deterministic
   signals versus the model-supplied complexity/familiarity assertion.
5. Run a security-sensitive `check finish --enforce` without evidence and show
   exit 3. Perform synthetic verification, then re-run with completed and
   reasoned skipped evidence.
6. Record one outcome with exact policy and decision digests. Inspect the
   private receipt and show that changed paths, prompts, source, and output are
   absent.
7. Show `/cairn-work` in Claude or OpenCode and the portable `AGENTS.md`
   guidance for Codex/Qwen. State that adapters route to the same CLI and do not
   automatically activate skills.
8. Remove the managed instruction block, prove user instructions remain, and
   close on the design-only team boundary.

## Recording cautions

- Use only synthetic paths, actors, reasons, and project data.
- Do not imply that an agent's `completed` assertion proves an action ran;
  demonstrate the evidence boundary explicitly.
- Do not describe local actor labels as authenticated identities.
- Do not claim productivity or quality improvement without a separate measured
  evaluation.
- Keep all network-capable optional integrations disabled during the demo.
