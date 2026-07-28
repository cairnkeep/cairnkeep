import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
    chmod,
    copyFile,
    lstat,
    mkdir,
    readFile,
    readdir,
    realpath,
    rm,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { CAPABILITY_IDS } from "./capability-schema.js";
import type { EvalPlan, EvalScheduleRow } from "./eval-plan.js";
import {
    canonicalDigest,
    evalReportSchema,
    type EvalCommand,
    type EvalObservation,
    type EvalReport,
} from "./eval-schema.js";
import {
    EvalProcessError,
    runBoundedCommand,
    runBoundedJsonAdapter,
    type BoundedCommandResult,
} from "./eval-process.js";
import {
    checkpointEvalReport,
    createEvalReportStore,
    type EvalReportStore,
} from "./eval-report.js";
import {
    cleanupEvalWorkspace,
    createEvalWorkspace,
    runTaskPreparation,
    runTaskVerifier,
    type EvalWorkspace,
} from "./eval-workspace.js";

export type NoteSnapshotOutcome = "success" | "no_notes" | "failed" | "skipped";

export type NoteSnapshot = {
    task_id: string;
    arm: "baseline" | "treatment";
    repetition: number;
    root_path: string;
    digest: string;
    manifest: Array<{ path: string; digest: string; bytes: number }>;
    distiller_id: string;
    distiller_config_digest: string;
    trajectory_ref: string;
};

export type DistillRunOneResult = {
    outcome: NoteSnapshotOutcome;
    eligibility_reason: string;
    distiller_id: string | null;
    distiller_config_digest: string | null;
    trajectory_ref: string | null;
    snapshot: NoteSnapshot | null;
};

export type TwoPassRunOptions = {
    plan: EvalPlan;
    report_store?: EvalReportStore;
    experiment_id?: string;
    temporary_root?: string;
    signal?: AbortSignal;
    distill_command?: EvalCommand;
    distill_timeout_ms?: number;
};

export type TwoPassRunResult = {
    report: EvalReport;
    report_store: EvalReportStore;
    snapshots: NoteSnapshot[];
};

type ObservationOptions = {
    plan: EvalPlan;
    row: EvalScheduleRow;
    report: EvalReport;
    report_store: EvalReportStore;
    temporary_root?: string;
    signal?: AbortSignal;
    snapshot?: NoteSnapshot | null;
    prior_notes?: EvalObservation["notes"];
    distill_command?: EvalCommand;
    distill_timeout_ms?: number;
};

type ObservationResult = {
    observation: EvalObservation;
    snapshot: NoteSnapshot | null;
    cancelled: boolean;
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DISTILLER_ID = "cairn-note-distiller-v1";
const DEFAULT_DISTILL_TIMEOUT_MS = 120_000;
const MAX_SNAPSHOT_FILES = 10_000;
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

function isContained(root: string, candidate: string): boolean {
    const rel = relative(root, candidate);
    return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(sep));
}

function sha256(value: Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}

function snapshotKey(row: EvalScheduleRow): string {
    return `${row.arm}:r${row.repetition}:${row.task_id}`;
}

function capabilityState(row: EvalScheduleRow): Array<{ id: (typeof CAPABILITY_IDS)[number]; enabled: boolean }> {
    return CAPABILITY_IDS.map((id) => ({ id, enabled: row.disabled_capability !== id }));
}

function capabilityDigest(rows: Array<{ id: (typeof CAPABILITY_IDS)[number]; enabled: boolean }>): string {
    return canonicalDigest({
        schema_version: 1,
        contract_enabled: true,
        capabilities: rows,
        logging: { callbacks: false },
    });
}

function emptyNotes(row: EvalScheduleRow, snapshot?: NoteSnapshot | null): EvalObservation["notes"] {
    if (row.pass === "run2" && snapshot) {
        return {
            distiller_id: snapshot.distiller_id,
            distiller_config_digest: snapshot.distiller_config_digest,
            trajectory_ref: snapshot.trajectory_ref,
            distillation_outcome: "success",
            eligibility_reason: "same_task_snapshot",
            note_snapshot_digest: snapshot.digest,
            note_snapshot_manifest: snapshot.manifest,
            notes_exposed: true,
        };
    }
    return {
        distiller_id: null,
        distiller_config_digest: null,
        trajectory_ref: null,
        distillation_outcome: row.pass === "run1" ? "not_applicable" : "skipped",
        eligibility_reason: row.pass === "run1" ? "pending_distillation" : "snapshot_unavailable",
        note_snapshot_digest: null,
        note_snapshot_manifest: [],
        notes_exposed: false,
    };
}

function pendingObservation(
    row: EvalScheduleRow,
    snapshot?: NoteSnapshot | null,
    priorNotes?: EvalObservation["notes"],
): EvalObservation {
    const capabilities = capabilityState(row);
    const expectedDigest = capabilityDigest(capabilities);
    return {
        schema_version: 1,
        observation_id: row.observation_id,
        task_id: row.task_id,
        schedule_index: row.schedule_index,
        arm: row.arm,
        disabled_capability: row.disabled_capability,
        arm_order: row.arm_order,
        repetition: row.repetition,
        pass: row.pass,
        seed: row.seed,
        state: "pending",
        terminal_state: null,
        process: { exit_code: null, signal: null, error_code: null, cleanup: "pending" },
        verifier: { state: "pending", reason: null },
        pass_state: "unknown",
        expected_capabilities: capabilities,
        observed_capabilities: capabilities,
        expected_capability_digest: expectedDigest,
        observed_capability_digest: null,
        capability_status: "pending",
        capability_digest_match: null,
        four_cell_id: `${row.arm}-r${row.repetition}-${row.task_id}`,
        notes: row.pass === "run2" && priorNotes
            ? {
                ...priorNotes,
                note_snapshot_manifest: [...priorNotes.note_snapshot_manifest],
                notes_exposed: snapshot !== null && snapshot !== undefined,
            }
            : emptyNotes(row, snapshot),
        result: null,
        missing_reasons: [],
    };
}

function commandProcess(result: BoundedCommandResult): EvalObservation["process"] {
    return {
        exit_code: result.exit_code,
        signal: result.signal as EvalObservation["process"]["signal"],
        error_code: null,
        cleanup: result.cleanup,
    };
}

function processError(error: EvalProcessError): EvalObservation["process"] {
    return {
        exit_code: error.exit_code,
        signal: error.signal as EvalObservation["process"]["signal"],
        error_code: error.code,
        cleanup: error.cleanup,
    };
}

function terminalForProcessError(code: EvalProcessError["code"]): EvalObservation["terminal_state"] {
    if (code === "timeout") return "timeout";
    if (code === "cancelled") return "cancelled";
    if (["invalid_utf8", "multiple_json", "invalid_json", "invalid_request", "invalid_result", "stdout_overflow"].includes(code)) {
        return "invalid_result";
    }
    return "adapter_error";
}

function reportMissingness(report: EvalReport): void {
    const reasons = [...new Set(report.observations.flatMap((observation) => observation.missing_reasons))].sort();
    const count = report.observations.filter((observation) => observation.missing_reasons.length > 0).length;
    const missingness = { count, reasons };
    report.missingness = { ...missingness, digest: canonicalDigest(missingness) };
    report.evidence.missingness_digest = report.missingness.digest;
    report.evidence.note_snapshot_digests = [...new Set(report.observations
        .map(({ notes }) => notes.note_snapshot_digest)
        .filter((digest): digest is string => digest !== null))].sort();
}

async function checkpoint(reportStore: EvalReportStore, report: EvalReport): Promise<void> {
    report.updated_at = new Date().toISOString();
    reportMissingness(report);
    await checkpointEvalReport(reportStore, evalReportSchema.parse(report));
}

async function collectSnapshotFiles(root: string): Promise<Array<{ path: string; bytes: Buffer }>> {
    const files: Array<{ path: string; bytes: Buffer }> = [];
    const walk = async (directory: string): Promise<void> => {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
            const absolute = join(directory, entry.name);
            const info = await lstat(absolute);
            if (info.isSymbolicLink()) throw new Error("unsafe_note_snapshot");
            if (info.isDirectory()) {
                await walk(absolute);
                continue;
            }
            if (!info.isFile()) throw new Error("unsafe_note_snapshot");
            const bytes = await readFile(absolute);
            files.push({ path: relative(root, absolute).split(sep).join("/"), bytes });
            if (files.length > MAX_SNAPSHOT_FILES
                || files.reduce((total, file) => total + file.bytes.byteLength, 0) > MAX_SNAPSHOT_BYTES) {
                throw new Error("note_snapshot_limit");
            }
        }
    };
    await walk(root);
    return files;
}

async function makeReadOnlyDirectories(root: string): Promise<void> {
    const directories: string[] = [];
    const walk = async (directory: string): Promise<void> => {
        directories.push(directory);
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (entry.isDirectory()) await walk(join(directory, entry.name));
        }
    };
    await walk(root);
    for (const directory of directories.reverse()) await chmod(directory, 0o500);
}

export async function snapshotTaskNotes(options: {
    workspace: EvalWorkspace;
    row: EvalScheduleRow;
    report_store: EvalReportStore;
    distiller_id: string;
    distiller_config_digest: string;
    trajectory_ref: string;
}): Promise<NoteSnapshot | null> {
    const sourceRoot = join(options.workspace.notes_path, "notes");
    if (!existsSync(sourceRoot)) return null;
    const sourceInfo = await lstat(sourceRoot);
    if (sourceInfo.isSymbolicLink() || !sourceInfo.isDirectory()) throw new Error("unsafe_note_snapshot");
    const files = await collectSnapshotFiles(sourceRoot);
    if (files.length === 0) return null;
    const snapshotParent = join(options.report_store.experiment_path, "snapshots");
    await mkdir(snapshotParent, { recursive: true, mode: 0o700 });
    const root = join(snapshotParent, `${options.row.arm}-r${options.row.repetition}-${options.row.task_id}`);
    if (existsSync(root)) throw new Error("note_snapshot_exists");
    await mkdir(root, { mode: 0o700 });
    try {
        const manifest: NoteSnapshot["manifest"] = [];
        for (const file of files) {
            const destination = resolve(root, file.path);
            if (!isContained(root, destination) || destination === root) throw new Error("unsafe_note_snapshot");
            await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
            await copyFile(join(sourceRoot, ...file.path.split("/")), destination);
            await chmod(destination, 0o400);
            manifest.push({ path: file.path, digest: sha256(file.bytes), bytes: file.bytes.byteLength });
        }
        await makeReadOnlyDirectories(root);
        const snapshot: NoteSnapshot = {
            task_id: options.row.task_id,
            arm: options.row.arm,
            repetition: options.row.repetition,
            root_path: await realpath(root),
            digest: canonicalDigest(manifest),
            manifest,
            distiller_id: options.distiller_id,
            distiller_config_digest: options.distiller_config_digest,
            trajectory_ref: options.trajectory_ref,
        };
        if (!await verifyNoteSnapshot(snapshot)) throw new Error("note_snapshot_verification_failed");
        return snapshot;
    } catch (error) {
        await chmod(root, 0o700).catch(() => undefined);
        await rm(root, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }
}

export async function verifyNoteSnapshot(snapshot: NoteSnapshot): Promise<boolean> {
    try {
        const root = await realpath(snapshot.root_path);
        if (root !== snapshot.root_path) return false;
        const rootInfo = await lstat(root);
        if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (rootInfo.mode & 0o222) !== 0) return false;
        const files = await collectSnapshotFiles(root);
        const manifest = files.map((file) => ({ path: file.path, digest: sha256(file.bytes), bytes: file.bytes.byteLength }));
        if (canonicalDigest(manifest) !== snapshot.digest || canonicalDigest(manifest) !== canonicalDigest(snapshot.manifest)) return false;
        for (const file of files) {
            const info = await lstat(join(root, ...file.path.split("/")));
            if ((info.mode & 0o222) !== 0) return false;
        }
        return true;
    } catch {
        return false;
    }
}

async function exposeSnapshot(snapshot: NoteSnapshot, workspace: EvalWorkspace): Promise<void> {
    if (!await verifyNoteSnapshot(snapshot)) throw new Error("note_snapshot_tampered");
    for (const entry of snapshot.manifest) {
        const source = join(snapshot.root_path, ...entry.path.split("/"));
        const destination = resolve(workspace.notes_path, entry.path);
        if (!isContained(workspace.notes_path, destination) || destination === workspace.notes_path) {
            throw new Error("unsafe_note_snapshot");
        }
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await copyFile(source, destination);
        await chmod(destination, 0o400);
    }
    await makeReadOnlyDirectories(workspace.notes_path);
    if (!await verifyNoteSnapshot(snapshot)) throw new Error("note_snapshot_tampered");
}

async function makeWritableTree(root: string): Promise<void> {
    if (!existsSync(root)) return;
    const walk = async (path: string): Promise<void> => {
        const info = await lstat(path);
        if (info.isSymbolicLink()) throw new Error("unsafe_note_snapshot");
        if (info.isDirectory()) {
            await chmod(path, 0o700);
            for (const entry of await readdir(path)) await walk(join(path, entry));
        } else if (info.isFile()) {
            await chmod(path, 0o600);
        }
    };
    await walk(root);
}

export async function distillRunOneNotes(options: {
    workspace: EvalWorkspace;
    row: EvalScheduleRow;
    observation: EvalObservation;
    report_store: EvalReportStore;
    command?: EvalCommand;
    timeout_ms?: number;
    signal?: AbortSignal;
}): Promise<DistillRunOneResult> {
    const trajectoryRef = options.observation.result?.trajectory_ref ?? null;
    if (options.row.pass !== "run1"
        || options.observation.result?.status !== "completed"
        || trajectoryRef !== options.row.observation_id) {
        return {
            outcome: "skipped",
            eligibility_reason: trajectoryRef === null ? "trajectory_unavailable" : "trajectory_not_exact",
            distiller_id: null,
            distiller_config_digest: null,
            trajectory_ref: trajectoryRef,
            snapshot: null,
        };
    }
    const distillerId = DEFAULT_DISTILLER_ID;
    const distillerConfigDigest = canonicalDigest({ schema_version: 1, distiller_id: distillerId });
    const command = options.command ?? { program: process.execPath, args: [join(moduleDirectory, "note-cli.js")] };
    try {
        const result = await runBoundedCommand({
            command: {
                program: command.program,
                args: [...command.args, "distill", "--project", options.workspace.source_path, "--session", trajectoryRef, "--json"],
            },
            cwd: options.workspace.source_path,
            env: {
                ...process.env,
                HOME: options.workspace.home_path,
                TMPDIR: options.workspace.temp_path,
                XDG_CACHE_HOME: join(options.workspace.home_path, ".cache"),
                XDG_CONFIG_HOME: join(options.workspace.home_path, ".config"),
                XDG_DATA_HOME: join(options.workspace.home_path, ".local", "share"),
                CAIRN_AGENTFS_BASE_DIR: options.workspace.notes_path,
                CAIRN_NOTE_DISTILLATION: "1",
                CAIRN_NOTE_ENRICHMENT: "0",
                CAIRN_CAPABILITY_CONTRACT: "0",
            },
            stdout_mode: "raw",
            timeout_ms: options.timeout_ms ?? DEFAULT_DISTILL_TIMEOUT_MS,
            max_stdout_bytes: 1024 * 1024,
            signal: options.signal,
        });
        if (result.exit_code !== 0 || result.signal !== null || result.cleanup !== "closed") throw new Error("distiller_failed");
        const parsed = JSON.parse(result.stdout ?? "") as Record<string, unknown>;
        const created = Array.isArray(parsed.created) ? parsed.created.length : 0;
        const updated = Array.isArray(parsed.updated) ? parsed.updated.length : 0;
        const failed = Array.isArray(parsed.failed) ? parsed.failed.length : 0;
        if (parsed.enabled !== true || failed > 0) throw new Error("distiller_failed");
        if (created + updated === 0) {
            return {
                outcome: "no_notes",
                eligibility_reason: "no_distilled_notes",
                distiller_id: distillerId,
                distiller_config_digest: distillerConfigDigest,
                trajectory_ref: trajectoryRef,
                snapshot: null,
            };
        }
        const snapshot = await snapshotTaskNotes({
            workspace: options.workspace,
            row: options.row,
            report_store: options.report_store,
            distiller_id: distillerId,
            distiller_config_digest: distillerConfigDigest,
            trajectory_ref: trajectoryRef,
        });
        if (!snapshot) throw new Error("distiller_missing_notes");
        return {
            outcome: "success",
            eligibility_reason: "same_task_snapshot",
            distiller_id: distillerId,
            distiller_config_digest: distillerConfigDigest,
            trajectory_ref: trajectoryRef,
            snapshot,
        };
    } catch {
        return {
            outcome: "failed",
            eligibility_reason: "distillation_failed",
            distiller_id: distillerId,
            distiller_config_digest: distillerConfigDigest,
            trajectory_ref: trajectoryRef,
            snapshot: null,
        };
    }
}

function applyDistillation(observation: EvalObservation, result: DistillRunOneResult): void {
    observation.notes = {
        distiller_id: result.distiller_id,
        distiller_config_digest: result.distiller_config_digest,
        trajectory_ref: result.trajectory_ref,
        distillation_outcome: result.outcome,
        eligibility_reason: result.eligibility_reason,
        note_snapshot_digest: result.snapshot?.digest ?? null,
        note_snapshot_manifest: result.snapshot?.manifest ?? [],
        notes_exposed: false,
    };
    if (result.outcome !== "success") observation.missing_reasons.push(`notes_${result.outcome}`);
}

function replaceObservation(report: EvalReport, observation: EvalObservation): void {
    const index = report.observations.findIndex(({ observation_id }) => observation_id === observation.observation_id);
    if (index < 0) report.observations.push(observation);
    else report.observations[index] = observation;
}

export async function runEvalObservation(options: ObservationOptions): Promise<ObservationResult> {
    const observation = pendingObservation(options.row, options.snapshot, options.prior_notes);
    replaceObservation(options.report, observation);
    await checkpoint(options.report_store, options.report);
    let workspace: EvalWorkspace | undefined;
    let distilledSnapshot: NoteSnapshot | null = null;
    try {
        workspace = await createEvalWorkspace({
            plan: options.plan,
            row: options.row,
            temporary_root: options.temporary_root,
        });
        if (options.row.pass === "run2" && options.snapshot) await exposeSnapshot(options.snapshot, workspace);
        const preparation = await runTaskPreparation(workspace, { signal: options.signal });
        if (preparation.exit_code !== 0 || preparation.signal !== null || preparation.cleanup !== "closed") {
            observation.state = "terminal";
            observation.terminal_state = "adapter_error";
            observation.process = commandProcess(preparation);
            observation.process.error_code = "preparation_failed";
            observation.verifier = { state: "not_run", reason: "preparation_failed" };
            observation.missing_reasons.push("preparation_failed");
        } else {
            const request = {
                schema_version: 1 as const,
                experiment_id: options.report.experiment_id,
                task_id: options.row.task_id,
                arm: options.row.arm,
                repetition: options.row.repetition,
                pass: options.row.pass,
                workspace_path: relative(workspace.parent_path, workspace.workspace_path).split(sep).join("/"),
                notes_path: options.row.pass === "run2" && options.snapshot ? "notes" : null,
                input: workspace.task.input,
                limits: workspace.task.limits,
                seed: options.row.seed,
                expected_capability_digest: observation.expected_capability_digest,
                output_path: "output",
            };
            const adapter = await runBoundedJsonAdapter({
                command: {
                    program: options.plan.resolved_programs.adapter,
                    args: options.plan.adapter_config.command.args,
                },
                request,
                cwd: workspace.parent_path,
                env: {
                    ...process.env,
                    HOME: workspace.home_path,
                    TMPDIR: workspace.temp_path,
                    XDG_CACHE_HOME: join(workspace.home_path, ".cache"),
                    XDG_CONFIG_HOME: join(workspace.home_path, ".config"),
                    XDG_DATA_HOME: join(workspace.home_path, ".local", "share"),
                },
                timeout_ms: workspace.task.limits.elapsed_ms,
                max_stdout_bytes: workspace.task.limits.stdout_bytes,
                signal: options.signal,
            });
            observation.process = commandProcess(adapter);
            observation.result = adapter.result;
            observation.observed_capability_digest = adapter.result.observed_capability_digest ?? null;
            observation.capability_digest_match = observation.observed_capability_digest === null
                ? null
                : observation.observed_capability_digest === observation.expected_capability_digest;
            observation.capability_status = observation.observed_capability_digest === null
                ? "unavailable"
                : observation.capability_digest_match ? "valid" : "mismatch";
            if (observation.capability_status !== "valid") observation.missing_reasons.push(`capability_${observation.capability_status}`);
            if (adapter.result.status !== "completed") {
                observation.state = "terminal";
                observation.terminal_state = "adapter_error";
                observation.process.error_code = adapter.result.error_code ?? "adapter_error";
                observation.verifier = { state: "not_run", reason: "adapter_not_completed" };
                observation.missing_reasons.push("adapter_error");
            } else {
                const verifier = await runTaskVerifier(workspace, { adapter_completed: true, signal: options.signal });
                observation.state = "terminal";
                observation.terminal_state = verifier.terminal_state;
                observation.verifier = { state: verifier.verifier_state, reason: verifier.reason };
                observation.pass_state = verifier.pass_state;
                if (verifier.pass_state === "unknown") observation.missing_reasons.push(verifier.reason ?? "verifier_unknown");
            }
        }
    } catch (error) {
        observation.state = "terminal";
        observation.pass_state = "unknown";
        observation.verifier = { state: "not_run", reason: "adapter_not_completed" };
        if (error instanceof EvalProcessError) {
            observation.terminal_state = terminalForProcessError(error.code);
            observation.process = processError(error);
            observation.missing_reasons.push(error.code);
        } else {
            observation.terminal_state = options.signal?.aborted ? "cancelled" : "adapter_error";
            observation.process = {
                exit_code: null,
                signal: null,
                error_code: options.signal?.aborted ? "cancelled" : "workspace_error",
                cleanup: "failed",
            };
            observation.missing_reasons.push(options.signal?.aborted ? "cancelled" : "workspace_error");
        }
    }

    if (workspace && options.row.pass === "run1") {
        const distilled = await distillRunOneNotes({
            workspace,
            row: options.row,
            observation,
            report_store: options.report_store,
            command: options.distill_command,
            timeout_ms: options.distill_timeout_ms,
            signal: options.signal,
        });
        applyDistillation(observation, distilled);
        distilledSnapshot = distilled.snapshot;
    }
    replaceObservation(options.report, observation);
    await checkpoint(options.report_store, options.report);

    if (workspace) {
        await makeWritableTree(workspace.notes_path).catch(() => undefined);
        const cleanup = await cleanupEvalWorkspace(workspace);
        if (cleanup.status !== "closed") {
            observation.missing_reasons.push("workspace_cleanup_failed");
            observation.process.cleanup = "failed";
        }
    }
    if (options.snapshot && !await verifyNoteSnapshot(options.snapshot)) {
        observation.missing_reasons.push("note_snapshot_tampered");
        observation.notes.notes_exposed = false;
    }
    replaceObservation(options.report, observation);
    await checkpoint(options.report_store, options.report);
    return { observation, snapshot: distilledSnapshot, cancelled: observation.terminal_state === "cancelled" };
}

function initialReport(plan: EvalPlan, experimentId: string): EvalReport {
    const now = new Date().toISOString();
    const sourceCommit = plan.task_set_commit ?? (plan.source.kind === "git" ? plan.source.revision : plan.task_set_digest);
    const missingness = { count: 0, reasons: [] as string[] };
    return evalReportSchema.parse({
        schema_version: 1,
        experiment_id: experimentId,
        status: "partial",
        experiment_kind: plan.arms.length === 1 ? "two_pass" : "ablation",
        task_set_digest: plan.task_set_digest,
        adapter_config_digest: plan.adapter_config_digest,
        source_revision: plan.source.kind === "git" ? plan.source.revision : plan.task_set_digest,
        schedule_digest: plan.schedule_digest,
        created_at: now,
        updated_at: now,
        runtime: {
            platform: process.platform,
            arch: process.arch,
            node: process.version,
            cairnkeep: "0.1.0",
        },
        schedule: plan.schedule.map(({ observation_id, task_id, arm, repetition, pass, seed }) => ({
            observation_id, task_id, arm, repetition, pass, seed,
        })),
        observations: [],
        aggregates: [],
        missingness: { ...missingness, digest: canonicalDigest(missingness) },
        warnings: [],
        evidence: {
            schema_version: 1,
            evidence_scope: plan.source.kind === "bundled_fake" ? "offline-framework" : "live-evaluation",
            source_commit: sourceCommit,
            package_version: plan.source.kind === "bundled_fake" ? plan.source.package_version : "0.1.0",
            runtime_id: "node-local",
            task_set_digest: plan.task_set_digest,
            report_digest: canonicalDigest({ experiment_id: experimentId, plan_digest: plan.plan_digest }),
            schema_digests: [canonicalDigest({ schema_version: 1, contract: "eval-report" })],
            note_snapshot_digests: [],
            missingness_digest: canonicalDigest(missingness),
            claim_anchors: [],
        },
    });
}

export async function runTwoPassExperiment(options: TwoPassRunOptions): Promise<TwoPassRunResult> {
    const experimentId = options.experiment_id ?? options.report_store?.experiment_id
        ?? `eval-${options.plan.plan_digest.slice(0, 24)}`;
    const reportStore = options.report_store ?? await createEvalReportStore({
        root: options.plan.output_root,
        experiment_id: experimentId,
    });
    if (reportStore.experiment_id !== experimentId) throw new Error("report_experiment_mismatch");
    const report = initialReport(options.plan, experimentId);
    const snapshotsByTask = new Map<string, NoteSnapshot>();
    const notesByTask = new Map<string, EvalObservation["notes"]>();
    const snapshots: NoteSnapshot[] = [];
    const executed: string[] = [];
    await checkpoint(reportStore, report);

    for (const row of options.plan.schedule) {
        if (options.signal?.aborted) break;
        const snapshot = row.pass === "run2" ? snapshotsByTask.get(snapshotKey(row)) ?? null : null;
        const priorNotes = row.pass === "run2" ? notesByTask.get(snapshotKey(row)) : undefined;
        const result = await runEvalObservation({
            plan: options.plan,
            row,
            report,
            report_store: reportStore,
            temporary_root: options.temporary_root,
            signal: options.signal,
            snapshot,
            prior_notes: priorNotes,
            distill_command: options.distill_command,
            distill_timeout_ms: options.distill_timeout_ms,
        });
        executed.push(row.observation_id);
        if (result.snapshot) {
            snapshotsByTask.set(snapshotKey(row), result.snapshot);
            snapshots.push(result.snapshot);
        }
        if (row.pass === "run1") notesByTask.set(snapshotKey(row), {
            ...result.observation.notes,
            note_snapshot_manifest: [...result.observation.notes.note_snapshot_manifest],
        });
        if (result.cancelled || options.signal?.aborted) break;
    }

    const expectedPrefix = options.plan.schedule.slice(0, executed.length).map(({ observation_id }) => observation_id);
    if (canonicalDigest(executed) !== canonicalDigest(expectedPrefix)) throw new Error("schedule_order_mismatch");
    if (executed.length === options.plan.schedule.length) {
        report.status = "final";
    }
    await checkpoint(reportStore, report);
    return { report: evalReportSchema.parse(report), report_store: reportStore, snapshots };
}

export const runEvalTwoPass = runTwoPassExperiment;
