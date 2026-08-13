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
import { HARNESS_IDS } from "./harness-registry.mjs";

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
  for (const harness of HARNESS_IDS) {
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

  const setupSurfaceComplete = [
    join(root, "scripts", "setup.mjs"),
    join(root, "scripts", "setup-core.mjs"),
    join(root, "scripts", "setup-reconcile.mjs"),
    join(root, "schemas", "cairnkeep-setup.schema.json"),
    join(root, "schemas", "cairnkeep-setup-policy.schema.json"),
  ].every((candidate) => existsSync(candidate))
    && /case\s+["']setup["']/.test(readFileSync(join(root, "scripts", "windows-platform.mjs"), "utf8"))
    && /["']setup["']/.test(powershellCompletion());

  if (!setupSurfaceComplete) {
    if (process.env.CAIRN_PHASE26_RED === "1") {
      console.log("PHASE26_RED:WINDOWS_SETUP_MISSING");
      process.exitCode = 86;
    } else {
      console.log("SKIP: simulated Windows guided setup surface is not complete");
      console.log("PASS: native Windows CLI lifecycle, paths, archive safety, hooks, and PowerShell completion");
    }
  } else {
    const setupProject = join(sandbox, "Guided Project with spaces – Unicode");
    let output = "";
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk, ...args) => {
      output += String(chunk);
      return true;
    });
    try {
      const handled = await runWindowsCommand({
        command: "setup",
        args: [setupProject, "--git", "none", "--harness", "claude,pi", "--memory", "local", "--yes", "--json"],
        root,
      });
      assert.equal(handled, true);
    } finally {
      process.stdout.write = originalWrite;
    }
    const setupResult = JSON.parse(output);
    assert.equal(setupResult.schema_version, 1);
    assert.equal(setupResult.status, "limited");
    assert.equal(setupResult.git, "none");
    assert.equal(setupResult.memory, "local");
    assert.deepEqual(setupResult.harnesses, ["claude", "pi"]);
    assert.equal(Array.isArray(setupResult.recovery), true);
    assert.equal(setupResult.recovery.some((line) => /cairn (?:setup|sync)/.test(line)), true);

    const setupStatePath = join(setupProject, ".ai", "cairnkeep.json");
    assert.ok(existsSync(setupStatePath));
    const setupState = JSON.parse(readFileSync(setupStatePath, "utf8"));
    const serializedState = JSON.stringify(setupState);
    assert.equal(serializedState.includes(setupProject), false);
    assert.doesNotMatch(serializedState, /(?:token|secret|credential|endpoint|username|environment|https?:)/i);
    assert.match(powershellCompletion(), /--git/);
    assert.match(powershellCompletion(), /--harness/);
    assert.match(powershellCompletion(), /--memory/);
    assert.match(powershellCompletion(), /--policy/);
    assert.match(powershellCompletion(), /--yes/);
    assert.match(powershellCompletion(), /--json/);
    assert.match(powershellCompletion(), /codex/);

    const codexProject = join(sandbox, "Guided Codex Project");
    let codexOutput = "";
    process.stdout.write = ((chunk) => {
      codexOutput += String(chunk);
      return true;
    });
    try {
      await runWindowsCommand({
        command: "setup",
        args: [codexProject, "--git", "none", "--harness", "codex", "--memory", "local", "--yes", "--json"],
        root,
      });
    } finally {
      process.stdout.write = originalWrite;
    }
    const codexResult = JSON.parse(codexOutput);
    assert.deepEqual(codexResult.harnesses, ["codex"]);
    assert.equal(codexResult.machine_sync.command, null);
    assert.ok(existsSync(join(codexProject, ".ai", "start-codex.cmd")));
    assert.match(readFileSync(join(codexProject, ".codex", "config.toml"), "utf8"), /mcp_servers\.cairn-memory/);
    console.log("PASS: simulated Windows setup parity, private state, recovery, and completion contract");
  }
} finally {
  if (originalBase === undefined) delete process.env.CAIRN_AGENTFS_BASE_DIR;
  else process.env.CAIRN_AGENTFS_BASE_DIR = originalBase;
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  if (originalProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalProfile;
  rmSync(sandbox, { recursive: true, force: true });
}
