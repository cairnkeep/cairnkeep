#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const para = resolve(option("--para-root", join(homedir(), "PARA")));
const staleDays = Number(option("--stale-days", "30"));
const reportPath = option("--report", "");
const cutoff = Date.now() - staleDays * 86_400_000;
const findings = [];
let stale = 0;
let hard = 0;
let orphan = 0;
let staged = 0;
let noteStatus = "";

function directories(root, depth = 0) {
  if (!existsSync(root) || depth > 5) return [];
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    if (entry.name === "wiki" && basename(dirname(path)) === ".planning") result.push(path);
    else result.push(...directories(path, depth + 1));
  }
  return result;
}

for (const wiki of directories(para)) {
  const project = resolve(wiki, "..", "..");
  const rows = [];
  const sources = join(wiki, "sources");
  const sourceFiles = existsSync(sources) ? readdirSync(sources).filter((name) => name.endsWith(".md")) : [];
  const staleFiles = sourceFiles.filter((name) => {
    const match = readFileSync(join(sources, name), "utf8").match(/Last reviewed\*?\*?:\s*(\d{4}-\d{2}-\d{2})/i);
    return match && Date.parse(`${match[1]}T00:00:00Z`) < cutoff;
  });
  if (staleFiles.length) { stale += staleFiles.length; rows.push(`- stale source pages (${staleFiles.length}): ${staleFiles.join(", ")}`); }
  const contradictions = join(wiki, "CONTRADICTIONS.md");
  if (existsSync(contradictions)) {
    const open = readFileSync(contradictions, "utf8").match(/wiki:contradictions:open:start -->([\s\S]*?)<!-- wiki:contradictions:open:end/)?.[1] ?? "";
    const count = (open.match(/severity:\s*hard|hard contradiction/gi) ?? []).length;
    if (count) { hard += count; rows.push(`- open HARD contradictions: ${count}`); }
  }
  const indexPath = join(wiki, "index.md");
  if (existsSync(indexPath)) {
    const index = readFileSync(indexPath, "utf8");
    const orphans = sourceFiles.filter((name) => !index.includes(name));
    if (orphans.length) { orphan += orphans.length; rows.push(`- orphan source pages (${orphans.length}): ${orphans.join(", ")}`); }
  }
  const staging = join(project, ".planning", "memory-staging");
  if (existsSync(staging)) {
    const count = readdirSync(staging).filter((name) => name.endsWith(".json") && statSync(join(staging, name)).mtimeMs < cutoff).length;
    if (count) { staged += count; rows.push(`- unreviewed staged memory candidates (>${staleDays} days): ${count}`); }
  }
  if (rows.length) findings.push(`### ${basename(project)}\n\n${rows.join("\n")}`);
}

let noteEligible = /^(1|true|yes|on)$/i.test(process.env.CAIRN_NOTE_DISTILLATION ?? "");
if (/^(1|true|yes|on)$/i.test(process.env.CAIRN_CAPABILITY_CONTRACT ?? "")) {
  const status = spawnSync(process.execPath, [join(ROOT, "bin", "cairn"), "capabilities", "status", "--json"], { encoding: "utf8", windowsHide: true });
  try {
    const value = JSON.parse(status.stdout);
    noteEligible = value.capabilities?.some((row) => row.id === "notes.distill" && row.enabled === true) ?? false;
  } catch { noteEligible = false; }
}
if (noteEligible) {
  const result = spawnSync(process.execPath, [join(ROOT, "bin", "cairn"), "notes", "distill", "--all-projects", "--para-root", para, "--json"], { stdio: "ignore", windowsHide: true });
  noteStatus = result.status === 0 ? "completed" : "failed (deterministic wiki findings remain valid)";
}

const report = `# Memory + Wiki Audit Report

- Generated: ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}
- Scope: ${para} (staleness threshold: ${staleDays} days)
- Stale source pages: ${stale}
- Open hard contradictions: ${hard}
- Orphan source pages: ${orphan}
- Unreviewed staged candidates: ${staged}
${noteStatus ? `- Note distillation: ${noteStatus}\n` : ""}

${findings.length ? findings.join("\n\n") : "No deterministic findings."}
`;
process.stdout.write(report);
if (reportPath) writeFileSync(resolve(reportPath), report, "utf8");
