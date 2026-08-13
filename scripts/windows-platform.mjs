import {
  accessSync,
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  constants as fsConstants,
} from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { HARNESS_IDS, harnessProjectAssets } from "./harness-registry.mjs";

const BOOTSTRAP_FILES = [
  ["env.example.template", ".ai/env.example"],
  ["trajectory-redaction.json.template", ".ai/trajectory-redaction.json"],
  ["capabilities.json.template", ".ai/capabilities.json"],
  ["agentfs-gitignore.template", ".agentfs/.gitignore"],
  ["planning-config.json.template", ".planning/config.json"],
  ["project-brief.md.template", ".planning/PROJECT-BRIEF.md"],
  ["wiki-index.md.template", ".planning/wiki/index.md"],
  ["wiki-policy.md.template", ".planning/wiki/policy.md"],
  ["wiki-contradictions.md.template", ".planning/wiki/CONTRADICTIONS.md"],
  ["wiki-log.md.template", ".planning/wiki/LOG.md"],
  ["alignment-policy.md.template", ".planning/alignment/policy.md"],
  ["alignment-gap-register.yaml.template", ".planning/alignment/gap-register.yaml"],
  ["graph-policy.md.template", ".planning/graphs/policy.md"],
  ["graphs-gitignore.template", ".planning/graphs/.gitignore"],
  ["security-policy.md.template", ".planning/security/policy.md"],
];

const HARNESSES = HARNESS_IDS;
const HOOK_EVENTS = new Map([
  ["memory-wakeup", ["SessionStart", ""]],
  ["memory-capture", ["SessionEnd", ""]],
  ["compaction-capture", ["PostCompact", ""]],
  ["memory-recall", ["PreToolUse", "Edit|Write|MultiEdit"]],
  ["context-explore-pretask", ["UserPromptSubmit", ""]],
]);

function bool(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function expandHome(value) {
  if (!value) return value;
  return value === "~" ? homedir() : value.startsWith(`~${sep}`) || value.startsWith("~/")
    ? join(homedir(), value.slice(2)) : value;
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

function hardenWindowsAcl(path) {
  if (process.platform !== "win32") return;
  const identity = run("whoami.exe", ["/user", "/fo", "csv", "/nh"]);
  const sid = identity.stdout.match(/"(S-1-[0-9-]+)"/i)?.[1];
  if (identity.status !== 0 || !sid) throw new Error("Unable to resolve the current Windows security identity.");
  const result = run("icacls.exe", [path, "/inheritance:r", "/grant:r", `*${sid}:(F)`, "/grant:r", "*S-1-5-18:(F)", "/grant:r", "*S-1-5-32-544:(F)"]);
  if (result.status !== 0) throw new Error(`Unable to restrict Windows ACLs: ${path}`);
}

function atomicWrite(path, content, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, content, { mode });
  try { chmodSync(temporary, mode); } catch {}
  if (mode === 0o600) hardenWindowsAcl(temporary);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      renameSync(temporary, path);
      if (mode === 0o600) hardenWindowsAcl(path);
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      if (existsSync(path)) unlinkSync(path);
    }
  }
}

function installFile(source, destination, mode = 0o644) {
  if (existsSync(destination)) {
    console.log(`skip (exists): ${destination}`);
    return false;
  }
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  try { chmodSync(destination, mode); } catch {}
  if (mode === 0o600) hardenWindowsAcl(destination);
  console.log(`created: ${destination}`);
  return true;
}

function parseArgs(args, valued = new Set()) {
  const options = new Map();
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (valued.has(arg)) {
      if (index + 1 >= args.length) throw new Error(`${arg} requires a value`);
      options.set(arg, args[++index]);
    } else options.set(arg, true);
  }
  return { options, positional };
}

function allowOnly(options, allowed) {
  for (const key of options.keys()) if (!allowed.has(key)) throw new Error(`Unknown option: ${key}`);
}

function git(args, cwd) {
  const result = run("git.exe", args, { cwd });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "git failed").trim());
  return result.stdout.trim();
}

function windowsLauncher(harness) {
  return `@echo off\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-harness.ps1" ${harness} %*\r\n`;
}

function windowsSetupAssets(harnesses) {
  return Object.freeze([
    ...harnesses.map((harness) => Object.freeze({
      path: `.ai/start-${harness}.cmd`,
      bytes: Buffer.from(windowsLauncher(harness), "utf8"),
      mode: 0o755,
      template: `start-${harness}.cmd.generated`,
      harness,
    })),
    Object.freeze({
      path: ".ai/start-harness.mjs",
      bytes: Buffer.from(launcherModule(), "utf8"),
      mode: 0o755,
      template: "start-harness.mjs.generated",
    }),
    Object.freeze({
      path: ".ai/start-harness.ps1",
      bytes: Buffer.from(launcherPowerShell(), "utf8"),
      mode: 0o600,
      template: "start-harness.ps1.generated",
    }),
  ]);
}

export function launcherPowerShell() {
  return `param(
  [Parameter(Mandatory=$true, Position=0)][string]$Harness,
  [Parameter(ValueFromRemainingArguments=$true)][string[]]$HarnessArgs
)
$ErrorActionPreference = 'Stop'
$AiRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $AiRoot
$EnvFile = Join-Path $AiRoot '.env'
if (Test-Path -LiteralPath $EnvFile) {
  foreach ($RawLine in Get-Content -LiteralPath $EnvFile) {
    $Line = $RawLine.Trim()
    if (-not $Line -or $Line.StartsWith('#')) { continue }
    if ($Line -match '^(?:export\\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $Name = $Matches[1]
      if (Test-Path "Env:$Name") { continue }
      $Value = $Matches[2].Trim().Trim('"').Trim("'")
      if ($Value.StartsWith('~/') -or $Value.StartsWith('~\\')) { $Value = Join-Path $HOME $Value.Substring(2) }
      Set-Item -Path "Env:$Name" -Value $Value
    }
  }
}
$PreLaunch = Join-Path $AiRoot 'pre-launch.ps1'
if (Test-Path -LiteralPath $PreLaunch) { . $PreLaunch }
if ($env:CAIRN_EXTRA_SETTINGS -and $Harness -eq 'claude') {
  $HarnessArgs = @('--settings', $env:CAIRN_EXTRA_SETTINGS) + $HarnessArgs
}
if ($env:CAIRN_EXTRA_SETTINGS -and $Harness -eq 'opencode') { $env:OPENCODE_CONFIG = $env:CAIRN_EXTRA_SETTINGS }
Push-Location $ProjectRoot
try {
  & $Harness @HarnessArgs
  $Status = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
} finally {
  Pop-Location
}
$env:CAIRN_EXIT_STATUS = [string]$Status
$PostExit = Join-Path $AiRoot 'post-exit.ps1'
if (Test-Path -LiteralPath $PostExit) { . $PostExit }
exit $Status
`;
}

export function launcherModule() {
  return `#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const ai = dirname(fileURLToPath(import.meta.url));
const root = resolve(ai, "..");
const [command, ...args] = process.argv.slice(2);
const env = { ...process.env };
const envFile = resolve(ai, ".env");
if (existsSync(envFile)) for (const raw of readFileSync(envFile, "utf8").split(/\\r?\\n/)) {
  const line = raw.trim(); if (!line || line.startsWith("#")) continue;
  const match = line.match(/^(?:export\\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (!match) continue;
  if (env[match[1]] !== undefined) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  env[match[1]] = value.replace(/^~(?=[\\\\/]|$)/, env.USERPROFILE || env.HOME || "~");
}
if (!command) { console.error("missing harness command"); process.exit(2); }
if (env.CAIRN_EXTRA_SETTINGS && command === "claude") args.unshift("--settings", env.CAIRN_EXTRA_SETTINGS);
if (env.CAIRN_EXTRA_SETTINGS && command === "opencode") env.OPENCODE_CONFIG = env.CAIRN_EXTRA_SETTINGS;
const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell: false });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
`;
}

export function bootstrapWindows(root, args) {
  const { options, positional } = parseArgs(args);
  for (const key of options.keys()) if (key !== "--untracked") throw new Error(`Unknown option: ${key}`);
  if (positional.length > 1) throw new Error("Usage: cairn bootstrap [--untracked] [path]");
  const target = resolve(positional[0] ?? ".");
  if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error(`Bootstrap target is not a directory: ${target}`);

  let excludeFile;
  let prefix = "";
  if (options.has("--untracked")) {
    excludeFile = git(["rev-parse", "--git-path", "info/exclude"], target);
    if (!isAbsolute(excludeFile)) excludeFile = resolve(target, excludeFile);
    prefix = git(["rev-parse", "--show-prefix"], target).replaceAll("\\", "/");
  }

  const templates = join(root, "templates");
  for (const [source, destination] of BOOTSTRAP_FILES) {
    installFile(join(templates, source), join(target, ...destination.split("/")), destination.endsWith("capabilities.json") ? 0o600 : 0o644);
  }
  for (const harness of HARNESSES) {
    const asset = harnessProjectAssets(harness, "local")[0];
    installFile(join(templates, asset.template), join(target, ...asset.path.split("/")), asset.mode);
    const cmdPath = join(target, ".ai", `start-${harness}.cmd`);
    if (!existsSync(cmdPath)) atomicWrite(cmdPath, windowsLauncher(harness), 0o755);
  }
  const modulePath = join(target, ".ai", "start-harness.mjs");
  if (!existsSync(modulePath)) atomicWrite(modulePath, launcherModule(), 0o755);
  const powershellPath = join(target, ".ai", "start-harness.ps1");
  if (!existsSync(powershellPath)) atomicWrite(powershellPath, launcherPowerShell(), 0o600);

  if (excludeFile) {
    mkdirSync(dirname(excludeFile), { recursive: true });
    const existing = existsSync(excludeFile) ? readFileSync(excludeFile, "utf8").split(/\r?\n/) : [];
    const additions = [`.ai/`, `.planning/`, `.agentfs/`].map((entry) => `/${prefix}${entry}`);
    for (const entry of additions) if (!existing.includes(entry)) existing.push(entry);
    atomicWrite(excludeFile, `${existing.filter(Boolean).join("\n")}\n`, 0o644);
  }

  console.log(`\nCairnkeep bootstrapped into ${target}`);
  console.log(`Codex: run 'cairn setup' in the project and select Codex, review trust, then use ${join(target, ".ai", "start-codex.cmd")}`);
  console.log(`Claude: register 'cairn memory-server', run 'cairn sync --apply', then use ${join(target, ".ai", "start-claude.cmd")}`);
  console.log("For new projects, prefer 'cairn setup'; guide: docs/quickstart.md");
}

function walkFiles(root, predicate = () => true, prefix = "") {
  if (!existsSync(root)) return [];
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) result.push(...walkFiles(join(root, entry.name), predicate, rel));
    else if (entry.isFile() && predicate(rel)) result.push(rel);
  }
  return result;
}

function syncFile(source, destination, apply, render = (value) => value) {
  const expected = render(readFileSync(source, "utf8"));
  const matches = existsSync(destination) && readFileSync(destination, "utf8") === expected;
  if (matches) {
    console.log(`ok: ${destination}`);
    return true;
  }
  if (!apply) {
    console.error(`DRIFT: ${destination}`);
    return false;
  }
  atomicWrite(destination, expected, 0o644);
  console.log(`installed: ${destination}`);
  return true;
}

function registerClaudeHook(settingsPath, name, command, event, matcher) {
  let settings = {};
  if (existsSync(settingsPath)) settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  settings.hooks ??= {};
  settings.hooks[event] = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  const already = settings.hooks[event].some((entry) => entry?.hooks?.some((hook) => hook?.command?.includes(name)));
  if (!already) {
    if (existsSync(settingsPath)) copyFileSync(settingsPath, `${settingsPath}.bak`);
    const hook = { type: "command", command };
    if (name === "context-explore-pretask") hook.timeout = 25;
    settings.hooks[event].push(matcher ? { matcher, hooks: [hook] } : { hooks: [hook] });
    atomicWrite(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 0o600);
  }
}

function claudeHookRegistered(settingsPath, name, event) {
  if (!existsSync(settingsPath)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    return Array.isArray(settings.hooks?.[event])
      && settings.hooks[event].some((entry) => entry?.hooks?.some((hook) => hook?.command?.includes(name)));
  } catch { return false; }
}

function syncClaude(root, args) {
  const { options, positional } = parseArgs(args, new Set(["--live-root"]));
  allowOnly(options, new Set(["--check", "--apply", "--capability-overlay", "--live-root"]));
  if (positional.length) throw new Error("Usage: cairn sync [--check|--apply] [--live-root DIR]");
  const apply = options.has("--apply");
  const capabilityOverlay = options.has("--capability-overlay") && bool(process.env.CAIRN_CAPABILITY_CONTRACT);
  const live = resolve(expandHome(options.get("--live-root") || process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")));
  const source = join(root, "claude");
  let ok = true;
  for (const rel of walkFiles(source, (path) => path.endsWith(".md") && !path.startsWith(`capability-contract${sep}`))) {
    ok = syncFile(join(source, rel), join(live, rel), apply) && ok;
  }
  for (const rel of walkFiles(join(root, "templates"), (path) => /^(security|wiki)-.*\.template$/.test(path))) {
    ok = syncFile(join(root, "templates", rel), join(live, "templates", rel), apply) && ok;
  }
  for (const [name, [event, matcher]] of HOOK_EVENTS) {
    const wrapper = join(live, "hooks", `${name}.cmd`);
    const content = `@echo off\r\nnode "${join(root, "scripts", "cairn-hook.mjs")}" ${name} %*\r\n`;
    const matches = existsSync(wrapper) && readFileSync(wrapper, "utf8") === content;
    if (!matches && apply) atomicWrite(wrapper, content, 0o755);
    else if (!matches) ok = false;
    if (apply) registerClaudeHook(join(live, "settings.json"), name, `"${wrapper}"`, event, matcher);
    else if (!claudeHookRegistered(join(live, "settings.json"), name, event)) {
      console.error(`DRIFT: ${event} hook registration for ${name}`);
      ok = false;
    }
  }
  if (capabilityOverlay) {
    const capabilityHooks = [
      ["capability-command-start", "UserPromptExpansion", "wiki-ingest|wiki-query|wiki-lint|graphify|security-audit"],
      ["capability-command-finish", "Stop", ""],
      ["capability-command-finish", "StopFailure", ""],
      ["capability-command-finish", "CwdChanged", ""],
      ["capability-command-finish", "SessionEnd", ""],
    ];
    for (const [name, event, matcher] of capabilityHooks) {
      const wrapper = join(live, "hooks", `${name}.cmd`);
      const content = `@echo off\r\nnode "${join(root, "scripts", "cairn-hook.mjs")}" ${name} %*\r\n`;
      const matches = existsSync(wrapper) && readFileSync(wrapper, "utf8") === content;
      if (!matches && apply) atomicWrite(wrapper, content, 0o755);
      else if (!matches) ok = false;
      if (apply) registerClaudeHook(join(live, "settings.json"), name, `"${wrapper}"`, event, matcher);
      else if (!claudeHookRegistered(join(live, "settings.json"), name, event)) {
        console.error(`DRIFT: ${event} hook registration for ${name}`);
        ok = false;
      }
    }
  }
  if (!ok) process.exitCode = 1;
  else console.log(`Claude assets are in sync under ${live}`);
}

function syncSimple(root, args, kind) {
  const { options, positional } = parseArgs(args, new Set(["--live-root"]));
  allowOnly(options, new Set(["--check", "--apply", "--live-root"]));
  if (positional.length) throw new Error(`Usage: cairn sync-${kind} [--check|--apply] [--live-root DIR]`);
  const apply = options.has("--apply");
  const config = kind === "pi"
    ? { source: "pi", live: process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), files: ["extensions/cairnkeep-memory.ts", "extensions/cairnkeep-trajectory.ts", "prompts/graphify.md"] }
    : { source: "kimi", live: process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code"), files: ["skills/graphify/SKILL.md"] };
  const live = resolve(expandHome(options.get("--live-root") || config.live));
  let ok = true;
  for (const rel of config.files) {
    const render = kind === "pi" && rel.endsWith(".ts") ? (value) => value.replaceAll("@@INFRA_ROOT@@", root.replaceAll("\\", "/")) : undefined;
    ok = syncFile(join(root, config.source, ...rel.split("/")), join(live, ...rel.split("/")), apply, render) && ok;
  }
  if (!ok) process.exitCode = 1;
  else console.log(`${kind === "pi" ? "Pi" : "Kimi"} assets are in sync under ${live}`);
}

function loadProjectEnv(cwd) {
  const path = join(cwd, ".ai", ".env");
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = raw.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    process.env[match[1]] = expandHome(value);
  }
}

async function doctorWindows(root, args) {
  const repair = args.includes("--repair");
  if (args.some((arg) => !["--repair", "--help", "-h"].includes(arg))) throw new Error("Usage: cairn doctor [--repair]");
  if (args.some((arg) => ["--help", "-h"].includes(arg))) {
    console.log("Usage: cairn doctor [--repair]");
    return;
  }
  loadProjectEnv(process.cwd());
  let failures = 0;
  const line = (state, text) => { console.log(`  [${state}] ${text}`); if (state === "FAIL") failures += 1; };
  console.log("cairn doctor");
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) line("FAIL", `Node.js ${process.version} is unsupported (22 or newer required)`);
  else line("PASS", `Node.js ${process.version} on native Windows ${process.arch}`);
  const server = join(root, "mcp-memory-server", "dist", "index.js");
  const probe = join(root, "scripts", "probe-memory-server.mjs");
  const probeResult = run(process.execPath, [probe, server], { stdio: "ignore" });
  line(probeResult.status === 0 ? "PASS" : "FAIL", probeResult.status === 0
    ? "bundled local memory server responds over MCP stdio"
    : "memory server failed its MCP stdio probe");
  const store = resolve(expandHome(process.env.CAIRN_AGENTFS_BASE_DIR || join(homedir(), ".cairnkeep")));
  try {
    mkdirSync(store, { recursive: true });
    accessSync(store, fsConstants.W_OK);
    line("PASS", `memory store is writable: ${store}`);
  } catch { line("FAIL", `memory store is not writable: ${store}`); }
  const sqlite = run("where.exe", ["sqlite3.exe"]);
  line(sqlite.status === 0 ? "PASS" : "WARN", sqlite.status === 0
    ? "sqlite3 is available for WAL-safe memory export"
    : "sqlite3 is not installed; runtime works, but memory export is unavailable");
  for (const [label, file, doctorArgs] of [
    ["trajectory", "trajectory-cli.js", ["doctor", "--json", ...(repair ? ["--repair"] : [])]],
    ["artifact", "artifact-cli.js", ["doctor", "--json", ...(repair ? ["--repair"] : [])]],
    ["typed memory", "node-cli.js", ["doctor", "--project-root", process.cwd(), ...(repair ? ["--repair"] : [])]],
    ["capability", "capability-cli.js", ["doctor", "--json"]],
    ["context pack", "context-pack-cli.js", ["doctor", "--json"]],
  ]) {
    const entry = join(root, "mcp-memory-server", "dist", file);
    if (!existsSync(entry)) { line("FAIL", `${label} diagnostics are unavailable`); continue; }
    const result = run(process.execPath, [entry, ...doctorArgs]);
    line(result.status === 0 ? "PASS" : "FAIL", `${label} diagnostics ${result.status === 0 ? "passed" : "failed"}`);
  }
  if (process.env.CAIRN_LLM_API_URL) {
    try {
      await fetch(process.env.CAIRN_LLM_API_URL, { signal: AbortSignal.timeout(5000) });
      line("PASS", `LLM endpoint reachable (${process.env.CAIRN_LLM_API_URL})`);
    } catch { line("FAIL", `LLM endpoint unreachable (${process.env.CAIRN_LLM_API_URL})`); }
  } else line("SKIP", "LLM endpoint unset; search uses deterministic substring fallback");
  if (process.env.CAIRN_MEMORY_EMBEDDING_URL) {
    if (!process.env.CAIRN_LLM_API_KEY || !process.env.CAIRN_MEMORY_EMBEDDING_MODEL) {
      line("FAIL", "embedding configuration is incomplete (API key and model are required)");
    } else {
      try {
        const endpoint = `${process.env.CAIRN_MEMORY_EMBEDDING_URL.replace(/\/$/, "")}/embeddings`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.CAIRN_LLM_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: process.env.CAIRN_MEMORY_EMBEDDING_MODEL, input: ["cairnkeep health check"] }),
          signal: AbortSignal.timeout(10_000),
        });
        line(response.ok ? "PASS" : "FAIL", `embedding endpoint ${response.ok ? "accepted" : "rejected"} model ${process.env.CAIRN_MEMORY_EMBEDDING_MODEL}`);
      } catch { line("FAIL", `embedding endpoint request failed (${process.env.CAIRN_MEMORY_EMBEDDING_URL})`); }
    }
  } else line("SKIP", "embedding endpoint unset");
  const provider = process.env.CAIRN_GIT_PROVIDER?.trim();
  if (!provider || provider === "none") line("SKIP", "git provider unset/none; collaboration commands are off");
  else if (["github", "gitlab", "codeberg", "forgejo"].includes(provider)) line("PASS", `git provider configured: ${provider}`);
  else line("WARN", `git provider is not recognized: ${provider}`);
  if (failures) process.exitCode = 1;
}

function tarOctal(value, width) {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

export function createTar(files) {
  const blocks = [];
  for (const [name, content] of files) {
    if (!/^[A-Za-z0-9._-]+\.db$/.test(name)) throw new Error(`unsafe archive name: ${name}`);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    header.write(tarOctal(0o600, 8), 100, 8, "ascii");
    header.write(tarOctal(0, 8), 108, 8, "ascii");
    header.write(tarOctal(0, 8), 116, 8, "ascii");
    header.write(tarOctal(content.length, 12), 124, 12, "ascii");
    header.write(tarOctal(Math.floor(Date.now() / 1000), 12), 136, 12, "ascii");
    header.fill(0x20, 148, 156);
    header[156] = "0".charCodeAt(0);
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

export function extractTar(buffer) {
  const files = [];
  const names = new Set();
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const storedChecksum = Number.parseInt(header.subarray(148, 156).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const calculatedChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    if (storedChecksum !== calculatedChecksum) throw new Error("archive header checksum is invalid");
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    if (!/^[A-Za-z0-9._-]+\.db$/.test(name) || basename(name) !== name || type !== "0" || !Number.isSafeInteger(size)) {
      throw new Error("archive contains an unsafe or unsupported entry");
    }
    if (names.has(name)) throw new Error("archive contains duplicate database entries");
    names.add(name);
    offset += 512;
    if (offset + size > buffer.length) throw new Error("archive is truncated");
    files.push([name, Buffer.from(buffer.subarray(offset, offset + size))]);
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

function memoryWindows(args) {
  const [sub = "help", archive] = args;
  if (args.length > (sub === "path" || ["help", "-h", "--help"].includes(sub) ? 1 : 2)) throw new Error("Usage: cairn memory path | export <file.tgz> | import <file.tgz>");
  const base = resolve(expandHome(process.env.CAIRN_AGENTFS_BASE_DIR || join(homedir(), ".cairnkeep")));
  if (sub === "path") { console.log(base); return; }
  if (["help", "-h", "--help"].includes(sub)) {
    console.log("Usage: cairn memory path | export <file.tgz> | import <file.tgz>");
    return;
  }
  if (!archive) throw new Error(`cairn memory ${sub} requires an archive path`);
  if (sub === "export") {
    if (!existsSync(base)) throw new Error(`no memory store directory at ${base}`);
    const databases = readdirSync(base).filter((name) => /^[A-Za-z0-9._-]+\.db$/.test(name));
    if (!databases.length) throw new Error(`no scope .db files under ${base}`);
    const scratch = mkdtempSync(join(tmpdir(), "cairn-export-"));
    try {
      const files = [];
      for (const name of databases) {
        const output = join(scratch, name);
        const result = run("sqlite3.exe", [join(base, name), `.backup '${output.replaceAll("'", "''")}'`]);
        if (result.status !== 0) throw new Error("sqlite3 is required for a WAL-safe export");
        files.push([name, readFileSync(output)]);
      }
      writeFileSync(resolve(archive), gzipSync(createTar(files), { level: 9 }));
      console.log(`exported ${files.length} scope db file(s) from ${base} -> ${resolve(archive)}`);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
    return;
  }
  if (sub === "import") {
    const source = resolve(archive);
    if (!existsSync(source)) throw new Error(`no such archive: ${source}`);
    if (statSync(source).size > 512 * 1024 * 1024) throw new Error("memory archive exceeds the 512 MiB compressed limit");
    const files = extractTar(gunzipSync(readFileSync(source), { maxOutputLength: 512 * 1024 * 1024 }));
    if (!files.length) throw new Error("archive contained no scope .db files");
    mkdirSync(base, { recursive: true });
    for (const [name, content] of files) {
      const destination = join(base, name);
      if (existsSync(destination)) copyFileSync(destination, `${destination}.bak-pre-import`);
      atomicWrite(destination, content, 0o600);
    }
    console.log(`imported ${files.length} scope db file(s) -> ${base}`);
    return;
  }
  throw new Error(`Unknown: cairn memory ${sub}`);
}

function auditTimerWindows(root, args) {
  const { options, positional } = parseArgs(args, new Set(["--on-calendar", "--para-root", "--render-only"]));
  allowOnly(options, new Set(["--on-calendar", "--para-root", "--render-only"]));
  if (positional.length) throw new Error("Usage: cairn audit-timer [--on-calendar SPEC] [--para-root PATH] [--render-only DIR]");
  const interval = options.get("--on-calendar") || "DAILY";
  const para = resolve(expandHome(options.get("--para-root") || join(homedir(), "PARA")));
  const command = `node "${join(root, "scripts", "memory-wiki-audit.mjs")}" --para-root "${para}"`;
  if (options.get("--render-only")) {
    const destination = resolve(options.get("--render-only"));
    mkdirSync(destination, { recursive: true });
    atomicWrite(join(destination, "CairnkeepMemoryAudit.ps1"), `& ${command}\r\n`, 0o600);
    console.log(`rendered Windows audit task command under ${destination}`);
    return;
  }
  const schedule = /^(DAILY|WEEKLY|MONTHLY|ONLOGON)$/i.test(interval) ? interval.toUpperCase() : "DAILY";
  const result = run("schtasks.exe", ["/Create", "/F", "/TN", "Cairnkeep Memory Audit", "/SC", schedule, "/TR", command]);
  if (result.status !== 0) throw new Error((result.stderr || "Windows Task Scheduler registration failed").trim());
  console.log("installed Windows Task Scheduler task: Cairnkeep Memory Audit");
}

function uninstallWindows(root, args) {
  const { options, positional: projects } = parseArgs(args, new Set(["--live-root", "--pi-live-root", "--kimi-live-root"]));
  allowOnly(options, new Set(["--dry-run", "--yes", "--purge-memory", "--purge-packs", "--live-root", "--pi-live-root", "--kimi-live-root"]));
  const dryRun = options.has("--dry-run");
  if (!dryRun && !options.has("--yes")) throw new Error("native Windows uninstall requires --yes (or use --dry-run)");
  const targets = [];
  const live = resolve(expandHome(options.get("--live-root") || process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")));
  for (const rel of walkFiles(join(root, "claude"), (path) => path.endsWith(".md") && !path.startsWith(`capability-contract${sep}`))) targets.push(join(live, rel));
  for (const rel of walkFiles(join(root, "templates"), (path) => /^(security|wiki)-.*\.template$/.test(path))) targets.push(join(live, "templates", rel));
  for (const name of HOOK_EVENTS.keys()) targets.push(join(live, "hooks", `${name}.cmd`));
  targets.push(join(live, "hooks", "capability-command-start.cmd"), join(live, "hooks", "capability-command-finish.cmd"));
  const piLive = resolve(expandHome(options.get("--pi-live-root") || process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent")));
  targets.push(
    join(piLive, "extensions", "cairnkeep-memory.ts"),
    join(piLive, "extensions", "cairnkeep-trajectory.ts"),
    join(piLive, "prompts", "graphify.md"),
  );
  const kimiLive = resolve(expandHome(options.get("--kimi-live-root") || process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code")));
  targets.push(join(kimiLive, "skills", "graphify", "SKILL.md"));
  for (const project of projects) {
    const base = resolve(project);
    for (const [, rel] of BOOTSTRAP_FILES) targets.push(join(base, ...rel.split("/")));
    for (const harness of HARNESSES) {
      for (const asset of harnessProjectAssets(harness, "local")) targets.push(join(base, ...asset.path.split("/")));
      targets.push(join(base, ".ai", `start-${harness}.cmd`));
    }
    targets.push(join(base, ".ai", "start-harness.mjs"));
    targets.push(join(base, ".ai", "start-harness.ps1"));
    if (options.has("--purge-memory")) targets.push(join(base, ".agentfs"));
  }
  if (options.has("--purge-memory")) targets.push(resolve(expandHome(process.env.CAIRN_AGENTFS_BASE_DIR || join(homedir(), ".cairnkeep"))));
  if (options.has("--purge-packs")) targets.push(resolve(expandHome(process.env.CAIRN_PACK_BASE_DIR || join(homedir(), ".cairnkeep", "packs"))));
  const candidates = [...new Set(targets)].filter(existsSync);
  const existing = candidates.filter((target) => !candidates.some((parent) => parent !== target && target.toLowerCase().startsWith(`${parent.toLowerCase()}${sep}`)));
  if (dryRun) { for (const target of existing) console.log(`would remove: ${target}`); return; }
  const backup = join(homedir(), "cairnkeep-uninstall-backups", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(backup, { recursive: true });
  hardenWindowsAcl(backup);
  const manifest = [];
  const backupTarget = (target) => {
    const destination = join(backup, "items", String(manifest.length));
    mkdirSync(dirname(destination), { recursive: true });
    if (lstatSync(target).isDirectory()) cpSync(target, destination, { recursive: true, errorOnExist: false });
    else copyFileSync(target, destination);
    manifest.push({ source: join("items", String(manifest.length)), destination: target, directory: lstatSync(target).isDirectory() });
  };
  const settingsPath = join(live, "settings.json");
  if (existsSync(settingsPath)) {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    let changed = false;
    for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
      if (!Array.isArray(entries)) continue;
      const filtered = entries.map((entry) => {
        if (!Array.isArray(entry?.hooks)) return entry;
        const hooks = entry.hooks.filter((hook) => !/memory-wakeup|memory-capture|compaction-capture|memory-recall|context-explore-pretask|capability-command-(?:start|finish)/.test(hook?.command ?? ""));
        if (hooks.length !== entry.hooks.length) changed = true;
        return { ...entry, hooks };
      }).filter((entry) => entry.hooks?.length !== 0);
      settings.hooks[event] = filtered;
    }
    if (changed) {
      backupTarget(settingsPath);
      atomicWrite(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 0o600);
      console.log(`updated: ${settingsPath}`);
    }
  }
  for (const target of existing) {
    backupTarget(target);
    rmSync(target, { recursive: true, force: true });
    console.log(`removed: ${target}`);
  }
  atomicWrite(join(backup, "manifest.json"), `${JSON.stringify({ schema_version: 1, items: manifest }, null, 2)}\n`, 0o600);
  atomicWrite(join(backup, "revert.ps1"), `$ErrorActionPreference = 'Stop'
$Manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
foreach ($Item in $Manifest.items) {
  $Source = Join-Path $PSScriptRoot $Item.source
  $Parent = Split-Path -Parent $Item.destination
  New-Item -ItemType Directory -Force -Path $Parent | Out-Null
  if ($Item.directory) { Copy-Item -LiteralPath $Source -Destination $Item.destination -Recurse -Force }
  else { Copy-Item -LiteralPath $Source -Destination $Item.destination -Force }
  Set-Acl -LiteralPath $Item.destination -AclObject (Get-Acl -LiteralPath $Source)
  if ($Item.directory) {
    Get-ChildItem -LiteralPath $Source -Recurse -Force | ForEach-Object {
      $Relative = $_.FullName.Substring($Source.Length).TrimStart('\\')
      $Restored = Join-Path $Item.destination $Relative
      Set-Acl -LiteralPath $Restored -AclObject (Get-Acl -LiteralPath $_.FullName)
    }
  }
}
`, 0o600);
  console.log(`backup retained at ${backup}`);
}

export function powershellCompletion() {
  const harnesses = HARNESS_IDS.map((id) => `'${id}'`).join(",");
  return `Register-ArgumentCompleter -Native -CommandName cairn -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $commands = 'bootstrap','setup','memory-server','sync','sync-pi','sync-kimi','doctor','trajectory','artifact','capabilities','mcp-tools','pack','notes','eval','skill','graph','memory','audit-timer','uninstall','completion','version','help'
  $setup = '--git','--harness','--memory','--policy','--yes','--json','init','existing','none',${harnesses},'local'
  $candidates = if ($commandAst.ToString() -match '^\\s*cairn\\s+setup(?:\\s|$)') { $setup } else { $commands }
  $candidates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}\n`;
}

export async function runWindowsCommand({ command, args, root }) {
  switch (command) {
    case "bootstrap": bootstrapWindows(root, args); return true;
    case "setup": {
      const { runSetup } = await import("./setup.mjs");
      process.exitCode = await runSetup(args, {
        platform: "win32",
        augmentPlan: (plan) => Object.freeze({
          ...plan,
          assets: Object.freeze([...plan.assets, ...windowsSetupAssets(plan.harnesses)]),
        }),
      });
      return true;
    }
    case "sync": syncClaude(root, args); return true;
    case "sync-pi": syncSimple(root, args, "pi"); return true;
    case "sync-kimi": syncSimple(root, args, "kimi"); return true;
    case "doctor": await doctorWindows(root, args); return true;
    case "memory": memoryWindows(args); return true;
    case "audit-timer": auditTimerWindows(root, args); return true;
    case "uninstall": uninstallWindows(root, args); return true;
    case "completion":
      if (args[0] !== "powershell") throw new Error("native Windows completion supports PowerShell: cairn completion powershell");
      process.stdout.write(powershellCompletion()); return true;
    default: return false;
  }
}
