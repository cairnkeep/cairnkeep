#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { constants as osConstants } from "node:os";

import { workEvidenceHarnessSchema } from "./work-evidence-schema.js";
import {
    activeEvidenceEnvironment,
    deleteWorkEvidence,
    doctorWorkEvidence,
    finishWorkEvidence,
    listWorkEvidence,
    pruneWorkEvidence,
    readWorkEvidence,
    startWorkEvidence,
} from "./work-evidence-store.js";
import { getWorkEvidenceLimits, isWorkEvidenceEnabled } from "./work-evidence-schema.js";

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
});

function usage(): string {
    return `cairn evidence — opt-in local Git-linked work evidence

Usage:
  cairn evidence list [--status pending|complete] [--json]
  cairn evidence show <evidence-id-or-prefix> [--json]
  cairn evidence delete <evidence-id-or-prefix> [--dry-run] [--json]
  cairn evidence prune [--dry-run] [--json]
  cairn evidence doctor [--repair] [--json]
`;
}

function hasFlag(args: string[], flag: string): boolean {
    return args.includes(flag);
}

function option(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}

function humanList(value: ReturnType<typeof listWorkEvidence>): string {
    if (value.evidence.length === 0) return "No local work evidence found.";
    return value.evidence.map((row) => [row.evidence_id, row.status, row.harness, row.started_at, `${row.links.length} links`].join("\t")).join("\n");
}

async function runHarness(args: string[]): Promise<void> {
    const separator = args.indexOf("--");
    const harness = workEvidenceHarnessSchema.parse(option(args.slice(0, separator < 0 ? args.length : separator), "--harness"));
    const command = separator >= 0 ? args[separator + 1] : undefined;
    const commandArgs = separator >= 0 ? args.slice(separator + 2) : [];
    if (!command) throw new Error("run requires --harness NAME -- COMMAND [ARG...].");

    let evidence;
    if (isWorkEvidenceEnabled()) {
        try { evidence = startWorkEvidence(process.cwd(), harness); }
        catch { process.stderr.write("cairn evidence: capture unavailable; launching without work evidence\n"); }
    }
    const env = evidence ? { ...process.env, ...activeEvidenceEnvironment(evidence, process.cwd()) } : process.env;
    const result = spawnSync(command, commandArgs, { cwd: process.cwd(), env, stdio: "inherit", shell: false, windowsHide: false });
    const signalNumber = result.signal ? osConstants.signals[result.signal] : undefined;
    const status = result.status ?? (signalNumber ? 128 + signalNumber : 1);
    if (evidence) {
        try { await finishWorkEvidence(process.cwd(), evidence.evidence_id, status); }
        catch { process.stderr.write("cairn evidence: final capture failed; the evidence remains pending\n"); }
    }
    if (result.error) throw result.error;
    process.exitCode = status;
}

async function main(): Promise<void> {
    const [command = "help", ...args] = process.argv.slice(2);
    try {
        if (command === "run") { await runHarness(args); return; }
        if (command === "list") {
            const status = option(args, "--status") as "pending" | "complete" | undefined;
            if (status && !["pending", "complete"].includes(status)) throw new Error("--status must be pending or complete.");
            const value = listWorkEvidence(process.cwd(), { status });
            process.stdout.write(`${hasFlag(args, "--json") ? JSON.stringify(value) : humanList(value)}\n`);
            return;
        }
        if (command === "show") {
            const identifier = args.find((arg) => !arg.startsWith("-"));
            if (!identifier) throw new Error("show requires an evidence ID or unambiguous prefix.");
            const value = readWorkEvidence(identifier, process.cwd());
            process.stdout.write(`${hasFlag(args, "--json") ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`);
            return;
        }
        if (command === "delete") {
            const identifier = args.find((arg) => !arg.startsWith("-"));
            if (!identifier) throw new Error("delete requires an evidence ID or unambiguous prefix.");
            const value = deleteWorkEvidence(identifier, process.cwd(), hasFlag(args, "--dry-run"));
            process.stdout.write(`${hasFlag(args, "--json") ? JSON.stringify(value) : `${value.dry_run ? "Would delete" : "Deleted"} ${value.evidence_id}.`}\n`);
            return;
        }
        if (command === "prune") {
            const value = pruneWorkEvidence(process.cwd(), getWorkEvidenceLimits(), { dryRun: hasFlag(args, "--dry-run") });
            process.stdout.write(`${hasFlag(args, "--json") ? JSON.stringify(value) : `${value.dry_run ? "Would remove" : "Removed"} ${value.removed.length} evidence record(s).`}\n`);
            return;
        }
        if (command === "doctor") {
            const value = doctorWorkEvidence(process.cwd(), hasFlag(args, "--repair"));
            process.stdout.write(`${hasFlag(args, "--json") ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`);
            if (!value.ok) process.exitCode = 2;
            return;
        }
        if (["help", "--help", "-h"].includes(command)) { process.stdout.write(usage()); return; }
        throw new Error(`unknown evidence command "${command}".`);
    } catch (error) {
        process.stderr.write(`cairn evidence: ${error instanceof Error ? error.message : "unknown error"}\n`);
        process.exitCode = 2;
    }
}

await main();
