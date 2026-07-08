# Phase 10: Routing Seam - Research

**Researched:** 2026-07-06
**Domain:** Thin subprocess/HTTP delegate wiring in an MCP server (TypeScript), against an external Rust reverse-proxy (token-miser)
**Confidence:** HIGH (the crux question — D-02/D-03 — was resolved by reading token-miser's actual source and by running its real built binary, not by assumption)

## Summary

The crux question this research had to resolve was whether token-miser ships a
one-shot CLI routing subcommand (D-01, the CONTEXT.md default assumption) or is
proxy-only (D-03, the fallback). **It is proxy-only.** I located token-miser's
actual repo and built binary on this machine
(`/home/stondo/PARA/Projects/token-miser`), read `src/main.rs` end to end, and
ran the real binary. `std::env::args()` is checked for exactly one literal:
`"explore"` (already consumed by Phase 7's `context_explore`). Every other
invocation — including `--help`, `--version`, or no args at all — falls through
to starting the full Axum HTTP proxy on `0.0.0.0:8080` (verified live: `--help`
printed no usage text and bound the server). There is no `route`/`classify`
subcommand, no `--dry-run`, nothing in token-miser's own docs or `.planning/`
mentions one being planned.

Routing itself (`Router::classify` in `src/router.rs`) only runs as an internal
step inside the two proxy HTTP handlers, `POST /v1/chat/completions` and
`POST /v1/messages` — both of which forward the (now-classified) request to a
**real upstream provider** and return a genuine chat completion. The chosen
tier is **never returned to the HTTP caller** — not in the response body, not
in a header. It is only observable server-side, via `tracing` log lines and an
optional JSONL telemetry file (`[telemetry].log_path`, off by default), both of
which are token-miser's own internal implementation details, not a stable API.
The only side-effect-free, zero-cost, unauthenticated endpoint is `GET /health`
— verified live to return `{"cluster_healthy":null,"status":"ok"}` when no
private cluster is configured.

**Primary recommendation:** Build the D-03 fallback exactly as CONTEXT.md
anticipated it — an **env-var endpoint reference**, not a CLI delegate. Add one
new MCP tool (`route_check`, name is the planner's call) that reads
`CAIRN_ROUTE_ENDPOINT` (base URL of an already-running token-miser proxy) and
does a single `fetch()` to `${endpoint}/health`, using the exact fail-closed
precondition/execution split and dual-output shape `context_explore` already
established — but built on the **fetch-based delegate pattern** already present
in this codebase (`extractMemoryCandidates`, `index.ts:337-404`, the
`CAIRN_LLM_*` idiom), **not** `runCommand`/`spawn`. This is a necessary,
verified correction to CONTEXT.md's D-04 canonical-refs, which point at
`runCommand` as the reuse target — there is no argv to spawn in reference mode,
so there is nothing for `runCommand` to delegate to. The freeze (D-10) pins the
fetch URL/path and the `CAIRN_ROUTE_*` env-key set instead of an argv array.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Routing/tiering decision (which tier serves a request) | **External Service** (token-miser, outside this repo) | — | token-miser owns `Router::classify` entirely; it is only exercised inside its own proxy handlers and is architecturally impossible to host in cairnkeep without duplicating token-miser's logic — which is exactly what RT-01/LOCKED forbids. |
| Seam wiring (new MCP tool, registration, fail-closed tiers) | API/Backend (`cairn-memory` MCP server, `mcp-memory-server/src/index.ts`) | — | Mirrors where `context_explore` already lives; this is where every other `CAIRN_*` delegate is registered. |
| `CAIRN_ROUTE_*` env-var config surface | API/Backend (`process.env` reads inside the MCP server process) | — | Same idiom as `CAIRN_EXPLORE_*`/`CAIRN_LLM_*` — env-only, read at call time, no committed defaults. |
| Seam-contract documentation (RT-02) | Docs (`docs/operating.md`) | — | Not a runtime tier; the doc must be sufficient for an overlay to drive the seam without reading source (Success Criterion #3). |
| Freeze/pinning test (D-10) | API/Backend (colocated with the MCP server's smoke-test suite) | — | Same location and mechanism as the rest of the `check:*-guard` family. |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Design the seam against a one-shot CLI subcommand (`token_miser route`-style) spawned via `runCommand`, exactly as `context_explore` spawns `token_miser explore`. Input in → routing decision/result JSON out → process exits. **RESOLVED FALSE by this research — see Summary.**
- **D-02:** The exact subcommand name and input→output JSON shape are unconfirmed — the researcher MUST verify them against token-miser's actual routing surface before planning locks the argv. **VERIFIED: no such subcommand exists (source + live binary).**
- **D-03:** Fallback if token-miser routing is proxy-only (no CLI subcommand): the seam becomes an env-var endpoint *reference* the overlay points at — still no proxy hosted in core, still config-external. Researcher picks CLI vs. reference based on what token-miser actually ships; CLI is the default assumption. **THIS BRANCH APPLIES.**
- **D-04:** The seam is a new thin MCP tool in `cairn-memory`, mirroring `context_explore` (`index.ts:1001`) — same registration, same `runCommand` delegation, same fail-closed tiers. Chosen over an internal-only function because the MCP tool is the overlay's driveable, independently-verifiable entry point. **Registration/fail-closed-tier pattern still applies; `runCommand` delegation does NOT apply — see Architecture Patterns below for the corrected mirror (`extractMemoryCandidates`'s fetch-based idiom instead).**
- **D-05:** The tool is inert unless `CAIRN_ROUTE_*` is configured (mirrors `context_explore`'s inertness without `CAIRN_EXPLORE_BINARY`).
- **D-06:** Dormant/env-gated seam + a real proof invocation. Ship the delegate and exercise it once with a real token-miser routing call in a verify script (verify-by-execution, not a mock). cairnkeep's own memory-extraction stays on `CAIRN_LLM_*` — zero new runtime dependency by default.
- **D-07:** Cairnkeep does NOT route its own extraction LLM calls through token-miser in this phase. Deferred/optional follow-up.
- **D-08:** Config keys mirror `CAIRN_EXPLORE_*` → `CAIRN_ROUTE_*`: env-only, no committed defaults, provider-neutral.
- **D-09:** Fail-closed error tiers identical to `context_explore`: precondition problems (missing binary/env) throw; runtime problems (non-zero exit, timeout, malformed JSON) return `{ok:false, ...}`.
- **D-10:** Freeze = documented seam contract in `docs/operating.md` + a pinning test on the emitted call shape (the exact `token_miser` argv and the `CAIRN_ROUTE_*` env-key set). **Corrected: pin the fetch URL/path (`GET ${CAIRN_ROUTE_ENDPOINT}/health`) and the env-key set — there is no argv in reference mode.**

### Claude's Discretion
The user delegated every design decision above ("you decide what is best"). All decisions D-01…D-10 are Claude's calls, grounded in the LOCKED constraints and the Phase 7 precedent. The planner has latitude on naming details and test structure, but MUST preserve: thin-delegate boundary, env-only config, fail-closed tiers, and a real (non-mocked) proof invocation.

### Deferred Ideas (OUT OF SCOPE)
- Live extraction routing (opt-in): route cairnkeep's own memory-extraction LLM calls (`CAIRN_LLM_*`) through token-miser when a routing env var is set. Explicitly out of Phase 10 scope (D-07).
- Hosting the token-miser routing proxy / any endpoint/model/tier config: already LOCKED out of the core (v1.2 thin-delegate boundary); carried by a future private-track milestone.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RT-01 | Thin delegate to token-miser's routing/tiering surface; core hosts no proxy/endpoint/model/tier config | Resolved to: one `fetch()`-based MCP tool reading `CAIRN_ROUTE_ENDPOINT` and calling the real, already-running proxy's `GET /health` — no routing logic, no tier table, no model list in cairnkeep. See Architecture Patterns and Code Examples. |
| RT-02 | Routing invocation + provider-neutral config keys documented as a stable seam contract | `docs/operating.md` §Configuration gets one new env-var row (`CAIRN_ROUTE_ENDPOINT`) plus a seam-contract subsection describing the tool name, its precondition/execution/success shape, and explicitly stating what it does NOT do (it does not drive `/v1/chat/completions` or `/v1/messages`, does not learn or report which tier serves a request). See Common Pitfalls #3 for why over-promising here would break the "no source-reading needed" bar. |

## Standard Stack

No new runtime dependencies. Both halves of this phase are covered by what's
already `import`ed in `mcp-memory-server/src/index.ts` and Node 20's built-ins.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `fetch` | Node 20.19.2 (repo's runtime) [VERIFIED: `node --version` in this environment] | HTTP call to `${CAIRN_ROUTE_ENDPOINT}/health` | Already the exact mechanism `extractMemoryCandidates` uses for `CAIRN_LLM_API_URL`; no HTTP client library needed. |
| Node.js built-in `AbortSignal.timeout()` | Node 20.19.2 | Bounding the fetch call | Already used in `extractMemoryCandidates` (120000ms); reuse the idiom with a shorter default for a health probe. |
| `zod` | ^3.25.76 (already a dependency, `package.json`) [VERIFIED: package.json] | Tool input schema (`timeout_seconds` etc.) | Already the schema library every other tool in `index.ts` uses. |
| Node.js built-in `URL` | Node 20.19.2 | Validating/normalizing `CAIRN_ROUTE_ENDPOINT` | Throws on malformed input; no regex hand-rolling needed. |

### Supporting
None — no new package is required by this phase.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reference-mode `/health` check | Spawning `token_miser` itself as a subprocess to serve one request and reading the routed provider from its own stdout | Not possible — `token_miser` (no `explore` arg) never exits; it blocks forever serving HTTP. There is no one-shot CLI mode for routing to spawn. |
| Reading `/health` | Sending one real `/v1/chat/completions` request through the proxy and treating "got a 200" as proof routing works | Heavier (real LLM cost, needs a live backend at whichever tier's endpoint is configured — not present on this machine, see Environment Availability), and still never reveals the tier to the caller. Reserved for the optional/stretch real-proof path in the verify script, not the MCP tool itself. |

**Installation:** None — no `npm install` needed for this phase.

**Version verification:** N/A (no new packages).

## Package Legitimacy Audit

Not applicable — this phase installs zero external packages. Both the MCP tool
and the verify script are built entirely from already-present dependencies
(`zod`, Node built-ins) and the already-vendored `token_miser` binary (a
sibling project, not an npm/PyPI/crates package this repo pulls in).

## Architecture Patterns

### System Architecture Diagram

```
Overlay / harness
     │  reads docs/operating.md seam contract
     ▼
CAIRN_ROUTE_ENDPOINT (env, e.g. http://127.0.0.1:8080)
     │
     ▼
cairn-memory MCP server (mcp-memory-server/src/index.ts)
     │
     │  route_check tool call
     ▼
┌─────────────────────────────────────────────┐
│ Precondition tier (throw)                    │
│  - CAIRN_ROUTE_ENDPOINT unset                │
│  - CAIRN_ROUTE_ENDPOINT fails `new URL(...)` │
└─────────────────────────────────────────────┘
     │ passes
     ▼
┌─────────────────────────────────────────────┐
│ Execution tier (return {ok:false, ...})      │
│  fetch(`${endpoint}/health`, {signal: ...})  │
│  - network error / connection refused        │
│  - non-2xx status                            │
│  - malformed JSON body                       │
│  - AbortSignal timeout                       │
└─────────────────────────────────────────────┘
     │ 200 + parseable JSON
     ▼
{ ok: true, status, cluster_healthy }
     │
     ▼  (OUT OF PROCESS — cairnkeep never touches this)
token-miser proxy (external binary, real HTTP server)
  GET /health          → {status, cluster_healthy}   (this seam)
  POST /v1/chat/completions ─┐
  POST /v1/messages          ├─→ Router::classify → forwards to a REAL
                             │    upstream provider (tier1/2/3), returns
                             │    a genuine completion. Tier is NEVER
                             │    returned to the caller — only logged
                             │    server-side (tracing + optional JSONL).
                             └─→ (out of scope for this phase, D-07)
```

### Recommended Project Structure
```
mcp-memory-server/
├── src/index.ts                    # add route_check tool, alongside context_explore
├── scripts/smoke-route-guard.mjs   # new: offline fail-closed guard (mirrors smoke-explore-guard.mjs)
└── package.json                    # add check:route-guard, wire into test:smoke
scripts/
└── verify-routing-seam.sh          # new: real proof invocation (D-06) — starts the actual token_miser binary, polls /health, asserts a genuine 200
docs/
└── operating.md                    # add CAIRN_ROUTE_ENDPOINT row + seam-contract subsection (RT-02)
```

### Pattern 1: Fetch-based env-gated delegate (the correct mirror — NOT runCommand)
**What:** A tool that is inert unless its env var is set, validates the env
value at the precondition tier (throw), then makes exactly one outbound
network call at the execution tier (`{ok:false}` on any failure), and returns
a typed success payload otherwise.
**When to use:** Whenever the delegate's target is an HTTP surface rather than
a spawnable one-shot CLI. `CAIRN_LLM_*`/`extractMemoryCandidates` already
established this pattern in this exact file; `CAIRN_ROUTE_*` extends it rather
than `CAIRN_EXPLORE_*`'s subprocess pattern.
**Example:**
```typescript
// Source: mcp-memory-server/src/index.ts:337-404 (extractMemoryCandidates),
// adapted to this phase's shape. Precondition/execution split mirrors
// context_explore (index.ts:1001) — dual output (text + structuredContent).
server.registerTool(
    "route_check",
    {
        description: "Check reachability of the external token_miser routing/tiering proxy via its /health endpoint. Requires CAIRN_ROUTE_ENDPOINT (base URL of an already-running token_miser instance). Thin adapter — token_miser owns all routing/tiering logic; this tool neither hosts a proxy nor learns which tier serves a request.",
        inputSchema: z.object({
            timeout_seconds: z.number().int().min(1).max(60).optional(),
        }),
    },
    async ({ timeout_seconds }) => {
        // --- Precondition tier: throw ---
        const rawEndpoint = process.env.CAIRN_ROUTE_ENDPOINT;
        if (!rawEndpoint) {
            throw new Error("CAIRN_ROUTE_ENDPOINT is not set.");
        }
        let endpoint: URL;
        try {
            endpoint = new URL(rawEndpoint);
        } catch {
            throw new Error(`CAIRN_ROUTE_ENDPOINT is not a valid URL: ${rawEndpoint}`);
        }
        const base = endpoint.toString().replace(/\/+$/, "");

        // --- Execution tier: return { ok: false, ... } ---
        let response: Response;
        try {
            response = await fetch(`${base}/health`, {
                signal: AbortSignal.timeout((timeout_seconds ?? 10) * 1000),
            });
        } catch (e) {
            const payload = {
                ok: false,
                error: e instanceof Error && e.name === "TimeoutError"
                    ? "token_miser /health timed out"
                    : "token_miser /health request failed",
                detail: e instanceof Error ? e.message : String(e),
            };
            return { content: [{ type: "text", text: asToolText(payload) }], structuredContent: payload };
        }

        if (!response.ok) {
            const payload = { ok: false, error: "token_miser /health returned non-2xx", status: response.status };
            return { content: [{ type: "text", text: asToolText(payload) }], structuredContent: payload };
        }

        let body: { status?: string; cluster_healthy?: boolean | null };
        try {
            body = await response.json();
        } catch {
            const payload = { ok: false, error: "malformed /health JSON" };
            return { content: [{ type: "text", text: asToolText(payload) }], structuredContent: payload };
        }

        const payload = { ok: true, status: body.status, cluster_healthy: body.cluster_healthy ?? null };
        return { content: [{ type: "text", text: asToolText(payload) }], structuredContent: payload };
    },
);
```

### Anti-Patterns to Avoid
- **Spawning `token_miser` with an assumed `route` argv:** it does not exist. Any plan that reuses `runCommand` with an argv like `["route", "--input", ...]` will fail at the first real integration attempt — `token_miser` will silently start the full proxy server instead of exiting with a decision (verified live: unrecognized args fall through to `main`'s server bootstrap, not an error).
- **Trying to read the routed tier from the HTTP response:** the tier is never in the response body or headers of `/v1/chat/completions` / `/v1/messages` (verified via `src/main.rs`: `handle_chat_completions`/`handle_messages` return only the translated completion; `RoutingRecord` is passed only to `state.telemetry.record()`, never to the client).
- **Depending on `[telemetry].log_path` as part of the seam:** it's an internal, opt-in, path-configurable implementation detail of token-miser's own config (off by default in its tracked `config.toml`, confirmed). Building the delegate around parsing that file would smuggle tier/config knowledge into cairnkeep's core — exactly what RT-01 forbids.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP call with a timeout | A custom XHR/http.request wrapper | Built-in `fetch` + `AbortSignal.timeout()` | Already the established idiom in this exact file (`extractMemoryCandidates`). |
| URL validation/normalization | Regex-based URL parsing | Built-in `new URL(...)` + `.replace(/\/+$/, "")` | Throws cleanly on malformed input; `extractMemoryCandidates` already does the trailing-slash strip this way. |
| Waiting for the real proxy to become ready in the verify script | A fixed `sleep N` | A short poll loop against `GET /health` with a small retry budget | `token_miser` also does live model discovery (GitHub CLI probe, Claude CLI probe) on startup, adding variable latency (observed ~1s, more if `gh`/network is slow) — a fixed sleep is a flaky-test generator. |

**Key insight:** Every piece this phase needs — HTTP fetch, timeout, URL
parsing, MCP tool registration, fail-closed dual-tier error handling — already
has a working, tested precedent in this same file. This phase is 100% wiring
and documentation, zero new capability.

## Common Pitfalls

### Pitfall 1: Assuming `token_miser --help` or unrecognized args fail loud
**What goes wrong:** A verify script or smoke test that probes with `--help`
(expecting a quick usage-and-exit) instead hangs — the real binary silently
starts the full Axum proxy server on `0.0.0.0:8080` and blocks forever.
**Why it happens:** `main.rs`'s only CLI dispatch is `if args.get(1) ==
Some("explore")`; every other case (including no args, `--help`, garbage) falls
through to the server bootstrap.
**How to avoid:** Never probe with unknown flags. If you need to confirm the
binary exists/works, either run `explore --query x --repo-root .` (a real
short-lived subcommand) or start it for real and poll `/health` with a timeout
and an explicit kill.
**Warning signs:** A script that "hangs" or times out on what looks like a
harmless `--help`/`--version` probe.

### Pitfall 2: Assuming routing is CLI-invocable at all
**What goes wrong:** Locking a plan/argv against a `token_miser route`-style
one-shot subcommand (the CONTEXT.md D-01 default) that does not exist.
**Why it happens:** It's a very reasonable inference from the `explore`
precedent (Phase 7) — but `explore` is a special case token-miser added
specifically for external callers; routing was never given the same treatment.
**How to avoid:** This research resolved it: build D-03 (env-var endpoint
reference), not D-01.
**Warning signs:** Any task description or code review comment referencing
"the `token_miser route` subcommand" — there isn't one.

### Pitfall 3: Over-promising what the seam does in docs (RT-02)
**What goes wrong:** Writing the seam-contract doc as if `route_check` (or its
final name) reports "which tier a request would be routed to." It cannot — the
tier is never surfaced over HTTP.
**Why it happens:** The tool's name and the phase's framing ("drives the
routing/tiering surface") make it tempting to imply a decision-returning call.
**How to avoid:** Document precisely what the seam proves: that
`CAIRN_ROUTE_ENDPOINT` points at a live, reachable token-miser instance. The
overlay is the one that actually sends real chat/messages traffic through the
proxy to get routed — this delegate only confirms the wire is live. Success
Criterion #3 (doc sufficient without reading source) means this distinction
must be explicit in the doc, not just implied.
**Warning signs:** A UAT question like "what tier did it route to?" that the
implemented tool cannot answer.

### Pitfall 4: Conflating the `/health` check with a real routing proof (D-06)
**What goes wrong:** Treating a `/health` 200 as proof that `Router::classify`
was genuinely exercised. `/health` never touches the router at all (verified:
`handle_health` only reports `cluster_healthy` from the optional private
intent classifier — it doesn't call `router.classify`).
**Why it happens:** `/health` is the only endpoint that's free to call
(no upstream cost, no backend dependency), so it's an attractive target for
"the" proof invocation.
**How to avoid:** Frame `/health` reachability as proof the **seam** (the
delegate's wiring to a real, running binary) works — which is what D-06 asks
for ("exercise it once with a real token-miser routing call" — read this as
"a real call against the routing *surface's* liveness," not literally proving
a tier decision). If a stronger proof is wanted later, that requires standing
up a real backend (see Environment Availability) and sending one real
`/v1/chat/completions` request — a heavier, optional stretch, not this
phase's minimum bar. State this framing explicitly in the verify script's
comments so a future reader isn't confused about what was and wasn't proven.
**Warning signs:** A verify script or UAT criterion phrased as "prove routing
picked the right tier" when the environment (this machine, likely CI too) has
no live tier1/tier2/tier3 backend configured.

### Pitfall 5: Reusing `runCommand`'s `cwd: infraRoot` mental model
**What goes wrong:** Copying `context_explore`'s pattern verbatim, including
spawning via `runCommand` with an `infraRoot`-relative cwd — there is nothing
to spawn in reference mode, so this is dead code if copied literally.
**Why it happens:** CONTEXT.md's canonical refs explicitly point at
`runCommand` as the reuse target (written before this research resolved D-02/
D-03).
**How to avoid:** Reuse `extractMemoryCandidates`'s fetch idiom instead (see
Architecture Patterns, Pattern 1). Keep the *shape* (precondition throw /
execution `{ok:false}` / success payload) from `context_explore`, not the
*mechanism*.
**Warning signs:** A diff that imports `runCommand` for the routing tool.

## Code Examples

### Guard-script pattern for offline fail-closed testing (no real token_miser needed)
```javascript
// Source: pattern mirrors mcp-memory-server/scripts/smoke-explore-guard.mjs,
// adapted for an HTTP-fetch delegate instead of a spawned binary. An ephemeral
// local http.createServer stands in for token_miser's /health endpoint so the
// four outcomes (unset env, malformed URL, unreachable, non-2xx/malformed JSON,
// success) are all exercised offline.
import { createServer } from "node:http";

// ok server: real listening port, returns the exact live-verified /health shape.
const okServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", cluster_healthy: null }));
});
await new Promise((r) => okServer.listen(0, "127.0.0.1", r));
const { port } = okServer.address();

// ... withClient({ CAIRN_ROUTE_ENDPOINT: `http://127.0.0.1:${port}` }, ...) => ok:true
// ... withClient({ CAIRN_ROUTE_ENDPOINT: "http://127.0.0.1:1" }, ...)      => ok:false (connection refused)
// ... withClient({ CAIRN_ROUTE_ENDPOINT: "not-a-url" }, ...)               => throws (precondition)
// ... withClient({}, ...)                                                  => throws (unset)

okServer.close();
```

### Verify-script skeleton for the real proof invocation (D-06)
```bash
# Source: pattern mirrors scripts/verify-fastcontext-reliability.sh and
# scripts/verify-token-savings-ab.sh's staged, env-driven, loopback-safe shape.
TOKEN_MISER_BIN="${CAIRN_ROUTE_BINARY:-$HOME/PARA/Projects/token-miser/target/release/token_miser}"
"$TOKEN_MISER_BIN" &   # blocks forever serving HTTP — run in background
PID=$!
trap 'kill "$PID" 2>/dev/null' EXIT

# Poll, don't sleep-and-hope — startup includes model discovery (gh/claude CLI probes).
for _ in $(seq 1 20); do
  curl -sf -m 2 "http://127.0.0.1:8080/health" && break
  sleep 0.5
done

# This IS the real, non-mocked binary, not a fixture — satisfies D-06's
# "verify-by-execution" bar for proving the seam's target actually runs and
# answers. It proves liveness, not a routing decision (see Pitfall 4).
curl -sf "http://127.0.0.1:8080/health" | grep -q '"status":"ok"'
```

## State of the Art

| Old Approach (CONTEXT.md default, D-01) | Current Approach (this research, D-03) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `runCommand`-spawned one-shot CLI subcommand, input→JSON→exit | `fetch()`-based reachability check against an env-referenced running proxy | This research session (2026-07-06), by reading token-miser's actual `src/main.rs` and running the built binary | The planner must not reuse `runCommand`/argv-pinning; the pinning test (D-10) pins a fetch URL/path and env-key set instead of an argv array. |

**Deprecated/outdated:** None — this is a first-time integration, not a
migration away from a prior pattern.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `token_miser` binary and source checked out at `/home/stondo/PARA/Projects/token-miser` on this machine is the same version/commit the planner and a future overlay will target in production. | Summary, all D-02/D-03 findings | If the overlay's/production token-miser diverges (e.g. a `route` subcommand is added later), this research's "no CLI subcommand exists" finding could go stale. Mitigated: the pinning test (D-10) will fail loudly if the seam's assumptions ever stop matching a real instance, and `/health`'s shape is a stable, documented part of token-miser's public surface (README "What it does": `Serves POST /v1/chat/completions and POST /v1/messages` + the smoke-tested `/health` route). |
| A2 | `CAIRN_ROUTE_ENDPOINT` (exact env var name) is not yet locked anywhere else in the codebase or docs. | User Constraints, Standard Stack | Low — grepped the full repo for `CAIRN_ROUTE` and found zero existing uses; the name is free. |
| A3 | The tool name `route_check` is a placeholder the planner may rename. | Architecture Patterns, Code Examples | None if renamed consistently — CONTEXT.md explicitly reserves naming as planner discretion. |

**If this table is empty:** N/A — see above; none of these are compliance/
security/performance claims requiring user sign-off, they're implementation
naming/versioning notes the planner can freely adjust.

## Open Questions

1. **Should the verify script (D-06) attempt a real end-to-end `/v1/chat/completions` proof, or is `/health` reachability sufficient?**
   - What we know: `/health` is free, real, and already verified live. A true routing-decision proof needs a live tier1/tier2/tier3 backend (e.g. Ollama on `localhost:11434`), which is NOT present on this machine (verified: `ollama` not found, port 11434 unreachable) and cannot be assumed present elsewhere.
   - What's unclear: Whether "a real token-miser routing call" in D-06's wording strictly requires exercising `Router::classify`, or whether proving the real binary is live and answering is an acceptable interpretation.
   - Recommendation: Ship `/health` as the required minimum (this research's Pitfall 4 argues why), and make a full `/v1/chat/completions` round-trip an explicitly optional, operator-gated stretch step in the verify script (mirroring `verify-token-savings-ab.sh`'s `--full` operator-gated pattern) — never a hard requirement, since it depends on infrastructure outside this repo's control.

2. **Does the overlay need any auth header support for a future real routing call?**
   - What we know: `/health` is unauthenticated (verified live, no `Authorization` header sent or required). `/v1/chat/completions`/`/v1/messages` also accept unauthenticated requests at the token-miser layer itself (auth, if any, is between token-miser and its upstream providers, per `[providers.*].api_key`).
   - What's unclear: Whether a future private overlay fronts its own token-miser instance with an auth layer cairnkeep's delegate would need to pass through.
   - Recommendation: Out of scope for Phase 10 (D-07 defers live routing entirely); if it surfaces later, extend `CAIRN_ROUTE_*` with an optional bearer-token var following the `CAIRN_MEMORY_HTTP_TOKEN` precedent already in this codebase (`docs/operating.md` HTTP transport section).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `token_miser` binary (built) | D-06 real proof invocation | ✓ (this machine only) [VERIFIED: ran it live] | 0.1.0 (Cargo.toml) | On a machine without it, the verify script's real-proof step must be explicitly skippable/operator-gated, mirroring `verify-token-savings-ab.sh`'s "fails loud, never a silent skip" discipline — document the skip condition, don't silently pass. |
| `cargo`/`rustc` (to rebuild token_miser if needed) | Rebuilding the binary | ✓ | 1.96.1 | N/A — binary is already built. |
| Ollama (or any tier backend) at `localhost:11434` | Optional stretch: real `/v1/chat/completions` routing proof | ✗ [VERIFIED: port unreachable, `ollama` not on PATH] | — | Skip the stretch step; `/health`-only proof is the required minimum (see Open Question 1). |
| Node.js 20 | Building/running `mcp-memory-server` | ✓ | 20.19.2 | — |
| `gh` CLI (GitHub Copilot model discovery, triggered automatically on token_miser startup) | Not required by this phase, but affects startup latency/log noise when starting the real binary | ✗ [VERIFIED: startup log shows "GitHub CLI not available or user not authenticated" — non-fatal] | — | None needed — the warning is harmless and startup proceeds. |

**Missing dependencies with no fallback:** None — the one true gap (a live
tier backend) has an explicit, sanctioned fallback (skip the optional stretch,
ship `/health`-only proof).

**Missing dependencies with fallback:** Ollama/tier backend (see above).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None — hand-rolled assert-style smoke scripts (`check(name, cond)` helper), consistent with every other `check:*-guard` script in this repo [VERIFIED: `mcp-memory-server/scripts/smoke-explore-guard.mjs`] |
| Config file | none — see Wave 0 |
| Quick run command | `npm run check:route-guard` (new script, once added) |
| Full suite command | `npm run test:smoke` (already runs `build` + all `check:*-guard` scripts; add the new one to this chain) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RT-01 | Tool registered; throws when `CAIRN_ROUTE_ENDPOINT` unset/malformed; returns `{ok:false}` on unreachable/non-2xx/malformed-JSON; returns `{ok:true,...}` on a real 200 | smoke (MCP round-trip, mirrors `smoke-explore-guard.mjs`) | `node mcp-memory-server/scripts/smoke-route-guard.mjs` | ❌ Wave 0 |
| RT-01 (D-10 freeze) | Pinning test: exact fetch path (`GET {endpoint}/health`) and exact `CAIRN_ROUTE_*` env-key set (just `CAIRN_ROUTE_ENDPOINT`) never silently drift | smoke (same file, additional assertions) | same command | ❌ Wave 0 |
| RT-01 (D-06 real proof) | A genuine (non-mocked) `token_miser` binary answers `/health` | integration/manual-gated (operator/CI must have the binary; skip-with-message if absent) | `scripts/verify-routing-seam.sh` | ❌ Wave 0 |
| RT-02 | `docs/operating.md` documents `CAIRN_ROUTE_ENDPOINT` and the tool's exact contract, sufficient without reading source | manual-only — doc completeness/accuracy is judged by review (UAT), not a runnable assertion; optionally backstop with a trivial `grep` presence check | manual (UAT) + optional `grep -q CAIRN_ROUTE_ENDPOINT docs/operating.md` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run check:route-guard` (once it exists)
- **Per wave merge:** `npm run test:smoke`
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus `scripts/verify-routing-seam.sh` run at least once (D-06)

### Wave 0 Gaps
- [ ] `mcp-memory-server/scripts/smoke-route-guard.mjs` — covers RT-01 registration + all four fail-closed outcomes + D-10 pinning assertions
- [ ] `mcp-memory-server/package.json` — add `check:route-guard` script, wire into `test:smoke`
- [ ] `scripts/verify-routing-seam.sh` — real proof invocation (D-06), operator/CI-gated on the `token_miser` binary being present
- [ ] `docs/operating.md` — `CAIRN_ROUTE_ENDPOINT` env row + seam-contract subsection (RT-02)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface added — `/health` itself is unauthenticated at the token-miser side, and this delegate adds no credentials. |
| V3 Session Management | no | Stateless single fetch per call. |
| V4 Access Control | no | No access-control decisions made by this tool. |
| V5 Input Validation | yes | Validate `CAIRN_ROUTE_ENDPOINT` with `new URL(...)` before use (throws on malformed input at the precondition tier); normalize trailing slashes before building the request path (mirrors `extractMemoryCandidates`'s `apiUrl.trim().replace(/\/+$/, "")`). |
| V6 Cryptography | no | No new cryptographic operations; no secrets are introduced by this phase (unlike `CAIRN_LLM_API_KEY`, `CAIRN_ROUTE_ENDPOINT` is a plain URL, not a credential). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Operator-controlled URL fetched by the server (SSRF-shaped surface) | Tampering / Information Disclosure | Accepted precedent already exists in this exact codebase (`CAIRN_LLM_API_URL` is fetched the same way) — the env var is operator-set at deploy time, never derived from untrusted request input, so this is not a new attack surface class. Validate with `new URL(...)` to reject garbage early; no change beyond that is warranted. |
| Slow/hanging endpoint causing the MCP tool call to hang | Denial of Service | `AbortSignal.timeout()` on every fetch, mirroring `extractMemoryCandidates`'s existing pattern; use a short default (e.g. 10s) appropriate for a health check, not the 120s used for LLM completions. |

## Sources

### Primary (HIGH confidence)
- `/home/stondo/PARA/Projects/token-miser/src/main.rs` — read in full; CLI dispatch (`explore` special-case only), `handle_health`, `handle_chat_completions`, `handle_messages`, `RoutingRecord` usage. [VERIFIED: direct source read]
- `/home/stondo/PARA/Projects/token-miser/src/router.rs` — `Router::classify`, `Tier` enum, confirms routing is a request-classification step, not a standalone decision API. [VERIFIED: direct source read]
- `/home/stondo/PARA/Projects/token-miser/src/telemetry.rs` — confirms `RoutingRecord`/tier is only ever logged (tracing + optional JSONL), never returned to the HTTP caller. [VERIFIED: direct source read]
- Live execution: `./target/release/token_miser --help` (bound the server, no usage text) and a full run with `curl GET /health` → `{"cluster_healthy":null,"status":"ok"}` and `curl GET /v1/models` → real discovered-model list. [VERIFIED: live command execution in this session]
- `/home/stondo/PARA/Projects/token-miser/README.md`, `QUICKSTART.md`, `config.example.toml`, `.env.example` — confirm the proxy-only framing, default port `8080`, default tier1 backend `localhost:11434` (Ollama), telemetry off by default in the tracked `config.toml`. [VERIFIED: direct source read]
- `mcp-memory-server/src/index.ts` — `context_explore` (line 1000), `runCommand` (line 406), `extractMemoryCandidates` (line 337). [VERIFIED: direct source read]
- `mcp-memory-server/scripts/smoke-explore-guard.mjs`, `scripts/verify-fastcontext-reliability.sh`, `scripts/verify-token-savings-ab.sh` — precedent patterns for the guard script and verify script. [VERIFIED: direct source read]
- `mcp-memory-server/package.json` — confirms the smoke-script test wiring (`test:smoke` chain) and that no formal test framework is used. [VERIFIED: direct source read]

### Secondary (MEDIUM confidence)
None used — no web search was needed; every claim was resolvable by reading the actual code and running the actual binary on this machine.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - zero new dependencies, everything already precedented in this exact file
- Architecture: HIGH - the crux (D-02/D-03) was resolved by direct source read + live execution of the real binary, not inference
- Pitfalls: HIGH - every pitfall listed was directly observed (the `--help` hang, the absent tier-in-response, the absent live backend) in this session, not assumed

**Research date:** 2026-07-06
**Valid until:** 30 days, OR immediately if token-miser's `src/main.rs` CLI dispatch changes (the pinning test, D-10, is the automated tripwire for that on cairnkeep's side; token-miser is a sibling project this repo does not control)
