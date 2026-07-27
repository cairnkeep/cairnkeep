import type { Plugin } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const COORDINATOR = "@@INFRA_ROOT@@/mcp-memory-server/dist/capability-cli.js"
const FIXED_BLOCK = "Cairn capability disabled."
const MAX_COORDINATOR_OUTPUT = 8 * 1024
const COORDINATOR_TIMEOUT_MS = 3000
const SESSION_ID = /^(?:cairn:)?[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const COMMANDS = new Set([
  "wiki-ingest",
  "wiki-query",
  "wiki-lint",
  "graphify",
  "security-audit",
])

export const OPENCODE_CAPABILITY_CONTRACT = {
  version: "1.17.20",
  sourceCommit: "4473fc3c9055046183990a965d68df3db7ea6f62",
  admissionHook: "command.execute.before",
  terminalEvents: {
    success_terminals: ["session.idle", "session.status:idle"],
    error_terminal: "session.error",
    abandonment_only: "session.deleted",
    event_callback_is_awaited: false,
  },
} as const

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value: JsonObject, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key))
}

function validSessionID(value: unknown): value is string {
  return typeof value === "string" && value !== "unknown" && SESSION_ID.test(value)
}

function contractEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.CAIRN_CAPABILITY_CONTRACT ?? "")
}

function validatedProjectRoot(values: unknown[]): string | undefined {
  try {
    if (!values.every((value) => typeof value === "string" && path.isAbsolute(value))) return undefined
    const roots = values.map((value) => fs.realpathSync(value as string))
    if (!roots.every((value) => value === roots[0])) return undefined
    if (!fs.statSync(roots[0]).isDirectory()) return undefined
    return roots[0]
  } catch {
    return undefined
  }
}

function coordinator(operation: string, payload: JsonObject): Promise<JsonObject | undefined> {
  return new Promise((resolvePromise) => {
    let stdout = ""
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (value?: JsonObject) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolvePromise(value)
    }
    const child = spawn(process.execPath, [COORDINATOR, operation], {
      stdio: ["pipe", "pipe", "ignore"],
    })
    timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        // best-effort termination only
      }
      finish()
    }, COORDINATOR_TIMEOUT_MS)
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
      if (Buffer.byteLength(stdout, "utf8") > MAX_COORDINATOR_OUTPUT) {
        stdout = ""
        try {
          child.kill("SIGKILL")
        } catch {
          // best-effort termination only
        }
      }
    })
    child.on("error", () => finish())
    child.on("close", (code) => {
      if (code !== 0 || !stdout) {
        finish()
        return
      }
      try {
        const value = JSON.parse(stdout) as unknown
        finish(isObject(value) ? value : undefined)
      } catch {
        finish()
      }
    })
    child.stdin.on("error", () => finish())
    child.stdin.end(JSON.stringify(payload))
  })
}

function admission(input: unknown, output: unknown): {
  command: string
  sessionID: string
} | undefined {
  if (!isObject(input) || !isObject(output)) return undefined
  if (!hasExactKeys(input, ["command", "sessionID", "arguments"])) return undefined
  if (!hasExactKeys(output, ["parts"]) || !Array.isArray(output.parts)) return undefined
  if (typeof input.command !== "string" || !COMMANDS.has(input.command)) return undefined
  if (!validSessionID(input.sessionID) || typeof input.arguments !== "string") return undefined
  return { command: input.command, sessionID: input.sessionID }
}

function eventTerminal(event: unknown): { sessionID: string; outcome: "success" | "error" | "abandoned" } | undefined {
  if (!isObject(event) || !hasExactKeys(event, ["type", "properties"]) || !isObject(event.properties)) {
    return undefined
  }
  const properties = event.properties
  if (event.type === "session.idle") {
    if (!hasExactKeys(properties, ["sessionID"]) || !validSessionID(properties.sessionID)) return undefined
    return { sessionID: properties.sessionID, outcome: "success" }
  }
  if (event.type === "session.error") {
    if (!hasExactKeys(properties, [], ["sessionID", "error"]) || !validSessionID(properties.sessionID)) return undefined
    return { sessionID: properties.sessionID, outcome: "error" }
  }
  if (event.type === "session.status") {
    if (!hasExactKeys(properties, ["sessionID", "status"]) || !validSessionID(properties.sessionID)) return undefined
    if (!isObject(properties.status) || properties.status.type !== "idle" || !hasExactKeys(properties.status, ["type"])) {
      return undefined
    }
    return { sessionID: properties.sessionID, outcome: "success" }
  }
  if (event.type === "session.deleted") {
    if (!hasExactKeys(properties, ["info"]) || !isObject(properties.info)) return undefined
    const info = properties.info
    if (!hasExactKeys(
      info,
      ["id", "projectID", "directory", "title", "version", "time"],
      ["parentID", "summary", "share", "revert"],
    ) || !validSessionID(info.id) || !isObject(info.time)) return undefined
    if (!hasExactKeys(info.time, ["created", "updated"], ["compacting"])) return undefined
    if (typeof info.projectID !== "string" || typeof info.directory !== "string"
      || typeof info.title !== "string" || typeof info.version !== "string"
      || typeof info.time.created !== "number" || typeof info.time.updated !== "number") return undefined
    return { sessionID: info.id, outcome: "abandoned" }
  }
  return undefined
}

export const CapabilityCommandPlugin: Plugin = async ({ directory, worktree, project }) => {
  const projectRoot = validatedProjectRoot([directory, worktree, project.worktree])

  return {
    "command.execute.before": async (input, output) => {
      if (!contractEnabled()) return
      if (!isObject(input) || typeof input.command !== "string" || !COMMANDS.has(input.command)) return
      const parsed = admission(input, output)
      if (!parsed || !projectRoot || !fs.existsSync(COORDINATOR)) throw new Error(FIXED_BLOCK)
      const decision = await coordinator("harness-before", {
        schema_version: 1,
        harness: "opencode",
        command: parsed.command,
        session_id: parsed.sessionID,
        project_root: projectRoot,
      })
      if (decision?.schema_version !== 1 || (decision.decision !== "allow" && decision.decision !== "block")) {
        throw new Error(FIXED_BLOCK)
      }
      if (decision.decision === "block") throw new Error(FIXED_BLOCK)
    },
    event: async ({ event }) => {
      if (!contractEnabled() || !fs.existsSync(COORDINATOR)) return
      const terminal = eventTerminal(event)
      if (!terminal) return
      await coordinator("harness-terminal", {
        schema_version: 1,
        harness: "opencode",
        session_id: terminal.sessionID,
        outcome: terminal.outcome,
      })
    },
  }
}
