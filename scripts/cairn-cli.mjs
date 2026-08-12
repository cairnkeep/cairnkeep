import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runWindowsCommand, powershellCompletion } from "./windows-platform.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const NODE_COMMANDS = new Map([
  ["memory-server", "index.js"],
  ["trajectory", "trajectory-cli.js"],
  ["artifact", "artifact-cli.js"],
  ["capabilities", "capability-cli.js"],
  ["mcp-tools", "mcp-tool-cli.js"],
  ["pack", "context-pack-cli.js"],
  ["notes", "note-cli.js"],
  ["eval", "eval-cli.js"],
  ["skill", "skill-cli.js"],
  ["graph", "graph-cli.js"],
]);

const POSIX_COMMANDS = new Map([
  ["bootstrap", "bootstrap.sh"],
  ["doctor", "doctor.sh"],
  ["uninstall", "uninstall.sh"],
  ["memory", "memory-store.sh"],
  ["sync", "sync-claude-assets.sh"],
  ["sync-pi", "sync-pi-assets.sh"],
  ["sync-kimi", "sync-kimi-assets.sh"],
  ["audit-timer", "install-audit-timer.sh"],
  ["completion", "completion.sh"],
]);

export const USAGE = `cairn — Cairnkeep CLI

Usage:
  cairn bootstrap [--untracked] [path]
  cairn setup PATH --git init|existing|none --harness LIST --memory local|none [--policy PATH] --yes [--json]
  cairn memory-server
  cairn sync [--check|--apply] [--live-root DIR]
  cairn sync-pi [--check|--apply] [--live-root DIR]
  cairn sync-kimi [--check|--apply] [--live-root DIR]
  cairn doctor [--repair]
  cairn trajectory <list|show|prune>
  cairn artifact <list|show|delete|prune>
  cairn capabilities <list|status|enable|disable|reset|logging>
  cairn mcp-tools <list|status|set|reset>
  cairn pack <init|lock|validate|install|list|show|remove|enable|disable|update|skills|approve-skill|revoke-skill>
  cairn notes <distill|search-error|promote|doctor>
  cairn eval <validate|run|ablate|report|prune|delete>
  cairn skill <harvest|list|show|review|propose|evaluate|apply|rollback>
  cairn graph <build|query|status|diff|explain|path>
  cairn memory <path|export|import>
  cairn audit-timer [--on-calendar SPEC] [--para-root PATH] [--render-only DIR]
  cairn uninstall [--dry-run] [--yes] [--purge-memory] [--purge-packs] [PROJECT ...]
  cairn completion bash|zsh|fish|powershell
  cairn version
  cairn help

Native Windows support does not require WSL or Git Bash. Windows x64 is the
supported native target; Windows ARM64 currently runs through x64 emulation.`;

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function version() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  console.log(`cairnkeep ${pkg.version}`);
}

export async function main(argv) {
  const [command = "help", ...args] = argv;

  if (["help", "--help", "-h"].includes(command)) {
    console.log(USAGE);
    return;
  }
  if (["version", "--version", "-v"].includes(command)) {
    version();
    return;
  }

  const nodeEntry = NODE_COMMANDS.get(command);
  if (nodeEntry) {
    // Preserve the historical dispatcher contract: child Node resolution comes
    // from PATH, which supports managed runtimes and test/probe wrappers.
    run("node", [resolve(ROOT, "mcp-memory-server", "dist", nodeEntry), ...args]);
    return;
  }

  if (command === "completion" && args[0] === "powershell") {
    process.stdout.write(powershellCompletion());
    return;
  }

  if (command === "setup" && process.platform !== "win32") {
    const { runSetup } = await import("./setup.mjs");
    process.exitCode = await runSetup(args);
    return;
  }

  if (process.platform === "win32") {
    const handled = await runWindowsCommand({ command, args, root: ROOT });
    if (handled) return;
  } else {
    const script = POSIX_COMMANDS.get(command);
    if (script) {
      run(resolve(ROOT, "scripts", script), args);
      return;
    }
  }

  console.error(`Unknown command: ${command}`);
  console.error(USAGE);
  process.exitCode = 2;
}
