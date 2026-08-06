#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "mcp-memory-server", "dist", "index.js");
const TRAJECTORY = join(ROOT, "mcp-memory-server", "dist", "trajectory-cli.js");
const ARTIFACT = join(ROOT, "mcp-memory-server", "dist", "artifact-cli.js");
const CAPABILITY = join(ROOT, "mcp-memory-server", "dist", "capability-cli.js");

function enabled(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] ?? "").trim());
}

async function stdin() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function json(input) {
  try { return JSON.parse(input); } catch { return {}; }
}

function node(entry, args = [], options = {}) {
  return spawnSync(process.execPath, [entry, ...args], { encoding: "utf8", timeout: 3000, windowsHide: true, ...options });
}

function hookOutput(event, prefix, context) {
  if (!context.trim()) return;
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: `${prefix}\n\n${context.trim()}` } })}\n`);
}

async function wakeup() {
  const repo = process.cwd();
  const projectDb = join(repo, ".agentfs", "project.db");
  const wiki = join(repo, ".planning", "wiki", "index.md");
  if (!existsSync(projectDb) && !existsSync(wiki) && !enabled("CAIRN_COMPACTION_CAPTURE")) return;
  if (existsSync(projectDb) && existsSync(SERVER)) {
    const result = node(SERVER, ["wakeup"]);
    if (result.stdout) process.stdout.write(`## Project memory (AgentFS)\n${result.stdout}`);
  }
  if (existsSync(wiki)) process.stdout.write(`\n## Wiki index\n${readFileSync(wiki, "utf8")}\n`);
  const contradictions = join(repo, ".planning", "wiki", "CONTRADICTIONS.md");
  if (existsSync(contradictions)) {
    const text = readFileSync(contradictions, "utf8");
    const open = text.match(/<!-- wiki:contradictions:open:start -->([\s\S]*?)<!-- wiki:contradictions:open:end -->/)?.[1] ?? "";
    const hard = open.split(/\r?\n/).filter((line) => /severity:\s*hard/i.test(line));
    if (hard.length) process.stdout.write(`\n## Open HARD contradictions — resolve before dependent work\n${hard.join("\n")}\n`);
  }
  const staging = join(repo, ".planning", "memory-staging");
  if (existsSync(staging)) {
    const count = readdirSync(staging).filter((name) => name.endsWith(".json")).length;
    if (count) process.stdout.write(`\n## Staged memory candidates (${count} session(s)) — UNREVIEWED\nRun /memory-review to accept or discard them.\n`);
  }
  if (enabled("CAIRN_COMPACTION_CAPTURE") && existsSync(ARTIFACT)) {
    const payload = json(await stdin());
    const args = ["recover", repo];
    if (/^[A-Za-z0-9._:/-]{1,160}$/.test(payload.session_id ?? "")) args.push("--session-ref", `claude-code:${payload.session_id}`);
    const result = node(ARTIFACT, args);
    if (result.stdout?.trim()) process.stdout.write(`\n${result.stdout}`);
  }
}

async function capture() {
  const repo = process.cwd();
  const input = json(await stdin());
  const transcript = typeof input.transcript_path === "string" ? resolve(input.transcript_path) : "";
  if (!transcript || !existsSync(transcript)) return;
  if (enabled("CAIRN_TRAJECTORY_CAPTURE") && existsSync(TRAJECTORY)) node(TRAJECTORY, ["capture-claude", transcript, repo]);
  if (!existsSync(join(repo, ".agentfs", "project.db")) || !existsSync(SERVER)
      || !process.env.CAIRN_LLM_API_KEY || !process.env.CAIRN_LLM_EXTRACTION_MODEL) return;
  const helper = join(ROOT, "scripts", "transcript-to-text.mjs");
  const text = node(helper, [transcript]);
  if (!text.stdout?.trim()) return;
  const result = node(SERVER, ["extract", process.env.CAIRN_LLM_EXTRACTION_MODEL], { input: text.stdout, timeout: 20_000 });
  const candidates = json(result.stdout);
  if (!Array.isArray(candidates.candidates) || candidates.candidates.length === 0) return;
  const staging = join(repo, ".planning", "memory-staging");
  mkdirSync(staging, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  writeFileSync(join(staging, `${stamp}.json`), `${JSON.stringify(candidates)}\n`, { mode: 0o600 });
  const files = readdirSync(staging).filter((name) => name.endsWith(".json"))
    .map((name) => ({ name, mtime: statSync(join(staging, name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
  for (const old of files.slice(5)) rmSync(join(staging, old.name), { force: true });
}

async function compact() {
  if (!enabled("CAIRN_COMPACTION_CAPTURE") || !existsSync(ARTIFACT)) return;
  const input = await stdin();
  const version = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 2000, windowsHide: true }).stdout?.match(/\d+\.\d+\.\d+/)?.[0] ?? "unknown";
  node(ARTIFACT, ["capture-claude", process.cwd(), "--harness-version", version], { input });
}

async function recall() {
  const repo = process.cwd();
  const input = json(await stdin());
  const file = input.tool_input?.file_path || input.tool_input?.path;
  if (typeof file !== "string") return;
  const base = basename(file);
  const stem = base.replace(/\.[^.]+$/, "");
  if (stem.length < 4) return;
  const sections = [];
  if (existsSync(join(repo, ".agentfs", "project.db")) && existsSync(SERVER)) {
    const result = node(SERVER, ["wakeup"]);
    const hits = (result.stdout ?? "").split(/\r?\n/).filter((line) => line.toLowerCase().includes(stem.toLowerCase())).slice(0, 8);
    if (hits.length) sections.push(`## Relevant project memory for ${base}\n\n${hits.join("\n")}`);
  }
  const sources = join(repo, ".planning", "wiki", "sources");
  if (existsSync(sources)) {
    const hits = readdirSync(sources).filter((name) => name.endsWith(".md")).filter((name) => {
      try { return readFileSync(join(sources, name), "utf8").toLowerCase().includes(stem.toLowerCase()); } catch { return false; }
    }).slice(0, 8);
    if (hits.length) sections.push(`## Relevant wiki pages for ${base}\n\n${hits.map((name) => `- ${name}`).join("\n")}`);
  }
  hookOutput("PreToolUse", "Memory recall (auto-injected for this file edit):", sections.join("\n\n"));
}

async function explore() {
  if (!process.env.CAIRN_EXPLORE_BINARY || process.env.CAIRN_EXPLORE_AUTOINVOKE !== "1" || !existsSync(SERVER)) return;
  const prompt = json(await stdin()).prompt;
  if (typeof prompt !== "string" || prompt.length < 10 || prompt.startsWith("/") || /^\s*(ok|yes|no|thanks?)\.?\s*$/i.test(prompt)) return;
  const result = node(SERVER, ["explore", prompt], { timeout: 20_000 });
  const value = json(result.stdout);
  if (value.ok !== true || !Array.isArray(value.citations) || !value.citations.length) return;
  const context = value.citations.slice(0, 40).map((citation) => {
    let line = `${citation.path}:${citation.start_line}-${citation.end_line}`;
    const refs = [];
    if (citation.memory_refs?.length) refs.push(`memory: ${citation.memory_refs.join(", ")}`);
    if (citation.wiki_refs?.length) refs.push(`wiki: ${citation.wiki_refs.join(", ")}`);
    return refs.length ? `${line} <- ${refs.join(" - ")}` : line;
  }).join("\n");
  hookOutput("UserPromptSubmit", "Auto-invoked exploration context (context_explore):", context);
}

function validSession(value) {
  return typeof value === "string" && /^(?:cairn:)?[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value) && value !== "unknown";
}

async function capabilityStart() {
  const block = () => { process.stdout.write('{"decision":"block","reason":"capability disabled"}\n'); process.exitCode = 2; };
  if (!enabled("CAIRN_CAPABILITY_CONTRACT")) { process.stdout.write("{}\n"); return; }
  if (!existsSync(CAPABILITY)) { block(); return; }
  const value = json(await stdin());
  const commands = new Set(["wiki-ingest", "wiki-query", "wiki-lint", "graphify", "security-audit"]);
  const required = ["session_id", "transcript_path", "cwd", "hook_event_name", "expansion_type", "command_name", "command_args", "command_source", "prompt"];
  const valid = required.every((key) => Object.hasOwn(value, key))
    && value.hook_event_name === "UserPromptExpansion"
    && ["slash_command", "mcp_prompt"].includes(value.expansion_type)
    && commands.has(value.command_name)
    && validSession(value.session_id)
    && resolve(value.cwd || "") === resolve(process.cwd());
  if (!valid) { block(); return; }
  const payload = JSON.stringify({ schema_version: 1, harness: "claude-code", command: value.command_name, session_id: value.session_id, project_root: resolve(process.cwd()) });
  const result = node(CAPABILITY, ["harness-before"], { input: payload });
  if (result.stdout?.trim() === '{"schema_version":1,"decision":"block","reason":"capability-disabled"}') block();
  else process.stdout.write("{}\n");
}

async function capabilityFinish() {
  if (!enabled("CAIRN_CAPABILITY_CONTRACT") || !existsSync(CAPABILITY)) return;
  const value = json(await stdin());
  if (!validSession(value.session_id) || typeof value.hook_event_name !== "string") return;
  let operation;
  let body;
  if (value.hook_event_name === "Stop" && typeof value.stop_hook_active === "boolean") {
    operation = "harness-terminal"; body = { outcome: "success" };
  } else if (value.hook_event_name === "StopFailure" && typeof value.error === "string") {
    operation = "harness-terminal"; body = { outcome: "error" };
  } else if (value.hook_event_name === "SessionEnd" && typeof value.reason === "string") {
    operation = "harness-terminal"; body = { outcome: "abandoned" };
  } else if (value.hook_event_name === "CwdChanged" && typeof value.old_cwd === "string" && typeof value.new_cwd === "string") {
    operation = "harness-cwd"; body = { old_cwd: value.old_cwd, new_cwd: value.new_cwd };
  } else return;
  node(CAPABILITY, [operation], { input: JSON.stringify({ ...body, schema_version: 1, harness: "claude-code", session_id: value.session_id }) });
}

const handlers = new Map([
  ["memory-wakeup", wakeup],
  ["memory-capture", capture],
  ["compaction-capture", compact],
  ["memory-recall", recall],
  ["context-explore-pretask", explore],
  ["capability-command-start", capabilityStart],
  ["capability-command-finish", capabilityFinish],
]);

const handler = handlers.get(process.argv[2]);
if (!handler) process.exitCode = 2;
else handler().catch(() => {
  if (process.argv[2] === "capability-command-start") {
    process.stdout.write('{"decision":"block","reason":"capability disabled"}\n');
    process.exitCode = 2;
  }
}); // Other harness callbacks are deliberately fail-open.
