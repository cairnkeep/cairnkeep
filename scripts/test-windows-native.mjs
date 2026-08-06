#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  bootstrapWindows,
  createTar,
  extractTar,
  launcherModule,
  launcherPowerShell,
  powershellCompletion,
  runWindowsCommand,
} from "./windows-platform.mjs";
import { runNativeContainer } from "./cairn-container-cli.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sandbox = mkdtempSync(join(tmpdir(), "cairn-windows-native-"));
const originalBase = process.env.CAIRN_AGENTFS_BASE_DIR;
const originalHome = process.env.HOME;
const originalProfile = process.env.USERPROFILE;
try {
  process.env.HOME = sandbox;
  process.env.USERPROFILE = sandbox;
  const project = join(sandbox, "Project with spaces – Unicode");
  mkdirSync(project, { recursive: true });
  bootstrapWindows(root, [project]);
  for (const harness of ["claude", "opencode", "pi", "kimi", "qwen"]) {
    assert.ok(existsSync(join(project, ".ai", `start-${harness}.cmd`)), `${harness} cmd launcher`);
  }
  assert.match(readFileSync(join(project, ".ai", "start-claude.cmd"), "utf8"), /start-harness\.ps1/);
  assert.match(launcherModule(), /spawnSync\(command/);
  assert.match(launcherPowerShell(), /pre-launch\.ps1/);
  assert.match(launcherPowerShell(), /post-exit\.ps1/);

  const claudeRoot = join(sandbox, "Claude Config");
  await runWindowsCommand({ command: "sync", args: ["--apply", "--live-root", claudeRoot], root });
  assert.ok(existsSync(join(claudeRoot, "commands", "remember.md")));
  assert.ok(existsSync(join(claudeRoot, "hooks", "memory-wakeup.cmd")));
  const settings = JSON.parse(readFileSync(join(claudeRoot, "settings.json"), "utf8"));
  assert.ok(settings.hooks.SessionStart.some((entry) => entry.hooks.some((hook) => /memory-wakeup/.test(hook.command))));
  await runWindowsCommand({ command: "sync", args: ["--check", "--live-root", claudeRoot], root });

  const payloads = [["project.db", Buffer.from("sqlite-a")], ["team.db", Buffer.from("sqlite-b")]];
  const tar = createTar(payloads);
  assert.deepEqual(extractTar(tar), payloads);
  assert.throws(() => extractTar(Buffer.from(tar).fill(0x2e, 0, 12)), /checksum|unsafe|unsupported/);
  const archive = join(sandbox, "memory.tgz");
  writeFileSync(archive, gzipSync(tar));
  const memory = join(sandbox, "Memory Store");
  process.env.CAIRN_AGENTFS_BASE_DIR = memory;
  await runWindowsCommand({ command: "memory", args: ["import", archive], root });
  assert.equal(readFileSync(join(memory, "project.db"), "utf8"), "sqlite-a");
  assert.match(powershellCompletion(), /Register-ArgumentCompleter/);

  let containerArgs = [];
  runNativeContainer(["stdio", "--image", "example/windows:1", "--volume", "windows-data"], root, (_engine, args) => { containerArgs = args; });
  assert.ok(containerArgs.includes("--read-only"));
  assert.ok(containerArgs.includes("windows-data:/data:Z,U"));
  assert.ok(containerArgs.includes("example/windows:1"));

  await runWindowsCommand({ command: "uninstall", args: ["--yes", "--live-root", claudeRoot, project], root });
  assert.ok(!existsSync(join(project, ".ai", "start-claude.cmd")));
  assert.ok(!existsSync(join(claudeRoot, "commands", "remember.md")));
  const cleanedSettings = JSON.parse(readFileSync(join(claudeRoot, "settings.json"), "utf8"));
  assert.ok(!JSON.stringify(cleanedSettings).includes("memory-wakeup"));
  console.log("PASS: native Windows CLI lifecycle, paths, archive safety, hooks, and PowerShell completion");
} finally {
  if (originalBase === undefined) delete process.env.CAIRN_AGENTFS_BASE_DIR;
  else process.env.CAIRN_AGENTFS_BASE_DIR = originalBase;
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  if (originalProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalProfile;
  rmSync(sandbox, { recursive: true, force: true });
}
