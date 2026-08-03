import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import {
    chmod,
    lstat,
    mkdir,
    mkdtemp,
    open,
    readFile,
    realpath,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { canonicalDigest, type EvalCommand, type EvalTaskSet } from "./eval-schema.js";
import { type EvalPlan, type EvalScheduleRow } from "./eval-plan.js";
import {
    EvalProcessError,
    runBoundedCommand,
    type BoundedCommandResult,
    type EvalProcessErrorCode,
} from "./eval-process.js";

type EvalTask = EvalTaskSet["tasks"][number];

export type EvalWorkspace = {
    observation_id: string;
    task_id: string;
    parent_path: string;
    source_path: string;
    workspace_path: string;
    notes_path: string;
    output_path: string;
    home_path: string;
    temp_path: string;
    source_revision: string;
    source_kind: "git" | "bundled_fake";
    repository_root: string | null;
    worktree_registered: boolean;
    task: EvalTask;
    prepare_program: string;
    verify_program: string;
};

export type EvalVerifierResult = {
    pass_state: "passed" | "failed" | "unknown";
    terminal_state: "completed" | "verifier_failed" | "cancelled";
    verifier_state: "completed" | "error" | "not_run";
    reason: string | null;
    process: BoundedCommandResult | null;
};

export type CreateEvalWorkspaceOptions = {
    plan: EvalPlan;
    row: EvalScheduleRow;
    temporary_root?: string;
};

export type EvalCommandExecutionOptions = {
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    kill_grace_ms?: number;
};

export type EvalVerifierOptions = EvalCommandExecutionOptions & {
    adapter_completed: boolean;
};

export type EvalWorkspaceCleanupResult = {
    status: "closed" | "failed";
    worktree_registration: "removed" | "not_applicable" | "failed";
    parent: "removed" | "failed";
};

export type EvalWorkspaceOverlay = {
    relative_path: string;
    content: string;
    digest: string;
};

const GIT_TIMEOUT_MS = 120_000;
const GIT_OUTPUT_LIMIT = 64 * 1024;
const CLEANUP_TIMEOUT_MS = 120_000;
const BINDING_LIMIT = 64 * 1024;

function isContained(root: string, candidate: string): boolean {
    const rel = relative(root, candidate);
    return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function assertPrivateDirectory(path: string): Promise<string> {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("unsafe_workspace_root");
    return realpath(path);
}

async function privateDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: false, mode: 0o700 });
    await chmod(path, 0o700);
}

async function gitCommand(
    repository: string,
    args: string[],
    stdoutMode: "raw" | "exit-only",
): Promise<BoundedCommandResult> {
    return runBoundedCommand({
        command: { program: "git", args: ["-C", repository, ...args] },
        cwd: repository,
        env: process.env,
        stdout_mode: stdoutMode,
        timeout_ms: GIT_TIMEOUT_MS,
        max_stdout_bytes: stdoutMode === "raw" ? GIT_OUTPUT_LIMIT : 0,
    });
}

function requireSuccessfulCommand(result: BoundedCommandResult, code: string): void {
    if (result.exit_code !== 0 || result.signal !== null || result.cleanup !== "closed") throw new Error(code);
}

async function verifyGitWorkspace(workspace: EvalWorkspace): Promise<void> {
    const head = await gitCommand(workspace.source_path, ["rev-parse", "--verify", "HEAD^{commit}"], "raw");
    requireSuccessfulCommand(head, "workspace_head_query_failed");
    if (head.stdout?.trim() !== workspace.source_revision) throw new Error("workspace_revision_mismatch");
    const status = await gitCommand(
        workspace.source_path,
        ["status", "--porcelain", "--untracked-files=all"],
        "raw",
    );
    requireSuccessfulCommand(status, "workspace_status_query_failed");
    if (status.stdout?.trim() !== "") throw new Error("workspace_not_clean");
}

async function validateBundledBinding(plan: EvalPlan): Promise<void> {
    if (plan.source.kind !== "bundled_fake" || plan.task_set.source.kind !== "bundled_fake") {
        throw new Error("bundled_source_mismatch");
    }
    if (canonicalDigest(plan.task_set) !== plan.task_set_digest) throw new Error("task_set_digest_mismatch");
    let handle;
    let binding: unknown;
    try {
        handle = await open(plan.source.binding_path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const info = await handle.stat();
        if (!info.isFile() || info.size > BINDING_LIMIT) throw new Error("unsafe_bundled_binding");
        const bytes = await handle.readFile();
        if (bytes.byteLength > BINDING_LIMIT) throw new Error("unsafe_bundled_binding");
        binding = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
        throw new Error("invalid_bundled_binding");
    } finally {
        await handle?.close().catch(() => undefined);
    }
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new Error("invalid_bundled_binding");
    const record = binding as Record<string, unknown>;
    if (canonicalDigest(Object.keys(record).sort()) !== canonicalDigest([
        "identifier", "package_version", "schema_version", "task_set_digest",
    ])
        || record.schema_version !== plan.schema_version
        || record.identifier !== plan.source.identifier
        || record.package_version !== plan.source.package_version
        || record.task_set_digest !== plan.task_set_digest) {
        throw new Error("bundled_binding_mismatch");
    }
}

async function materializeBundledSource(plan: EvalPlan, sourcePath: string): Promise<void> {
    await validateBundledBinding(plan);
    if (plan.task_set.source.kind !== "bundled_fake") throw new Error("bundled_source_mismatch");
    await privateDirectory(sourcePath);
    for (const file of plan.task_set.source.files) {
        const destination = resolve(sourcePath, file.path);
        if (!isContained(sourcePath, destination) || destination === sourcePath) throw new Error("bundled_path_escape");
        const segments = relative(sourcePath, dirname(destination)).split(sep).filter(Boolean);
        let parent = sourcePath;
        for (const segment of segments) {
            parent = join(parent, segment);
            if (!isContained(sourcePath, parent)) throw new Error("bundled_path_escape");
            if (!existsSync(parent)) await privateDirectory(parent);
            else if ((await lstat(parent)).isSymbolicLink() || !(await lstat(parent)).isDirectory()) {
                throw new Error("bundled_path_unsafe");
            }
        }
        await writeFile(destination, Buffer.from(file.content, "utf8"), { flag: "wx", mode: 0o600 });
        const info = await lstat(destination);
        if (info.isSymbolicLink() || !info.isFile()) throw new Error("bundled_path_unsafe");
        if (!Buffer.from(file.content, "utf8").equals(await readFile(destination))) throw new Error("bundled_source_mismatch");
    }
    if (canonicalDigest(plan.task_set) !== plan.task_set_digest) throw new Error("task_set_digest_mismatch");
}

function workspaceEnvironment(workspace: EvalWorkspace, extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return {
        ...process.env,
        ...extra,
        HOME: workspace.home_path,
        TMPDIR: workspace.temp_path,
        XDG_CACHE_HOME: join(workspace.home_path, ".cache"),
        XDG_CONFIG_HOME: join(workspace.home_path, ".config"),
        XDG_DATA_HOME: join(workspace.home_path, ".local", "share"),
    };
}

export async function createEvalWorkspace(options: CreateEvalWorkspaceOptions): Promise<EvalWorkspace> {
    const taskIndex = options.plan.task_set.tasks.findIndex((candidate) => candidate.id === options.row.task_id);
    if (taskIndex < 0) throw new Error("unknown_schedule_task");
    const task = options.plan.task_set.tasks[taskIndex];
    if (!task) throw new Error("unknown_schedule_task");
    const root = await assertPrivateDirectory(resolve(options.temporary_root ?? tmpdir()));
    const parent = await mkdtemp(join(root, "cairn-eval-workspace-"));
    await chmod(parent, 0o700);
    const workspace: EvalWorkspace = {
        observation_id: options.row.observation_id,
        task_id: task.id,
        parent_path: parent,
        source_path: join(parent, "source"),
        workspace_path: "",
        notes_path: join(parent, "notes"),
        output_path: join(parent, "output"),
        home_path: join(parent, "home"),
        temp_path: join(parent, "tmp"),
        source_revision: options.plan.source.kind === "git" ? options.plan.source.revision : options.plan.task_set_digest,
        source_kind: options.plan.source.kind,
        repository_root: options.plan.source.kind === "git" ? options.plan.source.repository_root : null,
        worktree_registered: false,
        task,
        prepare_program: options.plan.resolved_programs.prepare[taskIndex] ?? task.prepare.program,
        verify_program: options.plan.resolved_programs.verify[taskIndex] ?? task.verify.program,
    };
    try {
        if (options.plan.source.kind === "git") {
            const added = await gitCommand(
                options.plan.source.repository_root,
                ["worktree", "add", "--quiet", "--detach", workspace.source_path, options.plan.source.revision],
                "exit-only",
            );
            requireSuccessfulCommand(added, "workspace_add_failed");
            workspace.worktree_registered = true;
            await verifyGitWorkspace(workspace);
        } else {
            await materializeBundledSource(options.plan, workspace.source_path);
        }
        workspace.workspace_path = resolve(workspace.source_path, task.workspace.path);
        if (!isContained(workspace.source_path, workspace.workspace_path)) throw new Error("workspace_path_escape");
        const realTaskRoot = await assertPrivateDirectory(workspace.workspace_path);
        if (!isContained(await realpath(workspace.source_path), realTaskRoot)) throw new Error("workspace_path_escape");
        workspace.workspace_path = realTaskRoot;
        for (const directory of [workspace.notes_path, workspace.output_path, workspace.home_path, workspace.temp_path]) {
            await privateDirectory(directory);
        }
        return workspace;
    } catch (error) {
        await cleanupEvalWorkspace(workspace).catch(() => undefined);
        throw error;
    }
}

export async function runTaskPreparation(
    workspace: EvalWorkspace,
    options: EvalCommandExecutionOptions = {},
): Promise<BoundedCommandResult> {
    return runBoundedCommand({
        command: { program: workspace.prepare_program, args: workspace.task.prepare.args },
        cwd: workspace.workspace_path,
        env: workspaceEnvironment(workspace, options.env),
        stdout_mode: "exit-only",
        timeout_ms: workspace.task.limits.elapsed_ms,
        max_stdout_bytes: 0,
        kill_grace_ms: options.kill_grace_ms,
        signal: options.signal,
    });
}

export async function applyEvalWorkspaceOverlay(
    workspace: EvalWorkspace,
    overlay: EvalWorkspaceOverlay,
): Promise<void> {
    const segments = overlay.relative_path.split("/");
    if (overlay.relative_path.startsWith("/") || overlay.relative_path.endsWith("/")
        || overlay.relative_path.includes("\\") || segments.some((segment) => segment === "" || segment === "." || segment === "..")
        || /[\u0000-\u001f\u007f]/.test(overlay.relative_path)) {
        throw new Error("workspace_overlay_path_invalid");
    }
    const target = resolve(workspace.source_path, overlay.relative_path);
    if (!isContained(workspace.source_path, target) || target === workspace.source_path) {
        throw new Error("workspace_overlay_path_escape");
    }
    let cursor = workspace.source_path;
    for (const segment of segments.slice(0, -1)) {
        cursor = join(cursor, segment);
        try {
            const info = await lstat(cursor);
            if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("workspace_overlay_parent_unsafe");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            await mkdir(cursor, { mode: 0o700 });
        }
    }
    try {
        const info = await lstat(target);
        if (info.isSymbolicLink() || !info.isFile()) throw new Error("workspace_overlay_target_unsafe");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = await realpath(dirname(target));
    const source = await realpath(workspace.source_path);
    if (!isContained(source, parent)) throw new Error("workspace_overlay_parent_escape");
    const bytes = Buffer.from(overlay.content, "utf8");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== overlay.digest) throw new Error("workspace_overlay_digest_mismatch");
    await writeFile(target, bytes, { mode: 0o600 });
    await chmod(target, 0o600);
    const storedDigest = createHash("sha256").update(await readFile(target)).digest("hex");
    if (storedDigest !== overlay.digest) throw new Error("workspace_overlay_write_mismatch");
}

function verifierReason(code: EvalProcessErrorCode): string {
    return `verifier_${code}`;
}

export async function runTaskVerifier(
    workspace: EvalWorkspace,
    options: EvalVerifierOptions,
): Promise<EvalVerifierResult> {
    if (!options.adapter_completed) {
        return {
            pass_state: "unknown",
            terminal_state: "completed",
            verifier_state: "not_run",
            reason: "adapter_not_completed",
            process: null,
        };
    }
    try {
        const result = await runBoundedCommand({
            command: { program: workspace.verify_program, args: workspace.task.verify.args },
            cwd: workspace.workspace_path,
            env: workspaceEnvironment(workspace, options.env),
            stdout_mode: "exit-only",
            timeout_ms: workspace.task.limits.elapsed_ms,
            max_stdout_bytes: 0,
            kill_grace_ms: options.kill_grace_ms,
            signal: options.signal,
        });
        if (result.signal !== null || result.cleanup !== "closed" || result.exit_code === null) {
            return {
                pass_state: "unknown",
                terminal_state: "completed",
                verifier_state: "error",
                reason: result.signal !== null ? "verifier_signal" : "verifier_cleanup_failed",
                process: result,
            };
        }
        const passed = result.exit_code === 0;
        return {
            pass_state: passed ? "passed" : "failed",
            terminal_state: passed ? "completed" : "verifier_failed",
            verifier_state: "completed",
            reason: passed ? null : "verifier_nonzero",
            process: result,
        };
    } catch (error) {
        if (!(error instanceof EvalProcessError)) throw error;
        if (error.code === "cancelled") {
            return {
                pass_state: "unknown",
                terminal_state: "cancelled",
                verifier_state: "error",
                reason: "verifier_cancelled",
                process: {
                    exit_code: error.exit_code,
                    signal: error.signal,
                    cleanup: error.cleanup,
                    termination_scope: error.termination_scope,
                },
            };
        }
        return {
            pass_state: "unknown",
            terminal_state: "completed",
            verifier_state: "error",
            reason: verifierReason(error.code),
            process: null,
        };
    }
}

async function removeParent(path: string): Promise<boolean> {
    try {
        const result = await runBoundedCommand({
            command: {
                program: process.execPath,
                args: ["-e", "import('node:fs/promises').then(fs=>fs.rm(process.argv[1],{recursive:true,force:true}))", path],
            },
            stdout_mode: "exit-only",
            timeout_ms: CLEANUP_TIMEOUT_MS,
            max_stdout_bytes: 0,
        });
        return result.exit_code === 0 && !existsSync(path);
    } catch {
        return false;
    }
}

export async function cleanupEvalWorkspace(workspace: EvalWorkspace): Promise<EvalWorkspaceCleanupResult> {
    let registration: EvalWorkspaceCleanupResult["worktree_registration"] = "not_applicable";
    if (workspace.worktree_registered && workspace.repository_root) {
        try {
            const removed = await gitCommand(
                workspace.repository_root,
                ["worktree", "remove", "--force", workspace.source_path],
                "exit-only",
            );
            registration = removed.exit_code === 0 ? "removed" : "failed";
        } catch {
            registration = "failed";
        }
    }
    const parentRemoved = await removeParent(workspace.parent_path);
    if (workspace.worktree_registered && workspace.repository_root && registration === "failed") {
        try {
            await gitCommand(workspace.repository_root, ["worktree", "prune", "--expire", "now"], "exit-only");
            const listed = await gitCommand(workspace.repository_root, ["worktree", "list", "--porcelain"], "raw");
            if (listed.exit_code === 0 && !listed.stdout?.includes(workspace.source_path)) registration = "removed";
        } catch {
            registration = "failed";
        }
    }
    return {
        status: parentRemoved && registration !== "failed" ? "closed" : "failed",
        worktree_registration: registration,
        parent: parentRemoved ? "removed" : "failed",
    };
}

export function evalWorkspaceCommand(workspace: EvalWorkspace, kind: "prepare" | "verify"): EvalCommand {
    return kind === "prepare"
        ? { program: workspace.prepare_program, args: [...workspace.task.prepare.args] }
        : { program: workspace.verify_program, args: [...workspace.task.verify.args] };
}
