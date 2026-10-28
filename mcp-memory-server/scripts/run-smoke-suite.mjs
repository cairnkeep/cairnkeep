#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const check = (name, weight, ...commands) => ({ name, weight, commands });
const node = (script, ...args) => [join("scripts", script), ...args];

// Weights are approximate native-Windows seconds from the last complete run.
// They affect shard balance only; every contract still runs exactly once.
export const smokeChecks = Object.freeze([
  // Native ACL validation dominates these controls; distribute them rather
  // than adding all six to a single Windows matrix shard.
  check("team", 70, node("smoke-team.mjs")),
  check("team-review", 137, node("smoke-team-review.mjs")),
  check("team-http", 40, node("smoke-team-http.mjs")),
  check("team-mcp", 69, node("smoke-team-mcp.mjs")),
  check("team-restore", 86, node("smoke-team-restore.mjs")),
  check("team-cli", 125, node("smoke-team-cli.mjs")),
  check("team-onboarding", 233, node("smoke-team-onboarding.mjs")),
  check("team-operations", 240, node("smoke-team-operations.mjs")),
  check("embeddings", 1, node("smoke-embeddings.mjs")),
  check("extract", 1, node("smoke-extract-cli.mjs")),
  check("memory-retrieval", 7, node("smoke-memory-retrieval.mjs"), node("smoke-memory-retrieval-mcp.mjs"), node("run-memory-retrieval-study.mjs", "--check", "--summary")),
  check("memory-continuity-baseline", 8,
    node("smoke-memory-context-contract.mjs", "--baseline"),
    node("probe-memory-context-revisions.mjs", "--baseline"),
    node("run-memory-continuity-study.mjs", "--baseline", "--check", "--summary")),
  // Conservative measured pre-batch native timings, not Linux timings or
  // claimed post-optimization costs. Refresh after complete qualification.
  check("memory-database", 120, node("smoke-memory-runtime-admission.mjs"), node("smoke-memory-database.mjs")),
  check("memory-store-admission", 453, node("smoke-memory-file-admission.mjs"), node("smoke-memory-store-admission.mjs")),
  check("memory-store-restore", 280, node("smoke-memory-store-restore.mjs")),
  // Provisional native budget for the new contract; refresh after hosted timing.
  check("memory-context-store", 220, node("smoke-memory-context-store.mjs")),
  check("memory-reranker", 5, node("smoke-memory-reranker.mjs"), node("smoke-memory-reranker-mcp.mjs"), node("run-memory-reranker-study.mjs", "--check", "--summary")),
  check("scope-guard", 1, node("smoke-scope-guard.mjs")),
  check("http-guard", 9, node("smoke-http-guard.mjs")),
  check("remote-context", 14, node("smoke-remote-context.mjs"), node("smoke-remote-context-ports.mjs")),
  check("explore-guard", 4, node("smoke-explore-guard.mjs")),
  check("explore-cache", 4, node("smoke-explore-cache.mjs")),
  check("explore-crossref", 2, node("smoke-explore-crossref.mjs")),
  check("route-guard", 4, node("smoke-route-guard.mjs")),
  check("reviewed-memory", 2, node("smoke-reviewed-memory.mjs")),
  check("memory-proposals", 16, node("smoke-memory-proposals.mjs")),
  check("trajectory-roundtrip", 2, node("smoke-trajectory-roundtrip.mjs")),
  check("trajectory-redaction", 2, node("smoke-trajectory-redaction.mjs")),
  check("trajectory-retention", 4, node("smoke-trajectory-retention.mjs")),
  check("note-signatures", 1, node("smoke-note-signatures.mjs")),
  check("note-distillation", 3, node("smoke-note-distillation.mjs")),
  check("note-enrichment", 1, node("smoke-note-enrichment.mjs")),
  check("node-compat", 2, node("smoke-node-compat.mjs")),
  check("typed-nodes", 2, node("smoke-typed-nodes.mjs")),
  check("memory-import", 2, node("smoke-memory-import.mjs")),
  check("note-mcp", 9, node("smoke-note-mcp.mjs")),
  check("node-doctor", 2, node("smoke-node-doctor.mjs")),
  check("artifact-store", 35, node("smoke-artifact-store.mjs")),
  check("artifact-mcp", 17, node("smoke-artifact-mcp.mjs")),
  check("compaction-capture", 1, node("smoke-compaction-capture.mjs")),
  check("capability-contract", 10, node("smoke-capability-lock.mjs"), node("smoke-capability-contract.mjs")),
  check("capability-logging", 10, node("smoke-capability-logging.mjs")),
  check("capability-harness", 148, node("smoke-capability-harness.mjs")),
  check("capability-mcp", 39, node("smoke-capability-mcp.mjs")),
  check("eval-schema", 4, node("smoke-eval-schema.mjs")),
  check("eval-process", 18, node("smoke-eval-process.mjs")),
  check("eval-statistics", 1, node("smoke-eval-statistics.mjs")),
  check("eval-protocol", 2, node("smoke-eval-protocol.mjs")),
  check("codex-protocol", 2, node("smoke-codex-protocol.mjs")),
  check("skill-lifecycle", 244, node("smoke-skill-lifecycle.mjs")),
  check("graph-cli", 3, node("smoke-graph-cli.mjs")),
  check("mcp-trust", 14, node("smoke-mcp-trust.mjs")),
  check("pi-mcp-bridge", 4, node("smoke-pi-mcp-bridge.mjs")),
  check("pi-bridge-env", 1, node("smoke-pi-bridge-env.mjs")),
  check("pi-bridge-child", 11, node("smoke-pi-bridge-child.mjs")),
  check("context-pack", 75,
    node("smoke-context-pack-state.mjs"),
    node("smoke-context-pack-lock.mjs"),
    node("smoke-context-pack.mjs")),
  check("context-pack-retrieval", 43, node("smoke-context-pack-retrieval.mjs")),
  check("context-pack-v216-compat", 24, node("smoke-context-pack-v216-compat.mjs")),
  check("context-usage", 57, node("smoke-context-usage.mjs")),
  check("domain-retrieval", 6, node("smoke-domain-retrieval.mjs"), node("smoke-provider-config-flow.mjs")),
  check("anythingllm-workspace", 3, node("smoke-anythingllm-workspace.mjs"), node("smoke-anythingllm-workspace-mcp.mjs")),
  check("retrieval-benchmark", 25,
    node("smoke-retrieval-benchmark.mjs"),
    node("run-retrieval-benchmark.mjs", "--check")),
  check("work-evidence", 136, node("smoke-work-evidence.mjs")),
  check("okf", 31, node("smoke-okf.mjs")),
  check("playbook", 279, node("smoke-playbook.mjs")),
  check("security-assurance", 139, node("smoke-security-fixture-order.mjs")),
]);

export function buildShardPlan(total) {
  if (!Number.isSafeInteger(total) || total < 1 || total > smokeChecks.length) {
    throw new Error(`Shard count must be between 1 and ${smokeChecks.length}.`);
  }
  const positions = new Map(smokeChecks.map((entry, index) => [entry.name, index]));
  const shards = Array.from({ length: total }, () => ({ weight: 0, checks: [] }));
  const weighted = [...smokeChecks].sort((left, right) =>
    right.weight - left.weight || positions.get(left.name) - positions.get(right.name));
  // Keep native team ACL coverage in every runtime lane even when a new
  // expensive group changes the unconstrained greedy placement.
  const seeds = weighted.filter(({ name }) => name === 'team' || name.startsWith('team-')).slice(0, total);
  seeds.forEach((entry, index) => { shards[index].checks.push(entry); shards[index].weight += entry.weight; });
  for (const entry of weighted.filter(entry => !seeds.includes(entry))) {
    const target = shards.reduce((best, candidate) =>
      candidate.weight < best.weight ? candidate : best, shards[0]);
    target.checks.push(entry);
    target.weight += entry.weight;
  }
  for (const shard of shards) {
    shard.checks.sort((left, right) => positions.get(left.name) - positions.get(right.name));
  }
  return shards;
}

function parseSelection(args) {
  if (args.length === 0) return smokeChecks;
  if (args.length === 2 && args[0] === "--plan") {
    const total = Number(args[1]);
    const plan = buildShardPlan(total).map(({ weight, checks }, index) => ({
      shard: `${index + 1}/${total}`,
      weight,
      checks: checks.map(({ name }) => name),
    }));
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return null;
  }
  if (args.length === 2 && args[0] === "--shard") {
    const match = /^(\d+)\/(\d+)$/.exec(args[1]);
    if (!match) throw new Error("--shard must use INDEX/TOTAL, for example 1/3.");
    const index = Number(match[1]);
    const total = Number(match[2]);
    const plan = buildShardPlan(total);
    if (!Number.isSafeInteger(index) || index < 1 || index > total) {
      throw new Error(`Shard index must be between 1 and ${total}.`);
    }
    return plan[index - 1].checks;
  }
  throw new Error("Usage: run-smoke-suite.mjs [--shard INDEX/TOTAL | --plan TOTAL]");
}

export function runSmokeChecks(selected, { spawn = spawnSync, now = () => performance.now(), write = value => process.stdout.write(value) } = {}) {
  for (const entry of selected) {
    write(`\n==> smoke:${entry.name}\n`);
    const started = now();
    let status = 0;
    try {
    for (const args of entry.commands) {
      const result = spawn(process.execPath, args, {
        cwd: serverRoot,
        env: process.env,
        stdio: "inherit",
      });
      if (result.error) { status = 1; throw result.error; }
      if (result.status !== 0) { status = result.status ?? 1; break; }
    }
    } catch (error) {
      status = status || 1;
      throw error;
    } finally {
      write(`SMOKE_TIMING ${JSON.stringify({ schema_version: 1, name: entry.name, duration_ms: Math.max(0, Math.round(now() - started)), status })}\n`);
    }
    if (status !== 0) return status;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const selected = parseSelection(process.argv.slice(2));
  if (selected) process.exitCode = runSmokeChecks(selected);
}
