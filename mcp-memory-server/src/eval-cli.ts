#!/usr/bin/env node

import { isEvalEnabled, loadEvalPlan } from "./eval-plan.js";
import { runTwoPassExperiment } from "./eval-runner.js";
import { EVAL_SCHEMA_VERSION } from "./eval-schema.js";

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
});

const publicCommands = new Set(["validate", "run", "ablate", "report", "prune", "delete"]);
const validateFlags = new Set(["--task-set", "--adapter", "--output", "--repetitions", "--seed", "--json"]);
const runFlags = new Set([...validateFlags, "--yes"]);
const valueFlags = new Set(["--task-set", "--adapter", "--output", "--repetitions", "--seed"]);

function usage(): string {
    return `cairn eval — deterministic local evaluation coordinator

Usage:
  cairn eval validate --task-set PATH --adapter PATH --output ROOT [--repetitions N] [--seed VALUE] [--json]
  cairn eval run --task-set PATH --adapter PATH --output ROOT [--repetitions N] [--seed VALUE] --yes [--json]
  cairn eval ablate --disable CAPABILITY --task-set PATH --adapter PATH --output ROOT [options]
  cairn eval report EXPERIMENT [--json]
  cairn eval prune [--json]
  cairn eval delete EXPERIMENT [--json]

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

function loadPlan(args: string[]) {
    return loadEvalPlan({
        taskSetPath: requireValue(args, "--task-set"),
        adapterPath: requireValue(args, "--adapter"),
        outputRoot: requireValue(args, "--output"),
        repetitions: repetitions(args),
        seed: valueAfter(args, "--seed"),
    });
}

async function main(): Promise<void> {
    const [command = "help", ...args] = process.argv.slice(2);
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
            const run = await runTwoPassExperiment({ plan, signal: controller.signal });
            const value = {
                schema_version: EVAL_SCHEMA_VERSION,
                enabled: true,
                operation: "run" as const,
                invocation_count: plan.invocation_count,
                experiment_id: run.report.experiment_id,
                report_path: run.report_store.report_path,
                status: run.report.status,
            };
            process.stdout.write(`${json ? JSON.stringify(value) : [
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
