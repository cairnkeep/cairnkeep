# Pitfalls Research

**Domain:** Adding a FastContext-style local-GGUF repo-explorer + a token-miser routing layer as a new MCP capability (`context_explore`) to an existing provider-neutral memory/context layer (cairnkeep)
**Researched:** 2026-07-04
**Confidence:** MEDIUM (HIGH on the two prior-pain risks — tool-call reliability and provider-neutrality/DEC-no-private-references — because they are grounded directly in this project's own commit history and memory; MEDIUM on FastContext/mitkox specifics, cross-checked across the arXiv paper and multiple independent GitHub/HF mirrors; LOW on token-miser, which has no discoverable public footprint)

## Critical Pitfalls

### Pitfall 1: FastContext-4B degrades into narrated-but-unexecuted tool calls, exactly like the prior thinking-model gap

**What goes wrong:**
The explorer model is prompted to emit `Read`/`Glob`/`Grep` tool calls and stop with a final evidence list, but under certain serving configurations it narrates the calls as text ("I'll grep for X...") instead of invoking the MCP tool, or emits some turns as real tool calls and others as prose. `context_explore` then returns nothing (or a hallucinated evidence list) while looking like it succeeded, silently defeating the token-savings the milestone exists to prove.

**Why it happens:**
This project already hit this exact failure mode with `qwen3.6-27b-coder` in OpenCode: with thinking ON, `/remember` fired reliably but `/recall` did not — the model narrated the read tool call as text instead of invoking it (see project memory `qwen-coder-opencode-toolcall-limits`). The root cause was model-specific tool-calling reliability under a given chat template/thinking configuration, not a bug in the calling code. FastContext-4B is a different model family (Qwen3-4B backbone) but the same class of risk applies: it is deliberately small (4B–30B, optimized for cheap high-parallelism exploration, not agentic robustness), it is quantized (GGUF, often Q4_K_M), and mitkox's own GGUF card plus a known community fork note a path-resolution quirk from its Docker-mounted training data (`/repo-name/...` style absolute paths) — evidence the model's behavior under llama.cpp deviates from its paper-reported SWE-bench harness. Any of {quantization loss, missing/mismatched Jinja tool-calling template, thinking-mode leakage, llama.cpp `--jinja` flag omitted, wrong chat_template} can flip it from "reliably emits real tool calls" to "narrates them."

**How to avoid:**
- Before wiring `context_explore` into any operating-layer command, run a raw-`curl`/direct-API tool-calling reliability probe against the FastContext GGUF endpoint in isolation (the same pattern already used to validate qwen3.5-27b): fire N repeated exploration prompts, and require `finish_reason=tool_calls` (not narrated text) on every turn across multiple turns, not just the first.
- Do not trust the FastContext paper's harness numbers as evidence for *this* deployment — the paper's harness (Mini-SWE-Agent, likely a different serving stack/template) is not the same probe. Re-verify against the actual GGUF quant + llama.cpp server flags that cairnkeep will actually run.
- Treat a "no tool call executed" response as a hard failure the `context_explore` handler must detect and surface (e.g. an empty/malformed evidence list should raise, not silently return "no results") — mirrors the "false-positive substring match" lesson already logged in MILESTONES.md Known Gaps (verify actual `"type":"tool"` events, not text that merely looks like a tool call).
- Pin the exact GGUF quant, llama.cpp version, `--jinja` flag, and chat-template source as an explicit, documented config — don't let "whatever quant happens to be on disk" be the integration target, since quant/template drift is exactly what caused the qwen3.5 fix to require pulling a patched template.

**Warning signs:**
- `context_explore` returns empty evidence on prompts that obviously have matches in the repo.
- Live harness logs show model output containing tool-call-shaped text (e.g. "Grep(...):") that never produced a corresponding `"type":"tool"` event in the transport stream.
- Reliability is inconsistent across repeated identical prompts (nondeterministic narration vs. real calls) — this is the same "thinking-on fires write but not read" pattern seen before, just for explore instead of recall.

**Phase to address:**
Should be its own early phase (or the first sub-slice of the FastContext integration phase) — a standalone "prove FastContext tool-call reliability against a raw endpoint" spike, gated *before* any MCP/operating-layer wiring is built on top of it. This is the single highest-risk item in the milestone because it already burned significant time once with a different model.

---

### Pitfall 2: A `context_explore` capability that lets the explorer model choose `Read`/`Glob`/`Grep` targets reopens the SEC-0001 path-containment class of bug

**What goes wrong:**
`context_explore` is, by design, a tool-calling loop where a model decides which files to `Read`/`Glob`/`Grep` inside the repo. If the wrapper naively passes the model's chosen path straight to `fs.readFile`/glob without containment, a prompt-injected or hallucinating explorer can read files outside the target repo (e.g. `../../../.ssh/id_rsa`, `/etc/passwd`, or — given FastContext's own known Docker-path-mounting quirk — an absolute path like `/repo-name/../../secrets`) via the same confused-deputy class SEC-0001 already found and fixed for AgentFS `scope`.

**Why it happens:**
cairnkeep's own SEC-0001 finding (`.planning/security/VALIDATED/SEC-0001-scope-path-traversal-sandbox-escape.md`) and the logged pitfall `scope-path-containment-join-pitfall` document that `resolve(base, x) === join(base, x)` does **not** reject `../` traversal (both normalize identically) — only `relative()`-based containment (`rel === "" || rel.startsWith("..") || isAbsolute(rel)` → reject) actually closes it. `context_explore` is a *new* input→filesystem-sink path, structurally identical to the one SEC-0001 fixed for AgentFS scope, except the "attacker" here is the (sometimes prompt-injectable, sometimes just wrong) FastContext model's own tool-call arguments rather than an MCP client argument. It is easy to assume "the explorer only ever reads inside the repo it's told about" and skip re-deriving the containment check for this new input path, because that assumption held for AgentFS scope until it didn't.
Additionally: FastContext's SWE-bench training data mounts repos at `/<repo-name>/`, so it is documented to sometimes emit absolute paths as if the repo root were `/`. If the `context_explore` wrapper resolves those "as-is" against a local repo root without validation, it can either error confusingly or, worse, resolve to a real absolute path on the host filesystem.

**How to avoid:**
- Reuse the *exact* containment primitive already proven in `resolveScopePath`/SEC-0001 (a `relative(repoRoot, resolvedPath)` check rejecting `""`/`..`-prefixed/absolute results) for every path FastContext's `Read`/`Glob`/`Grep` tool calls touch — don't hand-roll a second one.
- Explicitly handle the known "Docker-style absolute path" quirk: strip/rewrite a leading `/<repo-name>/` (or any single leading path segment matching the configured repo name) to relative before containment-checking, rather than silently passing an absolute path through — and reject anything that doesn't resolve inside the repo after that rewrite.
- Enforce containment at the tool-execution boundary the wrapper controls (the code that actually calls `fs.readFile`/glob/grep on the explorer's behalf), not merely as a prompt instruction to the model — the model is not a trust boundary.
- Extend `smoke-scope-guard.mjs`'s pattern (drive the built server, assert traversal/absolute paths are rejected with no file touched) to a new `smoke-context-explore-guard.mjs` covering `../`, absolute, and repo-name-prefixed-absolute paths.

**Warning signs:**
- `context_explore`'s Read/Glob/Grep wrapper does path resolution but never calls `relative()`+prefix-check, or uses a `resolve()===join()` equality check (the exact bug SEC-0001 already found once).
- No smoke test exercises `context_explore` with a traversal or absolute-path probe before it ships.
- The wrapper silently "fixes" model-emitted absolute paths by string-concatenation instead of an explicit, tested rewrite+validate step.

**Phase to address:**
The phase that implements the `context_explore` MCP tool itself, before it is wired into any operating-layer command. Should ship with its own smoke test and, ideally, a `SEC-000X`-style write-up analogous to SEC-0001 given this is a structurally identical class of finding in a new input path.

---

### Pitfall 3: Provider-neutral core accidentally hardcodes the mitkox/HF model id, a local host/IP, or an `endpoint.md` default in committed code or docs

**What goes wrong:**
"Provider-neutral, defaults to a tested model on local infra" is easy to implement backwards: instead of "no default, must configure," a PR bakes in a concrete model identifier, a private-network endpoint, or a comment referencing the operator's specific host or service name into `src/`, docs, or a commit message. This simultaneously violates **DEC-no-private-references [LOCKED]** (no internal host/IP in code/comments/commits/docs) and the **provider-neutral core** constraint (no vendor/model hardcoding), and DEC-commit-scanning means it would be caught at commit time - but only if the scan actually covers the new files, and only after the violation was already typed.

**Why it happens:**
This is the single most natural way to "make FastContext work" quickly: the operator's own local infra (documented in project memory `local-inference-infra`) already has a working FastContext-capable llama.cpp endpoint, a real model file path, and a specific `--hf-repo mitkox/...` invocation from research — the shortest path to a demo is to paste that in. This is precisely the anti-pattern the `embeddings.ts` precedent explicitly avoids: `getEmbeddingConfig()` requires `CAIRN_MEMORY_EMBEDDING_MODEL` to be set explicitly and returns `null` (fall back to substring search) if unset — "the core ships no vendor default." The comment in that file ("the core ships no vendor default... unset means semantic search degrades") is the exact pattern `context_explore`'s config must copy, and it's easy to skip because FastContext feels more like "infrastructure" than "an LLM call," making it feel exempt from the same discipline.

**How to avoid:**
- Model the `context_explore`/token-miser endpoint config directly on `embeddings.ts`'s `getEmbeddingConfig()`: a `CAIRN_CONTEXT_EXPLORE_URL` / `CAIRN_CONTEXT_EXPLORE_MODEL` / `CAIRN_CONTEXT_EXPLORE_API_KEY` triplet (or equivalent, reusing `CAIRN_LLM_API_URL` where sensible), all required, none defaulted to a real hostname, IP, or vendor/model string in code. If none are set, `context_explore` should be absent/disabled (mirroring "substring fallback"), not silently pointed at a hardcoded local endpoint.
- Model docs/config templates may *name* FastContext and mitkox's GGUF quants generically as "a supported, tested backend" (that's a technology fact, not a private reference) — but must never embed a literal local IP, hostname, or systemd service name from the operator's own infra (per `local-inference-infra`: "Never commit private hosts/IPs... keep endpoints loopback in committed artifacts").
- Route any example/default in committed docs through `127.0.0.1`/`localhost` placeholders only, exactly as `local-inference-infra` already prescribes for `.ai/.env`.
- Add (or extend) a commit-scan check specifically for private IP patterns (RFC1918 ranges, Tailscale `100.64.0.0/10`, known internal hostnames) and for the literal mitkox HF repo path being used as a hardcoded default (as opposed to an example in a doc) — don't rely solely on manual review for this milestone, since it's new surface area DEC-commit-scanning hasn't been exercised against yet.

**Warning signs:**
- Any `src/*.ts` file contains a literal `http://` URL that isn't `127.0.0.1`/`localhost`, or a literal `mitkox/...`/`microsoft/fastcontext` string used as a runtime default (vs. a comment/doc example).
- A commit message or code comment names an operator-specific host, private IP address, workstation, or service unit.
- Config requires zero environment variables to "just work" for FastContext — that's the tell that a default snuck in.

**Phase to address:**
The phase that adds the `context_explore` endpoint config, mirrored immediately against `embeddings.ts`'s existing pattern; verified by an explicit review step (or automated grep) before that phase's commit, not deferred to a later audit.

---

### Pitfall 4: token-miser is adopted as a routing dependency with no public provenance to vet

**What goes wrong:**
Web research turned up no discoverable public package, repository, or documentation for a project literally named "token-miser" (searches for "token-miser npm routing LLM github" surface only unrelated token-counting/routing tools). If `token-miser` is in fact a private/local tool (as its PROJECT.md framing — "already deferred... this milestone lands it" — suggests), adopting it as a routing dependency for a public, Apache-2.0, OSS-hygiene-target repo (cairnkeep) means: no independent way to audit its license, no CVE/supply-chain history, no versioning/maintenance signal, and a nontrivial risk that its own source contains the same kind of private references (internal endpoints, employer/vendor names) that DEC-no-private-references forbids — which would leak into cairnkeep the moment it's vendored, `npm install`ed from a private registry, or copied in.

**Why it happens:**
"We already have this tool, just wire it in" skips the vetting a *new* public dependency would normally get, precisely because it doesn't feel new — it's already been used privately. But cairnkeep's OSS-hygiene bar (Apache-2.0, no attribution noise, `DEC-no-private-references`) applies to every dependency the public repo pulls in, including ones that started life as personal/private tooling.

**How to avoid:**
- Before adding `token-miser` as a dependency, establish where it actually lives (private npm registry? local path dependency? vendored source?) and treat it as a first-class supply-chain decision, not a given: license (must be OSS-compatible with Apache-2.0), whether its own source/README/comments contain any private host/IP/employer references (scan it the same way DEC-commit-scanning would scan cairnkeep's own code), and whether it needs to be rewritten/stripped/forked-clean rather than pulled in verbatim.
- If token-miser's source is not itself clean of private references, do not vendor it as-is — either sanitize a fork before adding it to the public repo, or reimplement only the routing behavior cairnkeep needs (provider selection + `context_explore` dispatch) as new, clean code, treating "token-miser" as a design reference rather than a dependency.
- If token-miser turns out to be small in scope (e.g. "route this call to backend A vs B based on a config key"), consider whether it needs to be a dependency at all versus a thin, purpose-built router living in `mcp-memory-server/src/` — consistent with the project's existing preference for small, auditable, in-repo logic (e.g. the provider-neutral git-host operation→tool map) over pulling in a routing framework.
- Whatever is decided, record it as a Key Decision in PROJECT.md (matching the pattern already used for other provider-neutrality calls), so the rationale for "why token-miser is/isn't vendored as-is" is traceable.

**Warning signs:**
- `package.json` gains a `token-miser` dependency resolving to a private registry/local path with no publicly inspectable source, and no license file was checked.
- token-miser's own source contains a hostname, IP, or vendor name that would fail DEC-commit-scanning if it were cairnkeep's own code.
- No one on the team can answer "what license is token-miser under" before it ships.

**Phase to address:**
Should be resolved in the same early phase as Pitfall 1 (before operating-layer wiring), as a "vet the token-miser dependency" gate — its outcome (vendor-as-is / fork-and-clean / reimplement-thin) determines how much of the routing-layer phase's scope is "wire up X" vs. "write X."

---

### Pitfall 5: FastContext's MCP tool-schema contract silently drifts from what `context_explore` expects, corrupting evidence rather than failing loudly

**What goes wrong:**
FastContext's own design is deliberately minimal — exactly three tools (`Read`: line-numbered file contents, `Glob`: path discovery, `Grep`: regex search) and a turn protocol where the explorer either issues tool calls or stops with a final evidence list of paths + line ranges. If cairnkeep's `context_explore` wrapper's tool schema (argument names, whether `Grep` takes a `path` scoping argument, whether `Read` takes a line-range argument, the shape of the final "evidence list" response) doesn't match exactly what the specific FastContext quant/checkpoint was trained/fine-tuned against, the model either (a) emits malformed tool-call arguments that error out per-call (visible failure, recoverable), or worse (b) emits *plausible-looking but wrong* arguments (e.g. glob patterns anchored to the Docker-mount-style absolute paths noted in Pitfall 2) that "succeed" against the wrapper's schema but return wrong/empty results silently — the same "looks done but isn't" risk as Pitfall 1, but at the schema layer instead of the invocation layer.

**Why it happens:**
This project has already been bitten by a schema-shape mismatch once: the ZodEffects `.refine()` MCP-inputSchema bug (`mcp-sdk-zodeffects-empty-schema`) published an *empty* tool schema for `memory_read` because the MCP SDK can't convert a ZodEffects wrapper to JSON Schema — the tool "worked" in the sense that the handler ran, but the schema exposed to clients was silently wrong, hiding the actual argument contract. FastContext introduces a new version of the same risk class: its three-tool contract is a specific, narrow protocol from a paper/training setup, and cairnkeep's `context_explore` wrapper is a *reimplementation* of that contract on the MCP side, not a passthrough — any deviation between "what the model was trained to emit" and "what the wrapper's Zod schema/handler accepts" is a silent contract mismatch, not a type error.

**How to avoid:**
- Keep every `context_explore`-facing tool's `inputSchema` a plain `z.object(...)` (per the already-fixed pattern) — no `.refine()`/`.transform()` wrapping the top-level schema; do cross-field validation inside the handler, exactly as the `memory_read` fix established.
- Derive the tool-call schema (arg names/types for Read/Glob/Grep and the shape of the final evidence-list response) directly from FastContext's own published prompt/tool-definition (from the paper or a reference harness like `fastcontext-harness`), rather than inventing an schema shape independently and hoping the model conforms to it.
- Add a schema-conformance check to whatever live-harness script verifies `context_explore` (mirroring `smoke-scope-guard.mjs`'s "drive the built server and assert" pattern): dump the actual JSON Schema the MCP server publishes for the tool and assert it round-trips (non-empty, matches expected keys) rather than asserting only "the tool ran."
- Log and surface raw tool-call arguments during the reliability probe from Pitfall 1 so a schema mismatch (wrong arg name, wrong path convention) is visible early rather than discovered as "the results are just always empty/wrong."

**Warning signs:**
- The published MCP tool schema for `context_explore`'s internal Read/Glob/Grep (if exposed) is empty or missing fields when inspected via `tools/list`.
- FastContext emits tool calls that parse but consistently reference a path convention (e.g. always prefixed `/repo-name/`) the wrapper doesn't normalize, producing empty results without errors.
- No dedicated test asserts the tool schema shape independent of "the handler didn't crash."

**Phase to address:**
Same phase as Pitfall 2 (the `context_explore` MCP tool implementation) — schema design should be reviewed against FastContext's actual published contract before the handler is written, and the ZodEffects lesson should be an explicit checklist item in that phase's plan.

---

### Pitfall 6: The "60% token savings" claim ships unverified because it's hard to prove live, not just hard to remember to check

**What goes wrong:**
FastContext's paper claims are for a specific harness (Mini-SWE-Agent, specific benchmark suites) — not a live, measured property of cairnkeep's actual `context_explore` integration. Without an explicit before/after token-count comparison run against the real registered `cairn-memory` MCP (the project's own verify-by-execution bar), the milestone risks shipping "we added FastContext" without ever actually confirming it reduces the *main agent's* token consumption in cairnkeep's own operating-layer commands — which is the entire stated goal ("token-efficient repo-exploration capability").

**Why it happens:**
Token-count comparisons require deliberately running the *same* exploration task twice — once with the main agent doing raw `Read`/`Glob`/`Grep` itself, once routed through `context_explore` — and diffing conversation/context token counts, which is more setup than most feature verification (a functional pass/fail check is much easier to write than a comparative measurement). It's also easy to substitute a proxy claim ("FastContext's paper says up to 60%, so it must be saving tokens here") for an actual local measurement, especially under the pressure of an already-flaky verify-by-execution history (opencode headless flakiness bit v1.1 hard).

**How to avoid:**
- Design the verification harness from the start as an A/B token-count comparison on a fixed, representative repo-exploration prompt (e.g. "find where scope path containment is implemented"): run once through the main agent's native tools, once through `context_explore`, and record actual token counts from the harness/transport (not estimates), on the registered `cairn-memory` MCP.
- Don't claim a specific percentage (e.g. "~60%") in cairnkeep's own docs/UAT unless it was actually measured locally — report the measured number for cairnkeep's own harness instead of citing the paper's number, to avoid an unverifiable/misleading claim in project docs.
- Reuse the existing scratch-isolated live-parity harness pattern (fingerprint guards, negative controls, genuine `"type":"tool"` event verification rather than substring grep) already proven in Phase 5, rather than building a new, less rigorous measurement approach from scratch.
- Explicitly budget for the possibility that the live measurement doesn't hit 60% (different repo, different task shape, different model) — the milestone's UAT bar should be "measured savings exist and are reported," not "measured savings match the paper."

**Warning signs:**
- SUMMARY/UAT docs cite "~60% token reduction" with no accompanying measured number or harness script.
- No before/after comparison run exists in the repo's smoke/verify scripts for `context_explore`.
- The only "proof" offered is a single successful `context_explore` call, not a *comparative* one against the baseline no-explorer path (mirrors the OCP-04 gap: "proven achievable once" is not the same as "reliably reproducible" or "measurably beneficial").

**Phase to address:**
The verification/UAT phase for the milestone (whichever phase closes out `context_explore` + token-miser wiring) — the A/B harness should be written alongside the feature, not bolted on afterward, given how much harder retrofitting a comparative measurement is than writing a functional check.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode the operator's local FastContext endpoint "just to get a demo working," planning to genericize later | Fastest path to a live `context_explore` call | Violates DEC-no-private-references/provider-neutral core the moment it's committed; DEC-commit-scanning may or may not catch it depending on scan coverage | Never in a committed state — acceptable only in an uncommitted, gitignored local `.ai/.env`-style file, exactly as the embeddings config already does |
| Skip the raw-endpoint tool-call reliability probe and wire FastContext straight into an operating-layer command | Saves a spike phase | Repeats the OCP-04 investigation cost (multiple burned sessions triangulating thinking-config/proxy/template dead ends) but for a new model | Never — the prior investigation is exactly why this probe is cheap insurance |
| Vendor token-miser source as-is without checking for private references inside it | Fast integration | Could reintroduce private references cairnkeep worked to remove, undetected until a wiki/security audit | Never for the public repo; acceptable temporarily on a private branch during evaluation only |
| Reuse `resolveScopePath`'s containment logic by copy-paste instead of extracting a shared helper | Faster to ship `context_explore`'s path guard | Two copies drift; a future SEC fix to one won't propagate to the other (this is exactly how SEC-0001-class bugs recur) | Acceptable only as an interim step with a tracked follow-up to extract a shared `assertContainedPath()` helper |
| Ship `context_explore` without its own smoke test, relying on manual live checks | Faster phase closeout | No regression protection; the exact gap SEC-0001's `smoke-scope-guard.mjs` was built to close for AgentFS scope | Never — smoke-scope-guard.mjs is the template to reuse, not skip |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|-------------------|
| FastContext GGUF via llama.cpp | Assuming the default/embedded chat template handles tool-calling correctly out of the box | Verify (as the qwen3.5-27b fix required) whether the template needs patching/stripping `raise_exception` guards, and pin `--jinja` + explicit template file rather than relying on GGUF-embedded defaults |
| FastContext path conventions | Passing FastContext's Docker-mount-style absolute paths (`/repo-name/...`) straight through to the local filesystem | Normalize/rewrite the known leading-segment convention to a repo-relative path, then apply containment (Pitfall 2) — never pass model-authored absolute paths to `fs`/glob directly |
| token-miser routing config | Coupling token-miser's config format directly into `cairn-memory`'s own env-var scheme without a neutral adapter | Keep token-miser's routing config isolated behind the same `CAIRN_*` env-var convention used for embeddings/LLM config, so swapping token-miser out later doesn't ripple through the MCP server |
| MCP tool schema for `context_explore` | Wrapping the tool's Zod `inputSchema` in `.refine()`/`.transform()` for convenience validation | Keep `inputSchema` a plain `z.object(...)`; validate cross-field constraints inside the handler (established fix pattern from `memory_read`) |
| Local inference endpoint config | Defaulting `CAIRN_CONTEXT_EXPLORE_URL` to a real local IP/port if unset | No default — absent config means the capability is disabled/falls back, exactly like the embeddings substring-fallback pattern |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Running FastContext-4B and the embeddings model on the same GPU as the main coding-agent model | VRAM contention causes swapping/OOM or forces one model to be stopped before the other starts (already observed: qwen3.5-27b and cairn-embed are "mutually exclusive on VRAM" per `local-inference-infra`) | Document VRAM budget per host explicitly for the FastContext deployment; treat co-residency as a documented constraint, not an assumption | Breaks the moment two of {main model, embeddings, FastContext} are needed concurrently on a single consumer GPU (16-32GB class) |
| Routing every exploration call through token-miser regardless of task size | Added latency/hop overhead for trivial single-file lookups negates the token savings | Let token-miser (or a thin router) short-circuit trivial cases (single known file) to a direct read, reserving `context_explore` for genuinely broad/ambiguous exploration | Becomes visible once `context_explore` is used for simple lookups where the round-trip overhead exceeds the tokens saved |
| Treating FastContext's evidence-list output as unbounded | Very large repos/queries produce a large evidence list that itself consumes significant tokens once returned to the main agent, eroding the savings | Cap/paginate the evidence list size the wrapper returns; measure the actual A/B savings (Pitfall 6) rather than assuming savings scale with repo size | Breaks on large monorepos where "compact" evidence is still large in absolute terms |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Treating the FastContext model's tool-call arguments as trusted input | Confused-deputy path traversal / arbitrary file read via a prompt-injected or malfunctioning explorer (Pitfall 2) | Apply the same `relative()`-based containment already proven for AgentFS scope to every Read/Glob/Grep argument the explorer emits |
| Exposing `context_explore` over the opt-in HTTP transport without the same auth hardening as other tools | Unauthenticated remote/local callers could drive the explorer to read arbitrary in-repo files (or, if containment is also broken, out-of-repo files) with no credentials | Route `context_explore` through the existing fail-closed bearer-auth/CORS/Host-validation HTTP guard rather than adding a parallel, unguarded transport path |
| Vendoring token-miser without a license/provenance check | Supply-chain risk (unaudited code with filesystem/network access wired into an MCP server) plus potential DEC-no-private-references leakage from its own source | Vet before adding (Pitfall 4); prefer a clean reimplementation over verbatim vendoring if provenance can't be established |
| Hardcoding a specific local model/endpoint as a "sensible default" | Violates provider-neutral core; also creates an implicit trust assumption that the default endpoint is always safe to call | No defaults — require explicit config, exactly as `embeddings.ts` already enforces (Pitfall 3) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|------------------|
| `context_explore` fails silently (empty evidence) when the FastContext endpoint is unreachable or misbehaving | Operator believes the repo genuinely has no matches, or that the main agent should fall back to slow native search, with no signal of *why* | Surface an explicit error/degraded-mode signal (mirrors the embeddings "explicit disable, not silent wrong answer" pattern) rather than an empty success |
| No visible indication of *when* a command routed through `context_explore` vs. native tools | Operator can't tell whether the token-savings feature is even active, undermining trust in the "it works" claim | Log/report which path was used (native vs. context_explore) in the same style as existing verify-by-execution harness output |
| token-miser routing decisions are opaque | Operator can't debug why a given exploration call went to FastContext vs. another backend vs. failed over | Log the routing decision and reason (config key, fallback trigger) so operator behavior mirrors the transparency of the existing provider-neutral git-host operation→tool map |

## "Looks Done But Isn't" Checklist

- [ ] **FastContext tool-call reliability:** Often "looks done" after one successful manual call — verify with a repeated-trial reliability probe against the raw endpoint (Pitfall 1), not a single anecdotal success (the OCP-04 lesson: "proven once" ≠ "reliable").
- [ ] **Path containment on `context_explore`:** Often "looks done" because the happy path (reading files that exist inside the repo) works — verify with an explicit traversal/absolute-path/Docker-prefix smoke test (Pitfall 2), not just functional reads.
- [ ] **Provider-neutral config:** Often "looks done" because it works on the operator's own machine — verify by grepping the diff for literal IPs/hostnames/vendor model strings before commit (Pitfall 3), not just "it runs for me."
- [ ] **token-miser provenance:** Often "looks done" because it's already used privately — verify license/source cleanliness explicitly before it ships in the public repo (Pitfall 4).
- [ ] **MCP tool schema for context_explore's internal tools:** Often "looks done" because the handler executes without throwing — verify the *published* JSON Schema is non-empty and matches FastContext's expected contract (Pitfall 5), not just "no crash."
- [ ] **Token-savings claim:** Often "looks done" because FastContext ran successfully once — verify with an actual local A/B token-count measurement (Pitfall 6), not a citation of the paper's number.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|-----------------|
| FastContext tool-call unreliability discovered late | MEDIUM–HIGH | Same recovery this project already executed for OCP-04: swap to a different/no-thinking model or quant, re-run the raw-endpoint reliability probe, and if still unreliable, scope `context_explore` down to a narrower, more deterministic subset of tasks rather than shipping a fully autonomous explorer |
| Private reference or vendor hardcoding merged before catch | LOW–MEDIUM | `git revert`/history-scrub the offending commit(s) before any push to the public remote; extend the commit-scan patterns to cover the specific string that slipped through, so the same class doesn't recur |
| Path-traversal gap found in `context_explore` post-ship | MEDIUM | Follow the SEC-0001 remediation playbook exactly: add the `relative()`-based containment fix, add a regression smoke test, write a SEC-000X finding doc, ship as a patch release |
| token-miser found to contain private references after being vendored | MEDIUM–HIGH | Remove/replace with a clean reimplementation; scrub git history of the vendored source if it was ever pushed to the public remote (coordinate carefully — history rewrites are destructive) |
| Token-savings claim shown to be unverifiable/false after ship | LOW | Correct the docs/UAT claim to the actually-measured number (or "not yet measured, tracked as a gap") rather than leaving an unverified claim in place — matches this project's existing practice of honestly downgrading claims (e.g. OCP-06's override closeout language) |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|---------------|
| Tool-call reliability degradation (Pitfall 1) | Standalone spike phase, before any MCP/operating-layer wiring | Repeated-trial raw-endpoint probe requiring `finish_reason=tool_calls` across every turn, on the pinned quant/template/flags actually shipped |
| Path/scope traversal via explorer tool calls (Pitfall 2) | `context_explore` MCP tool implementation phase | New `smoke-context-explore-guard.mjs` (traversal, absolute, repo-prefix-absolute cases), modeled on `smoke-scope-guard.mjs` |
| Provider-neutrality / DEC-no-private-references hardcoding (Pitfall 3) | Same phase as endpoint config for `context_explore` | Explicit pre-commit grep for literal IPs/hostnames/vendor-model defaults in `src/`; config requires explicit env vars with no default, mirroring `getEmbeddingConfig()` |
| token-miser provenance/supply-chain (Pitfall 4) | Same early spike phase as Pitfall 1, as a dependency-vetting gate | Documented license/source review outcome (vendor-as-is / fork-and-clean / reimplement) recorded as a Key Decision in PROJECT.md before the routing-layer phase starts |
| Tool-schema contract drift (Pitfall 5) | `context_explore` MCP tool implementation phase | `tools/list` schema-shape assertion in the live harness; plain `z.object(...)` (no `.refine()`) checked in review |
| Unverified token-savings claim (Pitfall 6) | Verification/UAT phase closing out the milestone | A/B token-count comparison harness (native tools vs. `context_explore`) with a measured, reported number in SUMMARY/UAT docs |

## Sources

- `.planning/PROJECT.md` — v1.2 goal, LOCKED decisions (`DEC-no-private-references`, `DEC-commit-scanning`), Key Decisions table, Out of Scope entry deferring token-miser — HIGH confidence (curated, internal)
- `.planning/security/VALIDATED/SEC-0001-scope-path-traversal-sandbox-escape.md` — the path-containment finding this milestone's `context_explore` path handling must not repeat — HIGH confidence (curated, internal, verified/fixed)
- `mcp-memory-server/src/embeddings.ts` (`getEmbeddingConfig`) — the existing "no vendor default, explicit config required, fallback on absent config" pattern to mirror — HIGH confidence (curated, internal, shipped code)
- Project memory `qwen-coder-opencode-toolcall-limits` — direct prior-milestone evidence of a small/local model narrating tool calls instead of executing them under certain thinking/template configs — HIGH confidence (curated, internal, first-hand investigation)
- Project memory `scope-path-containment-join-pitfall`, `mcp-sdk-zodeffects-empty-schema`, `local-inference-infra` — prior fixed pitfalls and infra constraints directly reused above — HIGH confidence (curated, internal)
- `.planning/MILESTONES.md` — OCP-04/OCP-06 override-closeout language, the "verify genuine `type:tool` events, not substring grep" follow-up — HIGH confidence (curated, internal)
- [FastContext: Training Efficient Repository Explorer for Coding Agents (arXiv:2606.14066)](https://arxiv.org/abs/2606.14066) — model design (3-tool minimal contract, 4B–30B range, ~60% token reduction / +5.5% SWE-bench claims), Microsoft — MEDIUM confidence (web search, cross-checked across multiple independent summaries/mirrors)
- [microsoft/fastcontext trending stats](https://trendshift.io/repositories/54150), [sdougbrown/fastcontext-harness](https://github.com/sdougbrown/fastcontext-harness), [LIVELUCKY/fastcontext-integrations](https://github.com/LIVELUCKY/fastcontext-integrations) — community deployment/harness context — MEDIUM confidence (web search)
- [mitkox/FastContext-1.0-4B-SFT-Q4_K_M-GGUF](https://huggingface.co/mitkox/FastContext-1.0-4B-SFT-Q4_K_M-GGUF), [sdougbrown/FastContext-1.0-4B-RL-GGUF](https://huggingface.co/sdougbrown/FastContext-1.0-4B-RL-GGUF) — GGUF quant availability, the documented Docker-mount-path (`/repo-name/...`) quirk and community `resolve_path()` workaround — MEDIUM confidence (web search, cross-checked across two independent HF cards)
- Web search for "token-miser npm routing LLM github" — returned no matching public project; informs Pitfall 4's "no discoverable provenance" finding directly — LOW confidence (absence-of-evidence, not conclusive that no public project exists, but consistent with token-miser being private/local tooling per PROJECT.md's own framing)

---
*Pitfalls research for: FastContext + token-miser integration into cairnkeep (v1.2 Context Exploration)*
*Researched: 2026-07-04*
