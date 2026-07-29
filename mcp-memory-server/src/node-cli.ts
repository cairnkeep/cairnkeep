#!/usr/bin/env node
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { doctorNoteStore } from "./note-store.js";
import { doctorTypedNodeStore, type TypedNodeDoctorResult } from "./node-store.js";

type ScopeDiagnosis = TypedNodeDoctorResult & { scope: string; path: string };

function baseDirectory(): string {
    const value = process.env.CAIRN_AGENTFS_BASE_DIR?.trim();
    if (!value || value === "~") return join(process.env.HOME ?? "", ".cairnkeep");
    if (value.startsWith("~/")) return join(process.env.HOME ?? "", value.slice(2));
    return resolve(value);
}

function databasePaths(projectRoot: string): string[] {
    const base = baseDirectory();
    const candidates: string[] = [];
    const addFiles = (directory: string): void => {
        if (!existsSync(directory) || lstatSync(directory).isSymbolicLink()) return;
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (candidates.length >= 1024) throw new Error("Database enumeration exceeded the 1024-file safety bound.");
            if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".db")) candidates.push(join(directory, entry.name));
        }
    };
    addFiles(base);
    addFiles(join(base, "projects"));
    const local = join(resolve(projectRoot), ".agentfs", "project.db");
    if (existsSync(local) && !lstatSync(local).isSymbolicLink()) candidates.push(local);
    return [...new Set(candidates)].sort();
}

export async function doctorNodes(options: { repair?: boolean; projectRoot?: string } = {}): Promise<{
    schema_version: 1;
    exists: boolean;
    ok: boolean;
    repaired: boolean;
    scopes: ScopeDiagnosis[];
    notes: ReturnType<typeof doctorNoteStore>;
    issues: string[];
}> {
    const scopes: ScopeDiagnosis[] = [];
    const issues: string[] = [];
    try {
        for (const path of databasePaths(options.projectRoot ?? process.cwd())) {
            const scope = basename(path, ".db");
            const result = await doctorTypedNodeStore({ scope, baseDir: dirname(path), repair: options.repair });
            scopes.push({ scope, path, ...result });
            issues.push(...result.issues.map((issue) => `${scope}: ${issue}`));
        }
    } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error));
    }
    const notes = doctorNoteStore(options.repair ?? false);
    issues.push(...notes.issues.map((issue) => `notes: ${issue}`));
    const exists = scopes.length > 0 || notes.exists;
    return {
        schema_version: 1,
        exists,
        ok: issues.length === 0 && scopes.every((scope) => scope.ok) && notes.ok,
        repaired: scopes.some((scope) => scope.repaired) || notes.repaired,
        scopes,
        notes,
        issues,
    };
}

async function main(): Promise<void> {
    const [command, ...args] = process.argv.slice(2);
    if (command !== "doctor") throw new Error("Usage: node node-cli.js doctor [--repair] [--project-root PATH]");
    let repair = false;
    let projectRoot = process.cwd();
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === "--repair") repair = true;
        else if (args[index] === "--project-root" && args[index + 1]) projectRoot = args[++index];
        else throw new Error(`Unknown node doctor option: ${args[index]}`);
    }
    const result = await doctorNodes({ repair, projectRoot });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
