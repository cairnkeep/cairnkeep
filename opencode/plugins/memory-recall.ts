import type { Plugin } from "@opencode-ai/plugin"
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
// re-throwing (and re-blocking) the same file forever (T-04-09).
//
// Known OpenCode limitation (Pitfall 4, anomalyco/opencode#5894): this hook
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

export const MemoryRecallPlugin: Plugin = async ({ $, directory }) => {
  const surfaced = new Set<string>()

  return {
    "tool.execute.before": async (input, output) => {
      try {
        if (input.tool !== "edit" && input.tool !== "write") return

        const filePath: string | undefined = output.args?.filePath ?? output.args?.path
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
        const dedupeKey = `${input.sessionID}:${filePath}`
        if (surfaced.has(dedupeKey)) return

        const sections: string[] = []

        // 1. AgentFS project memory: filter the compact wakeup index by stem.
        if (hasAgentfs && fs.existsSync(SERVER_ENTRY)) {
          const res = await $`node ${SERVER_ENTRY} wakeup`.quiet().nothrow()
          const idx = String(res.stdout ?? "").trim()
          if (idx) {
            const hitLines = idx
              .split("\n")
              .filter((line) => line.toLowerCase().includes(stem.toLowerCase()))
              .slice(0, MAX_MEMORY_HITS)
            if (hitLines.length > 0) {
              sections.push(`## Relevant project memory for ${base}`, "", hitLines.join("\n"))
            }
          }
        }

        // 2. Wiki source pages (top level only) whose content mentions the
        // stem. Reads are confined to wikiSourcesDir via isContained() —
        // filePath (untrusted) only supplied the stem grep token above, it
        // is never used to build a read path here.
        if (hasWiki) {
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

        // Inject only when there is something specific (high-signal /
        // low-noise) — routine edits with no match proceed silently.
        if (sections.length === 0) return

        surfaced.add(dedupeKey)
        const context = sections.join("\n\n").split("\n").slice(0, MAX_CONTEXT_LINES).join("\n")
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
}
