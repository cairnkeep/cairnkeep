# L26 - Context intelligence with explicit authority

## Outcome

You will measure retrieval before changing it, retrieve an enabled context pack
progressively, link a privacy-preserving usage receipt to work evidence, and
review a trajectory-derived memory proposal before any durable write. You will
also understand when the optional OpenViking adapter is useful and what it does
not replace.

## Prerequisites

- Complete [L21 - Immutable context packs](L21-context-packs.md) and
  [L25 - Bounded workflow playbooks](L25-playbooks.md).
- Work in a project already bootstrapped with Cairnkeep.
- Enable at least one document-bearing context pack. Skill entries stay hidden
  unless separately approved for this project.
- For the proposal exercise, capture a trajectory and configure the existing
  Cairnkeep extraction endpoint. The retrieval and benchmark exercises are
  local and offline.

## 1. Freeze the retrieval baseline

From a Cairnkeep source checkout, run the checked-in synthetic suite:

```sh
npm --prefix mcp-memory-server run build
npm --prefix mcp-memory-server run check:retrieval-benchmark
```

The suite contains hierarchical documents, multiple versions, and a hidden
skill. It checks frozen substring and deterministic mock-embedding results, then
reports Hit@1, Recall@5, MRR, relevant and irrelevant bytes, estimated tokens,
latency, mutation counts, and forbidden leakage. A quality improvement is not
accepted if it leaks the skill, mutates storage, or quietly uses the network.

For a non-golden current report:

```sh
npm --prefix mcp-memory-server run benchmark:retrieval
```

Record the mode with the score. Comparing one mode's score with another mode's
label omitted is not meaningful evidence.

## 2. Retrieve progressively

Start the memory server with `CAIRN_CONTEXT_PACKS=1`. In an MCP-capable harness,
inspect the visible hierarchy first:

```json
context_pack_tree { "detail": "abstract" }
```

Now ask a broad question without loading every file:

```json
context_pack_search {
  "query": "release validation",
  "strategy": "hierarchical",
  "detail": "overview",
  "explain": true,
  "include_refs": true
}
```

Check four things in the result:

1. The selected pack, directory, and file fit the question.
2. The bounded trace explains selection without exposing hidden content.
3. Each result includes a `chunk_digest` and the response includes a
   `result_digest`.
4. No unapproved skill appears in the tree, summaries, results, or trace.

Ask for `detail: "content"` only after summaries narrow the candidate set. For a
known path, use `context_pack_read`; exact path/title searches can bypass the
hierarchy. Omitting all new fields exercises the compatible flat search.

## 3. Record use without recording content

Create or activate a work-evidence record for the task, then enable the local
receipt mutation with both `CAIRN_WORK_EVIDENCE=1` and
`CAIRN_CONTEXT_USAGE=1`. After deciding whether you used a
search result, call:

```json
context_usage_record {
  "task_digest": "<64-lowercase-hex-task-digest>",
  "result_digest": "<result_digest-from-search>",
  "outcome": "used"
}
```

Use `unused` or `unknown` when that is the honest outcome. Supply `evidence_id`
only when linking a non-active record deliberately. Inspect the evidence and
verify that the receipt contains identifiers and outcome—not query text,
retrieved content, prompts, or responses.

This is a mutation. A read-only MCP profile correctly hides it even though the
pack retrieval tools remain visible.

## 4. Promote a trajectory through review

List or capture a trajectory you want to distill, then create a proposal:

```sh
cairn proposals create --session SESSION_ID --scope project --json
cairn proposals list --json
cairn proposals show PROPOSAL_DIGEST --json
```

Review every candidate for accuracy, scope, sensitivity, and durability. The
proposal is not reviewed memory. If it is acceptable, apply the exact digest:

```sh
cairn proposals apply PROPOSAL_DIGEST --json
cairn proposals doctor --json
```

Creation redacts the stored trajectory again before configured model extraction.
Application rechecks the source digest and base reviewed-memory hashes. If it
reports stale state, create and review a new proposal; do not edit the digest-
addressed file or bypass the check.

## 5. Decide whether an external provider helps

AnythingLLM remains Cairnkeep's default domain provider. Use OpenViking only when
you deliberately operate an OpenViking index and want its search results through
the existing `domain_knowledge_query` surface:

```sh
CAIRN_DOMAIN_RETRIEVAL_PROVIDER=openviking
CAIRN_OPENVIKING=1
CAIRN_OPENVIKING_BASE_URL=http://127.0.0.1:1933
```

The adapter is read-only and calls search only. It does not synchronize data,
manage OpenViking, or replace Cairnkeep's reviewed memory, context-pack pins,
approvals, evidence, or tool profiles. Leave the variables unset when you do not
need the external index.

## Common failures

- **A hidden skill appears:** revoke exposure, run `cairn doctor`, and treat it as
  a visibility regression. Approval is bound to pack/path/file digests.
- **Hierarchical search looks worse:** compare it with the frozen benchmark and
  inspect a bounded trace. Do not change default flat behavior to hide a miss.
- **A receipt conflicts:** the same task/result identity was recorded with a
  different outcome. Resolve the evidence rather than overwriting history.
- **Proposal apply is stale:** source or reviewed memory changed after creation.
  Generate a new proposal and review it.
- **OpenViking is unreachable:** verify the explicit gates, HTTPS requirement for
  non-loopback hosts, endpoint, timeout, and service separately. Cairnkeep's
  default operation does not depend on it.

## Privacy and trust boundary

Context-pack and proposal digests prove content integrity and bind decisions to
specific state; they do not authenticate a publisher or prove that extracted
claims are true. Derived summaries can contain visible pack content, so protect
the cache like the pack store. Proposal extraction can cross a model-provider
boundary only through the operator's existing extraction configuration and only
after redaction. Context-usage receipts deliberately avoid raw content.

## Recovery and acceptance

You are done when:

- the frozen benchmark passes without network or filesystem mutation;
- tree and hierarchical search expose enabled documents and only approved skills;
- flat search still works when optional fields are omitted;
- a receipt links to work evidence without copying content;
- a proposal is inspected before exact-digest apply, or intentionally rejected;
- you can explain why OpenViking is optional retrieval rather than a replacement
  for Cairnkeep.

Continue with the operational references in
[Context intelligence](../../context-intelligence.md),
[Immutable context packs](../../context-packs.md), and
[Git-linked work evidence](../../work-evidence.md).
