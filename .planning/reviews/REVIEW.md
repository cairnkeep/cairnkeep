## FINDINGS

> Resolution: **Finding 1 (Medium) fixed** (2026-07-02) — `resolveScopePath` now uses
> `relative(baseDir, dbPath)` containment (rejects `..` escapes and absolute overrides).
> **Finding 3 (Low) fixed** (2026-07-03) — `resolveScopePath` now rejects the read-only
> virtual scope `"all"` on the write/list/delete/supersede/history paths, so it can no
> longer masquerade as a literal `all.db`; `memory_read`/`memory_search` still fan it out.
> Both are covered by `scripts/smoke-scope-guard.mjs`. Finding 2 (Low) is accepted as a
> non-issue: scopes follow the documented kebab-case convention.

**Scope:** diff (SEC-0001 scope traversal fix + memory_read schema fix + embedding vendor-default removal)
**Files reviewed:** 2 (`mcp-memory-server/src/index.ts`, `mcp-memory-server/src/embeddings.ts`)
**Findings:** 3 (0 critical, 0 high, 1 medium, 2 low)

### Core verdict on the fix

The path-traversal fix is sound. `resolveScopePath` is the single chokepoint every DB access flows through (`openScope` → all read/write/list/delete/supersede/history tools, `embeddingCachePath`, and the `wakeup` CLI), and `assertSafeScope`'s `SCOPE_PATTERN = /^[a-z0-9][a-z0-9-]*$/` rejects `/`, `.`, `..`, backslashes, uppercase, and absolute paths — so `../`, absolute, and dotfile scopes can no longer escape the base dir.

Reachability was checked for the two tricky paths called out in scope:
- **`scope === "all"` fan-out:** `getSearchScopes("all")` returns `config.scopes`, and each concrete config scope is independently re-validated when `listEntries`/`readKey` call `resolveScopePath`. A malicious `scopes` entry in `memory.json` would now be rejected, not resolved. No bypass.
- **`promote_to` (memory_write):** `targets` includes `promote_to`, and each target goes through `openScope` → `resolveScopePath` → `assertSafeScope`. Validated. No bypass.

The `memory_read` schema change is behavior-preserving: `Boolean(key) === Boolean(query)` throwing is the exact negation of the old `.refine(Boolean(key) !== Boolean(query))` XOR, including the empty-string edge cases. Moving it into the handler to avoid the ZodEffects empty-JSON-Schema bug is a reasonable, correct trade-off.

The embedding vendor-default removal is correct: unset/whitespace `CAIRN_MEMORY_EMBEDDING_MODEL` → `null` → substring fallback, and the degradation is surfaced to callers via `mode: "substring"`. Consistent with the provider-neutrality goal.

### Medium (1)
| # | File:Line | Dimension | Description | Suggested Fix |
|---|---|---|---|---|
| 1 | `mcp-memory-server/src/index.ts:143-147` | security | The "defense in depth" guard `if (dbPath !== join(baseDir, \`${scope}.db\`))` does **not** do what its comment claims ("even if the pattern is ever loosened, never resolve outside the base dir"). `path.join` normalizes `..` identically to `path.resolve`, so for a `../evil` scope both sides are equal and the check passes — it only catches *absolute-path* segments, not `../` traversal. Today the regex covers both, so this is not currently exploitable, but the comment explicitly invites a future maintainer to loosen `SCOPE_PATTERN` while trusting a guard that would silently fail against `../`. | Make the guard actually verify containment, e.g. `const rel = relative(baseDir, dbPath); if (rel.startsWith("..") || isAbsolute(rel)) throw ...`, or `if (!dbPath.startsWith(baseDir + sep)) throw ...`. Alternatively drop the guard and rely on the regex (confidence: high). |

### Low (2)
| # | File:Line | Dimension | Description | Suggested Fix |
|---|---|---|---|---|
| 2 | `mcp-memory-server/src/index.ts:122` | reliability | `SCOPE_PATTERN` rejects underscores and uppercase. Any pre-existing on-disk scope named e.g. `project_notes` or `Work` now throws on every read/write instead of resolving. Low risk given the codebase's convention appears kebab-case (`identity`, `engineering-patterns`), but it is a behavior change for non-conforming existing configs/DBs and there is no migration note. | If underscores are used in the wild, widen to `/^[a-z0-9][a-z0-9_-]*$/`; otherwise document that scopes must be kebab-case so the thrown error is expected (confidence: medium). |
| 3 | `mcp-memory-server/src/index.ts:125,651` | correctness | `assertSafeScope` whitelists `scope === "all"` so it passes through `resolveScopePath` to a literal `all.db`. Tools that do **not** expand via `getSearchScopes` — `memory_write`/`memory_delete`/`memory_list`/`memory_supersede`/`memory_history` — therefore treat `"all"` as a real DB file, while `memory_read`/`memory_search` fan `"all"` out over `config.scopes`. A `memory_write(scope:"all")` writes to `all.db`, which a subsequent `memory_read(scope:"all")` will never surface. Pre-existing behavior, not introduced by this diff, but the new `assertSafeScope` now explicitly blesses `"all"` as a safe scope, making the asymmetry easy to overlook. | Reject `"all"` in the write-path tools (or route them through `getSearchScopes` and disallow `"all"` as a write target) so the reserved keyword can't masquerade as a concrete DB (confidence: medium). |

### Summary
The SEC-0001 fix is correct and complete: traversal is closed at the single resolution chokepoint, and both the `"all"` fan-out and `promote_to` re-validate every concrete scope, with no bypass found. The `memory_read` validation remains logically equivalent, and the embedding default removal degrades gracefully and visibly. The one item worth acting on before it bites is the ineffective `resolve !== join` defense-in-depth check (Finding 1): it is harmless today but gives false confidence for exactly the "pattern loosened later" scenario its own comment anticipates. Findings 2 and 3 are minor edge-case/consistency notes.
