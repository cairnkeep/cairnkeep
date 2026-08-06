#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { lstat, readdir, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { capabilityIdSchema, type CapabilityId } from "./capability-schema.js";
import { isEvalEnabled, loadEvalPlan } from "./eval-plan.js";
import {
    diagnoseEvalReport,
    readEvalReport,
    renderEvalReport,
    type EvalReportStore,
} from "./eval-report.js";
import {
    buildAblationArms,
    runCapabilityAblation,
    runTwoPassExperiment,
} from "./eval-runner.js";
import { canonicalJson, EVAL_SCHEMA_VERSION, type EvalReport } from "./eval-schema.js";
import { privatePathIsSafe } from "./platform-security.js";

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
});

const publicCommands = new Set(["validate", "run", "ablate", "report", "prune", "delete"]);
const validateFlags = new Set(["--task-set", "--adapter", "--output", "--repetitions", "--seed", "--json"]);
const runFlags = new Set([...validateFlags, "--yes"]);
const ablateFlags = new Set([...runFlags, "--disable"]);
const reportFlags = new Set(["--experiment", "--json"]);
const pruneFlags = new Set(["--older-than-days", "--dry-run", "--json"]);
const deleteFlags = new Set(["--experiment", "--dry-run", "--json"]);
const valueFlags = new Set(["--task-set", "--adapter", "--output", "--repetitions", "--seed", "--disable", "--experiment", "--older-than-days"]);
const EXPERIMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEFAULT_REPORT_BYTES = 16 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_EXPERIMENTS = 10_000;
const DOCTOR_DIAGNOSES = ["absent", "ok", "partial", "tampered", "unsafe"] as const;
type DoctorDiagnosis = typeof DOCTOR_DIAGNOSES[number];

function usage(): string {
    return `cairn eval — deterministic local evaluation coordinator

Usage:
  cairn eval validate --task-set PATH --adapter PATH --output ROOT [--repetitions N] [--seed VALUE] [--json]
  cairn eval run --task-set PATH --adapter PATH --output ROOT [--repetitions N] [--seed VALUE] --yes [--json]
  cairn eval ablate --disable CAPABILITY --task-set PATH --adapter PATH --output ROOT [--repetitions N] [--seed VALUE] [--yes] [--json]
  cairn eval report --experiment ID [--json]
  cairn eval prune [--older-than-days N] [--dry-run] [--json]
  cairn eval delete --experiment ID [--dry-run] [--json]

Evaluation is disabled unless CAIRN_EVAL is explicitly enabled. Live harness
commands remain operator-owned; validate resolves inputs without executing one.
`;
}

function valueAfter(args: string[], flag: string): string | undefined {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    return value;
}

function assertKnown(args: string[], flags: Set<string>): void {
    const seen = new Set<string>();
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (!arg.startsWith("--")) throw new Error(`unexpected positional argument "${arg}".`);
        if (!flags.has(arg)) throw new Error(`unknown option "${arg}".`);
        if (seen.has(arg)) throw new Error(`option "${arg}" may be supplied only once.`);
        seen.add(arg);
        if (valueFlags.has(arg)) {
            const value = args[index + 1];
            if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
            index += 1;
        }
    }
}

function requireValue(args: string[], flag: string): string {
    const value = valueAfter(args, flag);
    if (value === undefined) throw new Error(`${flag} is required.`);
    return value;
}

function repetitions(args: string[]): number | undefined {
    const raw = valueAfter(args, "--repetitions");
    if (raw === undefined) return undefined;
    if (!/^[0-9]+$/.test(raw)) throw new Error("--repetitions must be a positive integer.");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("--repetitions must be a positive integer.");
    return value;
}

function disabled(json: boolean): void {
    const value = {
        schema_version: EVAL_SCHEMA_VERSION,
        enabled: false,
        operation: "eval",
        status: "disabled",
    } as const;
    process.stdout.write(`${json ? JSON.stringify(value) : "Evaluation is disabled. Set CAIRN_EVAL=1 to enable it."}\n`);
}

function isContained(root: string, candidate: string): boolean {
    const path = relative(root, candidate);
    return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function requireExperiment(args: string[]): string {
    const experimentId = requireValue(args, "--experiment");
    if (!EXPERIMENT_PATTERN.test(experimentId)) throw new Error("--experiment must be a canonical experiment ID.");
    return experimentId;
}

function retentionDays(args: string[]): number {
    const raw = valueAfter(args, "--older-than-days");
    if (raw === undefined) return DEFAULT_RETENTION_DAYS;
    if (!/^[0-9]+$/.test(raw)) throw new Error("--older-than-days must be a nonnegative integer.");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > 36_500) throw new Error("--older-than-days is outside the supported range.");
    return value;
}

async function evalRoot(): Promise<string | null> {
    const root = resolve(process.cwd(), ".agentfs", "eval", "experiments");
    let info;
    try {
        info = await lstat(root);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
    if (info.isSymbolicLink() || !info.isDirectory() || !privatePathIsSafe(root)) {
        throw new Error("unsafe_eval_root");
    }
    const resolvedRoot = await realpath(root);
    if (resolvedRoot !== root) throw new Error("unsafe_eval_root");
    return root;
}

function isStrictReportDiagnosis(value: unknown): value is Awaited<ReturnType<typeof diagnoseEvalReport>> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || !Object.hasOwn(record, "state") || !Object.hasOwn(record, "code")) {
        return false;
    }
    const expectedCodes: Record<DoctorDiagnosis, string> = {
        absent: "report_absent",
        ok: "report_ok",
        partial: "report_partial",
        tampered: "report_invalid",
        unsafe: "report_unsafe",
    };
    return typeof record.state === "string"
        && DOCTOR_DIAGNOSES.includes(record.state as DoctorDiagnosis)
        && record.code === expectedCodes[record.state as DoctorDiagnosis];
}

function diagnosisEnvelope(diagnosis: DoctorDiagnosis): { schema_version: 1; diagnosis: DoctorDiagnosis } {
    return { schema_version: EVAL_SCHEMA_VERSION, diagnosis };
}

function privateDoctorRoot(args: string[]): string {
    if (args.length !== 3 || args[0] !== "--root" || args[2] !== "--json") throw new Error("unsafe");
    const root = args[1];
    if (!root || !isAbsolute(root) || resolve(root) !== root) throw new Error("unsafe");
    return root;
}

async function diagnoseProjectReports(projectRoot: string): Promise<DoctorDiagnosis> {
    const projectInfo = await lstat(projectRoot);
    if (projectInfo.isSymbolicLink() || !projectInfo.isDirectory() || await realpath(projectRoot) !== projectRoot) {
        return "unsafe";
    }
    const agentfsRoot = resolve(projectRoot, ".agentfs");
    const evalDirectory = resolve(agentfsRoot, "eval");
    const root = resolve(evalDirectory, "experiments");
    if (!isContained(projectRoot, root) || root === projectRoot) return "unsafe";

    for (const directory of [agentfsRoot, evalDirectory, root]) {
        let info;
        try {
            info = await lstat(directory);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
            return "unsafe";
        }
        if (info.isSymbolicLink() || !info.isDirectory() || await realpath(directory) !== directory) return "unsafe";
        if (directory === root && !privatePathIsSafe(directory)) return "unsafe";
    }

    const entries = await readdir(root, { withFileTypes: true });
    if (entries.length === 0) return "absent";
    if (entries.length > MAX_EXPERIMENTS) return "unsafe";

    let aggregate: DoctorDiagnosis = "ok";
    for (const entry of entries) {
        if (!EXPERIMENT_PATTERN.test(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) return "unsafe";
        const experimentPath = resolve(root, entry.name);
        if (!isContained(root, experimentPath) || experimentPath === root) return "unsafe";
        const experimentInfo = await lstat(experimentPath);
        if (experimentInfo.isSymbolicLink() || !experimentInfo.isDirectory() || !privatePathIsSafe(experimentPath)
            || await realpath(experimentPath) !== experimentPath) {
            return "unsafe";
        }
        const diagnosis = await diagnoseEvalReport({
            root_path: root,
            experiment_path: experimentPath,
            report_path: join(experimentPath, "report.json"),
            experiment_id: entry.name,
            max_report_bytes: DEFAULT_REPORT_BYTES,
        });
        if (!isStrictReportDiagnosis(diagnosis) || diagnosis.state === "unsafe") return "unsafe";
        if (diagnosis.state === "tampered") aggregate = "tampered";
        else if (aggregate !== "tampered" && diagnosis.state !== "ok") aggregate = "partial";
    }
    return aggregate;
}

async function privateDoctorDiagnosis(args: string[]): Promise<void> {
    let diagnosis: DoctorDiagnosis = "unsafe";
    try {
        diagnosis = await diagnoseProjectReports(privateDoctorRoot(args));
    } catch {
        diagnosis = "unsafe";
    }
    process.stdout.write(`${JSON.stringify(diagnosisEnvelope(diagnosis))}\n`);
}

async function safeReportStore(experimentId: string): Promise<EvalReportStore> {
    const root = await evalRoot();
    if (!root) throw new Error("eval_report_not_found");
    const experimentPath = resolve(root, experimentId);
    if (!isContained(root, experimentPath) || experimentPath === root) throw new Error("unsafe_experiment_path");
    let directory;
    try {
        directory = await lstat(experimentPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("eval_report_not_found");
        throw error;
    }
    if (directory.isSymbolicLink() || !directory.isDirectory() || !privatePathIsSafe(experimentPath)
        || await realpath(experimentPath) !== experimentPath) {
        throw new Error("unsafe_experiment_path");
    }
    const reportPath = join(experimentPath, "report.json");
    let reportInfo;
    try {
        reportInfo = await lstat(reportPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("eval_report_not_found");
        throw error;
    }
    if (reportInfo.isSymbolicLink() || !reportInfo.isFile() || !privatePathIsSafe(reportPath)
        || reportInfo.size > DEFAULT_REPORT_BYTES) {
        throw new Error("unsafe_eval_report");
    }
    return {
        root_path: root,
        experiment_path: experimentPath,
        report_path: reportPath,
        experiment_id: experimentId,
        max_report_bytes: DEFAULT_REPORT_BYTES,
    };
}

async function validatedStoredReport(experimentId: string): Promise<{ store: EvalReportStore; report: EvalReport }> {
    const store = await safeReportStore(experimentId);
    const report = await readEvalReport(store);
    if (!report) throw new Error("eval_report_not_found");
    if (report.experiment_id !== experimentId) throw new Error("report_experiment_mismatch");
    return { store, report };
}

async function removeExperiment(store: EvalReportStore): Promise<void> {
    const tombstone = join(store.root_path, `.delete-${randomBytes(16).toString("hex")}`);
    await rename(store.experiment_path, tombstone);
    await rm(tombstone, { recursive: true });
}

async function reportCommand(args: string[], json: boolean): Promise<void> {
    assertKnown(args, reportFlags);
    const { report } = await validatedStoredReport(requireExperiment(args));
    process.stdout.write(json ? `${canonicalJson(report)}\n` : renderEvalReport(report));
}

async function deleteCommand(args: string[], json: boolean): Promise<void> {
    assertKnown(args, deleteFlags);
    const experimentId = requireExperiment(args);
    const dryRun = args.includes("--dry-run");
    const { store } = await validatedStoredReport(experimentId);
    if (!dryRun) await removeExperiment(store);
    const value = { schema_version: EVAL_SCHEMA_VERSION, operation: "delete", dry_run: dryRun, experiment_id: experimentId, deleted: !dryRun };
    process.stdout.write(`${json ? canonicalJson(value) : `${dryRun ? "Would delete" : "Deleted"} experiment ${experimentId}.`}\n`);
}

async function pruneCommand(args: string[], json: boolean): Promise<void> {
    assertKnown(args, pruneFlags);
    const olderThanDays = retentionDays(args);
    const dryRun = args.includes("--dry-run");
    const root = await evalRoot();
    const eligible: Array<{ id: string; store: EvalReportStore }> = [];
    if (root) {
        const entries = await readdir(root, { withFileTypes: true });
        if (entries.length > 10_000) throw new Error("experiment_limit_exceeded");
        for (const entry of entries) {
            if (!EXPERIMENT_PATTERN.test(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) {
                throw new Error("unsafe_experiment_entry");
            }
            const { store, report } = await validatedStoredReport(entry.name);
            const age = Date.now() - Date.parse(report.updated_at);
            if (!Number.isFinite(age)) throw new Error("invalid_eval_report");
            if (age >= olderThanDays * 86_400_000) eligible.push({ id: entry.name, store });
        }
    }
    if (!dryRun) {
        for (const { store } of eligible) await removeExperiment(store);
    }
    const value = {
        schema_version: EVAL_SCHEMA_VERSION,
        operation: "prune",
        dry_run: dryRun,
        older_than_days: olderThanDays,
        experiments: eligible.map(({ id }) => id),
        removed: dryRun ? 0 : eligible.length,
    };
    process.stdout.write(`${json ? canonicalJson(value) : `${dryRun ? "Would remove" : "Removed"} ${eligible.length} experiment(s).`}\n`);
}

function renderValidation(value: ReturnType<typeof validationResult>): string {
    const source = value.plan.source.kind === "git"
        ? `${value.plan.source.revision} (${value.plan.source.repository_root})`
        : `${value.plan.source.identifier} (${value.plan.source.package_version})`;
    return [
        `Evaluation plan ${value.plan.plan_digest}`,
        `Task set: ${value.plan.task_set.id} (${value.plan.task_set_digest})`,
        `Source: ${source}`,
        `Adapter: ${value.plan.adapter_config.id} (${value.plan.adapter_config_digest})`,
        `Schedule: ${value.invocation_count} serial invocation(s) (${value.plan.schedule_digest})`,
        `Output root: ${value.plan.output_root}`,
    ].join("\n");
}

function validationResult(plan: ReturnType<typeof loadEvalPlan>) {
    return {
        schema_version: EVAL_SCHEMA_VERSION,
        enabled: true,
        operation: "validate" as const,
        invocation_count: plan.invocation_count,
        plan,
    };
}

function loadPlan(args: string[], disabledCapability?: CapabilityId) {
    return loadEvalPlan({
        taskSetPath: requireValue(args, "--task-set"),
        adapterPath: requireValue(args, "--adapter"),
        outputRoot: requireValue(args, "--output"),
        repetitions: repetitions(args),
        seed: valueAfter(args, "--seed"),
        ...(disabledCapability === undefined ? {} : {
            arms: buildAblationArms(disabledCapability).map(({ id, disabled_capability }) => ({ id, disabled_capability })),
        }),
    });
}

function requireDisabledCapability(args: string[]): CapabilityId {
    const parsed = capabilityIdSchema.safeParse(requireValue(args, "--disable"));
    if (!parsed.success) throw new Error("--disable must name exactly one canonical capability ID.");
    return parsed.data;
}

function ablationPreview(plan: ReturnType<typeof loadEvalPlan>, disabledCapability: CapabilityId) {
    return {
        schema_version: EVAL_SCHEMA_VERSION,
        enabled: true,
        operation: "ablate-preview" as const,
        disabled_capability: disabledCapability,
        invocation_count: plan.invocation_count,
        arms: buildAblationArms(disabledCapability).map((arm) => ({
            id: arm.id,
            disabled_capability: arm.disabled_capability,
            expected_capabilities: arm.expected_capabilities,
            expected_configuration_digest: arm.expected_configuration_digest,
        })),
    };
}

function renderAblationPreview(value: ReturnType<typeof ablationPreview>): string {
    const armLines = value.arms.flatMap((arm) => [
        `${arm.id}: ${arm.expected_configuration_digest}`,
        ...arm.expected_capabilities.map(({ id, enabled }) => `  ${id}: ${enabled ? "enabled" : "disabled"}`),
    ]);
    return [
        `Capability ablation will perform ${value.invocation_count} serial adapter invocation(s).`,
        `Disabled capability: ${value.disabled_capability}`,
        ...armLines,
    ].join("\n");
}

async function executePlan(options: {
    operation: "run" | "ablate";
    plan: ReturnType<typeof loadEvalPlan>;
    json: boolean;
    disabled_capability?: CapabilityId;
}): Promise<void> {
    const controller = new AbortController();
    let receivedSignal: "SIGINT" | "SIGTERM" | null = null;
    const stop = (signal: "SIGINT" | "SIGTERM"): void => {
        receivedSignal ??= signal;
        controller.abort();
    };
    const onSigint = (): void => stop("SIGINT");
    const onSigterm = (): void => stop("SIGTERM");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    try {
        const run = options.operation === "ablate"
            ? await runCapabilityAblation({
                plan: options.plan,
                disabled_capability: options.disabled_capability as CapabilityId,
                signal: controller.signal,
            })
            : await runTwoPassExperiment({ plan: options.plan, signal: controller.signal });
        const value = {
            schema_version: EVAL_SCHEMA_VERSION,
            enabled: true,
            operation: options.operation,
            invocation_count: options.plan.invocation_count,
            ...(options.disabled_capability === undefined ? {} : { disabled_capability: options.disabled_capability }),
            experiment_id: run.report.experiment_id,
            report_path: run.report_store.report_path,
            status: run.report.status,
        };
        process.stdout.write(`${options.json ? JSON.stringify(value) : [
            `Experiment: ${value.experiment_id}`,
            `Status: ${value.status}`,
            `Report: ${value.report_path}`,
        ].join("\n")}\n`);
        if (receivedSignal === "SIGINT") process.exitCode = 130;
        else if (receivedSignal === "SIGTERM") process.exitCode = 143;
    } finally {
        process.removeListener("SIGINT", onSigint);
        process.removeListener("SIGTERM", onSigterm);
    }
}

async function main(): Promise<void> {
    const [command = "help", ...args] = process.argv.slice(2);
    if (command === "doctor-diagnosis") {
        await privateDoctorDiagnosis(args);
        return;
    }
    if (["help", "--help", "-h"].includes(command)) {
        process.stdout.write(usage());
        return;
    }
    if (!publicCommands.has(command)) throw new Error(`unknown eval command "${command}".`);

    const json = args.includes("--json");
    if (!isEvalEnabled()) {
        disabled(json);
        return;
    }

    if (command === "validate") {
        assertKnown(args, validateFlags);
        const plan = loadPlan(args);
        const value = validationResult(plan);
        process.stdout.write(`${json ? JSON.stringify(value) : renderValidation(value)}\n`);
        return;
    }

    if (command === "run") {
        assertKnown(args, runFlags);
        if (!args.includes("--yes")) throw new Error("run requires --yes for non-interactive execution.");
        const plan = loadPlan(args);
        const estimate = `Evaluation will perform ${plan.invocation_count} serial adapter invocation(s).`;
        if (json) process.stderr.write(`${estimate}\n`);
        else process.stdout.write(`${estimate}\n`);

        await executePlan({ operation: "run", plan, json });
        return;
    }

    if (command === "ablate") {
        assertKnown(args, ablateFlags);
        const disabledCapability = requireDisabledCapability(args);
        const plan = loadPlan(args, disabledCapability);
        const preview = ablationPreview(plan, disabledCapability);
        const rendered = json ? JSON.stringify(preview) : renderAblationPreview(preview);
        if (json && args.includes("--yes")) process.stderr.write(`${rendered}\n`);
        else process.stdout.write(`${rendered}\n`);
        if (!args.includes("--yes")) throw new Error("ablate requires --yes for non-interactive execution.");
        await executePlan({ operation: "ablate", plan, json, disabled_capability: disabledCapability });
        return;
    }

    if (command === "report") {
        await reportCommand(args, json);
        return;
    }

    if (command === "prune") {
        await pruneCommand(args, json);
        return;
    }

    if (command === "delete") {
        await deleteCommand(args, json);
        return;
    }

    throw new Error(`eval command "${command}" is not available in this build.`);
}

try {
    await main();
} catch (error) {
    process.stderr.write(`cairn eval: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
}
