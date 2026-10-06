import type { Plugin as V1Plugin } from "@opencode-ai/plugin"
import type { Plugin as V2 } from "@opencode/plugin"
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

// OpenCode-native reimplementation of the Claude PreToolUse `memory-recall`
// hook (OCP-02, D-10). Before an edit/write proceeds, surface AgentFS facts
// and wiki pages that specifically mention the file about to be edited —
// high-signal / low-noise: inject nothing on routine edits, only on a
// specific stem match.
//
// Per 04-RESEARCH.md Pattern 2 / D-11, `tool.execute.before` cannot append
// freeform non-blocking context the way Claude's `additionalContext` does.
// The only confirmed mechanism is to `throw new Error(text)`, which the model
// sees as the tool call's result and must retry — this blocks the first
// attempt at a matched edit. A once-per-file-per-session guard prevents
// re-throwing (and re-blocking) the same file forever (T-04-09). The same
// throw-to-surface mechanism is used by the V2 `ctx.tool.hook
// ("execute.before")` registration; the V2 hook fails the tool call with the
// thrown message, which the model also sees as the call's result.
//
// Known OpenCode limitation (Pitfall 4, anomalyco/opencode#5894): the V1 hook
// does not fire for tool calls issued by subagents spawned via the `task`
// tool — subagent-issued edits silently bypass recall injection. Documented
// scope limitation, not addressed by this phase.
//
// SERVER_ENTRY carries the install-rendered @@INFRA_ROOT@@ token (mirrors
// memory-wakeup.ts / memory-capture.ts's existing convention — the sync
// script, not this plugin, resolves it to the real repo root at install
// time; never accept a runtime-overridable server path here — T-04-03).
//
// Fail-open everywhere (D-03): a missing server binary, missing
// .agentfs/.planning, or any unexpected error must never block an edit.
//
// V1/V2 dual entrypoint (2026-09-08): see memory-wakeup.ts's header — V2
// (opencode2) requires the default-exported `{ id, setup }` definition
// (server log ref err_128a87db); V1 >= 1.18.29 uses `server()` on the same
// object.

const SERVER_ENTRY = "@@INFRA_ROOT@@/mcp-memory-server/dist/index.js"
const MIN_STEM_LENGTH = 4
const MAX_MEMORY_HITS = 8
const MAX_CONTEXT_LINES = 40

// Confines a candidate wiki source file to inside `.planning/wiki/sources/`
// using relative()-based containment (Phase 2 SEC-0001 pattern) — `resolve()
// === join()` misses `../` traversal, so this checks the relative path
// instead. The untrusted file path being edited is never concatenated into
// this read path; it is only used earlier to derive the `stem` grep token.
function isContained(baseDir: string, candidate: string): boolean {
  const rel = path.relative(baseDir, candidate)
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
}

// node's own child_process (never the plugin runtime's `$` — V2's context has
// no BunShell at all, and `$` had a broken stdin writer under this V1 build
// anyway; the OCP-06 defect note in memory-capture.ts applies).
function runNode(entry: string, args: string[], timeoutMs = 3000): Promise<string> {
  return new Promise((resolvePromise) => {
    let stdout = ""
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(stdout)
    }
    const child = spawn("node", [entry, ...args], {
      stdio: ["ignore", "pipe", "ignore"],
    })
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        // best-effort kill only
      }
    }, timeoutMs)
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
      if (stdout.length > 262144) {
        stdout = ""
        try {
          child.kill("SIGKILL")
        } catch {
          // best-effort kill only
        }
      }
    })
    child.on("close", finish)
    child.on("error", finish)
  })
}

// Shared V1/V2 matching rules (OCP-02, D-10): `wakeupIndex` is the compact
// AgentFS wakeup listing ("" when unavailable). Returns the bounded
// surface-context text, or null when nothing specific matched (routine edits
// proceed silently).
function buildRecallContext(repo: string, base: string, stem: string, wakeupIndex: string): string | null {
  const sections: string[] = []

  // 1. AgentFS project memory: filter the compact wakeup index by stem.
  if (wakeupIndex) {
    const hitLines = wakeupIndex
      .split("\n")
      .filter((line) => line.toLowerCase().includes(stem.toLowerCase()))
      .slice(0, MAX_MEMORY_HITS)
    if (hitLines.length > 0) {
      sections.push(`## Relevant project memory for ${base}`, "", hitLines.join("\n"))
    }
  }

  // 2. Wiki source pages (top level only) whose content mentions the
  // stem. Reads are confined to wikiSourcesDir via isContained() —
  // filePath (untrusted) only supplied the stem grep token above, it
  // is never used to build a read path here.
  const wikiSourcesDir = path.join(repo, ".planning", "wiki", "sources")
  if (fs.existsSync(wikiSourcesDir)) {
    const wikiHits: string[] = []
    const entries = fs.readdirSync(wikiSourcesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      const pagePath = path.join(wikiSourcesDir, entry.name)
      if (!isContained(wikiSourcesDir, pagePath)) continue
      const content = fs.readFileSync(pagePath, "utf8")
      if (!content.toLowerCase().includes(stem.toLowerCase())) continue
      const teaserMatch = content.match(/^- \*\*.*$/m)
      const teaser = teaserMatch ? teaserMatch[0].slice(0, 160) : ""
      wikiHits.push(`- [${entry.name}] ${teaser}`)
    }
    if (wikiHits.length > 0) {
      sections.push(`## Relevant wiki pages for ${base}`, "", wikiHits.join("\n"))
    }
  }

  if (sections.length === 0) return null
  return sections.join("\n\n").split("\n").slice(0, MAX_CONTEXT_LINES).join("\n")
}

export default {
  id: "cairnkeep.memory-recall",

  // V2 (opencode2) entrypoint.
  async setup(ctx: V2.Context) {
    const repo = ctx.location.directory
    const surfaced = new Set<string>()

    await ctx.tool.hook("execute.before", async (event) => {
      try {
        if (event.tool !== "edit" && event.tool !== "write") return

        const args = event.input as { filePath?: string; path?: string } | undefined
        const filePath = args?.filePath ?? args?.path
        if (!filePath) return

        const hasAgentfs = fs.existsSync(path.join(repo, ".agentfs", "project.db"))
        const hasWiki = fs.existsSync(path.join(repo, ".planning", "wiki", "sources"))
        if (!hasAgentfs && !hasWiki) return

        const base = path.basename(filePath)
        const stem = base.slice(0, base.length - path.extname(base).length)
        // Low-noise rule (D-10): skip tiny/generic stems that would match
        // too broadly and turn this into noise on routine edits.
        if (stem.length < MIN_STEM_LENGTH) return

        // Once-per-file-per-session guard (T-04-09): after surfacing for
        // this file once in this session, let subsequent edits/retries of
        // the same file proceed unmodified — never re-block in a loop.
        const dedupeKey = `${event.sessionID}:${filePath}`
        if (surfaced.has(dedupeKey)) return

        let wakeupIndex = ""
        if (hasAgentfs && fs.existsSync(SERVER_ENTRY)) {
          wakeupIndex = (await runNode(SERVER_ENTRY, ["wakeup"])).trim()
        }

        const context = buildRecallContext(repo, base, stem, wakeupIndex)
        if (!context) return

        surfaced.add(dedupeKey)
        throw new Error(`Memory recall (auto-injected for this file edit):\n\n${context}`)
      } catch (err) {
        // Re-throw our own intentional surface-context error (it carries the
        // "Memory recall" prefix); swallow everything else to fail open —
        // a lookup failure must never block an edit (D-03).
        if (err instanceof Error && err.message.startsWith("Memory recall (auto-injected")) {
          throw err
        }
      }
    })
  },

  // V1 (opencode >= 1.18.29 documented object form) entrypoint — legacy
  // implementation kept verbatim on its own API (`$` is V1's BunShell).
  async server(input: Parameters<V1Plugin>[0]) {
    const { $, directory } = input
    const surfaced = new Set<string>()

    return {
      "tool.execute.before": async (
        hookInput: { tool: string; sessionID: string },
        hookOutput: { args?: { filePath?: string; path?: string } },
      ) => {
        try {
          if (hookInput.tool !== "edit" && hookInput.tool !== "write") return

          const filePath = hookOutput.args?.filePath ?? hookOutput.args?.path
          if (!filePath) return

          const repo = directory
          const agentfsDb = path.join(repo, ".agentfs", "project.db")
          const wikiSourcesDir = path.join(repo, ".planning", "wiki", "sources")
          const hasAgentfs = fs.existsSync(agentfsDb)
          const hasWiki = fs.existsSync(wikiSourcesDir)
          if (!hasAgentfs && !hasWiki) return

          const base = path.basename(filePath)
          const stem = base.slice(0, base.length - path.extname(base).length)
          // Low-noise rule (D-10): skip tiny/generic stems that would match
          // too broadly and turn this into noise on routine edits.
          if (stem.length < MIN_STEM_LENGTH) return

          // Once-per-file-per-session guard (T-04-09): after surfacing for
          // this file once in this session, let subsequent edits/retries of
          // the same file proceed unmodified — never re-block in a loop.
          const dedupeKey = `${hookInput.sessionID}:${filePath}`
          if (surfaced.has(dedupeKey)) return

          let wakeupIndex = ""
          if (hasAgentfs && fs.existsSync(SERVER_ENTRY)) {
            const res = await $`node ${SERVER_ENTRY} wakeup`.quiet().nothrow()
            wakeupIndex = String(res.stdout ?? "").trim()
          }

          const context = buildRecallContext(repo, base, stem, wakeupIndex)
          if (!context) return

          surfaced.add(dedupeKey)
          throw new Error(`Memory recall (auto-injected for this file edit):\n\n${context}`)
        } catch (err) {
          // Re-throw our own intentional surface-context error (it carries the
          // "Memory recall" prefix); swallow everything else to fail open —
          // a lookup failure must never block an edit (D-03).
          if (err instanceof Error && err.message.startsWith("Memory recall (auto-injected")) {
            throw err
          }
        }
      },
    }
  },
}
