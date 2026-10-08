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
  check("team", 3, node("smoke-team.mjs"), node("smoke-team-review.mjs")),
  check("embeddings", 1, node("smoke-embeddings.mjs")),
  check("extract", 1, node("smoke-extract-cli.mjs")),
  check("scope-guard", 1, node("smoke-scope-guard.mjs")),
  check("http-guard", 10, node("smoke-http-guard.mjs")),
  check("remote-context", 1, node("smoke-remote-context.mjs")),
  check("explore-guard", 3, node("smoke-explore-guard.mjs")),
  check("explore-cache", 3, node("smoke-explore-cache.mjs")),
  check("explore-crossref", 1, node("smoke-explore-crossref.mjs")),
  check("route-guard", 3, node("smoke-route-guard.mjs")),
  check("reviewed-memory", 1, node("smoke-reviewed-memory.mjs")),
  check("memory-proposals", 11, node("smoke-memory-proposals.mjs")),
  check("trajectory-roundtrip", 1, node("smoke-trajectory-roundtrip.mjs")),
  check("trajectory-redaction", 1, node("smoke-trajectory-redaction.mjs")),
  check("trajectory-retention", 3, node("smoke-trajectory-retention.mjs")),
  check("note-signatures", 1, node("smoke-note-signatures.mjs")),
  check("note-distillation", 3, node("smoke-note-distillation.mjs")),
  check("note-enrichment", 1, node("smoke-note-enrichment.mjs")),
  check("node-compat", 2, node("smoke-node-compat.mjs")),
  check("typed-nodes", 2, node("smoke-typed-nodes.mjs")),
  check("memory-import", 2, node("smoke-memory-import.mjs")),
  check("note-mcp", 8, node("smoke-note-mcp.mjs")),
  check("node-doctor", 2, node("smoke-node-doctor.mjs")),
  check("artifact-store", 29, node("smoke-artifact-store.mjs")),
  check("artifact-mcp", 15, node("smoke-artifact-mcp.mjs")),
  check("compaction-capture", 1, node("smoke-compaction-capture.mjs")),
  check("capability-contract", 9, node("smoke-capability-contract.mjs")),
  check("capability-logging", 8, node("smoke-capability-logging.mjs")),
  check("capability-harness", 119, node("smoke-capability-harness.mjs")),
  check("capability-mcp", 31, node("smoke-capability-mcp.mjs")),
  check("eval-schema", 3, node("smoke-eval-schema.mjs")),
  check("eval-process", 15, node("smoke-eval-process.mjs")),
  check("eval-statistics", 1, node("smoke-eval-statistics.mjs")),
  check("eval-protocol", 2, node("smoke-eval-protocol.mjs")),
  check("codex-protocol", 2, node("smoke-codex-protocol.mjs")),
  check("skill-lifecycle", 185, node("smoke-skill-lifecycle.mjs")),
  check("graph-cli", 3, node("smoke-graph-cli.mjs")),
  check("mcp-trust", 10, node("smoke-mcp-trust.mjs")),
  check("pi-mcp-bridge", 3, node("smoke-pi-mcp-bridge.mjs")),
  check("pi-bridge-env", 1, node("smoke-pi-bridge-env.mjs")),
  check("pi-bridge-child", 7, node("smoke-pi-bridge-child.mjs")),
  check("context-pack", 58,
    node("smoke-context-pack-state.mjs"),
    node("smoke-context-pack-lock.mjs"),
    node("smoke-context-pack.mjs")),
  check("context-pack-retrieval", 34, node("smoke-context-pack-retrieval.mjs")),
  check("context-pack-v216-compat", 15, node("smoke-context-pack-v216-compat.mjs")),
  check("context-usage", 40, node("smoke-context-usage.mjs")),
  check("domain-retrieval", 4, node("smoke-domain-retrieval.mjs")),
  check("retrieval-benchmark", 21,
    node("smoke-retrieval-benchmark.mjs"),
    node("run-retrieval-benchmark.mjs", "--check")),
  check("work-evidence", 106, node("smoke-work-evidence.mjs")),
  check("okf", 23, node("smoke-okf.mjs")),
  check("playbook", 208, node("smoke-playbook.mjs")),
  check("security-assurance", 65, node("smoke-security-assurance.mjs")),
]);

export function buildShardPlan(total) {
  if (!Number.isSafeInteger(total) || total < 1 || total > smokeChecks.length) {
    throw new Error(`Shard count must be between 1 and ${smokeChecks.length}.`);
  }
  const positions = new Map(smokeChecks.map((entry, index) => [entry.name, index]));
  const shards = Array.from({ length: total }, () => ({ weight: 0, checks: [] }));
  const weighted = [...smokeChecks].sort((left, right) =>
    right.weight - left.weight || positions.get(left.name) - positions.get(right.name));
  for (const entry of weighted) {
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

function run(selected) {
  for (const entry of selected) {
    process.stdout.write(`\n==> smoke:${entry.name}\n`);
    for (const args of entry.commands) {
      const result = spawnSync(process.execPath, args, {
        cwd: serverRoot,
        env: process.env,
        stdio: "inherit",
      });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const selected = parseSelection(process.argv.slice(2));
  if (selected) run(selected);
}
