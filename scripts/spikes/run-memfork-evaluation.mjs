#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const binary = resolve(option("--binary") ?? process.env.MEMFORK_BIN ?? "memfork");
const keep = args.includes("--keep-data");
const dataDir = mkdtempSync(join(tmpdir(), "cairnkeep-memfork-eval-"));

function value(result) {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function openClient(name) {
  const transport = new StdioClientTransport({
    command: binary,
    args: ["mcp", "--data-dir", dataDir, "--namespace", "cairnkeep-spike", "--idle-timeout", "0"],
    stderr: "pipe",
  });
  const client = new Client({ name, version: "1" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

async function call(client, name, callArgs) {
  const result = await client.callTool({ name, arguments: callArgs });
  assert.notEqual(result.isError, true, `${name} returned an MCP error: ${JSON.stringify(result.content)}`);
  return value(result);
}

const observations = {};
let writer;
let reader;
try {
  writer = await openClient("cairnkeep-spike-writer");
  const tools = await writer.client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  for (const required of [
    "memfork_put", "memfork_get", "memfork_fork", "memfork_merge", "memfork_discard",
    "memfork_at", "memfork_diff", "memfork_handoff", "memfork_resume",
  ]) assert.equal(names.has(required), true, `MemFork is missing ${required}`);

  await call(writer.client, "memfork_put", {
    key: "cairnkeep-spike:decision:retrieval",
    value: "Reviewed memory remains a locator, never an authority.",
    branch: "main",
  });
  const baselineLog = await call(writer.client, "memfork_log", { branch: "main", limit: 10 });
  const baselineSeq = baselineLog.entries?.[0]?.seq ?? baselineLog.commits?.[0]?.seq;
  assert.equal(Number.isInteger(baselineSeq), true, `Could not identify baseline sequence: ${JSON.stringify(baselineLog)}`);

  await call(writer.client, "memfork_fork", { name: "candidate", from: "main" });
  await call(writer.client, "memfork_put", {
    key: "cairnkeep-spike:task:adapter",
    value: "OpenCode 2.0.24 adapter verified with native compaction recovery.",
    branch: "candidate",
  });
  const isolation = await call(writer.client, "memfork_get", {
    key: "cairnkeep-spike:task:adapter",
    branch: "main",
  });
  assert.equal(isolation.found, false, `Candidate write leaked into main: ${JSON.stringify(isolation)}`);

  await call(writer.client, "memfork_fork", { name: "conflict", from: "main" });
  await call(writer.client, "memfork_put", {
    key: "cairnkeep-spike:decision:retrieval",
    value: "Conflicting experimental policy.",
    branch: "conflict",
  });
  await call(writer.client, "memfork_put", {
    key: "cairnkeep-spike:decision:retrieval",
    value: "Verified repository sources remain authoritative.",
    branch: "main",
  });
  const conflict = await writer.client.callTool({
    name: "memfork_merge",
    arguments: { source: "conflict", target: "main", policy: "fail" },
  });
  observations.conflict_rejected = conflict.isError === true || /conflict/i.test(JSON.stringify(conflict.content));
  assert.equal(observations.conflict_rejected, true, "Conflicting merge did not fail closed");
  const discarded = await call(writer.client, "memfork_discard", {
    name: "conflict",
    lesson: "Do not replace reviewed source authority with mutable agent memory.",
  });
  observations.discard_recorded_lesson = /authority|lesson/i.test(JSON.stringify(discarded));

  await call(writer.client, "memfork_handoff", {
    summary: "The OpenCode v2 adapter is implemented on the candidate branch.",
    done: ["Added native v2 compaction normalization", "Verified branch isolation"],
    next: ["Merge the reviewed candidate"],
    branch: "candidate",
  });
  await writer.client.close();
  writer = undefined;

  reader = await openClient("cairnkeep-spike-reader");
  const resumed = await call(reader.client, "memfork_resume", {
    task: "Continue the OpenCode v2 release",
    branch: "candidate",
    budget: 4096,
  });
  observations.cross_client_handoff = /OpenCode v2 adapter|native v2 compaction/i.test(JSON.stringify(resumed));
  assert.equal(observations.cross_client_handoff, true, `Reader did not receive the handoff: ${JSON.stringify(resumed)}`);

  const diff = await call(reader.client, "memfork_diff", { a: "main", b: "candidate" });
  observations.branch_diff_visible = /task:adapter|adapter/i.test(JSON.stringify(diff));
  assert.equal(observations.branch_diff_visible, true, `Branch diff omitted candidate state: ${JSON.stringify(diff)}`);

  const historical = await call(reader.client, "memfork_at", {
    seq: baselineSeq,
    key: "cairnkeep-spike:decision:retrieval",
    branch: "main",
  });
  observations.time_travel_restored_baseline = /locator, never an authority/i.test(JSON.stringify(historical));
  assert.equal(observations.time_travel_restored_baseline, true, `Historical read did not restore baseline: ${JSON.stringify(historical)}`);

  await call(reader.client, "memfork_merge", { source: "candidate", target: "main", policy: "fail" });
  const merged = await call(reader.client, "memfork_get", {
    key: "cairnkeep-spike:task:adapter",
    branch: "main",
  });
  observations.reviewed_candidate_merged = merged.found === true && /2\.0\.24/.test(JSON.stringify(merged));
  assert.equal(observations.reviewed_candidate_merged, true, `Candidate state was not merged: ${JSON.stringify(merged)}`);

  console.log(JSON.stringify({
    schema_version: 1,
    subject: "memfork",
    version: option("--version") ?? "externally-supplied",
    observations,
    conclusion: "complementary-experimental-state-not-durable-authority",
  }, null, 2));
} finally {
  await reader?.client.close().catch(() => {});
  await writer?.client.close().catch(() => {});
  if (!keep) rmSync(dataDir, { recursive: true, force: true });
  else console.error(`MemFork evaluation data retained at ${dataDir}`);
}
