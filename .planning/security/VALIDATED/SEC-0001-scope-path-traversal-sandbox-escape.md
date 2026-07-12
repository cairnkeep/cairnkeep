# SEC-0001 — Unvalidated `scope` input allows AgentFS sandbox escape via path traversal

- **Finding ID:** SEC-0001
- **Kind:** path-traversal
- **Severity:** medium
- **Threat model:** localhost-service-abuse / confused-deputy tool-arg injection
- **Status:** fixed (input validation + HTTP-transport hardening)
- **Component:** `mcp-memory-server/src/index.ts`

## Remediation Status

The path-traversal / sandbox-escape vector is closed. `resolveScopePath` now
routes every non-`project` scope through `assertSafeScope` (kebab-case allowlist
`^[a-z0-9][a-z0-9-]*$`, plus `project`/`all`) and asserts the resolved db path
stays within the base dir via `relative()` containment, rejecting any `..` or
absolute scope before a file or directory is created. `promote_to` is covered
because it resolves through the same `openScope` chokepoint. Regression-tested
end-to-end by `mcp-memory-server/scripts/smoke-scope-guard.mjs`
(`npm run check:scope-guard`), which drives the built server over stdio and
confirms absolute and traversal scopes are rejected with no file created outside
the base dir.

**HTTP transport now hardened.** The opt-in HTTP mode (`MCP_HTTP_PORT`) fails
closed: it requires `CAIRN_MEMORY_HTTP_TOKEN` (refuses to start otherwise) and
demands `Authorization: Bearer <token>` on every request (constant-time
comparison → `401`); CORS is opt-in per origin via
`CAIRN_MEMORY_HTTP_ALLOWED_ORIGINS` (default: no `Access-Control-Allow-Origin`,
replacing the former `*`); and the `Host` header is validated against an
allowlist (`CAIRN_MEMORY_HTTP_ALLOWED_HOSTS`, default bind-host + localhost) for
DNS-rebinding protection (`403` on mismatch). Regression-tested by
`mcp-memory-server/scripts/smoke-http-guard.mjs` (`npm run check:http-guard`):
fail-closed start, `401` without/with a bad token, `403` on an unexpected Host,
and `200` when authorized.

## Summary

Every memory tool exposed by `cairn-memory` accepts `scope` (and `memory_write` additionally `promote_to`) as a bare `z.string()` and feeds it directly into a filesystem path:

```ts
function resolveScopePath(scope: string, cwd = process.cwd()): string {
    if (scope === "project") return resolve(cwd, ".agentfs", "project.db");
    return resolve(getBaseDir(), `${scope}.db`);   // no normalization / confinement
}
```

Because `path.resolve` collapses `..` segments and lets an absolute second argument discard the base, a `scope` value such as `../../../../tmp/pwn` or `/tmp/abs-escape` resolves the AgentFS database file to an arbitrary location, escaping `CAIRN_AGENTFS_BASE_DIR` (default `~/.cairnkeep`). On `create` paths (`memory_write`, `memory_supersede`) the server also `mkdirSync(..., { recursive: true })` the traversed parent, so it builds arbitrary directory trees before opening the db. The documented "one db file per scope, all under the base dir" invariant and the `config.scopes` allowlist are not enforced anywhere in this flow.

## Reachability And Impact

Input-to-sink path (all in `src/index.ts`):

1. Tool schemas declare `scope: z.string()` with no regex/refine/allowlist — `memory_read` (569), `memory_write` (607), `memory_list` (663), `memory_delete` (688), `memory_search` (715), `memory_extract` (745), `memory_supersede` (772), `memory_history` (831); plus `promote_to: z.string().optional()` (610).
2. Handlers forward `scope` unchanged. `getSearchScopes` (110-116) returns `[scope]` verbatim for any `scope !== "all"`; `config.scopes` is used only as the fan-out list when `scope === "all"`, never to validate an incoming scope.
3. `openScope(scope, create)` (142-154) → `resolveScopePath(scope)` (118-124); on `create` it calls `ensureParentDir` → `mkdirSync(dirname(dbPath), { recursive: true })` (126-128, 149-151).
4. `getBaseDir()` (66-68) is `~/.cairnkeep` by default. The only guard in the flow, `isHistoryKey` (156-158), validates the *key* namespace, not the *scope*.

Node `path.resolve` semantics (independently confirmed dynamically by the orchestrator): `resolve('~/.cairnkeep', '../../../../tmp/pwn.db')` → `/tmp/pwn.db`; an absolute scope `/tmp/abs-escape` → `/tmp/abs-escape.db`.

Transport reachability:
- **Default (stdio):** `httpPort = parseInt(process.env.MCP_HTTP_PORT ?? "", 10)` is `NaN` with no env var, so the `else` branch (`StdioServerTransport`, 1067-1074) is the default. Here `scope` is model-controlled and reachable via confused-deputy / prompt-injection through untrusted content the model handles (stored memory values, `memory_extract` input, synced docs).
- **HTTP (opt-in, `MCP_HTTP_PORT > 0`):** `handleWeb` (1016-1032) performs no authentication — a new client simply mints a session on `initialize`. CORS is `*` (1035) and no allowed-host / DNS-rebinding protection is passed to `WebStandardStreamableHTTPServerTransport`. Binds `MCP_HTTP_HOST ?? "127.0.0.1"` (1062). In this explicitly-documented mode any co-located local process can complete the handshake and invoke every tool with no credentials.

Impact:
- **Integrity (primary, unconditional):** create attacker-controlled AgentFS `.db` files and arbitrary directory trees anywhere the server process can write, outside `CAIRN_AGENTFS_BASE_DIR`; mutate existing AgentFS db files at arbitrary `*.db` paths (`memory_write`/`memory_supersede`).
- **Confidentiality:** read any AgentFS-format `*.db` reachable by the process, including scopes absent from the config allowlist. On a shared/centralized ("VPS") HTTP deployment this crosses into other users'/projects' scope databases.
- **Availability/tampering:** `memory_delete` opens an arbitrarily-pathed *existing* db and deletes a KV key inside it (cross-scope tampering). It removes a key within the db — it does not unlink the file.

Severity is transport-gated. Under the default single-user stdio deployment the practical damage is bounded (same-uid AgentFS files; injection-driven arbitrary db/dir creation) → **medium**. It escalates to **high** under the opt-in unauthenticated HTTP transport combined with a shared/multi-tenant deployment, where any local process reads/writes other tenants' scope databases with no credentials. A human triager running HTTP multi-tenant should re-rate to high.

## Evidence

- `resolveScopePath` (index.ts:118-124): no normalization; `resolve(getBaseDir(), \`${scope}.db\`)`.
- `getSearchScopes` (index.ts:110-116): returns `[scope]` verbatim for non-`"all"`; allowlist never enforced on incoming scope.
- `openScope` + `ensureParentDir` (index.ts:126-128, 142-154): `mkdirSync(recursive)` on the traversed parent when `create=true`.
- Bare `scope: z.string()` on every memory tool (lines 569, 607, 663, 688, 715, 745, 772, 831); `promote_to: z.string().optional()` (610).
- `memory_delete` handler (index.ts:692-701): `openScope(scope, false)` then `agent.kv.delete(key)` — key deletion inside an arbitrarily-pathed db, not file unlink.
- HTTP transport (index.ts:1007-1066): no auth in `handleWeb`/`createServer`; CORS `*`; default bind `127.0.0.1`; opt-in via `MCP_HTTP_PORT`.
- Orchestrator dynamically confirmed the `path.resolve` traversal and absolute-override behavior.

## Minimal Reproduction Or Exploit Sketch

HTTP mode (`MCP_HTTP_PORT=7801 node dist/index.js`, base dir `~/.cairnkeep`), from a local unprivileged process:

1. `POST http://127.0.0.1:7801/` JSON-RPC `initialize`; read minted `mcp-session-id` from response headers.
2. `POST notifications/initialized` with that session id.
3. Arbitrary write outside the sandbox (absolute-path variant):
   ```json
   {"jsonrpc":"2.0","id":2,"method":"tools/call",
    "params":{"name":"memory_write",
      "arguments":{"scope":"/tmp/cairn-escape/pwned","key":"x","value":"planted"}}}
   ```
   `resolveScopePath` → `/tmp/cairn-escape/pwned.db`; `ensureParentDir` creates `/tmp/cairn-escape/`; AgentFS creates the SQLite db there.
4. Cross-boundary read (traversal variant):
   ```json
   {"jsonrpc":"2.0","id":3,"method":"tools/call",
    "params":{"name":"memory_read",
      "arguments":{"scope":"../../../../home/otheruser/.cairnkeep/identity","key":"credentials"}}}
   ```
   Opens `/home/otheruser/.cairnkeep/identity.db` (if readable) and returns its contents.

Under stdio the same arguments are reachable whenever the model can be induced to emit them via injected content.

## Duplicate Check

`.planning/security/FINDINGS.yaml` contains `findings: []`. No prior or duplicate finding for this path-traversal / scope-confinement issue. This is a materially new finding assigned SEC-0001.

## Recommended Remediation

- Confine `scope` and `promote_to` before use: reject values containing path separators, `..`, or absolute paths (e.g., a strict `^[a-z0-9][a-z0-9-]*$` kebab-case allowlist matching the documented key/scope convention), enforced in the Zod schema via `.regex(...)`.
- Enforce the `config.scopes` allowlist as an actual boundary for concrete (non-`"all"`) scopes, not just as the `"all"` fan-out list.
- After resolving `dbPath`, assert it is contained within `getBaseDir()` (e.g., `resolve(dbPath).startsWith(resolve(getBaseDir()) + sep)`), rejecting anything outside — defense-in-depth even if input validation is bypassed.
- For HTTP mode: require an authentication token (shared secret / bearer) on every request, restrict CORS to trusted origins, and enable allowed-host / DNS-rebinding protection on the streamable HTTP transport.
