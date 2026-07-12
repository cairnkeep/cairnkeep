# Phase 10: Routing Seam - Pattern Map

**Mapped:** 2026-07-06
**Files analyzed:** 5 (1 modified + 4 new)
**Analogs found:** 5 / 5

**Correction applied (per orchestrator instruction / RESEARCH.md):** token-miser
routing is proxy-only HTTP, not a CLI subcommand. The new MCP tool's fetch/HTTP
body is patterned on `extractMemoryCandidates` (fetch-based), NOT
`context_explore`/`runCommand` (subprocess-based). `context_explore` is still
the correct analog for the tool's *registration/return-shape skeleton* only
(`server.registerTool(...)`, precondition-throw/execution-`{ok:false}` split,
`asToolText` + `structuredContent` dual output).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `mcp-memory-server/src/index.ts` (add `route_check` tool) | service (MCP tool handler) | request-response (single outbound HTTP call) | `extractMemoryCandidates` (fetch body, `index.ts:337-404`) + `context_explore` (registration/return-shape skeleton, `index.ts:1000-1085`) | exact (composite) |
| `mcp-memory-server/scripts/smoke-route-guard.mjs` | test (smoke/guard) | request-response | `mcp-memory-server/scripts/smoke-explore-guard.mjs` | exact |
| `mcp-memory-server/package.json` (add `check:route-guard`, wire `test:smoke`) | config | — | existing `check:explore-guard` / `test:smoke` entries (lines 17, 19) | exact |
| `scripts/verify-routing-seam.sh` | test (verify script, real proof) | request-response | `scripts/verify-fastcontext-reliability.sh` | exact |
| `docs/operating.md` (add `CAIRN_ROUTE_ENDPOINT` row + seam-contract subsection) | config/docs | — | existing `## Configuration` env-var table (lines 93-107) | exact |

## Pattern Assignments

### `mcp-memory-server/src/index.ts` — new `route_check` tool (service, request-response)

**Analog A (fetch/HTTP body + env idiom):** `extractMemoryCandidates`, `mcp-memory-server/src/index.ts:337-404`

Env-only config + `new URL`/trim/trailing-slash-strip idiom (lines 342-351):
```typescript
const apiKey = process.env.CAIRN_LLM_API_KEY;
if (!apiKey) {
    throw new Error("CAIRN_LLM_API_KEY is not set.");
}

const rawUrl = process.env.CAIRN_LLM_API_URL;
if (!rawUrl) {
    throw new Error("CAIRN_LLM_API_URL is not set.");
}
const apiUrl = rawUrl.trim().replace(/\/+$/, "");
```
→ For `route_check`, replace `.trim().replace(...)` string idiom with `new URL(rawEndpoint)` (throws on malformed input) then `.toString().replace(/\/+$/, "")` — RESEARCH.md's Pattern 1 code example already has this exact adaptation (RESEARCH.md lines 187-246); copy it directly.

Fetch-with-timeout idiom (lines 368-384):
```typescript
const response = await fetch(`${apiUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ... }),
    signal: AbortSignal.timeout(120000),
});

if (!response.ok) {
    const text = await response.text();
    throw new Error(`Extraction request failed with ${response.status}: ${text}`);
}
```
→ `route_check` reuses `fetch(..., { signal: AbortSignal.timeout(...) })` but must NOT throw on non-2xx (execution tier is `{ok:false}`, not throw — D-09/D-04 fail-closed split differs from this extraction helper, which throws on both tiers). Follow `context_explore`'s tier split instead (see Analog B).

**Analog B (registration + fail-closed tier split + dual output):** `context_explore`, `mcp-memory-server/src/index.ts:1000-1085`

Registration + input schema (lines 1000-1009):
```typescript
server.registerTool(
    "context_explore",
    {
        description: "Delegate a natural-language repo-exploration query to the external token_miser explore binary (FastContext-backed). ...",
        inputSchema: z.object({
            query: z.string().min(1),
            repo_root: z.string().min(1).optional(),
            timeout_seconds: z.number().int().min(10).max(600).optional(),
        }),
    },
    async ({ query, repo_root, timeout_seconds }) => { ... },
);
```

Precondition tier — throw (lines 1010-1032):
```typescript
const binaryPath = process.env.CAIRN_EXPLORE_BINARY;
if (!binaryPath) {
    throw new Error("CAIRN_EXPLORE_BINARY is not set.");
}
if (!existsSync(binaryPath)) {
    throw new Error(`CAIRN_EXPLORE_BINARY does not exist: ${binaryPath}`);
}
```
→ `route_check`'s precondition tier: unset `CAIRN_ROUTE_ENDPOINT` throws; `new URL(rawEndpoint)` failure throws (see RESEARCH.md lines 201-211 for the exact adapted code).

Execution tier — return `{ok:false}`, never throw (lines 1042-1076):
```typescript
if (result.timedOut || result.exitCode !== 0) {
    const payload = {
        ok: false,
        error: result.timedOut ? "token_miser explore timed out" : "token_miser explore exited non-zero",
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
    };
    return { content: [{ type: "text", text: asToolText(payload) }], structuredContent: payload };
}
// ... malformed-JSON branch follows the identical return shape
```
→ `route_check` mirrors this shape for: network error/connection refused, non-2xx status, malformed JSON body, timeout — each returns `{ content: [{type:"text", text: asToolText(payload)}], structuredContent: payload }` with `payload.ok === false`. Full adapted code already drafted in RESEARCH.md lines 213-244 — copy verbatim, only naming is planner's discretion (RESEARCH.md A3).

Dual-output success shape (lines 1078-1083):
```typescript
const payload = { ok: true, ...evidence };
return {
    content: [{ type: "text", text: renderCitations(evidence) }],
    structuredContent: payload,
};
```
→ `route_check` success: `{ ok: true, status, cluster_healthy }`, both as `asToolText(payload)` text and `structuredContent: payload`.

**Do NOT use:** `runCommand` (`index.ts:406`, spawns a subprocess with `cwd: infraRoot`) — there is no argv to spawn in reference mode; RESEARCH.md Pitfall 5 explicitly warns against importing it for this tool.

---

### `mcp-memory-server/scripts/smoke-route-guard.mjs` (test, request-response)

**Analog:** `mcp-memory-server/scripts/smoke-explore-guard.mjs` (full file, 125 lines)

Reusable skeleton — client/server harness (lines 31-44):
```javascript
async function withClient(env, fn) {
    const transport = new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
        env: { ...process.env, ...env },
    });
    const client = new Client({ name: "smoke-explore-guard", version: "0" }, { capabilities: {} });
    await client.connect(transport);
    try {
        return await fn(client);
    } finally {
        await client.close();
    }
}
```
→ Rename client name to `smoke-route-guard`; reuse verbatim otherwise.

Registration anchor pattern (lines 55-59):
```javascript
await withClient({}, async (client) => {
    const { tools } = await client.listTools();
    check("context_explore is registered", tools.some((t) => t.name === "context_explore"));
});
```
→ `check("route_check is registered", tools.some((t) => t.name === "route_check"))`.

Precondition-throw pattern (lines 61-71) — reuse the `callExplore`-style wrapper (rename to `callRoute`) against `{}` env (unset) and a malformed-URL env, asserting `isError` both times.

Execution-tier `{ok:false}` pattern (lines 79-91) — per RESEARCH.md's offline guard-script pattern (RESEARCH.md lines 345-368), stand up an ephemeral `node:http` server via `createServer` instead of shell-script fixtures (no spawnable binary in reference mode, so the `fixture()`/`chmodSync` fake-binary machinery does NOT carry over — replace with the ephemeral-server idiom):
```javascript
import { createServer } from "node:http";
const okServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", cluster_healthy: null }));
});
await new Promise((r) => okServer.listen(0, "127.0.0.1", r));
const { port } = okServer.address();
// CAIRN_ROUTE_ENDPOINT: `http://127.0.0.1:${port}` => ok:true
// CAIRN_ROUTE_ENDPOINT: "http://127.0.0.1:1"        => ok:false (connection refused)
// CAIRN_ROUTE_ENDPOINT: "not-a-url"                 => throws (precondition)
// unset                                              => throws (precondition)
okServer.close();
```
Also add a non-2xx server and a malformed-JSON-body server (same `createServer` idiom, different handler) to cover those two `{ok:false}` branches, plus the D-10 pinning assertions (exact fetch path `GET {endpoint}/health`, exact env-key set = `{CAIRN_ROUTE_ENDPOINT}` only).

Exit/summary pattern (lines 121-126) — copy verbatim (`failures` counter, `process.exit(1)`).

---

### `mcp-memory-server/package.json` (config)

**Analog:** existing lines 17, 19
```json
"check:explore-guard": "node scripts/smoke-explore-guard.mjs",
"test:smoke": "npm run build && npm run check:embeddings && npm run check:extract && npm run check:scope-guard && npm run check:http-guard && npm run check:explore-guard",
```
→ Add `"check:route-guard": "node scripts/smoke-route-guard.mjs"` and append `&& npm run check:route-guard` to the `test:smoke` chain.

---

### `scripts/verify-routing-seam.sh` (test, verify script — real proof, D-06)

**Analog:** `scripts/verify-fastcontext-reliability.sh` (624 lines; only its shape matters, not its content)

Structural pattern to mirror:
- `set -euo pipefail` at top, staged/env-driven, loopback-safe, generous timeouts, single exit-code pass/fail (header comment style, lines 1-21).
- `usage()` heredoc with `-h|--help` and named modes (lines 23-52) — routing's script needs at minimum a default/`--full` split per RESEARCH.md's Open Question 1 recommendation (health-only required, `/v1/chat/completions` round-trip optional/operator-gated, mirroring `verify-token-savings-ab.sh`'s `--full` pattern referenced in RESEARCH.md line 373).
- Never hardcode/echo operator infra details — env-var-driven URL (`CAIRN_ROUTE_BINARY`/endpoint), consistent with `DEC-no-private-references` comment convention seen at lines 13-16.

Concrete body to adapt — RESEARCH.md's verify-script skeleton (RESEARCH.md lines 370-389):
```bash
TOKEN_MISER_BIN="${CAIRN_ROUTE_BINARY:-$HOME/PARA/Projects/token-miser/target/release/token_miser}"
"$TOKEN_MISER_BIN" &   # blocks forever serving HTTP — run in background
PID=$!
trap 'kill "$PID" 2>/dev/null' EXIT

for _ in $(seq 1 20); do
  curl -sf -m 2 "http://127.0.0.1:8080/health" && break
  sleep 0.5
done

curl -sf "http://127.0.0.1:8080/health" | grep -q '"status":"ok"'
```
Must be explicitly skippable (never a silent skip — fail loud with a message) when the `token_miser` binary is absent, mirroring `verify-token-savings-ab.sh`'s discipline (RESEARCH.md Environment Availability table, row 1's Fallback column).

---

### `docs/operating.md` (config/docs)

**Analog:** existing `## Configuration` table, `docs/operating.md:93-107`

Row format to extend (lines 98-107):
```markdown
| Variable | Purpose |
|---|---|
| `CAIRN_LLM_API_KEY` | API key for the extraction / embeddings endpoint (unset → substring-only memory) |
...
```
→ Add: `| `CAIRN_ROUTE_ENDPOINT` | Base URL of an already-running token-miser routing/tiering proxy (unset → `route_check` tool is inert) |`

Then add a new seam-contract subsection (parallel to the existing `### HTTP transport (opt-in, network-facing)` subsection at line 108) documenting, per RESEARCH.md RT-02/Pitfall 3: the tool name, precondition/execution/success shape, and an explicit **does-not** clause — it does not drive `/v1/chat/completions`/`/v1/messages` and does not learn/report which tier serves a request (RESEARCH.md lines 294-307). Must be sufficient for an overlay to drive the seam without reading source (Success Criterion #3).

## Shared Patterns

### Fail-closed precondition/execution tier split
**Source:** `mcp-memory-server/src/index.ts:1010-1076` (`context_explore`)
**Apply to:** `route_check` tool handler, `smoke-route-guard.mjs` assertions
Precondition problems (missing/malformed env) → `throw`. Runtime problems (network error, non-2xx, malformed JSON, timeout) → `return { content: [...], structuredContent: { ok: false, ... } }`.

### Env-only config idiom, no committed defaults
**Source:** `mcp-memory-server/src/index.ts:342-351` (`extractMemoryCandidates`) and `docs/operating.md:93-107`
**Apply to:** `route_check`'s `CAIRN_ROUTE_ENDPOINT` read, and its `docs/operating.md` table row.
`process.env.X` read at call time, `new URL(...)` validation, trailing-slash normalization before building request paths.

### Dual output shape (`asToolText` + `structuredContent`)
**Source:** `mcp-memory-server/src/index.ts:1052-1083`
**Apply to:** every branch of `route_check`'s return value (both `{ok:false}` and `{ok:true}`).

### Smoke-guard harness (offline, no live dependency)
**Source:** `mcp-memory-server/scripts/smoke-explore-guard.mjs:31-44, 121-126`
**Apply to:** `smoke-route-guard.mjs` — `withClient` harness + `check()`/`failures` exit pattern reused verbatim; only the fixture mechanism changes (ephemeral `node:http` server instead of fake-binary shell scripts, per RESEARCH.md's guard-script code example).

### Verify-script shape (staged, env-driven, loopback-safe, real-proof)
**Source:** `scripts/verify-fastcontext-reliability.sh:1-52`
**Apply to:** `scripts/verify-routing-seam.sh` — header comment style, `usage()` heredoc, no hardcoded/echoed operator infra, poll-don't-sleep for startup readiness (RESEARCH.md's "Don't Hand-Roll" table, row 3).

## No Analog Found

None — every file in scope has a strong (exact) analog already in the codebase; this phase is 100% wiring against existing precedent, per RESEARCH.md's "Key insight."

## Metadata

**Analog search scope:** `mcp-memory-server/src/index.ts`, `mcp-memory-server/scripts/`, `scripts/`, `docs/operating.md`, `mcp-memory-server/package.json`
**Files scanned:** 5 (all read in full or via targeted offset/limit reads; no re-reads of overlapping ranges)
**Pattern extraction date:** 2026-07-06
