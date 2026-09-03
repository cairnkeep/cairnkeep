# L25 - Bounded workflow playbooks

**Status:** Ready
**Tested with:** Cairnkeep 2.17.3 and Node.js 22 or newer
**Time:** 35 minutes

## Outcome

Configure a project playbook, evaluate it at start and finish, satisfy a
deterministic `must` gate with honest evidence, and inspect one private receipt
without mistaking agent self-selection for authorization or execution.

## Exercise

Create a disposable project and a strict policy:

```bash
lab=$(mktemp -d)
mkdir -p "$lab/project/.ai"
cd "$lab/project"
cairn playbook init strict
cairn playbook status
cairn playbook check start --session course-playbook \
  --complexity complex --familiarity unfamiliar
```

The start decision should select recall, focused exploration, and a bounded
plan. It displays existing Cairnkeep actions; it does not run them. In a real
task, perform the applicable actions through the harness and retain truthful
evidence.

Now model a security-sensitive public code-and-documentation change. First
observe the enforcement failure:

```bash
set +e
cairn playbook check finish --session course-playbook \
  --changed src/auth.ts docs/security.md --risk security --public-change \
  --enforce --json >"$lab/missing.json"
test "$?" -eq 3
set -e
```

Inspect `blocking_actions`; do not merely label them complete. After running
the relevant tests, repository review, security audit, and documentation
checks, provide the resulting evidence:

```bash
cairn playbook check finish --session course-playbook \
  --changed src/auth.ts docs/security.md --risk security --public-change \
  --completed verify.tests review.repository review.security docs.update \
  --skipped learning.capture='no stable reusable learning' \
  --enforce --json >"$lab/decision.json"
```

Record one material result with the exact returned digests:

```bash
policy=$(node -p "require('$lab/decision.json').policy_digest")
decision=$(node -p "require('$lab/decision.json').decision_digest")
cairn playbook record --policy "$policy" --decision "$decision" \
  --event finish --action verify.tests --outcome completed \
  --session course-playbook --reason 'targeted synthetic tests passed'
cairn playbook receipts list
cairn playbook doctor
```

`cairn playbook record --help` prints this command's bounded event, action,
outcome, identity, session, project, and output options. A receipt records one
action outcome; use another call only for another material outcome.

Try a bounded customization, then restore the profile behavior:

```bash
cairn playbook disable learning.capture
cairn playbook reset learning.capture
cairn playbook set balanced
```

## Common failures

- Exit 3 is missing required evidence, not a request to weaken the policy.
- `--skipped` and `--failed` require `ACTION=REASON`; they do not satisfy a
  `must` action.
- Unknown actions, fields, modes, commands, URLs, path traversal, symlinks,
  unsafe permissions, and oversized policy files fail closed.
- A changed policy makes an old policy digest stale for new receipts.
- `CAIRN_PLAYBOOK_PROFILE` overrides the project profile for that process; use
  `cairn playbook status` to see the effective source.

## Privacy and trust boundary

The managed `AGENTS.md` block also gives compatible agents a bounded durable
context protocol: derive one short project query as the first tool or command,
treat memory as a locator, and verify the maintained source. It does not
contain a task-specific query or authorize an automatic memory write. When
evaluating the protocol, inspect the actual `memory_search` event rather than
assuming the instruction was followed.

Checks are offline and store nothing. Explicit receipts contain bounded
identifiers, digests, event/action/outcome/reason, and a timestamp, but no
prompt, file body, diff, command output, credential, or environment snapshot.
Changed-path labels affect the decision but are not stored in the receipt.

The v2.15 actor field is caller-supplied and unauthenticated. It is useful for
local provenance, not access control, employee monitoring, or non-repudiation.
Playbooks cannot enable capabilities, grant mutation approval, execute harness
commands, or promote a learning into durable memory. Team authentication,
ACLs, tenant isolation, and shared review queues remain design-only.

## Recovery and acceptance

```bash
cairn playbook instructions remove --project "$lab/project"
cd /
rm -rf "$lab"
```

- Identical policy, signals, event, and evidence produce the same decision
  digest.
- Missing applicable `must` evidence exits 3 under `--enforce`; completed
  evidence clears the relevant block.
- The receipt is private, project-bound, bounded, and visible to `doctor`.
- Removing managed instructions preserves all surrounding `AGENTS.md` content.
- The installed memory guidance contains no task-specific query and degrades to
  ordinary inspection when `memory_search` is unavailable.
- No check executes an action, contacts a network service, or grants approval.
