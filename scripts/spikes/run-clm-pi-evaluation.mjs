#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const required = (name) => {
  const value = option(name);
  assert.ok(value, `${name} is required`);
  return resolve(value);
};

const cairn = required("--cairn");
const pi = required("--pi");
const isolatedHome = required("--home");
const cairnExtension = required("--cairn-extension");
const clmExtension = required("--clm-extension");
const clmSteering = required("--clm-steering");
const model = option("--model", "openrouter/~openai/gpt-sol-latest");
const keep = args.includes("--keep-workspaces");
const root = mkdtempSync(join(tmpdir(), "cairnkeep-clm-pi-eval-"));

const requirements = [
  "Export createLedger() from src/release-ledger.mjs. It returns an in-memory ledger exposing append(input), finalize(packageName, version), get(packageName, version), and list(). Use ESM only and Node standard APIs only.",
  "Package names must match ^[a-z][a-z0-9-]*$ and versions must be exact x.y.z numeric semantic versions. Notes must be a non-empty array of non-empty strings. Throw Error objects with code INVALID_PACKAGE, INVALID_VERSION, or INVALID_NOTES.",
  "append({ package, version, notes }) creates a draft entry with a monotonically increasing sequence beginning at 1. The pair package+version is unique forever. A repeat throws code DUPLICATE_RELEASE. Preserve note order.",
  "finalize(packageName, version) returns the final entry and is idempotent. Its checksum is lowercase SHA-256 hex of JSON.stringify({package,version,notes,sequence}) with that property order. Missing releases throw code NOT_FOUND.",
  "get() and list() return detached copies: mutating returned entries or nested notes must never mutate ledger state. list() is sequence ordered. Entries have exactly package, version, notes, sequence, state and optional checksum; draft state is draft and finalized state is final.",
];

function briefing(index, requirement) {
  const noise = Array.from({ length: 85 }, (_, line) =>
    `Background ${index}.${line + 1}: release operations value deterministic provenance, bounded diagnostics, reproducible builds, and reviewable evidence; this sentence is context noise, not an additional API requirement.`,
  ).join("\n");
  return `# Release ledger briefing ${index}\n\n## Binding requirement\n\n${requirement}\n\n## Non-binding operational background\n\n${noise}\n`;
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    timeout: options.timeout ?? 180_000,
    cwd: options.cwd,
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${basename(command)} failed (${result.status}):\n${result.stderr}\n${result.stdout}`);
  return result;
}

function parseTurn(jsonl) {
  const events = jsonl.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const turns = events.filter((event) => event.type === "turn_end" && event.message?.role === "assistant");
  assert.ok(turns.length > 0, "Pi emitted no completed assistant turn");
  const usage = turns.at(-1).message.usage ?? {};
  const text = (turns.at(-1).message.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  return { usage, text };
}

function setupProject(arm) {
  const project = join(root, arm);
  mkdirSync(project, { recursive: true });
  run(cairn, ["setup", project, "--git", "init", "--harness", "pi", "--memory", "local", "--yes", "--json"], {
    cwd: root,
    env: { ...process.env, HOME: isolatedHome },
  });
  mkdirSync(join(project, "briefings"), { recursive: true });
  requirements.forEach((requirement, index) => {
    writeFileSync(join(project, "briefings", `${String(index + 1).padStart(2, "0")}.md`), briefing(index + 1, requirement));
  });
  return project;
}

function piArgs(project, arm, prompt) {
  const sessionId = arm === "cairnkeep-clm"
    ? "22222222-2222-7222-8222-222222222222"
    : "11111111-1111-7111-8111-111111111111";
  const common = [
    "--model", model,
    "--thinking", "medium",
    "--session-id", sessionId,
    "--session-dir", join(project, ".sessions"),
    "--no-extensions",
    "--extension", cairnExtension,
    "--no-skills",
    "--no-prompt-templates",
    "--mode", "json",
  ];
  if (arm === "cairnkeep-clm") common.push("--extension", clmExtension);
  common.push("--print", prompt);
  return common;
}

function armEnvironment(arm) {
  const env = { ...process.env, HOME: isolatedHome };
  if (arm === "cairnkeep-clm") {
    Object.assign(env, {
      PI_CLM_BUDGET: "12000",
      PI_CLM_RESERVE: "2048",
      PI_CLM_REMIND_AT: "0.35,0.55,0.75",
      PI_CLM_OVERFLOW: "withhold",
      PI_CLM_NATIVE_COMPACTION: "auto",
      PI_CLM_OBSERVATION_CAP: "8000",
      PI_CLM_STEERING: clmSteering,
    });
  }
  return env;
}

function verify(project) {
  const verifier = join(root, `verify-${basename(project)}.mjs`);
  writeFileSync(verifier, `
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const target = process.argv[2];
const checks = [];
async function check(id, fn) { try { await fn(); checks.push({id, pass:true}); } catch (error) { checks.push({id, pass:false, error:String(error?.message ?? error)}); } }
const mod = await import(pathToFileURL(target).href + "?verify=" + Date.now());
await check("export", () => { if (typeof mod.createLedger !== "function") throw new Error("createLedger missing"); });
const ledger = mod.createLedger();
await check("methods", () => { for (const name of ["append","finalize","get","list"]) if (typeof ledger[name] !== "function") throw new Error(name); });
let first;
await check("append", () => { first = ledger.append({package:"cairnkeep",version:"2.20.0",notes:["OpenCode v2","Context evidence"]}); if (first.state !== "draft" || first.sequence !== 1) throw new Error(JSON.stringify(first)); });
await check("shape", () => { if (Object.keys(first).sort().join(",") !== ["notes","package","sequence","state","version"].sort().join(",")) throw new Error(JSON.stringify(first)); });
await check("invalid-package", () => { try { ledger.append({package:"Bad_Name",version:"1.0.0",notes:["x"]}); } catch (e) { if (e.code === "INVALID_PACKAGE") return; } throw new Error("wrong code"); });
await check("invalid-version", () => { try { ledger.append({package:"valid",version:"v1.0",notes:["x"]}); } catch (e) { if (e.code === "INVALID_VERSION") return; } throw new Error("wrong code"); });
await check("invalid-notes", () => { try { ledger.append({package:"valid",version:"1.0.0",notes:[]}); } catch (e) { if (e.code === "INVALID_NOTES") return; } throw new Error("wrong code"); });
await check("duplicate", () => { try { ledger.append({package:"cairnkeep",version:"2.20.0",notes:["other"]}); } catch (e) { if (e.code === "DUPLICATE_RELEASE") return; } throw new Error("wrong code"); });
await check("sequence", () => { const x=ledger.append({package:"companion",version:"1.2.3",notes:["ok"]}); if(x.sequence!==2) throw new Error(String(x.sequence)); });
await check("not-found", () => { try { ledger.get("missing","1.0.0"); } catch (e) { if (e.code === "NOT_FOUND") return; } throw new Error("wrong code"); });
let final;
await check("finalize", () => { final=ledger.finalize("cairnkeep","2.20.0"); if(final.state!=="final") throw new Error(JSON.stringify(final)); });
await check("checksum", () => { const raw=JSON.stringify({package:"cairnkeep",version:"2.20.0",notes:["OpenCode v2","Context evidence"],sequence:1}); const expected=createHash("sha256").update(raw).digest("hex"); if(final.checksum!==expected) throw new Error(final.checksum); });
await check("idempotent", () => { if(ledger.finalize("cairnkeep","2.20.0").checksum!==final.checksum) throw new Error("changed"); });
await check("detached-get", () => { const x=ledger.get("cairnkeep","2.20.0"); x.notes.push("tamper"); x.state="draft"; const y=ledger.get("cairnkeep","2.20.0"); if(y.notes.length!==2||y.state!=="final") throw new Error(JSON.stringify(y)); });
await check("ordered-detached-list", () => { const x=ledger.list(); if(x.map(e=>e.sequence).join(",")!=="1,2") throw new Error(JSON.stringify(x)); x[0].notes[0]="tamper"; if(ledger.list()[0].notes[0]!=="OpenCode v2") throw new Error("shared state"); });
console.log(JSON.stringify({checks,passed:checks.filter(x=>x.pass).length,total:checks.length}));
`);
  const target = join(project, "src", "release-ledger.mjs");
  const packagePath = join(project, "package.json");
  if (!existsSync(packagePath) || !existsSync(target) || !readFileSync(packagePath, "utf8").includes("module")) {
    return { passed: 0, total: 15, checks: [{ id: "package", pass: false, error: "package.json is not ESM" }] };
  }
  const result = run(process.execPath, [verifier, target], { cwd: project, timeout: 30_000 });
  return JSON.parse(result.stdout);
}

async function evaluateArm(arm) {
  const project = setupProject(arm);
  const env = armEnvironment(arm);
  const turns = [];
  for (let index = 0; index < requirements.length; index += 1) {
    const relative = `briefings/${String(index + 1).padStart(2, "0")}.md`;
    const prompt = [
      `Read ${relative} fully. Its Binding requirement is reviewed and authoritative for the release-ledger task.`,
      "You are explicitly authorized to store one concise project-scoped Cairnkeep memory containing that binding requirement.",
      "Use available context-management facilities as appropriate because the briefing will be removed after this turn.",
      `Reply with a concise acknowledgement beginning CHECKPOINT ${index + 1}. Do not implement yet.`,
    ].join(" ");
    const result = run(pi, piArgs(project, arm, prompt), { cwd: project, env });
    turns.push(parseTurn(result.stdout));
    rmSync(join(project, relative));
  }
  const finalPrompt = [
    "Implement the release-ledger library now from the reviewed requirements accumulated across prior turns.",
    "The briefing files have intentionally been removed. Retrieve Cairnkeep project memory first and use your retained context.",
    "Create package.json and src/release-ledger.mjs. Do not add dependencies. Run any useful self-checks, then finish.",
  ].join(" ");
  const finalResult = run(pi, piArgs(project, arm, finalPrompt), { cwd: project, env, timeout: 300_000 });
  turns.push(parseTurn(finalResult.stdout));
  const usage = turns.reduce((sum, turn) => ({
    input: sum.input + Number(turn.usage.input ?? 0),
    output: sum.output + Number(turn.usage.output ?? 0),
    cacheRead: sum.cacheRead + Number(turn.usage.cacheRead ?? 0),
    cacheWrite: sum.cacheWrite + Number(turn.usage.cacheWrite ?? 0),
    totalTokens: sum.totalTokens + Number(turn.usage.totalTokens ?? 0),
    cost: sum.cost + Number(turn.usage.cost?.total ?? 0),
  }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 });
  return { arm, usage, verification: verify(project), project: keep ? project : undefined };
}

try {
  const baseline = await evaluateArm("cairnkeep");
  const candidate = await evaluateArm("cairnkeep-clm");
  console.log(JSON.stringify({
    schema_version: 1,
    subject: "pi-clm-cairnkeep-long-horizon",
    model,
    turns_per_arm: requirements.length + 1,
    artificial_context_budget: 12000,
    arms: [baseline, candidate],
    comparison: {
      score_delta: candidate.verification.passed - baseline.verification.passed,
      total_token_delta: candidate.usage.totalTokens - baseline.usage.totalTokens,
      total_token_ratio: baseline.usage.totalTokens ? candidate.usage.totalTokens / baseline.usage.totalTokens : null,
      cache_read_delta: candidate.usage.cacheRead - baseline.usage.cacheRead,
      cost_delta_usd: candidate.usage.cost - baseline.usage.cost,
    },
  }, null, 2));
} finally {
  if (!keep) rmSync(root, { recursive: true, force: true });
  else console.error(`CLM evaluation workspaces retained at ${root}`);
}
