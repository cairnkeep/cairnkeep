import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
    chmod,
    lstat,
    mkdir,
    open,
    readdir,
    realpath,
    rename,
    rm,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
    canonicalJson,
    evalReportSchema,
    type EvalReport,
} from "./eval-schema.js";

export type EvalReportStore = {
    root_path: string;
    experiment_path: string;
    report_path: string;
    experiment_id: string;
    max_report_bytes: number;
};

export type EvalReportDiagnosis = {
    state: "absent" | "ok" | "partial" | "tampered" | "unsafe";
    code: "report_absent" | "report_ok" | "report_partial" | "report_invalid" | "report_unsafe";
};

export type CreateEvalReportStoreOptions = {
    experiment_id: string;
    root?: string;
    project_root?: string;
    max_report_bytes?: number;
    max_experiments?: number;
};

export type EvalReportCheckpointFault =
    | "after_open"
    | "after_write"
    | "after_sync"
    | "after_close"
    | "after_rename";

export type CheckpointEvalReportOptions = {
    fault?: EvalReportCheckpointFault;
};

const DEFAULT_MAX_REPORT_BYTES = 16 * 1024 * 1024;
const MAX_ALLOWED_REPORT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_EXPERIMENTS = 10_000;
const EXPERIMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FORBIDDEN_FIELDS = new Set([
    "prompt",
    "model_output",
    "stdout",
    "stderr",
    "environment",
    "env",
    "error",
    "error_message",
    "request",
]);
const FORBIDDEN_SENTINELS = [
    "prompt-sentinel",
    "model-output-sentinel",
    "adapter-stderr-sentinel",
    "environment-sentinel",
];
const writeQueues = new Map<string, Promise<void>>();

function isContained(root: string, candidate: string): boolean {
    const rel = relative(root, candidate);
    return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function ensureSafeDirectory(path: string, privateMode = false): Promise<void> {
    try {
        const info = await lstat(path);
        if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("unsafe_report_directory");
        if (privateMode) await chmod(path, 0o700);
        return;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(path);
    if (parent === path) throw new Error("unsafe_report_directory");
    await ensureSafeDirectory(parent, false);
    await mkdir(path, { mode: 0o700 });
    await chmod(path, 0o700);
}

function assertLimits(maxReportBytes: number, maxExperiments: number): void {
    if (!Number.isSafeInteger(maxReportBytes) || maxReportBytes < 1 || maxReportBytes > MAX_ALLOWED_REPORT_BYTES) {
        throw new Error("invalid_report_limit");
    }
    if (!Number.isSafeInteger(maxExperiments) || maxExperiments < 1 || maxExperiments > DEFAULT_MAX_EXPERIMENTS) {
        throw new Error("invalid_experiment_limit");
    }
}

async function countExperiments(root: string, target: string, limit: number): Promise<void> {
    const entries = await readdir(root, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
        if (entry.name === basename(target)) continue;
        if (entry.isSymbolicLink()) throw new Error("unsafe_report_directory");
        if (entry.isDirectory()) count += 1;
        if (count >= limit) throw new Error("experiment_limit_reached");
    }
}

function assertNoSensitiveFields(value: unknown): void {
    if (typeof value === "string") {
        if (FORBIDDEN_SENTINELS.some((sentinel) => value.includes(sentinel))
            || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
            || /^Bearer\s+/i.test(value)) {
            throw new Error("sensitive_report_value");
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach(assertNoSensitiveFields);
        return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (FORBIDDEN_FIELDS.has(key)) throw new Error("sensitive_report_field");
        assertNoSensitiveFields(child);
    }
}

function validatedReport(value: unknown): EvalReport {
    assertNoSensitiveFields(value);
    const parsed = evalReportSchema.safeParse(value);
    if (!parsed.success) throw new Error("invalid_eval_report");
    return parsed.data;
}

async function readBoundedReport(store: EvalReportStore): Promise<Buffer | undefined> {
    let handle;
    try {
        handle = await open(store.report_path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > store.max_report_bytes) throw new Error("unsafe_eval_report");
        const bytes = await handle.readFile();
        if (bytes.byteLength > store.max_report_bytes) throw new Error("unsafe_eval_report");
        return bytes;
    } finally {
        await handle.close();
    }
}

async function withWriteQueue<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const prior = writeQueues.get(path) ?? Promise.resolve();
    let release = (): void => {};
    const turn = new Promise<void>((resolveTurn) => { release = resolveTurn; });
    const tail = prior.then(() => turn);
    writeQueues.set(path, tail);
    await prior;
    try {
        return await operation();
    } finally {
        release();
        if (writeQueues.get(path) === tail) writeQueues.delete(path);
    }
}

function injectFault(options: CheckpointEvalReportOptions, stage: EvalReportCheckpointFault): void {
    if (options.fault === stage) throw new Error(`injected_${stage}`);
}

export async function createEvalReportStore(options: CreateEvalReportStoreOptions): Promise<EvalReportStore> {
    if (!EXPERIMENT_PATTERN.test(options.experiment_id)) throw new Error("invalid_experiment_id");
    const maxReportBytes = options.max_report_bytes ?? DEFAULT_MAX_REPORT_BYTES;
    const maxExperiments = options.max_experiments ?? DEFAULT_MAX_EXPERIMENTS;
    assertLimits(maxReportBytes, maxExperiments);
    const projectRoot = resolve(options.project_root ?? process.cwd());
    const root = resolve(options.root ?? join(projectRoot, ".agentfs", "eval", "experiments"));
    if (options.root === undefined && !isContained(projectRoot, root)) throw new Error("report_root_escape");
    await ensureSafeDirectory(root, true);
    const realRoot = await realpath(root);
    const experimentPath = resolve(realRoot, options.experiment_id);
    if (!isContained(realRoot, experimentPath) || experimentPath === realRoot) throw new Error("report_path_escape");
    await countExperiments(realRoot, experimentPath, maxExperiments);
    await ensureSafeDirectory(experimentPath, true);
    const realExperiment = await realpath(experimentPath);
    if (!isContained(realRoot, realExperiment)) throw new Error("report_path_escape");
    return {
        root_path: realRoot,
        experiment_path: realExperiment,
        report_path: join(realExperiment, "report.json"),
        experiment_id: options.experiment_id,
        max_report_bytes: maxReportBytes,
    };
}

export async function checkpointEvalReport(
    store: EvalReportStore,
    report: EvalReport,
    options: CheckpointEvalReportOptions = {},
): Promise<void> {
    await withWriteQueue(store.report_path, async () => {
        const parsed = validatedReport(report);
        if (parsed.experiment_id !== store.experiment_id) throw new Error("report_experiment_mismatch");
        const bytes = Buffer.from(`${canonicalJson(parsed)}\n`, "utf8");
        if (bytes.byteLength > store.max_report_bytes) throw new Error("report_size_limit");
        const temporary = join(
            store.experiment_path,
            `.report.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
        );
        let handle;
        try {
            handle = await open(temporary, "wx", 0o600);
            injectFault(options, "after_open");
            await handle.writeFile(bytes);
            injectFault(options, "after_write");
            await handle.sync();
            injectFault(options, "after_sync");
            await handle.close();
            handle = undefined;
            injectFault(options, "after_close");
            await rename(temporary, store.report_path);
            await chmod(store.report_path, 0o600);
            injectFault(options, "after_rename");
        } finally {
            if (handle) await handle.close().catch(() => undefined);
            await rm(temporary, { force: true });
        }
    });
}

export async function readEvalReport(store: EvalReportStore): Promise<EvalReport | null> {
    const bytes = await readBoundedReport(store);
    if (!bytes) return null;
    let value: unknown;
    try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
        throw new Error("invalid_eval_report");
    }
    return validatedReport(value);
}

export async function diagnoseEvalReport(store: EvalReportStore): Promise<EvalReportDiagnosis> {
    try {
        const info = await lstat(store.report_path).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
        });
        if (!info) return { state: "absent", code: "report_absent" };
        if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o077) !== 0) {
            return { state: "unsafe", code: "report_unsafe" };
        }
        const report = await readEvalReport(store);
        if (!report) return { state: "absent", code: "report_absent" };
        return report.status === "partial"
            ? { state: "partial", code: "report_partial" }
            : { state: "ok", code: "report_ok" };
    } catch (error) {
        if (error instanceof Error && error.message === "unsafe_eval_report") {
            return { state: "unsafe", code: "report_unsafe" };
        }
        return { state: "tampered", code: "report_invalid" };
    }
}
