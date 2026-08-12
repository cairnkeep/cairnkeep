import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { accessSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_ROOT = join(ROOT, "templates");
const POLICY_LIMIT_BYTES = 1024 * 1024;
const GIT_MODES = Object.freeze(["init", "existing", "none"]);
const HARNESSES = Object.freeze(["claude", "opencode", "pi", "kimi", "qwen"]);
const MEMORY_MODES = Object.freeze(["local", "none"]);

const COMMON_ASSETS = Object.freeze([
  ["env.example.template", ".ai/env.example", 0o644],
  ["trajectory-redaction.json.template", ".ai/trajectory-redaction.json", 0o644],
  ["capabilities.json.template", ".ai/capabilities.json", 0o600],
  ["agentfs-gitignore.template", ".agentfs/.gitignore", 0o644],
  ["planning-config.json.template", ".planning/config.json", 0o644],
  ["project-brief.md.template", ".planning/PROJECT-BRIEF.md", 0o644],
  ["wiki-index.md.template", ".planning/wiki/index.md", 0o644],
  ["wiki-policy.md.template", ".planning/wiki/policy.md", 0o644],
  ["wiki-contradictions.md.template", ".planning/wiki/CONTRADICTIONS.md", 0o644],
  ["wiki-log.md.template", ".planning/wiki/LOG.md", 0o644],
  ["alignment-policy.md.template", ".planning/alignment/policy.md", 0o644],
  ["alignment-gap-register.yaml.template", ".planning/alignment/gap-register.yaml", 0o644],
  ["graph-policy.md.template", ".planning/graphs/policy.md", 0o644],
  ["graphs-gitignore.template", ".planning/graphs/.gitignore", 0o644],
  ["security-policy.md.template", ".planning/security/policy.md", 0o644],
]);

class SetupInputError extends Error {
  constructor(kind, message, status = 1) {
    super(message);
    this.name = "SetupInputError";
    this.kind = kind;
    this.status = status;
  }
}

function usage(message) {
  return new SetupInputError("usage", `${message} Usage: cairn setup PATH --git init|existing|none --harness LIST --memory local|none [--policy PATH] --yes [--json]`, 2);
}

function operational(kind, message) {
  return new SetupInputError(kind, message, 1);
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw operational("unsafe-policy", `Invalid setup policy ${label}.`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw operational("unsafe-policy", `Invalid setup policy: unknown ${label} field ${unknown.join(", ")}.`);
}

function enumValue(value, allowed, label, optional = false) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) throw operational("unsafe-policy", `Invalid setup policy ${label}; allowed values are ${allowed.join(", ")}.`);
  return value;
}

function enumArray(value, allowed, label, optional = false) {
  if (optional && value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !allowed.includes(item))) {
    throw operational("unsafe-policy", `Invalid setup policy ${label}; allowed values are ${allowed.join(", ")}.`);
  }
  if (new Set(value).size !== value.length) throw operational("unsafe-policy", `Invalid setup policy ${label}; duplicate values are not allowed.`);
  return allowed.filter((item) => value.includes(item));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function parsePolicy(value) {
  exactKeys(value, ["schema_version", "defaults", "constraints"], "root");
  if (value.schema_version !== 1) throw operational("unsafe-policy", "Invalid setup policy schema version; expected schema_version 1.");
  exactKeys(value.defaults, ["git", "harnesses", "memory"], "defaults");
  exactKeys(value.constraints, ["git", "harnesses", "required_harnesses", "memory"], "constraints");
  const policy = {
    schema_version: 1,
    defaults: {
      ...(value.defaults.git !== undefined ? { git: enumValue(value.defaults.git, GIT_MODES, "defaults.git") } : {}),
      ...(value.defaults.harnesses !== undefined ? { harnesses: enumArray(value.defaults.harnesses, HARNESSES, "defaults.harnesses") } : {}),
      ...(value.defaults.memory !== undefined ? { memory: enumValue(value.defaults.memory, MEMORY_MODES, "defaults.memory") } : {}),
    },
    constraints: {
      ...(value.constraints.git !== undefined ? { git: enumArray(value.constraints.git, GIT_MODES, "constraints.git") } : {}),
      ...(value.constraints.harnesses !== undefined ? { harnesses: enumArray(value.constraints.harnesses, HARNESSES, "constraints.harnesses") } : {}),
      ...(value.constraints.required_harnesses !== undefined ? { required_harnesses: enumArray(value.constraints.required_harnesses, HARNESSES, "constraints.required_harnesses") } : {}),
      ...(value.constraints.memory !== undefined ? { memory: enumArray(value.constraints.memory, MEMORY_MODES, "constraints.memory") } : {}),
    },
  };
  if (policy.defaults.git && policy.constraints.git && !policy.constraints.git.includes(policy.defaults.git)) {
    throw operational("unsafe-policy", "Invalid setup policy: defaults.git violates constraints.git.");
  }
  if (policy.defaults.memory && policy.constraints.memory && !policy.constraints.memory.includes(policy.defaults.memory)) {
    throw operational("unsafe-policy", "Invalid setup policy: defaults.memory violates constraints.memory.");
  }
  if (policy.defaults.harnesses && policy.constraints.harnesses
      && policy.defaults.harnesses.some((name) => !policy.constraints.harnesses.includes(name))) {
    throw operational("unsafe-policy", "Invalid setup policy: defaults.harnesses violates constraints.harnesses.");
  }
  if (policy.constraints.required_harnesses && policy.constraints.harnesses
      && policy.constraints.required_harnesses.some((name) => !policy.constraints.harnesses.includes(name))) {
    throw operational("unsafe-policy", "Invalid setup policy: required harnesses must be allowed by constraints.harnesses.");
  }
  return deepFreeze(policy);
}

export function readSetupPolicy(path, options = {}) {
  const lstat = options.lstat ?? lstatSync;
  const read = options.readFile ?? readFileSync;
  let info;
  try {
    info = lstat(path);
  } catch (error) {
    throw operational("unsafe-policy", `Setup policy could not be read: ${error instanceof Error ? error.message : String(error)}.`);
  }
  if (!info.isFile() || info.isSymbolicLink()) throw operational("unsafe-policy", "Setup policy must be a regular file, not a symbolic link or device.");
  if (info.size > POLICY_LIMIT_BYTES) throw operational("unsafe-policy", "Setup policy exceeds the size limit.");
  if (process.platform !== "win32" && (info.mode & 0o111) !== 0) throw operational("unsafe-policy", "Setup policy must not be executable.");
  let descriptor;
  let bytes;
  try {
    if (options.readFile) bytes = read(path);
    else {
      descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = fstatSync(descriptor);
      if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw operational("unsafe-policy", "Setup policy changed during validation.");
      if (opened.size > POLICY_LIMIT_BYTES || (process.platform !== "win32" && (opened.mode & 0o111) !== 0)) {
        throw operational("unsafe-policy", "Setup policy type, size, or executable mode is unsafe.");
      }
      bytes = read(descriptor);
    }
  } catch (error) {
    if (error instanceof SetupInputError) throw error;
    throw operational("unsafe-policy", `Setup policy could not be opened safely: ${error instanceof Error ? error.message : String(error)}.`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (bytes.byteLength > POLICY_LIMIT_BYTES) throw operational("unsafe-policy", "Setup policy exceeds the size limit.");
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw operational("unsafe-policy", "Invalid setup policy JSON syntax.");
  }
  return parsePolicy(parsed);
}

function parseHarnesses(raw) {
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || values.some((value) => !HARNESSES.includes(value)) || new Set(values).size !== values.length) {
    throw usage(`Invalid harness choice: ${raw || "missing"}.`);
  }
  return HARNESSES.filter((name) => values.includes(name));
}

export function parseSetupArgs(args, options = {}) {
  const isTTY = options.isTTY ?? Boolean(process.stdin.isTTY);
  const parsed = { target: null, git: null, harnesses: null, memory: null, policyPath: null, confirmed: false, json: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["--git", "--harness", "--memory", "--policy"].includes(arg)) {
      if (seen.has(arg)) throw usage(`Invalid duplicate ${arg} option.`);
      seen.add(arg);
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw usage(`Missing value for ${arg}.`);
      index += 1;
      if (arg === "--git") {
        if (!GIT_MODES.includes(value)) throw usage(`Invalid Git mode: ${value}.`);
        parsed.git = value;
      } else if (arg === "--harness") parsed.harnesses = parseHarnesses(value);
      else if (arg === "--memory") {
        if (!MEMORY_MODES.includes(value)) throw usage(`Invalid memory mode: ${value}.`);
        parsed.memory = value;
      } else parsed.policyPath = value;
    } else if (arg === "--yes" || arg === "--json") {
      if (seen.has(arg)) throw usage(`Invalid duplicate ${arg} option.`);
      seen.add(arg);
      if (arg === "--yes") parsed.confirmed = true;
      else parsed.json = true;
    } else if (arg.startsWith("-")) throw usage(`Unknown setup option: ${arg}.`);
    else if (parsed.target !== null) throw usage("Invalid extra target/path positional argument.");
    else parsed.target = arg;
  }
  if (!isTTY) {
    if (!parsed.target) throw usage("Missing setup target path.");
    const canUsePolicyDefaults = Boolean(parsed.policyPath);
    if (!canUsePolicyDefaults && !parsed.git) throw usage("Non-TTY setup requires an explicit Git choice.");
    if (!canUsePolicyDefaults && !parsed.harnesses) throw usage("Non-TTY setup requires an explicit harness choice.");
    if (!canUsePolicyDefaults && !parsed.memory) throw usage("Non-TTY setup requires an explicit memory choice.");
    if (!parsed.confirmed) throw usage("Non-TTY setup requires explicit confirmation with --yes.");
  }
  return deepFreeze(parsed);
}

function pathParts(path) {
  const result = [];
  let cursor = resolve(path);
  const root = parse(cursor).root;
  while (cursor !== root) {
    result.push(cursor);
    cursor = dirname(cursor);
  }
  result.push(root);
  return result.reverse();
}

export function classifySetupTarget(target, options = {}) {
  const lstat = options.lstat ?? lstatSync;
  const exists = options.exists ?? existsSync;
  const readdir = options.readdir ?? readdirSync;
  const realpath = options.realpath ?? realpathSync;
  const access = options.access ?? accessSync;
  const run = options.run ?? spawnSync;
  const absolute = resolve(target);
  let nearest = parse(absolute).root;
  for (const candidate of pathParts(absolute)) {
    if (!exists(candidate)) break;
    const info = lstat(candidate);
    if (info.isSymbolicLink()) throw operational("unsafe-target", "Setup target or an ancestor is a symbolic link and is unsafe.");
    if (!info.isDirectory()) throw operational("unsafe-target", "Setup target ancestor is not a regular directory.");
    nearest = candidate;
  }
  const targetExists = exists(absolute);
  const targetState = targetExists ? (readdir(absolute).length === 0 ? "empty" : "non-empty") : "missing";
  try {
    access(nearest, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch {
    throw operational("target-denied", "Setup target cannot be created or inspected because access to its parent is denied.");
  }
  const canonicalNearest = realpath(nearest);
  if (canonicalNearest !== nearest) throw operational("unsafe-target", "Setup target resolves through an unsafe ancestor.");

  const runOptions = { encoding: "utf8", shell: false };
  const version = run("git", ["--version"], runOptions);
  if (version.error?.code === "ENOENT") {
    return Object.freeze({ target: absolute, targetState, gitExecutable: "missing", repository: "unknown" });
  }
  if (version.error || version.status !== 0) {
    throw operational("git-probe", "Git availability could not be determined safely.");
  }
  const worktree = run("git", ["-C", targetExists ? absolute : nearest, "rev-parse", "--is-inside-work-tree"], runOptions);
  let repository = "none";
  if (worktree.error?.code === "ENOENT") return Object.freeze({ target: absolute, targetState, gitExecutable: "missing", repository: "unknown" });
  if (worktree.status === 0) repository = worktree.stdout.trim() === "true" ? "work-tree" : "bare";
  return Object.freeze({ target: absolute, targetState, gitExecutable: "available", repository });
}

function requiredChoice(value, name) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) throw usage(`Missing required ${name} choice.`);
  return value;
}

export function resolveSetupChoices({ parsed, preflight, policy = null, interactive = null }) {
  const git = requiredChoice(parsed.git ?? policy?.defaults?.git ?? interactive?.git, "Git");
  const harnesses = requiredChoice(parsed.harnesses ?? policy?.defaults?.harnesses ?? interactive?.harnesses, "harness");
  const memory = requiredChoice(parsed.memory ?? policy?.defaults?.memory ?? interactive?.memory, "memory");
  const confirmed = parsed.confirmed || interactive?.confirmed === true;
  if (!confirmed) throw usage("Missing setup confirmation; use --yes or confirm interactively.");
  if (!GIT_MODES.includes(git)) throw usage(`Invalid Git choice: ${git}.`);
  if (!Array.isArray(harnesses) || harnesses.length === 0 || harnesses.some((name) => !HARNESSES.includes(name))) throw usage("Invalid harness choice.");
  if (!MEMORY_MODES.includes(memory)) throw usage(`Invalid memory choice: ${memory}.`);
  const normalizedHarnesses = HARNESSES.filter((name) => harnesses.includes(name));
  if (git !== "none" && preflight.gitExecutable === "missing") throw operational("missing-git", `Git executable is required for --git ${git}.`);
  if (git === "existing" && preflight.repository !== "work-tree") throw operational("non-repository", "--git existing requires the target to be inside a Git work tree.");

  const constraints = policy?.constraints ?? {};
  if (constraints.git && !constraints.git.includes(git)) throw operational("policy-constraint", `Git choice ${git} violates policy constraints.`);
  if (constraints.memory && !constraints.memory.includes(memory)) throw operational("policy-constraint", `Memory choice ${memory} violates policy constraints.`);
  if (constraints.harnesses && normalizedHarnesses.some((name) => !constraints.harnesses.includes(name))) {
    throw operational("policy-constraint", "Harness choice violates policy constraints.");
  }
  const missingRequired = (constraints.required_harnesses ?? []).filter((name) => !normalizedHarnesses.includes(name));
  if (missingRequired.length) throw operational("policy-constraint", `Harness constraint requires ${missingRequired.join(", ")}.`);
  return deepFreeze({ git, harnesses: normalizedHarnesses, memory, confirmed: true, limited: git === "none" });
}

function templateAsset(template, path, mode, harness) {
  const asset = { path, bytes: readFileSync(join(TEMPLATE_ROOT, template)), mode, template, ...(harness ? { harness } : {}) };
  return Object.freeze(asset);
}

export function buildSetupPlan({ target, preflight, choices }) {
  const absolute = resolve(target);
  if (preflight.target && resolve(preflight.target) !== absolute) throw operational("unsafe-target", "Setup target changed after preflight.");
  if (!choices?.confirmed) throw usage("Missing setup confirmation before mutation planning.");
  if (choices.git === "existing" && preflight.repository !== "work-tree") throw operational("non-repository", "Existing Git mode requires a work tree.");
  if (choices.git !== "none" && preflight.gitExecutable === "missing") throw operational("missing-git", "The selected Git mode requires the Git executable.");
  const harnesses = HARNESSES.filter((name) => choices.harnesses.includes(name));
  const assets = [
    ...harnesses.map((harness) => templateAsset(`start-${harness}.sh.template`, `.ai/start-${harness}.sh`, 0o755, harness)),
    ...COMMON_ASSETS.map(([template, path, mode]) => templateAsset(template, path, mode)),
  ];
  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  return deepFreeze({
    target: absolute,
    targetState: preflight.targetState,
    version,
    git: choices.git,
    memory: choices.memory,
    harnesses,
    limited: choices.git === "none",
    assets: Object.freeze(assets),
  });
}
