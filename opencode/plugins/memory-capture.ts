import type { Plugin as V1Plugin } from "@opencode-ai/plugin"
import type { Plugin as V2 } from "@opencode/plugin"
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

// OpenCode-native reimplementation of the Claude SessionEnd `memory-capture`
// hook (OCP-01, D-08). OpenCode has no `session.end` event; per 04-RESEARCH.md
// the best-fit trigger is `session.idle` (D-09), filtered to top-level
// sessions and de-duplicated so one working session stages at most one
// capture (Pitfall 2). The session transcript is obtained via the supported
// client API (V1: SDK `client.session.messages()`, V2: `ctx.session.context()`),
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
//
// V1/V2 dual entrypoint (2026-09-08): see memory-wakeup.ts's header — V2
// (opencode2) requires the default-exported `{ id, setup }` definition
// (server log ref err_128a87db); V1 >= 1.18.29 uses `server()` on the same
// object. The V2 event stream carries `session.idle` / `session.compacted`
// under `event.data` (V1 used `event.properties`), and V2 transcripts are a
// message union (user/assistant/compaction variants), not the V1
// { info, parts } shape the mcp-memory-server normalizers parse — so V2
// payloads are normalized back to the legacy transcript shape below. The
// CLI-side compaction adapter stays version-pinned to the V1 harness
// (mcp-memory-server compaction-normalize gates on harness/session version
// 1.17.20): under V2 that path fails closed into its stderr skip (D-03
// fail-open). Follow-up lives in cairnkeep to teach the adapter the V2
// payload; never fake version fields in this plugin.

const SERVER_ENTRY = "@@INFRA_ROOT@@/mcp-memory-server/dist/index.js"
const TRAJECTORY_ENTRY = "@@INFRA_ROOT@@/mcp-memory-server/dist/trajectory-cli.js"
const ARTIFACT_ENTRY = "@@INFRA_ROOT@@/mcp-memory-server/dist/artifact-cli.js"
const MAX_CHARS = 12000
const RETENTION_CAP = 5

type SessionMessage = {
  info?: { role?: string; [key: string]: unknown }
  parts?: Array<{ type?: string; text?: string; [key: string]: unknown }>
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
function runNode(
  entry: string,
  args: string[],
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

    const child = spawn("node", [entry, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
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
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    child.on("close", finish)
    child.on("error", finish)
    child.stdin.on("error", () => {
      // EPIPE after a failed/terminated child is part of the fail-open path.
    })

    child.stdin.write(input)
    child.stdin.end()
  })
}

function trajectoryCaptureEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.CAIRN_TRAJECTORY_CAPTURE ?? "")
}

function compactionCaptureEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.CAIRN_COMPACTION_CAPTURE ?? "")
}

// Reimplements scripts/transcript-to-text.mjs's behavior (skip tool/reasoning/
// file noise, join user/assistant text in order, cap total length keeping the
// most recent turns) against the { info, parts } message shape rather than
// Claude's JSONL transcript shape (Pattern 3). Both runtimes feed this the
// normalized legacy shape (V1 natively, V2 via toLegacyMessages below).
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

// V2 (opencode2) `session.context()` returns a message union (user/assistant/
// compaction/…) whose shape does not match the { info, parts } transcript
// contract the mcp-memory-server normalizers parse (and the CLI contract is
// deliberately pinned there). Map V2 messages back to the legacy shape,
// preserving role, id, sessionID, timing, finish, text and tool-call fields.
function toLegacyMessages(sessionID: string, messages: unknown[]): SessionMessage[] {
  const out: SessionMessage[] = []
  for (const raw of messages) {
    const msg = raw as {
      type?: string
      id?: string
      text?: string
      finish?: string
      time?: { created?: number; completed?: number }
      content?: Array<{
        type?: string
        text?: string
        id?: string
        name?: string
        time?: { created?: number; ran?: number; completed?: number }
        state?: { status?: string; input?: unknown; content?: unknown; error?: unknown }
      }>
    }
    if (!msg || typeof msg !== "object") continue
    if (msg.type === "user") {
      out.push({
        info: { role: "user", id: msg.id, sessionID, time: msg.time },
        parts: typeof msg.text === "string" && msg.text ? [{ type: "text", text: msg.text, messageID: msg.id }] : [],
      })
    } else if (msg.type === "assistant") {
      const parts: NonNullable<SessionMessage["parts"]> = []
      for (const item of msg.content ?? []) {
        if (!item || typeof item !== "object") continue
        if (item.type === "text" && typeof item.text === "string") {
          parts.push({ type: "text", text: item.text, messageID: msg.id })
        } else if (item.type === "reasoning") {
          parts.push({ type: "reasoning", text: typeof item.text === "string" ? item.text : "" })
        } else if (item.type === "tool") {
          parts.push({
            type: "tool",
            id: item.id,
            tool: item.name,
            callID: item.id,
            state: {
              status: item.state?.status,
              input: item.state?.input,
              output: item.state?.content,
              error: item.state?.error,
              time: { start: item.time?.ran ?? item.time?.created, end: item.time?.completed },
            },
          })
        }
      }
      out.push({ info: { role: "assistant", id: msg.id, sessionID, time: msg.time, finish: msg.finish }, parts })
    } else if (msg.type === "compaction") {
      out.push({
        info: { role: "user", id: msg.id, sessionID, time: msg.time },
        parts: [{ type: "compaction" }],
      })
    }
  }
  return out
}

// Promise client unwrapping is defensive: methods currently resolve to bare
// values, but { data } envelopes would be a tolerated alternative shape.
async function fetchSession(ctx: V2.Context, sessionID: string) {
  const res = (await ctx.session.get({ sessionID })) as unknown
  return ((res as { data?: unknown })?.data ?? res) as
    | { id?: string; parentID?: string; time?: Record<string, unknown>; location?: { directory?: string } }
    | undefined
}

async function fetchLegacyMessages(ctx: V2.Context, sessionID: string): Promise<SessionMessage[]> {
  const res = (await ctx.session.context({ sessionID })) as unknown
  const list = Array.isArray(res) ? res : ((res as { data?: unknown })?.data ?? [])
  return toLegacyMessages(sessionID, Array.isArray(list) ? list : [])
}

// Shared V1/V2 staging contract (identical to claude/hooks/memory-capture.sh,
// D-08): one file per session, same candidate JSON shape, same UTC timestamp
// filename, bounded by RETENTION_CAP.
function stageCandidates(repo: string, candidatesJson: string): void {
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
}

// V2 (opencode2) event handling. Event types keep their V1 names
// (`session.idle`, `session.compacted`) but carry the payload under `data`
// instead of V1's `properties`, and the stream is server-global — sessions
// from other locations/projects appear here, so every event is filtered by
// the session's own location before it can stage anything into this repo.
async function handleV2Event(
  ctx: V2.Context,
  repo: string,
  processed: Set<string>,
  event: { type?: string; data?: { sessionID?: string } },
): Promise<void> {
  try {
    if (event.type === "session.compacted") {
      if (!compactionCaptureEnabled()) return
      const sessionID = event.data?.sessionID
      if (!sessionID) return

      const session = await fetchSession(ctx, sessionID)
      if (!session || session.parentID) return
      if (session.location?.directory && session.location.directory !== repo) return

      const messages = await fetchLegacyMessages(ctx, sessionID)
      if (!fs.existsSync(ARTIFACT_ENTRY)) return

      // The adapter keeps reading V1-shaped `event.properties.sessionID`, so
      // carry both spellings; `session.version` is honestly absent under V2,
      // which makes the adapter's pinned version gate fail closed into a
      // stderr skip (fail-open, see header note + cairnkeep adapter
      // follow-up).
      const payloadEvent = { type: "session.compacted", properties: { sessionID }, data: event.data }
      const capture = await runNode(
        ARTIFACT_ENTRY,
        ["capture-opencode", repo],
        JSON.stringify({ event: payloadEvent, session, messages, harness_version: "1.17.20" }),
        3000,
      )
      if (capture.stderr.trim()) {
        console.warn("cairn compaction capture skipped: local capture failed")
      }
      return
    }

    if (event.type !== "session.idle") return
    const sessionID = event.data?.sessionID
    if (!sessionID) return
    // De-dupe: one attempt per real top-level session, no matter how
    // many times session.idle fires within it (Pitfall 2).
    if (processed.has(sessionID)) return

    const agentfsDb = path.join(repo, ".agentfs", "project.db")
    const trajectoryEnabled = trajectoryCaptureEnabled()

    // Preserve the original disabled path: all pre-existing guards run
    // before any client request or subprocess when trajectory capture is off.
    if (!trajectoryEnabled) {
      if (!fs.existsSync(agentfsDb)) return
      if (!fs.existsSync(SERVER_ENTRY)) return
    }
    const apiKey = process.env.CAIRN_LLM_API_KEY
    const model = process.env.CAIRN_LLM_EXTRACTION_MODEL
    if (!trajectoryEnabled && (!apiKey || !model)) return

    // session.idle's event payload only carries sessionID (no parentID) —
    // fetch the full session record to filter out subagent subsessions
    // (Pitfall 2: subagent tool calls also idle and would otherwise
    // over-stage past the 5-session retention cap's intent).
    const session = await fetchSession(ctx, sessionID)
    if (session?.parentID) return
    if (session?.location?.directory && session.location.directory !== repo) return

    // Mark processed before doing the (possibly slow) extract call so a
    // second session.idle fire for this session never double-attempts,
    // even if this attempt ultimately yields no staged file.
    processed.add(sessionID)

    const messages = await fetchLegacyMessages(ctx, sessionID)

    if (trajectoryEnabled && fs.existsSync(TRAJECTORY_ENTRY)) {
      const payload = JSON.stringify({
        session: { ...session, id: session?.id ?? sessionID },
        messages,
      })
      const capture = await runNode(TRAJECTORY_ENTRY, ["capture-opencode", repo], payload, 3000)
      if (capture.stderr.trim()) {
        console.warn("cairn trajectory capture skipped: local capture failed")
      }
    }

    // Durable-memory extraction retains its independent project/model
    // gates and behavior when trajectory capture is enabled.
    if (!fs.existsSync(agentfsDb)) return
    if (!fs.existsSync(SERVER_ENTRY)) return
    if (!apiKey || !model) return

    const text = messagesToText(messages)
    if (!text) return

    // Pipe the session text into the shared `extract` subcommand via
    // stdin (T-04-01 mitigation) — never string-interpolate arbitrary
    // session/message content into the shell command.
    const res = await runNode(SERVER_ENTRY, ["extract", model], text)
    const candidatesJson = String(res.stdout ?? "").trim()
    if (!candidatesJson) return

    let parsed: { candidates?: unknown[] }
    try {
      parsed = JSON.parse(candidatesJson)
    } catch {
      return
    }
    if (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0) return

    stageCandidates(repo, candidatesJson)
  } catch {
    // Fail open — never block a session because capture failed.
  }
}

export default {
  id: "cairnkeep.memory-capture",

  // V2 (opencode2) entrypoint: consume the public event stream for the
  // lifetime of the plugin instance; abort the subscription on cleanup.
  async setup(ctx: V2.Context) {
    const repo = ctx.location.directory
    const processed = new Set<string>()
    const controller = new AbortController()

    void (async () => {
      try {
        for await (const rawEvent of ctx.event.subscribe({ signal: controller.signal })) {
          await handleV2Event(ctx, repo, processed, rawEvent as { type?: string; data?: { sessionID?: string } })
        }
      } catch {
        // Event stream failed — fail open (D-03); capture is best-effort.
      }
    })()

    return () => controller.abort()
  },

  // V1 (opencode >= 1.18.29 documented object form) entrypoint — legacy
  // implementation kept verbatim on its own API (`client` is the V1 SDK).
  async server(input: Parameters<V1Plugin>[0]) {
    const { client, directory } = input
    const processed = new Set<string>()

    return {
      event: async ({ event }: { event: { type?: string; properties?: { sessionID?: string } } }) => {
        try {
          if (event.type === "session.compacted") {
            if (!compactionCaptureEnabled()) return
            const sessionID = event.properties?.sessionID
            if (!sessionID) return

            const sessionRes = await client.session.get({ path: { id: sessionID } })
            const session = (sessionRes as { data?: { id?: string; parentID?: string; version?: string } })?.data
            if (!session || session.parentID) return

            const messagesRes = await client.session.messages({ path: { id: sessionID } })
            const messages = ((messagesRes as { data?: unknown[] })?.data ?? []) as unknown[]
            if (!fs.existsSync(ARTIFACT_ENTRY)) return

            const capture = await runNode(
              ARTIFACT_ENTRY,
              ["capture-opencode", directory],
              JSON.stringify({ event, session, messages, harness_version: "1.17.20" }),
              3000,
            )
            if (capture.stderr.trim()) {
              console.warn("cairn compaction capture skipped: local capture failed")
            }
            return
          }

          if (event.type !== "session.idle") return
          const sessionID = event.properties?.sessionID
          if (!sessionID) return
          // De-dupe: one attempt per real top-level session, no matter how
          // many times session.idle fires within it (Pitfall 2).
          if (processed.has(sessionID)) return

          const repo = directory
          const agentfsDb = path.join(repo, ".agentfs", "project.db")
          const trajectoryEnabled = trajectoryCaptureEnabled()

          // Preserve the original disabled path: all pre-existing guards run
          // before any SDK request or subprocess when trajectory capture is off.
          if (!trajectoryEnabled) {
            if (!fs.existsSync(agentfsDb)) return
            if (!fs.existsSync(SERVER_ENTRY)) return
          }
          const apiKey = process.env.CAIRN_LLM_API_KEY
          const model = process.env.CAIRN_LLM_EXTRACTION_MODEL
          if (!trajectoryEnabled && (!apiKey || !model)) return

          // session.idle's event payload only carries sessionID (no parentID) —
          // fetch the full session record to filter out subagent subsessions
          // (Pitfall 2: subagent tool calls also idle and would otherwise
          // over-stage past the 5-session retention cap's intent).
          const sessionRes = await client.session.get({ path: { id: sessionID } })
          const session = (sessionRes as { data?: { id?: string; parentID?: string; time?: unknown } })?.data
          if (session?.parentID) return

          // Mark processed before doing the (possibly slow) extract call so a
          // second session.idle fire for this session never double-attempts,
          // even if this attempt ultimately yields no staged file.
          processed.add(sessionID)

          const messagesRes = await client.session.messages({ path: { id: sessionID } })
          const messages = ((messagesRes as { data?: SessionMessage[] })?.data ?? []) as SessionMessage[]

          if (trajectoryEnabled && fs.existsSync(TRAJECTORY_ENTRY)) {
            const payload = JSON.stringify({
              session: { ...session, id: session?.id ?? sessionID },
              messages,
            })
            const capture = await runNode(TRAJECTORY_ENTRY, ["capture-opencode", repo], payload, 3000)
            if (capture.stderr.trim()) {
              console.warn("cairn trajectory capture skipped: local capture failed")
            }
          }

          // Durable-memory extraction retains its independent project/model
          // gates and behavior when trajectory capture is enabled.
          if (!fs.existsSync(agentfsDb)) return
          if (!fs.existsSync(SERVER_ENTRY)) return
          if (!apiKey || !model) return

          const text = messagesToText(messages)
          if (!text) return

          // Pipe the session text into the shared `extract` subcommand via
          // stdin (T-04-01 mitigation) — never string-interpolate arbitrary
          // session/message content into the shell command.
          const res = await runNode(SERVER_ENTRY, ["extract", model], text)
          const candidatesJson = String(res.stdout ?? "").trim()
          if (!candidatesJson) return

          let parsed: { candidates?: unknown[] }
          try {
            parsed = JSON.parse(candidatesJson)
          } catch {
            return
          }
          if (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0) return

          stageCandidates(repo, candidatesJson)
        } catch {
          // Fail open — never block a session because capture failed.
        }
      },
    }
  },
}
