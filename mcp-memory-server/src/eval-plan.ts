import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import {
    accessSync,
    closeSync,
    existsSync,
    fstatSync,
    lstatSync,
    openSync,
    readFileSync,
    realpathSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { CAPABILITY_IDS, type CapabilityId } from "./capability-schema.js";
import {
    EVAL_SCHEMA_VERSION,
    canonicalDigest,
    canonicalJson,
    evalAdapterConfigSchema,
    evalTaskSetSchema,
    type EvalAdapterConfig,
    type EvalTaskSet,
} from "./eval-schema.js";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_REPETITIONS = 1_000;
const truthyPattern = /^(?:1|true|yes|on)$/i;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const projectPackagePath = resolve(moduleDirectory, "..", "..", "package.json");
const bundledTaskSetPath = resolve(dirname(projectPackagePath), "examples", "eval", "task-set.json");

export type EvalArmPlan = {
    id: "baseline" | "treatment";
    disabled_capability: CapabilityId | null;
};

export type EvalScheduleRow = {
    schedule_index: number;
    observation_id: string;
    task_id: string;
    arm: "baseline" | "treatment";
    disabled_capability: CapabilityId | null;
    arm_order: number;
    repetition: number;
    pass: "run1" | "run2";
    seed: string;
    note_snapshot_task_id: string | null;
};

export type EvalSchedule = {
    concurrency: 1;
    invocation_count: number;
    digest: string;
    rows: EvalScheduleRow[];
};

export type EvalPlan = {
    schema_version: typeof EVAL_SCHEMA_VERSION;
    task_set: EvalTaskSet;
    adapter_config: EvalAdapterConfig;
    task_set_path: string;
    adapter_path: string;
    output_root: string;
    source: {
        kind: "git";
        repository_root: string;
        revision: string;
    } | {
        kind: "bundled_fake";
        identifier: "cairn-offline-fake-v1";
        package_version: string;
        binding_path: string;
    };
    repetitions: number;
    seed: string;
    arms: EvalArmPlan[];
    passes: ["run1", "run2"];
    concurrency: 1;
    invocation_count: number;
    task_set_commit: string | null;
    task_set_digest: string;
    adapter_config_digest: string;
    schedule_digest: string;
    plan_digest: string;
    schedule: EvalScheduleRow[];
    resolved_programs: {
        adapter: string;
        prepare: string[];
        verify: string[];
    };
};

export type ValidateEvalInputsOptions = {
    taskSetPath: string;
    adapterPath: string;
    outputRoot: string;
    repetitions?: number;
    seed?: string;
    arms?: EvalArmPlan[];
    cwd?: string;
};

type BoundedJson = { path: string; value: unknown; bytes: Buffer };

function isContained(root: string, candidate: string): boolean {
    const rel = relative(root, candidate);
    return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function assertRealDirectory(path: string, label: string): string {
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory.`);
    return realpathSync(path);
}

function readBoundedJson(path: string, label: string): BoundedJson {
    const absolute = resolve(path);
    const pathInfo = lstatSync(absolute);
    if (pathInfo.isSymbolicLink() || !pathInfo.isFile()) throw new Error(`${label} must be a regular non-symlink file.`);
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
    const descriptor = openSync(absolute, flags);
    try {
        const info = fstatSync(descriptor);
        if (!info.isFile() || info.size > MAX_INPUT_BYTES) throw new Error(`${label} exceeds the ${MAX_INPUT_BYTES}-byte limit.`);
        const bytes = readFileSync(descriptor);
        if (bytes.byteLength > MAX_INPUT_BYTES) throw new Error(`${label} exceeds the ${MAX_INPUT_BYTES}-byte limit.`);
        let value: unknown;
        try {
            value = JSON.parse(bytes.toString("utf8")) as unknown;
        } catch {
            throw new Error(`${label} is not valid JSON.`);
        }
        return { path: realpathSync(absolute), value, bytes };
    } finally {
        closeSync(descriptor);
    }
}

function git(repository: string, args: string[], label: string): string {
    const result = spawnSync("git", ["-C", repository, ...args], {
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        shell: false,
        windowsHide: true,
    });
    if (result.error || result.status !== 0) throw new Error(`${label} failed.`);
    return (result.stdout ?? "").trim();
}

function resolveExactCommit(repository: string, revision: string): string {
    const resolved = git(repository, ["rev-parse", "--verify", `${revision}^{commit}`], "Resolve evaluation source commit");
    if (resolved !== revision) throw new Error("Evaluation source revision must resolve exactly to the supplied full commit ID.");
    return resolved;
}

function parseCommittedTaskSet(taskSetPath: string): { taskSet: EvalTaskSet; commit: string } {
    const manifestRepository = assertRealDirectory(
        git(dirname(taskSetPath), ["rev-parse", "--show-toplevel"], "Resolve task-set repository"),
        "Task-set repository",
    );
    if (!isContained(manifestRepository, taskSetPath)) throw new Error("The task-set manifest must be contained by its Git repository.");
    const manifestPath = relative(manifestRepository, taskSetPath).split(sep).join("/");
    if (!manifestPath || manifestPath.startsWith("../")) throw new Error("The task-set manifest path is invalid.");
    git(manifestRepository, ["ls-files", "--error-unmatch", "--", manifestPath], "Require a tracked evaluation task set");
    const dirty = git(manifestRepository, ["status", "--porcelain", "--untracked-files=all", "--", manifestPath], "Check evaluation task set status");
    if (dirty !== "") throw new Error("Evaluation task set must be committed and unchanged.");
    const commit = git(manifestRepository, ["rev-parse", "--verify", "HEAD^{commit}"], "Resolve task-set commit");
    const committed = git(manifestRepository, ["show", `${commit}:${manifestPath}`], "Read committed evaluation task set");
    let value: unknown;
    try {
        value = JSON.parse(committed) as unknown;
    } catch {
        throw new Error("The committed evaluation task set is not valid JSON.");
    }
    return { taskSet: evalTaskSetSchema.parse(value), commit };
}

function resolveWorkspaceDirectories(taskSet: EvalTaskSet, repository: string, revision: string): void {
    for (const task of taskSet.tasks) {
        const candidate = resolve(repository, task.workspace.path);
        if (!isContained(repository, candidate)) throw new Error(`Task ${task.id} workspace escapes the declared repository.`);
        const object = task.workspace.path === "." ? `${revision}^{tree}` : `${revision}:${task.workspace.path}`;
        const kind = git(repository, ["cat-file", "-t", object], `Resolve task ${task.id} workspace`);
        if (kind !== "tree") throw new Error(`Task ${task.id} workspace is not a committed directory.`);
    }
}

function resolvePathProgram(program: string, base: string): string {
    const candidate = isAbsolute(program) ? program : resolve(base, program);
    const info = lstatSync(candidate);
    if (!info.isFile() && !info.isSymbolicLink()) throw new Error(`Evaluation program is not a file: ${program}`);
    accessSync(candidate, constants.X_OK);
    return realpathSync(candidate);
}

function resolveProgram(program: string, base: string): string {
    if (isAbsolute(program) || program.includes("/") || program.includes("\\")) return resolvePathProgram(program, base);
    for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
        const candidate = join(directory, program);
        try {
            accessSync(candidate, constants.X_OK);
            if (lstatSync(candidate).isFile() || lstatSync(candidate).isSymbolicLink()) return realpathSync(candidate);
        } catch {
            // Continue through PATH without executing the candidate.
        }
    }
    throw new Error(`Evaluation program was not found on PATH: ${program}`);
}

function validateOutputRoot(path: string): string {
    const absolute = resolve(path);
    let parent = absolute;
    while (!existsSync(parent)) {
        const next = dirname(parent);
        if (next === parent) throw new Error("Evaluation output has no existing parent directory.");
        parent = next;
    }
    const realParent = assertRealDirectory(parent, "Evaluation output parent");
    accessSync(realParent, constants.W_OK | constants.X_OK);
    if (existsSync(absolute)) {
        const realOutput = assertRealDirectory(absolute, "Evaluation output root");
        if (!isContained(realParent, realOutput) && realParent !== realOutput) {
            throw new Error("Evaluation output root resolves outside its writable parent.");
        }
    }
    return absolute;
}

function packageVersion(): string {
    const value = readBoundedJson(projectPackagePath, "Installed package manifest").value;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Installed package version is invalid.");
    }
    const record = value as Record<string, unknown>;
    if (typeof record.version !== "string" || record.version.length < 1 || record.version.length > 128) {
        throw new Error("Installed package version is invalid.");
    }
    return record.version;
}

function validateBundledBinding(taskSetPath: string, taskSet: EvalTaskSet, taskSetBytes: Buffer): EvalPlan["source"] {
    if (taskSet.source.kind !== "bundled_fake") throw new Error("Bundled binding requires the dedicated bundled source.");
    if (!existsSync(bundledTaskSetPath) || realpathSync(taskSetPath) !== realpathSync(bundledTaskSetPath)) {
        throw new Error("The bundled evaluation source is accepted only from the installed package-owned task set.");
    }
    if (!taskSetBytes.equals(Buffer.from(`${canonicalJson(taskSet)}\n`, "utf8"))) {
        throw new Error("The bundled evaluation task set must use its exact canonical bytes.");
    }
    const bindingPath = join(dirname(taskSetPath), "bundled-fake.json");
    const binding = readBoundedJson(bindingPath, "Bundled evaluation binding").value;
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new Error("Bundled evaluation binding is invalid.");
    const record = binding as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (canonicalJson(keys) !== canonicalJson(["identifier", "package_version", "schema_version", "task_set_digest"])) {
        throw new Error("Bundled evaluation binding has unknown or missing fields.");
    }
    const installedVersion = packageVersion();
    if (record.schema_version !== EVAL_SCHEMA_VERSION
        || record.identifier !== "cairn-offline-fake-v1"
        || record.package_version !== installedVersion
        || record.task_set_digest !== canonicalDigest(taskSet)) {
        throw new Error("Bundled evaluation binding does not match the installed package and committed task set.");
    }
    return {
        kind: "bundled_fake",
        identifier: "cairn-offline-fake-v1",
        package_version: installedVersion,
        binding_path: realpathSync(bindingPath),
    };
}

function validateArms(arms: EvalArmPlan[]): EvalArmPlan[] {
    if (arms.length < 1 || arms.length > 2) throw new Error("Evaluation requires one or two arms.");
    const seen = new Set<string>();
    return arms.map((arm) => {
        if (arm.id !== "baseline" && arm.id !== "treatment") throw new Error("Evaluation arm is invalid.");
        if (seen.has(arm.id)) throw new Error("Evaluation arm IDs must be unique.");
        seen.add(arm.id);
        if (arm.disabled_capability !== null && !(CAPABILITY_IDS as readonly string[]).includes(arm.disabled_capability)) {
            throw new Error("Evaluation arm disables an unknown capability.");
        }
        if (arm.id === "baseline" && arm.disabled_capability !== null) throw new Error("Baseline cannot disable a capability.");
        if (arm.id === "treatment" && arm.disabled_capability === null) throw new Error("Treatment must disable exactly one capability.");
        return { id: arm.id, disabled_capability: arm.disabled_capability };
    });
}

function rowSeed(seed: string, repetition: number, taskId: string): string {
    return canonicalDigest({ seed, repetition, task_id: taskId }).slice(0, 32);
}

export function isEvalEnabled(value = process.env.CAIRN_EVAL): boolean {
    return truthyPattern.test(value?.trim() ?? "");
}

export function buildEvalSchedule(options: {
    taskSet: EvalTaskSet;
    arms: EvalArmPlan[];
    repetitions: number;
    passes: readonly ("run1" | "run2")[];
    seed: string;
}): EvalSchedule {
    const taskSet = evalTaskSetSchema.parse(options.taskSet);
    const arms = validateArms(options.arms);
    if (!Number.isSafeInteger(options.repetitions) || options.repetitions < 1 || options.repetitions > MAX_REPETITIONS) {
        throw new Error(`Evaluation repetitions must be an integer from 1 to ${MAX_REPETITIONS}.`);
    }
    if (options.seed.length < 1 || options.seed.length > 256) throw new Error("Evaluation seed is invalid.");
    if (options.passes.length !== 2 || options.passes[0] !== "run1" || options.passes[1] !== "run2") {
        throw new Error("Evaluation passes must be exactly run1 followed by run2.");
    }
    const rows: EvalScheduleRow[] = [];
    for (const [armOrder, arm] of arms.entries()) {
        for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
            for (const pass of options.passes) {
                for (const task of taskSet.tasks) {
                    const observationId = `${arm.id}-r${repetition}-${pass}-${task.id}`;
                    rows.push({
                        schedule_index: rows.length,
                        observation_id: observationId,
                        task_id: task.id,
                        arm: arm.id,
                        disabled_capability: arm.disabled_capability,
                        arm_order: armOrder,
                        repetition,
                        pass,
                        seed: rowSeed(options.seed, repetition, task.id),
                        note_snapshot_task_id: pass === "run2" ? task.id : null,
                    });
                }
            }
        }
    }
    const frozenRows = rows.map((row) => Object.freeze({ ...row }));
    return Object.freeze({
        concurrency: 1 as const,
        invocation_count: frozenRows.length,
        digest: canonicalDigest(frozenRows),
        rows: Object.freeze(frozenRows) as unknown as EvalScheduleRow[],
    });
}

export function validateEvalInputs(options: ValidateEvalInputsOptions): EvalPlan {
    const cwd = assertRealDirectory(resolve(options.cwd ?? process.cwd()), "Evaluation working directory");
    const taskInput = readBoundedJson(resolve(cwd, options.taskSetPath), "Evaluation task set");
    const adapterInput = readBoundedJson(resolve(cwd, options.adapterPath), "Evaluation adapter configuration");
    const parsedTaskSet = evalTaskSetSchema.parse(taskInput.value);
    const adapterConfig = evalAdapterConfigSchema.parse(adapterInput.value);
    let taskSet = parsedTaskSet;
    let taskSetCommit: string | null;
    let source: EvalPlan["source"];
    let repositoryRoot: string | undefined;
    if (parsedTaskSet.source.kind === "git") {
        const committed = parseCommittedTaskSet(taskInput.path);
        if (canonicalJson(committed.taskSet) !== canonicalJson(parsedTaskSet)) {
            throw new Error("Evaluation task set differs from its committed document.");
        }
        taskSet = committed.taskSet;
        taskSetCommit = committed.commit;
        const repositoryCandidate = resolve(dirname(taskInput.path), parsedTaskSet.source.repository);
        repositoryRoot = assertRealDirectory(repositoryCandidate, "Evaluation source repository");
        const revision = resolveExactCommit(repositoryRoot, parsedTaskSet.source.revision);
        resolveWorkspaceDirectories(taskSet, repositoryRoot, revision);
        source = { kind: "git", repository_root: repositoryRoot, revision };
    } else {
        source = validateBundledBinding(taskInput.path, taskSet, taskInput.bytes);
        taskSetCommit = null;
    }

    const repetitions = options.repetitions ?? 1;
    const seed = options.seed ?? "cairn-eval-v1";
    const arms = validateArms(options.arms ?? [{ id: "baseline", disabled_capability: null }]);
    const passes = ["run1", "run2"] as const;
    const schedule = buildEvalSchedule({ taskSet, arms, repetitions, passes, seed });
    const adapterBase = dirname(adapterInput.path);
    const workspaceBase = repositoryRoot ?? dirname(taskInput.path);
    const outputRoot = validateOutputRoot(resolve(cwd, options.outputRoot));
    const taskSetDigest = canonicalDigest(taskSet);
    const adapterConfigDigest = canonicalDigest(adapterConfig);
    const resolvedPrograms = {
        adapter: resolveProgram(adapterConfig.command.program, adapterBase),
        prepare: taskSet.tasks.map((task) => resolveProgram(task.prepare.program, workspaceBase)),
        verify: taskSet.tasks.map((task) => resolveProgram(task.verify.program, workspaceBase)),
    };
    const identity = {
        schema_version: EVAL_SCHEMA_VERSION,
        task_set_digest: taskSetDigest,
        adapter_config_digest: adapterConfigDigest,
        source,
        output_root: outputRoot,
        repetitions,
        seed,
        arms,
        passes,
        concurrency: 1,
        task_set_commit: taskSetCommit,
        schedule_digest: schedule.digest,
    };
    const plan: EvalPlan = {
        schema_version: EVAL_SCHEMA_VERSION,
        task_set: taskSet,
        adapter_config: adapterConfig,
        task_set_path: taskInput.path,
        adapter_path: adapterInput.path,
        output_root: outputRoot,
        source,
        repetitions,
        seed,
        arms,
        passes: ["run1", "run2"],
        concurrency: 1,
        invocation_count: schedule.invocation_count,
        task_set_commit: taskSetCommit,
        task_set_digest: taskSetDigest,
        adapter_config_digest: adapterConfigDigest,
        schedule_digest: schedule.digest,
        plan_digest: canonicalDigest(identity),
        schedule: schedule.rows,
        resolved_programs: resolvedPrograms,
    };
    return deepFreeze(plan);
}

function deepFreeze<T>(value: T): T {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    }
    return value;
}

export function loadEvalPlan(options: ValidateEvalInputsOptions): EvalPlan {
    return validateEvalInputs(options);
}
