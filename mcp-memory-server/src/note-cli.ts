#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join, resolve } from "node:path";

import { startOperatingCapability, withCapability } from "./capability-adapter.js";
import { isCapabilityContractEnabled, resolveCapabilityStatus } from "./capability-config.js";
import { distillProject } from "./note-distiller.js";
import { isNoteDistillationEnabled } from "./note-schema.js";
import { doctorNoteStore, promoteNotes, searchHindsight } from "./note-store.js";

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
});

function usage(): string {
    return `cairn notes — deterministic local hindsight notes

Usage:
  cairn notes distill [--project PATH] [--session ID] [--json]
  cairn notes distill --all-projects --para-root PATH [--json]
  cairn notes search-error [--text TEXT] [--project PATH] [--component VALUE] [--json]
  cairn notes promote NOTE-ID --with NOTE-ID --confirm [--json]
  cairn notes doctor [--repair] [--json]
`;
}

function valueAfter(args: string[], flag: string): string | undefined {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    return value;
}

function assertKnown(args: string[], flags: string[], positionals = 0): void {
    const valueFlags = new Set(["--project", "--session", "--para-root", "--text", "--component", "--with"]);
    let positionalCount = 0;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg.startsWith("--")) {
            if (!flags.includes(arg)) throw new Error(`unknown option "${arg}".`);
            if (valueFlags.has(arg)) index += 1;
        } else positionalCount += 1;
    }
    if (positionalCount !== positionals) throw new Error(`expected ${positionals} positional argument(s).`);
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
}

function findTrajectoryProjects(root: string): string[] {
    const projects: string[] = [];
    const walk = (directory: string, depth: number) => {
        if (depth > 8) return;
        let entries: Dirent[];
        try {
            entries = readdirSync(directory, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
            const child = join(directory, entry.name);
            if (entry.name === ".agentfs") {
                try {
                    if (statSync(join(child, "trajectory.db")).isFile()) projects.push(directory);
                } catch { /* no trajectory store */ }
                continue;
            }
            if (entry.name.startsWith(".") || ["node_modules", "vendor"].includes(entry.name)) continue;
            walk(child, depth + 1);
        }
    };
    walk(resolve(root), 0);
    return [...new Set(projects.map((project) => resolve(project)))].sort();
}

function disabled(json: boolean): void {
    const value = { schema_version: 1, enabled: false, reason: "CAIRN_NOTE_DISTILLATION is disabled" };
    process.stdout.write(`${json ? JSON.stringify(value) : value.reason}\n`);
}

function output(value: unknown, json: boolean, human: string): void {
    process.stdout.write(`${json ? JSON.stringify(value) : human}\n`);
}

function validCorrelationId(value: string | undefined): string | undefined {
    return value !== undefined
        && value !== "unknown"
        && /^(?:cairn:)?[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
        ? value
        : undefined;
}

async function withEnabledCompatibility<T>(callback: () => Promise<T>): Promise<T> {
    if (isNoteDistillationEnabled()) return callback();
    const previous = process.env.CAIRN_NOTE_DISTILLATION;
    process.env.CAIRN_NOTE_DISTILLATION = "1";
    try {
        return await callback();
    } finally {
        if (previous === undefined) delete process.env.CAIRN_NOTE_DISTILLATION;
        else process.env.CAIRN_NOTE_DISTILLATION = previous;
    }
}

async function main(): Promise<void> {
    const [command = "help", ...args] = process.argv.slice(2);
    if (["help", "--help", "-h"].includes(command)) {
        process.stdout.write(usage());
        return;
    }
    const json = args.includes("--json");
    const contractEnabled = isCapabilityContractEnabled();
    if (!contractEnabled && !isNoteDistillationEnabled()) {
        disabled(json);
        return;
    }

    if (command === "distill") {
        assertKnown(args, ["--project", "--session", "--all-projects", "--para-root", "--json"]);
        const allProjects = args.includes("--all-projects");
        const project = valueAfter(args, "--project");
        const sessionId = valueAfter(args, "--session");
        const paraRoot = valueAfter(args, "--para-root");
        if (allProjects && (!paraRoot || project || sessionId)) {
            throw new Error("--all-projects requires --para-root and cannot be combined with --project or --session.");
        }
        if (!allProjects && paraRoot) throw new Error("--para-root is valid only with --all-projects.");
        const capabilityProjectRoot = resolve(project ?? process.cwd());
        const correlationId = validCorrelationId(sessionId);
        const snapshot = contractEnabled
            ? await resolveCapabilityStatus({ projectRoot: capabilityProjectRoot })
            : undefined;
        const capabilityOptions = snapshot === undefined ? undefined : {
            projectRoot: capabilityProjectRoot,
            snapshot,
            capabilityId: "notes.distill" as const,
            classification: {
                harness: "other" as const,
                source: "notes-cli" as const,
                transport: "local-process" as const,
            },
            ...(correlationId === undefined ? {} : { correlationId }),
        };
        const capability = snapshot?.capabilities.find(({ id }) => id === "notes.distill");
        if (contractEnabled && capability?.enabled !== true) {
            if (capabilityOptions) await startOperatingCapability(capabilityOptions);
            disabled(json);
            return;
        }
        if (allProjects) {
            const run = async () => {
                const projects = findTrajectoryProjects(paraRoot as string);
                const results = [];
                for (const projectRoot of projects) {
                    try {
                        results.push(await distillProject({ projectRoot }));
                    } catch (error) {
                        results.push({
                            schema_version: 1,
                            enabled: true,
                            project_root: projectRoot,
                            created: [], updated: [], already_processed: [], enrichment_skipped: [], enrichment_failed: [],
                            failed: [{ session_id: "*", error: error instanceof Error ? error.message : String(error) }],
                        });
                    }
                }
                return { schema_version: 1, enabled: true, projects_scanned: projects.length, results };
            };
            const execute = () => contractEnabled ? withEnabledCompatibility(run) : run();
            const value = await (capabilityOptions ? withCapability(capabilityOptions, execute)() : execute());
            output(value, json, `Scanned ${value.projects_scanned} project(s).`);
            return;
        }
        const distill = () => distillProject({ projectRoot: capabilityProjectRoot, ...(sessionId ? { sessionId } : {}) });
        const run = () => contractEnabled ? withEnabledCompatibility(distill) : distill();
        const value = await (capabilityOptions ? withCapability(capabilityOptions, run)() : run());
        output(value, json, `Created ${value.created.length}, updated ${value.updated.length}, already processed ${value.already_processed.length}.`);
        return;
    }
    if (!isNoteDistillationEnabled()) {
        disabled(json);
        return;
    }
    if (command === "search-error") {
        assertKnown(args, ["--project", "--text", "--component", "--json"]);
        const text = valueAfter(args, "--text") ?? await readStdin();
        if (!text.trim()) throw new Error("search-error requires --text or error text on stdin.");
        const projectRoot = resolve(valueAfter(args, "--project") ?? process.cwd());
        const value = await searchHindsight({ projectRoot, text, component: valueAfter(args, "--component") });
        output(value, json, value.results.length > 0 ? value.results.map((item) => `${item.status ?? "note"}\t${item.id}\t${item.path}`).join("\n") : "No exact hindsight match found.");
        return;
    }
    if (command === "promote") {
        assertKnown(args, ["--with", "--confirm", "--json"], 1);
        const source = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--with");
        const corroborating = valueAfter(args, "--with");
        if (!source || !corroborating) throw new Error("promote requires NOTE-ID --with NOTE-ID.");
        const value = await promoteNotes({ sourceNoteId: source, corroboratingNoteId: corroborating, confirm: args.includes("--confirm") });
        output(value, json, `Promoted ${source} and ${corroborating} to ${value.shared_id}.`);
        return;
    }
    if (command === "doctor") {
        assertKnown(args, ["--repair", "--json"]);
        const value = doctorNoteStore(args.includes("--repair"));
        output(value, json, value.ok ? "Note store is healthy." : value.issues.join("\n"));
        if (!value.ok) process.exitCode = 2;
        return;
    }
    throw new Error(`unknown notes command "${command}".`);
}

try {
    await main();
} catch (error) {
    process.stderr.write(`cairn notes: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
}
