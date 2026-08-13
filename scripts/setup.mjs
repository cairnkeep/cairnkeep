import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
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
import { HARNESS_IDS, machineSyncCommand, requiredHarnessAssetPaths } from "./harness-registry.mjs";

const HARNESSES = HARNESS_IDS;
const GIT_MODES = Object.freeze(["init", "existing", "none"]);
const MEMORY_MODES = Object.freeze(["local", "none"]);
const STATE_KEYS = Object.freeze(["schema_version", "cairnkeep_version", "git", "memory", "harnesses", "assets"]);
const ASSET_KEYS = Object.freeze(["digest", "mode", "template"]);
const SAFE_ASSET = /^\.(?:ai|planning|agentfs|codex)\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const COMMON_SETUP_ASSETS = Object.freeze([
  ".ai/env.example",
  ".ai/trajectory-redaction.json",
  ".ai/capabilities.json",
  ".agentfs/.gitignore",
  ".planning/config.json",
  ".planning/PROJECT-BRIEF.md",
  ".planning/wiki/index.md",
  ".planning/wiki/policy.md",
  ".planning/wiki/CONTRADICTIONS.md",
  ".planning/wiki/LOG.md",
  ".planning/alignment/policy.md",
  ".planning/alignment/gap-register.yaml",
  ".planning/graphs/policy.md",
  ".planning/graphs/.gitignore",
  ".planning/security/policy.md",
]);

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

export async function promptSetupChoices(parsed, streams) {
  const terminal = typeof streams.question === "function"
    ? { question: streams.question, close: streams.closePrompt ?? (() => {}) }
    : createInterface({ input: streams.input, output: streams.output });
  try {
    const target = parsed.target ?? (await terminal.question("Target path: ")).trim();
    if (!target) throw operational("interactive-input", "A setup target path is required.");
    const preflight = classifySetupTarget(target);
    const gitQuestion = preflight.targetState === "missing" || preflight.targetState === "empty"
      ? "Git mode (init recommended; choices: init, existing, none): "
      : preflight.repository === "work-tree"
        ? "Git mode (existing recommended; choices: init, existing, none): "
        : "Git mode (init requires explicit choice for existing non-Git target; choices: init, existing, none): ";
    const git = parsed.git ?? (await terminal.question(gitQuestion)).trim();
    const harnesses = parsed.harnesses ?? parseInteractiveHarnesses(await terminal.question(`Harnesses (${HARNESSES.join(", ")}): `));
    const memory = parsed.memory ?? (await terminal.question("Memory mode (local, none): ")).trim();
    return { target, git, harnesses, memory, preflight, terminal };
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
  const machineCommand = machineSyncCommand(plan.harnesses);
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

export function renderSetupResult(result, stream) {
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
  if (result.harnesses.includes("codex") && result.memory === "local") {
    writeLine(stream, "Codex: review .codex/config.toml and accept the project trust prompt before use");
  }
  writeLine(stream, result.machine_sync.command
    ? `Machine sync: ${result.machine_sync.command} (not run automatically)`
    : "Machine sync: not required for the selected harnesses");
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
  let preflight = null;
  if (isTTY && (!target || !parsed.git || !parsed.harnesses || !parsed.memory || !parsed.confirmed)) {
    interactive = await promptSetupChoices(parsed, options);
    target = interactive.target;
    preflight = interactive.preflight;
  }
  preflight ??= classifySetupTarget(target);
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
    question: options.question,
    closePrompt: options.closePrompt,
  };
  try {
    const result = await executeSetup(args, streams);
    if (!result) return 0;
    if (args.includes("--json")) writeLine(streams.output, JSON.stringify(result));
    else renderSetupResult(result, streams.output);
    return 0;
  } catch (error) {
    writeLine(streams.error, error instanceof Error ? error.message : "Setup failed.");
    return Number.isInteger(error?.status) ? error.status : 1;
  }
}

function incompleteDiagnosis(recovery = "cairn setup . --git existing --harness claude --memory local --yes") {
  return Object.freeze({ schema_version: 1, status: "incomplete", code: "setup-state", recovery: Object.freeze([recovery]) });
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function safeStateAsset(path, record) {
  return typeof path === "string"
    && path.length <= 512
    && SAFE_ASSET.test(path)
    && !path.includes("\\")
    && !path.split("/").includes("..")
    && exactKeys(record, ASSET_KEYS)
    && typeof record.digest === "string"
    && /^[a-f0-9]{64}$/.test(record.digest)
    && Number.isInteger(record.mode)
    && record.mode >= 0
    && record.mode <= 0o777
    && typeof record.template === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(record.template);
}

function readPrivateState(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error("unsafe");
  if (process.platform !== "win32" && (info.mode & 0o777) !== 0o600) throw new Error("unsafe");
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size > 1024 * 1024) throw new Error("unsafe");
    return JSON.parse(readFileSync(descriptor, "utf8"));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function hasCodexMemoryConfig(project) {
  const path = join(project, ".codex", "config.toml");
  if (!existsSync(path)) return false;
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return false;
  let descriptor;
  let text;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size > 1024 * 1024) return false;
    text = readFileSync(descriptor, "utf8");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const lines = text.split(/\r?\n/);
  const headers = lines.flatMap((line, index) => (
    ["[mcp_servers.cairn-memory]", "[mcp_servers.\"cairn-memory\"]"].includes(line.trim()) ? [index] : []
  ));
  if (headers.length !== 1) return false;
  const [start] = headers;
  const next = lines.findIndex((line, index) => index > start && /^\s*\[[^\]]+\]\s*$/.test(line));
  const section = lines.slice(start + 1, next < 0 ? lines.length : next).join("\n");
  return (section.match(/^\s*command\s*=\s*["']cairn["']\s*$/gm) ?? []).length === 1
    && (section.match(/^\s*args\s*=\s*\[\s*["']memory-server["']\s*\]\s*$/gm) ?? []).length === 1;
}

export function diagnoseSetup(target = ".") {
  const project = resolve(target);
  const statePath = join(project, ".ai", "cairnkeep.json");
  if (!existsSync(statePath)) return Object.freeze({ schema_version: 1, status: "absent", code: "not-configured", recovery: Object.freeze([]) });
  try {
    const state = readPrivateState(statePath);
    if (!exactKeys(state, STATE_KEYS)
        || state.schema_version !== 1
        || typeof state.cairnkeep_version !== "string"
        || state.cairnkeep_version.length === 0
        || state.cairnkeep_version.length > 128
        || !GIT_MODES.includes(state.git)
        || !MEMORY_MODES.includes(state.memory)
        || !Array.isArray(state.harnesses)
        || state.harnesses.length === 0
        || new Set(state.harnesses).size !== state.harnesses.length
        || state.harnesses.some((name) => !HARNESSES.includes(name))
        || !state.assets
        || typeof state.assets !== "object"
        || Array.isArray(state.assets)
        || Object.keys(state.assets).length === 0) return incompleteDiagnosis();

    const recovery = `cairn setup . --git ${state.git} --harness ${state.harnesses.join(",")} --memory ${state.memory} --yes`;
    for (const [path, record] of Object.entries(state.assets)) {
      if (!safeStateAsset(path, record)) return incompleteDiagnosis(recovery);
      const destination = join(project, ...path.split("/"));
      if (!existsSync(destination)) return incompleteDiagnosis(recovery);
      const info = lstatSync(destination);
      if (!info.isFile() || info.isSymbolicLink()) return incompleteDiagnosis(recovery);
      const digest = createHash("sha256").update(readFileSync(destination)).digest("hex");
      if (digest !== record.digest || (process.platform !== "win32" && (info.mode & 0o777) !== record.mode)) return incompleteDiagnosis(recovery);
    }
    const requiredAssets = [...COMMON_SETUP_ASSETS, ...requiredHarnessAssetPaths(state.harnesses, state.memory)];
    if (requiredAssets.some((path) => !Object.hasOwn(state.assets, path))) return incompleteDiagnosis(recovery);
    if (state.memory === "local" && state.harnesses.includes("codex") && !hasCodexMemoryConfig(project)) {
      return incompleteDiagnosis(recovery);
    }
    return Object.freeze({
      schema_version: 1,
      status: state.git === "none" ? "limited" : "complete",
      code: state.git === "none" ? "git-disabled" : "configured",
      recovery: Object.freeze([]),
    });
  } catch {
    return incompleteDiagnosis();
  }
}
