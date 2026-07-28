#!/usr/bin/env node
// Deterministic offline-framework adapter. It is fixture code, never live evidence.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const MAX_REQUEST_BYTES = 1024 * 1024;
const chunks = [];
let requestBytes = 0;
for await (const chunk of process.stdin) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  requestBytes += bytes.byteLength;
  if (requestBytes > MAX_REQUEST_BYTES) {
    process.stderr.write("offline-framework: request limit exceeded\n");
    process.exit(2);
  }
  chunks.push(bytes);
}

let request;
try {
  request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  process.stderr.write("offline-framework: invalid request\n");
  process.exit(2);
}

const required = [
  "schema_version", "experiment_id", "task_id", "arm", "repetition", "pass",
  "workspace_path", "notes_path", "input", "limits", "seed",
  "expected_capability_digest", "output_path",
];
if (!request || typeof request !== "object"
    || Object.keys(request).sort().join("\0") !== [...required].sort().join("\0")) {
  process.stderr.write("offline-framework: unsupported request shape\n");
  process.exit(2);
}

const workspace = resolve(process.cwd(), request.workspace_path);
const sessionId = `${request.arm}-r${request.repetition}-${request.pass}-${request.task_id}`;

function trajectory(events) {
  const agentfs = join(workspace, ".agentfs");
  mkdirSync(agentfs, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(join(agentfs, "trajectory.db"));
  database.exec("CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER DEFAULT (unixepoch ()), updated_at INTEGER DEFAULT (unixepoch ()))");
  const startedAt = "2026-01-01T00:00:00.000Z";
  const endedAt = "2026-01-01T00:00:01.000Z";
  const session = {
    schema_version: 1,
    session_id: sessionId,
    harness: "pi",
    project_root: workspace,
    started_at: startedAt,
    ended_at: endedAt,
    events,
    capture: {
      captured_at: endedAt,
      omitted_reasoning_blocks: 0,
      omitted_unknown_records: 0,
      truncated: false,
    },
  };
  const index = {
    schema_version: 1,
    session_id: sessionId,
    harness: "pi",
    started_at: startedAt,
    ended_at: endedAt,
    event_count: events.length,
    logical_bytes: Buffer.byteLength(JSON.stringify(session)),
    full_key: `trajectory/session/${sessionId}`,
  };
  const insert = database.prepare("INSERT INTO kv_store(key,value) VALUES(?,?)");
  insert.run("trajectory/meta/schema-version", "1");
  insert.run(`trajectory/session/${sessionId}`, JSON.stringify(session));
  insert.run(`trajectory/index/${String(Date.parse(endedAt)).padStart(16, "0")}/${sessionId}`, JSON.stringify(index));
  database.close();
}

if (request.task_id === "offline-timeout"
    || (request.task_id === "offline-cancellation-control" && process.env.CAIRN_FAKE_CANCEL === "1")) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 60_000));
}
if (request.task_id === "offline-invalid-result") {
  process.stdout.write('{"schema_version":1,"status":"completed","unexpected":true}');
  process.exit(0);
}
if (request.task_id === "offline-adapter-error") {
  process.stdout.write(JSON.stringify({ schema_version: 1, status: "adapter_error", error_code: "designed_adapter_error" }));
  process.exit(0);
}

writeFileSync(join(workspace, "adapter-result.txt"), `${request.task_id}:${request.pass}\n`, { mode: 0o600 });
if (request.task_id === "offline-distillation-failure") {
  const agentfs = join(workspace, ".agentfs");
  mkdirSync(agentfs, { recursive: true, mode: 0o700 });
  writeFileSync(join(agentfs, "trajectory.db"), "designed-invalid-store", { mode: 0o600 });
} else if (request.task_id !== "offline-skipped-notes") {
  const events = request.task_id === "offline-pass-note" ? [
    { sequence: 0, kind: "tool_invocation", payload: { call_id: "fixture-call", tool_name: "fixture-check", input: { task: request.task_id } } },
    { sequence: 1, kind: "tool_result", payload: { call_id: "fixture-call", is_error: true, error: "Deterministic fixture failure" } },
  ] : [];
  trajectory(events);
}

const result = {
  schema_version: 1,
  status: "completed",
  turns: { value: request.pass === "run1" ? 2 : 1, semantics: "offline-fixture-turn" },
  harness: { id: "cairn-offline-fake" },
  adapter: { id: "cairn-offline-fake" },
  model: { id: "deterministic-fixture" },
  observed_capability_digest: request.expected_capability_digest,
  ...(request.task_id === "offline-skipped-notes" ? {} : { trajectory_ref: sessionId }),
  ...(request.task_id === "offline-missing-tokens" ? {} : { usage: { total_tokens: request.pass === "run1" ? 20 : 10 } }),
};
process.stdout.write(JSON.stringify(result));
