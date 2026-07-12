import type { Plugin } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

// OpenCode-native reimplementation of the Claude SessionEnd `memory-capture`
// hook (OCP-01, D-08). OpenCode has no `session.end` event; per 04-RESEARCH.md
// the best-fit trigger is `session.idle` (D-09), filtered to top-level
// sessions and de-duplicated so one working session stages at most one
// capture (Pitfall 2). The session transcript is obtained via the SDK
// `client.session.messages()` call (04-SPIKE-INJECTION.md confirmed shape),
// never by reading OpenCode's undocumented internal storage layout directly
// (Anti-Pattern).
//
// SERVER_ENTRY carries the install-rendered @@INFRA_ROOT@@ token (mirrors the
// Claude hook's substitution and opencode/plugins/memory-wakeup.ts's existing
// convention — the sync script, not this plugin, resolves it to the real repo
// root at install time; never accept a runtime-overridable server path here.
// T-04-03 mitigation).
//
// Fail-open everywhere (D-03): a missing server binary, missing
// .agentfs/.planning, a missing/unset env guard, or a failed subprocess call
// must never wedge an OpenCode session — the whole handler is try/catch, and
// a missing staging file after a fire-and-forget event handler is a tolerated
// degraded outcome, not a retry loop (Pitfall 3).

const SERVER_ENTRY = "@@INFRA_ROOT@@/mcp-memory-server/dist/index.js"
const MAX_CHARS = 12000
const RETENTION_CAP = 5

type SessionMessage = {
  info?: { role?: string }
  parts?: Array<{ type?: string; text?: string }>
}

// Runs `node <serverEntry> extract <model>` piping `input` on stdin via
// Node's own child_process API (never the plugin runtime's `$` BunShell
// helper — live verification found `$`...`.quiet().nothrow()`'s returned
// promise has no usable `.stdin` writer at runtime in this OpenCode build,
// throwing `TypeError: undefined is not an object (evaluating
// 'shellPromise.stdin.getWriter')` on every call, which silently no-oped
// capture end to end via the outer fail-open catch (OCP-06 defect, this
// phase). Async/non-blocking so a slow extraction call never freezes a live
// interactive session; bounded by `timeoutMs` and resolves (never rejects)
// so the caller's existing fail-open handling is unchanged.
function runExtract(
  serverEntry: string,
  model: string,
  input: string,
  timeoutMs = 120000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ stdout, stderr })
    }

    const child = spawn("node", [serverEntry, "extract", model], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM")
      } catch {
        // best-effort kill only
      }
    }, timeoutMs)

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    child.on("close", finish)
    child.on("error", finish)

    child.stdin.write(input)
    child.stdin.end()
  })
}

// Reimplements scripts/transcript-to-text.mjs's behavior (skip tool/reasoning/
// file noise, join user/assistant text in order, cap total length keeping the
// most recent turns) against OpenCode's { info, parts } message shape rather
// than Claude's JSONL transcript shape (Pattern 3).
function messagesToText(messages: SessionMessage[]): string {
  const turns: string[] = []
  for (const message of messages) {
    const role = message.info?.role
    if (role !== "user" && role !== "assistant") continue
    const text = (message.parts ?? [])
      .filter((part) => part && part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("\n")
      .trim()
    if (!text) continue
    turns.push(`${role === "user" ? "USER" : "ASSISTANT"}: ${text}`)
  }
  let out = turns.join("\n\n")
  if (out.length > MAX_CHARS) out = out.slice(-MAX_CHARS)
  return out
}

export const MemoryCapturePlugin: Plugin = async ({ client, directory }) => {
  const processed = new Set<string>()

  return {
    event: async ({ event }) => {
      try {
        if (event.type !== "session.idle") return
        const sessionID = event.properties?.sessionID
        if (!sessionID) return
        // De-dupe: one attempt per real top-level session, no matter how
        // many times session.idle fires within it (Pitfall 2).
        if (processed.has(sessionID)) return

        const repo = directory
        const agentfsDb = path.join(repo, ".agentfs", "project.db")
        if (!fs.existsSync(agentfsDb)) return
        if (!fs.existsSync(SERVER_ENTRY)) return

        const apiKey = process.env.CAIRN_LLM_API_KEY
        const model = process.env.CAIRN_LLM_EXTRACTION_MODEL
        if (!apiKey || !model) return

        // session.idle's event payload only carries sessionID (no parentID) —
        // fetch the full session record to filter out subagent subsessions
        // (Pitfall 2: subagent tool calls also idle and would otherwise
        // over-stage past the 5-session retention cap's intent).
        const sessionRes = await client.session.get({ path: { id: sessionID } })
        const session = (sessionRes as { data?: { parentID?: string } })?.data
        if (session?.parentID) return

        // Mark processed before doing the (possibly slow) extract call so a
        // second session.idle fire for this session never double-attempts,
        // even if this attempt ultimately yields no staged file.
        processed.add(sessionID)

        const messagesRes = await client.session.messages({ path: { id: sessionID } })
        const messages = ((messagesRes as { data?: SessionMessage[] })?.data ?? []) as SessionMessage[]
        const text = messagesToText(messages)
        if (!text) return

        // Pipe the session text into the shared `extract` subcommand via
        // stdin (T-04-01 mitigation) — never string-interpolate arbitrary
        // session/message content into the shell command.
        const res = await runExtract(SERVER_ENTRY, model, text)
        const candidatesJson = String(res.stdout ?? "").trim()
        if (!candidatesJson) return

        let parsed: { candidates?: unknown[] }
        try {
          parsed = JSON.parse(candidatesJson)
        } catch {
          return
        }
        if (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0) return

        // Stage for the next session's accept gate — identical contract to
        // claude/hooks/memory-capture.sh (D-08): one file per session, same
        // candidate JSON shape, same UTC timestamp filename.
        const stagingDir = path.join(repo, ".planning", "memory-staging")
        fs.mkdirSync(stagingDir, { recursive: true })
        const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
        const stageFile = path.join(stagingDir, `${ts}.json`)
        fs.writeFileSync(stageFile, `${candidatesJson}\n`)

        // Keep the staging dir bounded — drop the oldest beyond 5 sessions.
        const staged = fs
          .readdirSync(stagingDir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => ({ f, mtime: fs.statSync(path.join(stagingDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime)
        for (const { f } of staged.slice(RETENTION_CAP)) {
          fs.unlinkSync(path.join(stagingDir, f))
        }
      } catch {
        // Fail open — never block a session because capture failed.
      }
    },
  }
}
