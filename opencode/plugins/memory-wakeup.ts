import type { Plugin } from "@opencode-ai/plugin"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"

// OpenCode parity with the Claude SessionStart `memory-wakeup` hook.
//
// Both harnesses must surface the SAME session-start context — AgentFS project
// memory, the wiki index, and any open HARD contradictions — so the LLM sees it
// autonomously without anyone having to remember a manual step. Rather than
// duplicate the surfacing logic, this plugin reuses the single source of truth:
// the rendered Claude hook at ~/.claude/hooks/memory-wakeup.sh (installed by
// sync-claude-assets.sh). Its stdout is injected into the system prompt once
// per session via experimental.chat.system.transform.
//
// Fail-open everywhere: a missing hook, a failed wakeup, or a project with no
// .agentfs/.planning must never wedge an OpenCode session.

const HOOK = path.join(os.homedir(), ".claude", "hooks", "memory-wakeup.sh")

export const MemoryWakeupPlugin: Plugin = async ({ $ }) => {
  const surfaced = new Set<string>()

  return {
    "experimental.chat.system.transform": async (input, output) => {
      try {
        const sid = input?.sessionID ?? ""
        // Surface once per session; the content is static for the session.
        if (sid && surfaced.has(sid)) return
        if (!fs.existsSync(HOOK)) return

        const res = await $`bash ${HOOK}`.quiet().nothrow()
        const text = String(res.stdout ?? "").trim()
        if (!text) return

        if (sid) surfaced.add(sid)
        output.system.push(
          "Session-start context (auto-surfaced by the memory-wakeup plugin — use it; do not ask the user to recall anything it contains):",
        )
        output.system.push(text)
      } catch {
        // Fail open — never block a session because context surfacing failed.
      }
    },
  }
}
