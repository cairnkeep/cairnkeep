import type { Plugin } from "@opencode-ai/plugin"
import fs from "node:fs"
import path from "node:path"

// OpenCode-native reimplementation of the Claude SessionStart `memory-wakeup`
// hook (OCP-05, D-04). This plugin no longer shells out to
// ~/.claude/hooks/memory-wakeup.sh — it surfaces the same four session-start
// sections natively, calling the shared cairn-memory server directly and
// reading the same .planning/ files, so OpenCode stands on its own with no
// Claude-rendered assets on disk.
//
// SERVER_ENTRY carries the install-rendered @@INFRA_ROOT@@ token (mirrors the
// Claude hook's substitution — the sync script, not this plugin, resolves it
// to the real repo root at install time; never accept a runtime-overridable
// server path here).
//
// Fail-open everywhere (D-03): a missing server binary, missing
// .agentfs/.planning, or a failed subcommand must never wedge an OpenCode
// session.

const SERVER_ENTRY = "@@INFRA_ROOT@@/mcp-memory-server/dist/index.js"

export const MemoryWakeupPlugin: Plugin = async ({ $, directory }) => {
  return {
    // No per-session dedupe: this hook fires more than once per session
    // (including OpenCode's internal title-generation call, which happens
    // before the first real agent turn and shares the same sessionID). A
    // "surface once per session" Set keyed on sessionID would mark the
    // session surfaced on that throwaway title-gen call and silently skip
    // every real turn afterward — the OCP-05 acceptance gate never sees the
    // injected context. `output.system` is a fresh array per call, so
    // re-pushing on every invocation is both correct and required.
    "experimental.chat.system.transform": async (input, output) => {
      try {
        const repo = directory
        const agentfsDb = path.join(repo, ".agentfs", "project.db")
        const wikiIndex = path.join(repo, ".planning", "wiki", "index.md")
        const hasAgentfs = fs.existsSync(agentfsDb)
        const hasWiki = fs.existsSync(wikiIndex)
        if (!hasAgentfs && !hasWiki) return

        const sections: string[] = []

        if (hasAgentfs) {
          const res = await $`node ${SERVER_ENTRY} wakeup`.quiet().nothrow()
          const memory = String(res.stdout ?? "").trim()
          sections.push("## Project memory (AgentFS)")
          if (memory) sections.push(memory)
        }

        if (hasWiki) {
          const wiki = fs.readFileSync(wikiIndex, "utf8").trim()
          sections.push("## Wiki index")
          if (wiki) sections.push(wiki)
        }

        // Surface open HARD wiki contradictions so the agent (and user) see
        // them at session start without anyone having to remember to scan the
        // register. Hard entries cannot both be correct and must be resolved
        // before dependent work.
        const contradictionsPath = path.join(repo, ".planning", "wiki", "CONTRADICTIONS.md")
        if (fs.existsSync(contradictionsPath)) {
          const raw = fs.readFileSync(contradictionsPath, "utf8")
          const start = raw.indexOf("<!-- wiki:contradictions:open:start -->")
          const end = raw.indexOf("<!-- wiki:contradictions:open:end -->")
          if (start !== -1 && end !== -1 && end > start) {
            const region = raw.slice(start, end)
            const hardLines = region
              .split("\n")
              .filter((line) => /severity:\s*hard/i.test(line))
            if (hardLines.length > 0) {
              sections.push("## Open HARD contradictions — resolve before dependent work")
              sections.push(hardLines.join("\n"))
            }
          }
        }

        // Surface staged memory candidates captured by the session-end
        // capture plugin. These are extracted automatically from the last
        // session but NOT yet written to AgentFS — /memory-review is the
        // accept gate.
        const stagingDir = path.join(repo, ".planning", "memory-staging")
        if (fs.existsSync(stagingDir)) {
          const staged = fs.readdirSync(stagingDir).filter((f) => f.endsWith(".json"))
          if (staged.length > 0) {
            sections.push(`## Staged memory candidates (${staged.length} session(s)) — UNREVIEWED`)
            sections.push("Run /memory-review to accept (→ AgentFS) or discard these before doing other work.")
          }
        }

        if (sections.length === 0) return

        output.system.push(
          "Session-start context (auto-surfaced by the memory-wakeup plugin — use it; do not ask the user to recall anything it contains):",
        )
        output.system.push(sections.join("\n\n"))
      } catch {
        // Fail open — never block a session because context surfacing failed.
      }
    },
  }
}
