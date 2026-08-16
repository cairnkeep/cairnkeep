#!/usr/bin/env node
import { getArtifactLimits, type ArtifactKind } from "./artifact-schema.js";
import {
    deleteArtifact,
    doctorArtifactStore,
    listArtifacts,
    pruneArtifacts,
    putArtifact,
    readArtifact,
    recordUnsupportedCompactionAdapter,
} from "./artifact-store.js";
import {
    normalizeClaudePostCompact,
    normalizeOpenCodeCompaction,
    renderCompactionRecovery,
    selectCompactionRecovery,
} from "./compaction-normalize.js";

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
});

function usage(): string {
    return `cairn artifact — local immutable artifacts

Usage:
  cairn artifact list [--kind K] [--session REF] [--json]
  cairn artifact show <artifact-id-or-prefix> [--json]
  cairn artifact delete <artifact-id-or-prefix> [--dry-run] [--json]
  cairn artifact prune [--dry-run] [--include-protected] [--json]
`;
}

function hasFlag(args: string[], flag: string): boolean {
    return args.includes(flag);
}

function option(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
}

function publicList(value: Awaited<ReturnType<typeof listArtifacts>>) {
    return {
        ...value,
        artifacts: value.artifacts.map(({ content: _content, ...artifact }) => artifact),
    };
}

function humanList(value: ReturnType<typeof publicList>): string {
    if (value.artifacts.length === 0) return "No local artifacts found.";
    return `${value.artifacts.map((artifact) => [artifact.artifact_id, artifact.kind, artifact.session_ref, artifact.created_at, `${artifact.logical_bytes} bytes`].join("\t")).join("\n")}\n${value.artifacts.length} artifact(s), ${value.logical_bytes} logical bytes`;
}

function humanShow(value: Awaited<ReturnType<typeof readArtifact>>): string {
    return [
        `Artifact: ${value.artifact_id}`,
        `Kind: ${value.kind}`,
        `Session: ${value.session_ref}`,
        `Created: ${value.created_at}`,
        `Digest: ${value.content_digest}`,
        "",
        JSON.stringify(value.content, null, 2),
    ].join("\n");
}

function artifactInput(normalized: NonNullable<ReturnType<typeof normalizeClaudePostCompact> | ReturnType<typeof normalizeOpenCodeCompaction>>) {
    return {
        kind: "compaction_summary" as const,
        session_ref: normalized.session_ref,
        media_type: "text/markdown",
        provenance: {
            producer: normalized.harness === "claude-code" ? "claude-post-compact" : "opencode-session-compacted",
            source_event: normalized.source_event,
            harness: normalized.harness,
            harness_version: normalized.harness_version,
            ...("native_id" in normalized ? { native_id: normalized.native_id } : {}),
        },
        content: {
            raw_summary: normalized.raw_summary,
            ...normalized.projection,
            trigger: normalized.trigger,
        },
    };
}

async function captureClaude(projectRoot: string, args: string[]): Promise<void> {
    const harnessVersion = option(args, "--harness-version") ?? "unknown";
    const normalized = normalizeClaudePostCompact(JSON.parse(await readStdin()), { harnessVersion });
    if (!normalized) {
        await recordUnsupportedCompactionAdapter(projectRoot, {
            harness: "claude-code",
            harness_version: harnessVersion === "unknown" ? undefined : harnessVersion,
            reason: ["2.1.219", "2.1.220"].includes(harnessVersion) ? "invalid_shape" : "unsupported_version",
        });
        return;
    }
    const result = await putArtifact(projectRoot, artifactInput(normalized));
    const { linkActiveWorkEvidence } = await import("./work-evidence-store.js");
    await linkActiveWorkEvidence(projectRoot, { kind: "artifact", artifact_id: result.artifact.artifact_id });
}

async function captureOpenCode(projectRoot: string): Promise<void> {
    const raw = JSON.parse(await readStdin()) as { event?: unknown; session?: unknown; messages?: unknown; harness_version?: unknown };
    const version = typeof raw.harness_version === "string"
        ? raw.harness_version
        : typeof (raw.session as { version?: unknown } | undefined)?.version === "string"
            ? String((raw.session as { version: string }).version) : "1.17.20";
    const normalized = normalizeOpenCodeCompaction(raw.event, raw.session, raw.messages, { harnessVersion: version });
    if (!normalized) {
        await recordUnsupportedCompactionAdapter(projectRoot, { harness: "opencode", harness_version: version, reason: "unsupported_version" });
        return;
    }
    const result = await putArtifact(projectRoot, artifactInput(normalized));
    const { linkActiveWorkEvidence } = await import("./work-evidence-store.js");
    await linkActiveWorkEvidence(projectRoot, { kind: "artifact", artifact_id: result.artifact.artifact_id });
}

async function recover(projectRoot: string, args: string[]): Promise<void> {
    const listed = await listArtifacts(projectRoot, { kind: "compaction_summary" });
    const selected = selectCompactionRecovery(listed.artifacts, {
        currentSessionRef: option(args, "--session-ref"),
        now: new Date(),
        staleAfterSeconds: 86400,
    });
    if (!selected) return;
    process.stdout.write(`${hasFlag(args, "--json") ? JSON.stringify(selected) : renderCompactionRecovery(selected)}${hasFlag(args, "--json") ? "\n" : ""}`);
}

async function main(): Promise<void> {
    const [command = "help", ...args] = process.argv.slice(2);
    if (command === "capture-claude" || command === "capture-opencode") {
        const projectRoot = args.find((arg) => !arg.startsWith("-"));
        if (!projectRoot) return;
        try {
            if (command === "capture-claude") await captureClaude(projectRoot, args);
            else await captureOpenCode(projectRoot);
        } catch {
            process.stderr.write("artifact capture skipped: local validation or persistence failed\n");
        }
        return;
    }
    try {
        if (command === "list") {
            const kind = option(args, "--kind") as ArtifactKind | undefined;
            const value = publicList(await listArtifacts(process.cwd(), { kind, session_ref: option(args, "--session") }));
            process.stdout.write(`${hasFlag(args, "--json") ? JSON.stringify(value) : humanList(value)}\n`);
            return;
        }
        if (command === "show") {
            const identifier = args.find((arg) => !arg.startsWith("-"));
            if (!identifier) throw new Error("show requires an artifact ID or unambiguous prefix.");
            const value = await readArtifact(identifier, process.cwd());
            process.stdout.write(`${hasFlag(args, "--json") ? JSON.stringify(value) : humanShow(value)}\n`);
            return;
        }
        if (command === "delete") {
            const identifier = args.find((arg) => !arg.startsWith("-"));
            if (!identifier) throw new Error("delete requires an artifact ID or unambiguous prefix.");
            const value = await deleteArtifact(identifier, process.cwd(), { dryRun: hasFlag(args, "--dry-run") });
            process.stdout.write(`${hasFlag(args, "--json") ? JSON.stringify(value) : `${value.deleted ? "Deleted" : "Would delete"} ${value.artifact_id}.`}\n`);
            return;
        }
        if (command === "prune") {
            const includeProtected = hasFlag(args, "--include-protected");
            const value = await pruneArtifacts(process.cwd(), getArtifactLimits(), {
                dryRun: hasFlag(args, "--dry-run"), includeProtected,
            });
            const output = { ...value, include_protected: includeProtected };
            process.stdout.write(`${hasFlag(args, "--json") ? JSON.stringify(output) : `${value.dry_run ? "Would remove" : "Removed"} ${value.removed.length} artifact(s); ${value.remaining_artifacts} remain.`}\n`);
            return;
        }
        if (command === "recover") {
            const projectRoot = args.find((arg) => !arg.startsWith("-")) ?? process.cwd();
            await recover(projectRoot, args);
            return;
        }
        if (command === "doctor") {
            const value = await doctorArtifactStore(process.cwd(), hasFlag(args, "--repair"));
            process.stdout.write(`${JSON.stringify(value)}\n`);
            if (!value.ok) process.exitCode = 2;
            return;
        }
        if (command === "help" || command === "--help" || command === "-h") {
            process.stdout.write(usage());
            return;
        }
        throw new Error(`unknown artifact command "${command}".`);
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        process.stderr.write(`cairn artifact: ${message}\n`);
        process.exitCode = 2;
    }
}

await main();
