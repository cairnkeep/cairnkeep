# Context intelligence

Cairnkeep can retrieve immutable project context progressively, measure retrieval
quality, record privacy-preserving usage evidence, and propose reviewed-memory
changes. These features keep the existing authority model: retrieval is an
observation; durable-memory changes require an explicit review and apply step.

## Progressive context-pack retrieval

Enable context packs for the process with `CAIRN_CONTEXT_PACKS=1`. The existing
`context_pack_list`, `context_pack_search`, and `context_pack_read` tools remain
available, and the default search remains the compatible flat, content-level
search. Two optional surfaces add progressive disclosure:

- `context_pack_tree` returns only enabled documents and approved skills, using
  `abstract` or `overview` detail.
- `context_pack_search` accepts `strategy: "hierarchical"`,
  `detail: "abstract" | "overview" | "content"`, and `explain: true`.

For example:

```json
{
  "query": "release validation",
  "strategy": "hierarchical",
  "detail": "overview",
  "explain": true,
  "include_refs": true
}
```

Hierarchical search ranks pack, directory, and file summaries before reading
content. An exact path or title can bypass the hierarchy and select the matching
leaf directly. `explain` adds a bounded, sanitized decision trace. It never adds
hidden file content to the trace.

Abstracts and overviews are deterministic derived data. They are cached below
the pack base directory in `cache/context/`, outside immutable pack objects, and
are bound to the pack digest and exact visible-file set. `cairn doctor` validates
this cache and can remove invalid derived entries; it does not enable a pack or
approve a skill.

Visibility is unchanged: a document must belong to an enabled pack, while a
skill must also have a current project approval matching the pack digest, path,
and file digest. Updating a pack therefore invalidates its old skill approvals.
Pack SHA-256 digests establish integrity, not publisher authenticity.

## Retrieval benchmark

The repository includes a frozen synthetic benchmark with hierarchical files,
multiple versions, and a hidden skill. Positive retrieval cases report Hit@1,
Recall@5, and MRR; negative-only isolation cases report their count, pass rate,
and leaks separately. The report also covers relevant/irrelevant bytes, an
estimated token count, latency, network and filesystem mutations, and leakage
from disabled packs, unapproved skills, case-specific exclusions, or undeclared
result identities. Frozen substring and deterministic mock-embedding goldens
make regression checks offline and reproducible.

From a source checkout:

```sh
npm --prefix mcp-memory-server run build
npm --prefix mcp-memory-server run check:retrieval-benchmark
npm --prefix mcp-memory-server run benchmark:retrieval
```

The first command compiles the TypeScript sources. The second runs the contract
smoke test and checks the frozen golden. The third rebuilds and emits a current
report.
The benchmark is an engineering baseline, not a claim about every real project.

## Context-usage receipts

Search results can include stable references by setting `include_refs: true`.
Each result then has a `chunk_digest`, and the response has a `result_digest`.
With work evidence enabled, set `CAIRN_CONTEXT_USAGE=1` as the second consent
gate to expose the local-only `context_usage_record` MCP mutation, then record
whether a referenced result was used. The tool is not registered unless both
`CAIRN_WORK_EVIDENCE=1` and `CAIRN_CONTEXT_USAGE=1` are active:

```json
{
  "task_digest": "<64-lowercase-hex-digest>",
  "result_digest": "<64-lowercase-hex-digest>",
  "outcome": "used"
}
```

`outcome` is `used`, `unused`, or `unknown`. The receipt links to the active work
evidence unless `evidence_id` is supplied explicitly. It stores digests and the
outcome, not the query, prompt, retrieved content, or model response. The tool is
a mutation, so the read-only MCP profile does not expose it. Receipts are strict,
idempotent links in the existing work-evidence store and follow its retention.

## Review-gated memory proposals

`cairn proposals` turns a stored, redacted trajectory into candidates for
reviewed durable memory. It never applies candidates during extraction:

```sh
cairn proposals create --session SESSION_ID --scope project --json
cairn proposals list --json
cairn proposals show PROPOSAL_DIGEST --json
cairn proposals apply PROPOSAL_DIGEST --json
cairn proposals doctor --json
```

`create` loads the named local trajectory, redacts it again before any configured
model call, and writes an immutable, digest-addressed proposal under
`.agentfs/memory-proposals/`. The digest binds the source, extraction, base memory,
and candidates. `apply` accepts that exact digest, rechecks source and base-memory
freshness, and then performs the reviewed-memory write atomically. A stale or
tampered proposal fails instead of being rebased or silently accepted.

Model extraction uses the existing `CAIRN_LLM_API_URL`, `CAIRN_LLM_API_KEY`, and
`CAIRN_LLM_EXTRACTION_MODEL` settings. No background hook creates or applies
proposals.

## Optional OpenViking retrieval provider

AnythingLLM remains the default domain-retrieval provider. OpenViking is an
optional, read-only adapter behind two explicit settings:

```sh
CAIRN_DOMAIN_RETRIEVAL_PROVIDER=openviking
CAIRN_OPENVIKING=1
CAIRN_OPENVIKING_BASE_URL=http://127.0.0.1:1933
# Optional:
CAIRN_OPENVIKING_API_KEY=...
CAIRN_OPENVIKING_TIMEOUT_MS=5000
```

The existing `domain_knowledge_query` tool keeps its schema. The adapter calls
only OpenViking's search endpoint; Cairnkeep does not import, sync, watch, delete,
or commit OpenViking data. Plain HTTP is accepted only for loopback hosts; other
hosts require HTTPS. Embedded URL credentials, redirects, oversized responses,
and invalid response shapes are rejected. Authenticated remote MCP deployment
also requires the separate `CAIRN_OPENVIKING_MCP_HTTP=1` consent flag.

OpenViking does not replace Cairnkeep. It can supply an external retrieval index;
Cairnkeep still owns project identity, reviewed memory, immutable context-pack
pins, tool authority, evidence, and approval boundaries. No OpenViking package or
service is required for the default Cairnkeep installation.
