#!/usr/bin/env node
// omp capture staging child for the cairnkeep-capture extension.
//
// Reads transcript text on stdin, runs the shared extraction
// (`node <server-entry> extract <model>`, stdin-piped — transcript text is
// never interpolated into a shell line), and stages the candidate JSON under
// <repo>/.planning/memory-staging/ with the exact same filename, JSON, and
// retention-cap-5 contract as stageCandidates in opencode/plugins/memory-capture.ts.
//
// Invoked detached + unref'd by the extension so staging completes even when
// the agent process exits before extraction returns. Fail-open: always exits 0.
//
// Usage: node omp-capture-stage.mjs <repo> <server-entry> <model>

import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync, unlinkSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const RETENTION_CAP = 5;
const EXTRACT_TIMEOUT_MS = 120_000;

const [, , repo, serverEntry, model] = process.argv;

function stageCandidates(repoRoot, candidatesJson) {
  const stagingDir = join(repoRoot, ".planning", "memory-staging");
  mkdirSync(stagingDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const stageFile = join(stagingDir, `${ts}.json`);
  writeFileSync(stageFile, `${candidatesJson}\n`);

  // Keep the staging dir bounded — drop the oldest beyond 5 sessions.
  const staged = readdirSync(stagingDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ f, mtime: statSync(join(stagingDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { f } of staged.slice(RETENTION_CAP)) {
    unlinkSync(join(stagingDir, f));
  }
  return stageFile;
}

function runExtract(entry, extractModel, input) {
  return new Promise((resolvePromise) => {
    let stdout = "";
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(stdout);
    };
    const child = spawn("node", [entry, "extract", extractModel], { stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* best-effort kill only */ }
    }, EXTRACT_TIMEOUT_MS);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 1024 * 1024) {
        stdout = "";
        try { child.kill("SIGKILL"); } catch { /* best-effort kill only */ }
      }
    });
    child.on("close", finish);
    child.on("error", finish);
    child.stdin.on("error", () => {
      // EPIPE after a failed/terminated child is part of the fail-open path.
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

async function main() {
  if (!repo || !serverEntry || !model || !existsSync(serverEntry)) return;
  let input = "";
  try {
    for await (const chunk of process.stdin) input += chunk.toString("utf8");
  } catch {
    return;
  }
  input = input.trim();
  if (!input) return;

  const candidatesJson = (await runExtract(serverEntry, model, input)).trim();
  if (!candidatesJson) return;

  let parsed;
  try {
    parsed = JSON.parse(candidatesJson);
  } catch {
    return;
  }
  if (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0) return;

  stageCandidates(repo, candidatesJson);
}

try {
  await main();
} catch {
  // Fail open — staging is best-effort.
}
process.exit(0);
