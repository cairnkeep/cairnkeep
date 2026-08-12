import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as defaultInput, stdout as defaultOutput, stderr as defaultError } from "node:process";
import {
  buildSetupPlan,
  classifySetupTarget,
  parseSetupArgs,
  readSetupPolicy,
  resolveSetupChoices,
} from "./setup-core.mjs";
import { reconcileSetupPlan } from "./setup-reconcile.mjs";

const HARNESSES = Object.freeze(["claude", "opencode", "pi", "kimi", "qwen"]);

function operational(kind, message) {
  const error = new Error(message);
  error.name = "SetupOperationalError";
  error.kind = kind;
  error.status = 1;
  return error;
}

function writeLine(stream, value = "") {
  stream.write(`${value}\n`);
}

function parseInteractiveHarnesses(value) {
  const selected = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (selected.length === 0 || new Set(selected).size !== selected.length || selected.some((item) => !HARNESSES.includes(item))) {
    throw operational("interactive-input", `Harnesses must be a comma-separated subset of ${HARNESSES.join(", ")}.`);
  }
  return HARNESSES.filter((name) => selected.includes(name));
}

async function collectInteractiveChoices(parsed, streams) {
  const terminal = createInterface({ input: streams.input, output: streams.output });
  try {
    const target = parsed.target ?? (await terminal.question("Target path: ")).trim();
    if (!target) throw operational("interactive-input", "A setup target path is required.");
    const git = parsed.git ?? (await terminal.question("Git mode (init, existing, none): ")).trim();
    const harnesses = parsed.harnesses ?? parseInteractiveHarnesses(await terminal.question(`Harnesses (${HARNESSES.join(", ")}): `));
    const memory = parsed.memory ?? (await terminal.question("Memory mode (local, none): ")).trim();
    return { target, git, harnesses, memory, terminal };
  } catch (error) {
    terminal.close();
    throw error;
  }
}

function renderPlan(plan, stream) {
  writeLine(stream, `Target: ${plan.target}`);
  writeLine(stream, `Git mode: ${plan.git}`);
  writeLine(stream, `Harnesses: ${plan.harnesses.join(", ")}`);
  writeLine(stream, `Memory mode: ${plan.memory}`);
  writeLine(stream, "Planned assets:");
  for (const asset of plan.assets) writeLine(stream, `  ${asset.path}`);
}

function launchCommands(plan, platform) {
  const suffix = platform === "win32" ? "cmd" : "sh";
  return plan.harnesses.map((harness) => `.ai/start-${harness}.${suffix}`);
}

function setupRecovery(plan) {
  return [`cairn setup . --git ${plan.git} --harness ${plan.harnesses.join(",")} --memory ${plan.memory} --yes`];
}

function resultFor(plan, reconciliation, platform) {
  const machineCommand = plan.harnesses.includes("pi") ? "cairn sync-pi --apply" : "cairn sync --apply";
  return Object.freeze({
    schema_version: 1,
    status: plan.limited ? "limited" : "complete",
    target: plan.target,
    git: plan.git,
    memory: plan.memory,
    harnesses: plan.harnesses,
    counts: reconciliation.counts,
    changes: reconciliation.changes,
    verification: Object.freeze(["cairn doctor"]),
    launch_commands: Object.freeze(launchCommands(plan, platform)),
    recovery: Object.freeze(setupRecovery(plan)),
    limitations: Object.freeze(plan.limited ? ["Git integration is disabled; repository-aware features are limited."] : []),
    machine_sync: Object.freeze({ automatic: false, command: machineCommand }),
  });
}

function renderHuman(result, stream) {
  writeLine(stream, `Setup status: ${result.status}`);
  writeLine(stream, `Harnesses: ${result.harnesses.join(", ")}`);
  writeLine(stream, `Git mode: ${result.git}`);
  writeLine(stream, `Memory mode: ${result.memory}`);
  writeLine(stream, `Created: ${result.counts.created}`);
  writeLine(stream, `Updated: ${result.counts.updated}`);
  writeLine(stream, `Unchanged: ${result.counts.unchanged}`);
  writeLine(stream, `Skipped: ${result.counts.skipped}`);
  writeLine(stream, `Verification: ${result.verification.join(", ")}`);
  for (const command of result.launch_commands) writeLine(stream, `Launch: ${command}`);
  for (const command of result.recovery) writeLine(stream, `Recovery: ${command}`);
  for (const limitation of result.limitations) writeLine(stream, `Limitation: ${limitation}`);
  writeLine(stream, `Machine sync: ${result.machine_sync.command} (not run automatically)`);
}

function createTarget(target) {
  try {
    if (!existsSync(target)) mkdirSync(target, { recursive: true, mode: 0o755 });
    const info = lstatSync(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("target is not a regular directory");
  } catch {
    throw operational("target-denied", "Setup target could not be created safely.");
  }
}

function initializeGit(target) {
  const result = spawnSync("git", ["init", "-q", target], { encoding: "utf8", shell: false });
  if (result.error?.code === "ENOENT") throw operational("missing-git", "Git executable is required for --git init.");
  if (result.error || result.status !== 0) throw operational("git-init", "Git repository initialization failed.");
}

async function executeSetup(args, options) {
  const isTTY = options.isTTY ?? Boolean(options.input.isTTY);
  const parsed = parseSetupArgs(args, { isTTY });
  const policy = parsed.policyPath ? readSetupPolicy(parsed.policyPath) : null;

  let interactive = null;
  let target = parsed.target;
  if (isTTY && (!target || !parsed.git || !parsed.harnesses || !parsed.memory || !parsed.confirmed)) {
    interactive = await collectInteractiveChoices(parsed, options);
    target = interactive.target;
  }
  const preflight = classifySetupTarget(target);
  const choices = resolveSetupChoices({
    parsed,
    preflight,
    policy,
    interactive: interactive ? { ...interactive, confirmed: true } : null,
  });
  let plan = buildSetupPlan({ target, preflight, choices });
  if (options.augmentPlan) plan = await options.augmentPlan(plan);

  if (interactive && !parsed.confirmed) {
    renderPlan(plan, options.output);
    const answer = (await interactive.terminal.question("Apply this setup plan? [y/N] ")).trim().toLowerCase();
    interactive.terminal.close();
    if (answer !== "y" && answer !== "yes") {
      writeLine(options.output, "Setup cancelled; no files were changed.");
      return null;
    }
  } else if (interactive) interactive.terminal.close();

  createTarget(plan.target);
  if (plan.git === "init") initializeGit(plan.target);
  const reconciliation = await reconcileSetupPlan(plan);
  return resultFor(plan, reconciliation, options.platform);
}

export async function runSetup(args, options = {}) {
  const streams = {
    input: options.input ?? defaultInput,
    output: options.output ?? defaultOutput,
    error: options.error ?? defaultError,
    isTTY: options.isTTY,
    platform: options.platform ?? process.platform,
    augmentPlan: options.augmentPlan,
  };
  try {
    const result = await executeSetup(args, streams);
    if (!result) return 0;
    if (args.includes("--json")) writeLine(streams.output, JSON.stringify(result));
    else renderHuman(result, streams.output);
    return 0;
  } catch (error) {
    writeLine(streams.error, error instanceof Error ? error.message : "Setup failed.");
    return Number.isInteger(error?.status) ? error.status : 1;
  }
}
