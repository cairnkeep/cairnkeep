import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { open, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const SETUP_STATE_SCHEMA_VERSION = 1;

const HARNESSES = Object.freeze(["claude", "opencode", "pi", "kimi", "qwen"]);
const GIT_MODES = Object.freeze(["init", "existing", "none"]);
const MEMORY_MODES = Object.freeze(["local", "none"]);
const STATE_KEYS = Object.freeze(["schema_version", "cairnkeep_version", "git", "memory", "harnesses", "assets"]);
const ASSET_KEYS = Object.freeze(["digest", "mode", "template"]);
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const RELATIVE_PATH_PATTERN = /^\.(?:ai|planning|agentfs)\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const TEMPLATE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function hashSetupAsset(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid setup ${label}.`);
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== [...expected].sort().join(",")) throw new Error(`Invalid setup ${label}: unknown or missing fields.`);
}

function normalizeHarnesses(harnesses) {
  if (!Array.isArray(harnesses) || harnesses.length === 0 || harnesses.some((value) => typeof value !== "string" || !HARNESSES.includes(value))) {
    throw new Error("Invalid setup state harnesses.");
  }
  if (new Set(harnesses).size !== harnesses.length) throw new Error("Invalid setup state duplicate harnesses.");
  return HARNESSES.filter((name) => harnesses.includes(name));
}

function safeRelativePath(path) {
  return typeof path === "string"
    && path.length <= 512
    && !isAbsolute(path)
    && !path.includes("\\")
    && RELATIVE_PATH_PATTERN.test(path)
    && !path.split("/").includes("..");
}

function normalizeState(state) {
  exactKeys(state, STATE_KEYS, "state");
  if (state.schema_version !== SETUP_STATE_SCHEMA_VERSION) throw new Error("Invalid setup state schema version.");
  if (typeof state.cairnkeep_version !== "string" || state.cairnkeep_version.length === 0 || state.cairnkeep_version.length > 128) {
    throw new Error("Invalid setup state version.");
  }
  if (!GIT_MODES.includes(state.git) || !MEMORY_MODES.includes(state.memory)) throw new Error("Invalid setup state mode.");
  const harnesses = normalizeHarnesses(state.harnesses);
  if (!state.assets || typeof state.assets !== "object" || Array.isArray(state.assets)) throw new Error("Invalid setup state assets.");
  const assets = {};
  for (const path of Object.keys(state.assets).sort()) {
    if (!safeRelativePath(path) || path === ".ai/cairnkeep.json") throw new Error("Invalid or unsafe setup state asset path.");
    const record = state.assets[path];
    exactKeys(record, ASSET_KEYS, "state asset record");
    if (!DIGEST_PATTERN.test(record.digest)
        || !Number.isInteger(record.mode) || record.mode < 0 || record.mode > 0o777
        || typeof record.template !== "string" || !TEMPLATE_PATTERN.test(record.template)) {
      throw new Error("Invalid setup state asset record.");
    }
    assets[path] = { digest: record.digest, mode: record.mode, template: record.template };
  }
  return { schema_version: SETUP_STATE_SCHEMA_VERSION, cairnkeep_version: state.cairnkeep_version, git: state.git, memory: state.memory, harnesses, assets };
}

function assertContained(target, path) {
  const absolute = resolve(target, ...path.split("/"));
  const rel = relative(target, absolute);
  if (!safeRelativePath(path) || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Unsafe setup asset path: ${path}.`);
  return absolute;
}

function assertExistingAncestors(target, destination) {
  const targetInfo = lstatSync(target);
  if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) throw new Error("Setup target must be a regular directory.");
  const segments = relative(target, dirname(destination)).split(/[\\/]/).filter(Boolean);
  let cursor = target;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) break;
    const info = lstatSync(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe setup asset ancestor: ${relative(target, cursor)}.`);
  }
  if (existsSync(destination)) {
    const destinationInfo = lstatSync(destination);
    if (!destinationInfo.isFile() || destinationInfo.isSymbolicLink()) throw new Error(`Unsafe setup asset destination: ${relative(target, destination)}.`);
  }
}

function validateAsset(asset, target, selectedHarnesses) {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) throw new Error("Invalid setup asset.");
  if (asset.harness && !selectedHarnesses.includes(asset.harness)) return null;
  if (asset.harness && !HARNESSES.includes(asset.harness)) throw new Error("Invalid setup asset harness.");
  if (!safeRelativePath(asset.path) || asset.path === ".ai/cairnkeep.json") throw new Error(`Unsafe setup asset path: ${asset.path}.`);
  if (!Buffer.isBuffer(asset.bytes) && !(asset.bytes instanceof Uint8Array)) throw new Error(`Invalid setup asset bytes: ${asset.path}.`);
  if (!Number.isInteger(asset.mode) || ![0o600, 0o644, 0o755].includes(asset.mode)) throw new Error(`Invalid setup asset mode: ${asset.path}.`);
  if (typeof asset.template !== "string" || !TEMPLATE_PATTERN.test(asset.template)) throw new Error(`Invalid setup asset template: ${asset.path}.`);
  const destination = assertContained(target, asset.path);
  return Object.freeze({
    path: asset.path,
    destination,
    bytes: Buffer.from(asset.bytes),
    digest: hashSetupAsset(asset.bytes),
    mode: asset.mode,
    template: asset.template,
  });
}

function validateTargetAncestors(target) {
  const segments = resolve(target).split(/[\\/]/).filter(Boolean);
  let cursor = resolve(target).startsWith("/") ? "/" : `${segments.shift()}\\`;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) return;
    const info = lstatSync(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe setup target ancestor: ${cursor}.`);
  }
}

function createTargetChain(target) {
  const absolute = resolve(target);
  const segments = absolute.split(/[\\/]/).filter(Boolean);
  let cursor = absolute.startsWith("/") ? "/" : `${segments.shift()}\\`;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    if (existsSync(cursor)) {
      const info = lstatSync(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe setup target ancestor: ${cursor}.`);
    } else mkdirSync(cursor, { mode: cursor === absolute ? 0o755 : 0o700 });
  }
}

function safeMkdirChain(target, directory) {
  const segments = relative(target, directory).split(/[\\/]/).filter(Boolean);
  let cursor = target;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    if (existsSync(cursor)) {
      const info = lstatSync(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe setup directory: ${relative(target, cursor)}.`);
    } else mkdirSync(cursor, { mode: 0o700 });
  }
}

async function defaultAtomicReplace(source, destination) {
  if (process.platform !== "win32") {
    await rename(source, destination);
    return;
  }
  let lastError = "Windows atomic setup replacement failed.";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (!existsSync(destination)) {
      try {
        await rename(source, destination);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25 * (attempt + 1)));
        continue;
      }
    }
    const backup = `${destination}.replace-backup-${randomUUID()}`;
    try {
      const result = spawnSync("powershell.exe", [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
        "[IO.File]::Replace($env:CK_INTERNAL_ATOMIC_SOURCE,$env:CK_INTERNAL_ATOMIC_DESTINATION,$env:CK_INTERNAL_ATOMIC_BACKUP,$true)",
      ], {
        encoding: "utf8",
        windowsHide: true,
        shell: false,
        env: {
          ...process.env,
          CK_INTERNAL_ATOMIC_SOURCE: source,
          CK_INTERNAL_ATOMIC_DESTINATION: destination,
          CK_INTERNAL_ATOMIC_BACKUP: backup,
        },
      });
      if (result.status === 0) return;
      lastError = result.stderr.trim() || result.stdout.trim() || lastError;
    } finally {
      rmSync(backup, { force: true });
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25 * (attempt + 1)));
  }
  throw new Error(lastError);
}

function hardenPrivatePath(path) {
  if (process.platform !== "win32") {
    chmodSync(path, lstatSync(path).isDirectory() ? 0o700 : 0o600);
    return;
  }
  const identity = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true, shell: false });
  const sid = identity.stdout.match(/"(S-1-[0-9-]+)"/i)?.[1];
  if (identity.status !== 0 || !sid) throw new Error("Unable to resolve the current Windows security identity.");
  const result = spawnSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `*${sid}:(F)`, "/grant:r", "*S-1-5-18:(F)", "/grant:r", "*S-1-5-32-544:(F)"], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) throw new Error("Unable to restrict private setup state.");
}

async function atomicWrite(path, bytes, mode, atomicReplace = defaultAtomicReplace, privateState = false) {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", mode);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    chmodSync(temporary, mode);
    if (privateState) hardenPrivatePath(temporary);
    await atomicReplace(temporary, path);
    chmodSync(path, mode);
    if (privateState) hardenPrivatePath(path);
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    rmSync(temporary, { force: true });
  }
}

function readPriorState(statePath) {
  if (!existsSync(statePath)) return null;
  const info = lstatSync(statePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error("Existing setup state is unsafe.");
  let descriptor;
  try {
    descriptor = openSync(statePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size > 1024 * 1024) {
      throw new Error("Existing setup state changed during validation.");
    }
    return normalizeState(JSON.parse(readFileSync(descriptor, "utf8")));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export async function writeSetupStateAtomic(path, state, options = {}) {
  const normalized = normalizeState(state);
  const directory = dirname(path);
  const target = dirname(directory);
  if (basename(directory) !== ".ai" || basename(path) !== "cairnkeep.json") throw new Error("Setup state path is unsafe.");
  if (!existsSync(target)) throw new Error("Setup state target does not exist.");
  assertExistingAncestors(target, path);
  safeMkdirChain(target, directory);
  const bytes = Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  if (existsSync(path) && readFileSync(path).equals(bytes) && (statSync(path).mode & 0o777) === 0o600) return normalized;
  await atomicWrite(path, bytes, 0o600, options.atomicReplace ?? defaultAtomicReplace, true);
  return normalized;
}

export async function reconcileSetupPlan(plan, options = {}) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("Invalid setup plan.");
  const target = resolve(plan.target);
  validateTargetAncestors(target);
  if (typeof plan.version !== "string" || !GIT_MODES.includes(plan.git) || !MEMORY_MODES.includes(plan.memory)) throw new Error("Invalid setup plan modes.");
  const harnesses = normalizeHarnesses(plan.harnesses);
  if (!Array.isArray(plan.assets)) throw new Error("Invalid setup plan assets.");
  const selected = plan.assets.map((asset) => validateAsset(asset, target, harnesses)).filter(Boolean);
  const paths = selected.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) throw new Error("Setup plan contains duplicate asset paths.");
  createTargetChain(target);
  const targetInfo = lstatSync(target);
  if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) throw new Error("Setup target is unsafe.");
  for (const asset of selected) assertExistingAncestors(target, asset.destination);
  const statePath = join(target, ".ai", "cairnkeep.json");
  assertExistingAncestors(target, statePath);
  const previousState = options.previousState === undefined ? readPriorState(statePath) : options.previousState === null ? null : normalizeState(options.previousState);

  const decisions = selected.map((asset) => {
    if (!existsSync(asset.destination)) return { ...asset, status: "created" };
    const currentInfo = lstatSync(asset.destination);
    if (!currentInfo.isFile() || currentInfo.isSymbolicLink()) throw new Error(`Unsafe setup asset destination: ${asset.path}.`);
    const currentDigest = hashSetupAsset(readFileSync(asset.destination));
    const currentMode = currentInfo.mode & 0o777;
    if (currentDigest === asset.digest && currentMode === asset.mode) return { ...asset, status: "unchanged" };
    const prior = previousState?.assets?.[asset.path];
    if (prior && prior.digest === currentDigest && prior.mode === currentMode) return { ...asset, status: "updated" };
    return { ...asset, status: "skipped" };
  });

  for (const decision of decisions) {
    if (decision.status !== "created" && decision.status !== "updated") continue;
    safeMkdirChain(target, dirname(decision.destination));
    await atomicWrite(decision.destination, decision.bytes, decision.mode, options.atomicReplace ?? defaultAtomicReplace, decision.mode === 0o600);
  }

  const assets = {};
  for (const decision of decisions) {
    if (decision.status === "skipped") {
      const prior = previousState?.assets?.[decision.path];
      if (prior) assets[decision.path] = prior;
      continue;
    }
    assets[decision.path] = { digest: decision.digest, mode: decision.mode, template: decision.template };
  }
  const state = normalizeState({
    schema_version: SETUP_STATE_SCHEMA_VERSION,
    cairnkeep_version: plan.version,
    git: plan.git,
    memory: plan.memory,
    harnesses,
    assets,
  });
  await writeSetupStateAtomic(statePath, state, { atomicReplace: options.atomicReplace ?? defaultAtomicReplace });
  const counts = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
  const changes = decisions.map(({ path, status }) => {
    counts[status] += 1;
    return Object.freeze({ path, status });
  });
  return Object.freeze({ counts: Object.freeze(counts), changes: Object.freeze(changes), state: Object.freeze(state) });
}
