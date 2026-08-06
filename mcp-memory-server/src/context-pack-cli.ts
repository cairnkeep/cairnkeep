import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
    applyContextPackUpdate,
    approvePackSkill,
    contextPackBaseDirectory,
    disableContextPack,
    doctorContextPacks,
    enableContextPack,
    initializeContextPack,
    inspectContextPackUpdate,
    installContextPack,
    listInstalledContextPacks,
    listPackSkills,
    lockContextPack,
    readProjectPointer,
    removeContextPack,
    resolveInstalledPack,
    revokePackSkill,
    validateContextPack,
} from "./context-pack.js";

function usage(): never {
    process.stderr.write(`Usage:
  cairn pack init [DIRECTORY] [--id ID] [--version VERSION] [--title TITLE] [--description TEXT] [--license LICENSE]
  cairn pack lock|validate [DIRECTORY]
  cairn pack install SOURCE [--ref REF]
  cairn pack list [--json]
  cairn pack show SELECTOR [--json]
  cairn pack remove SELECTOR
  cairn pack enable|disable SELECTOR [--project PATH | --project-id ID]
  cairn pack update SELECTOR --check [--project PATH | --project-id ID]
  cairn pack update SELECTOR --apply --confirm DIGEST [--project PATH | --project-id ID]
  cairn pack skills [--project PATH | --project-id ID] [--json]
  cairn pack approve-skill SELECTOR PATH --confirm FILE_DIGEST [--project PATH | --project-id ID]
  cairn pack revoke-skill SELECTOR PATH [--project PATH | --project-id ID]
`);
    process.exit(2);
}

function take(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) usage();
    args.splice(index, 2);
    return value;
}

function flag(args: string[], name: string): boolean {
    const index = args.indexOf(name);
    if (index < 0) return false;
    args.splice(index, 1);
    return true;
}

function projectOptions(args: string[]): { projectRoot?: string; projectId?: string } {
    const projectRoot = take(args, "--project");
    const projectId = take(args, "--project-id");
    if (projectRoot && projectId) usage();
    return projectId ? { projectId } : { projectRoot: projectRoot ?? process.cwd() };
}

function output(value: unknown, json: boolean, human?: string): void {
    process.stdout.write(`${json ? JSON.stringify(value) : human ?? JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const command = args.shift();
    const json = flag(args, "--json");

    if (command === "init") {
        const directory = args[0] && !args[0].startsWith("--") ? args.shift()! : process.cwd();
        const manifest = await initializeContextPack(directory, {
            id: take(args, "--id"), version: take(args, "--version"), title: take(args, "--title"),
            description: take(args, "--description"), license: take(args, "--license"),
        });
        if (args.length) usage();
        output(manifest, json, `Initialized ${resolve(directory)}/context-pack.json`);
        return;
    }
    if (command === "lock" || command === "validate") {
        const directory = args.shift() ?? process.cwd();
        if (args.length) usage();
        const result = command === "lock" ? await lockContextPack(directory) : await validateContextPack(directory);
        output(result, json, command === "lock" ? `Locked ${resolve(directory)}/context-pack.json` : `Valid context pack: ${(result as Awaited<ReturnType<typeof validateContextPack>>).digest}`);
        return;
    }
    if (command === "install") {
        const source = args.shift();
        if (!source) usage();
        const ref = take(args, "--ref");
        if (args.length) usage();
        const result = await installContextPack(source, { ref });
        output({ id: result.pack.manifest.id, version: result.pack.manifest.version, digest: result.pack.digest, source: result.source, existing: result.existing }, json, `${result.existing ? "Already installed" : "Installed"} ${result.pack.manifest.id}@${result.pack.manifest.version} ${result.pack.digest}`);
        return;
    }
    if (command === "list") {
        if (args.length) usage();
        const packs = await listInstalledContextPacks();
        output({ schema_version: 1, packs }, json, packs.length ? packs.map((pack) => `${pack.id}@${pack.version}\t${pack.digest}`).join("\n") : "No context packs installed.");
        return;
    }
    if (command === "show") {
        const selector = args.shift();
        if (!selector || args.length) usage();
        const pack = await resolveInstalledPack(selector);
        output({ ...pack.manifest, digest: pack.digest, total_bytes: pack.total_bytes }, json);
        return;
    }
    if (command === "remove") {
        const selector = args.shift();
        if (!selector || args.length) usage();
        const digest = await removeContextPack(selector);
        output({ removed: true, digest }, json, `Removed context pack ${digest}.`);
        return;
    }
    if (command === "enable" || command === "disable") {
        const selector = args.shift();
        if (!selector) usage();
        const project = projectOptions(args);
        if (args.length) usage();
        const pointer = command === "enable" ? await enableContextPack(selector, project) : await disableContextPack(selector, project);
        output(pointer, json, `${command === "enable" ? "Enabled" : "Disabled"} context pack ${selector}.`);
        return;
    }
    if (command === "update") {
        const selector = args.shift();
        if (!selector) usage();
        const check = flag(args, "--check");
        const apply = flag(args, "--apply");
        const confirm = take(args, "--confirm");
        const project = projectOptions(args);
        if (args.length || check === apply || (apply && !confirm) || (check && confirm)) usage();
        const result = check ? await inspectContextPackUpdate(selector, project) : await applyContextPackUpdate(selector, confirm!, project);
        output(result, json, check ? `${result.changed ? "Update available" : "Up to date"}: ${result.candidate_digest}` : `Applied context pack update ${result.candidate_digest}.`);
        return;
    }
    if (command === "skills") {
        const project = projectOptions(args);
        if (args.length) usage();
        const skills = await listPackSkills(project);
        output({ schema_version: 1, skills }, json, skills.length ? skills.map((row) => `${row.approved ? "approved" : "unapproved"}\t${row.pack_id}\t${row.path}\t${row.file_digest}`).join("\n") : "No context pack skills.");
        return;
    }
    if (command === "approve-skill" || command === "revoke-skill") {
        const selector = args.shift();
        const path = args.shift();
        if (!selector || !path) usage();
        const confirm = take(args, "--confirm");
        const project = projectOptions(args);
        if (args.length || (command === "approve-skill" && !confirm) || (command === "revoke-skill" && confirm)) usage();
        const pointer = command === "approve-skill"
            ? await approvePackSkill(selector, path, confirm!, project)
            : await revokePackSkill(selector, path, project);
        output(pointer, json, `${command === "approve-skill" ? "Approved" : "Revoked"} ${path}.`);
        return;
    }
    if (command === "doctor") {
        if (args.length) usage();
        const result = await doctorContextPacks();
        output(result, json, result.ok ? `Context packs healthy (${result.objects} objects, ${result.projects} projects).` : `Context pack problems: ${[...result.issues, ...result.temporary_remnants].join("; ")}`);
        if (!result.ok) process.exitCode = 1;
        return;
    }
    if (command === "purge") {
        if (!flag(args, "--yes") || args.length) usage();
        const base = contextPackBaseDirectory();
        if (existsSync(base)) await rm(base, { recursive: true, force: true });
        output({ purged: true, path: base }, json, `Purged context pack data at ${base}.`);
        return;
    }
    if (command === "status") {
        const project = projectOptions(args);
        if (args.length) usage();
        const pointer = readProjectPointer(project);
        output(pointer, json);
        return;
    }
    usage();
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
