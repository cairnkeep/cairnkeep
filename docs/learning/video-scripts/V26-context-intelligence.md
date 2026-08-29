# V26 - Context intelligence with explicit authority

Target length: 12–15 minutes. Audience: experienced developers who understand
MCP and have completed the context-pack lesson.

## Recording outline

### 0:00–0:45 — The contract

Show a simple four-step card: **measure → retrieve → attest → review**.

Narration:

> Cairnkeep now makes context retrieval more selective without making memory
> promotion automatic. We measure retrieval first, inspect context progressively,
> record only a digest-level usage receipt, and review every durable-memory
> proposal before applying it.

Pause. State that OpenViking is optional external retrieval and does not replace
Cairnkeep.

### 0:45–2:15 — Run the frozen benchmark

Use a real terminal at readable zoom and human typing speed:

```sh
npm --prefix mcp-memory-server run build
npm --prefix mcp-memory-server run check:retrieval-benchmark
```

Highlight Hit@1, Recall@5, MRR, byte/token estimates, latency, mutations, and
forbidden leakage. Explain that the corpus includes versions, hierarchy, and a
hidden skill. Do not claim that synthetic scores predict every project.

### 2:15–5:15 — Tree, overview, then content

Start from an already installed and enabled demo pack. Show:

```json
context_pack_tree { "detail": "abstract" }
```

Expand one directory visually. Then run:

```json
context_pack_search {
  "query": "release validation",
  "strategy": "hierarchical",
  "detail": "overview",
  "explain": true,
  "include_refs": true
}
```

Zoom briefly into the bounded trace, `chunk_digest`, and `result_digest`. Follow
with one content-level read of the selected file. Cut between overview and
content so the terminal remains dynamic without rushing.

Call out that omitting the new options keeps the existing flat content response,
and that an unapproved skill is absent from every visible surface.

### 5:15–7:00 — Privacy-preserving receipt

With work evidence active and `CAIRN_CONTEXT_USAGE=1`, record the result:

```json
context_usage_record {
  "task_digest": "<demo-task-digest>",
  "result_digest": "<search-result-digest>",
  "outcome": "used"
}
```

Show the stored receipt fields. Add an on-screen comparison:

- stored: evidence ID, task digest, result digest, outcome;
- not stored: query, prompt, content, response.

Pause after the comparison. Mention that this is a mutation and is unavailable
in the read-only MCP profile.

### 7:00–10:15 — Review-gated proposal

Use a real captured demo trajectory and type:

```sh
cairn proposals create --session SESSION_ID --scope project --json
cairn proposals show PROPOSAL_DIGEST --json
```

Scroll through a small proposal. Inspect one candidate aloud for correctness,
scope, sensitivity, and durability. Then apply the exact digest:

```sh
cairn proposals apply PROPOSAL_DIGEST --json
cairn proposals doctor --json
```

Use a diagram or terminal split to show that creation redacts again, extraction
creates immutable candidates, and apply rechecks source and base-memory state.
Do not imply that the model writes reviewed memory directly.

### 10:15–12:00 — Optional provider boundary

Show the minimal settings, without exposing a real key:

```sh
CAIRN_DOMAIN_RETRIEVAL_PROVIDER=openviking
CAIRN_OPENVIKING=1
CAIRN_OPENVIKING_BASE_URL=http://127.0.0.1:1933
```

Run one `domain_knowledge_query`, then return to a boundary diagram:

- OpenViking: optional read-only search index;
- Cairnkeep: identity, reviewed memory, pack pins, approvals, evidence, profiles.

Mention loopback-only HTTP, HTTPS elsewhere, no redirects, and the separate
remote-MCP consent gate. Do not show installation as required.

### 12:00–13:00 — Recap and acceptance

Return to **measure → retrieve → attest → review**. Recap:

1. Frozen evidence before retrieval changes.
2. Summaries before content, with compatible flat fallback.
3. Digest-level receipts instead of prompt logging.
4. Explicit proposal review and exact-digest apply.
5. Optional providers do not replace Cairnkeep's authority model.

Point viewers to L26 and `docs/context-intelligence.md`.

## Recording cautions

- Use a synthetic pack, trajectory, digests, endpoint, and API key placeholder.
- Ensure the skill shown in the manifest is unapproved and absent from tree,
  search, trace, and summaries.
- Keep command pauses long enough to read output; cut dead time rather than
  accelerating narration.
- Use terminal autocomplete and real command execution, but prewarm builds so the
  lesson focuses on behavior rather than compilation.
- Never label OpenViking as a dependency, synchronization target, memory store,
  or Cairnkeep replacement.
- Do not call a proposal “memory” until exact-digest application succeeds.
