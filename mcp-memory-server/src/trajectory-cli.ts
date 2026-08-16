#!/usr/bin/env node
import { fitTrajectoryToBytes, normalizeClaudeTranscript, normalizeOpenCodeSession, normalizePiSession } from "./trajectory-normalize.js";
import { redactTrajectory } from "./trajectory-redaction.js";
import { getTrajectoryLimits } from "./trajectory-schema.js";
import { doctorTrajectoryStore, listTrajectories, pruneTrajectories, putTrajectory, showTrajectory } from "./trajectory-store.js";

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
});

function usage(): string {
    return `cairn trajectory — local structured session trajectories

Usage:
  cairn trajectory list [--json]
  cairn trajectory show <session-id-or-prefix> [--json]
  cairn trajectory prune [--dry-run] [--json]
`;
}

function hasFlag(args: string[], flag: string): boolean {
    return args.includes(flag);
}

function humanList(value: Awaited<ReturnType<typeof listTrajectories>>): string {
    if (value.sessions.length === 0) return "No local trajectories found.";
    const lines = value.sessions.map((entry) => [
        entry.session_id,
        entry.harness,
        entry.ended_at,
        `${entry.event_count} events`,
        `${entry.logical_bytes} bytes`,
    ].join("\t"));
    return `${lines.join("\n")}\n${value.sessions.length} session(s), ${value.logical_bytes} logical bytes`;
}

function humanShow(value: Awaited<ReturnType<typeof showTrajectory>>): string {
    return [
        `Session: ${value.session_id}`,
        `Harness: ${value.harness}`,
        `Started: ${value.started_at}`,
        `Ended: ${value.ended_at}`,
        `Events: ${value.events.length}`,
        `Truncated: ${value.capture.truncated ? "yes" : "no"}`,
        "",
        JSON.stringify(value.events, null, 2),
    ].join("\n");
}

function humanPrune(value: Awaited<ReturnType<typeof pruneTrajectories>>): string {
    const prefix = value.dry_run ? "Would remove" : "Removed";
    return `${prefix} ${value.removed.length} session(s); ${value.remaining_sessions} remain (${value.logical_bytes} logical bytes).`;
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
}

async function captureClaude(args: string[]): Promise<void> {
    const [transcriptPath, projectRoot] = args;
    if (!transcriptPath || !projectRoot) throw new Error("capture-claude requires a transcript path and project root.");
    const limits = getTrajectoryLimits();
    const normalized = await normalizeClaudeTranscript(transcriptPath, projectRoot);
    const redacted = redactTrajectory(normalized, projectRoot);
    const fitted = fitTrajectoryToBytes(redacted, limits.sessionMaxBytes);
    const stored = await putTrajectory(projectRoot, fitted, limits);
    const { linkActiveWorkEvidence } = await import("./work-evidence-store.js");
    await linkActiveWorkEvidence(projectRoot, { kind: "trajectory", trajectory_id: stored.session_id });
}

async function captureOpenCode(args: string[]): Promise<void> {
    const [projectRoot] = args;
    if (!projectRoot) throw new Error("capture-opencode requires a project root.");
    const limits = getTrajectoryLimits();
    const normalized = normalizeOpenCodeSession(JSON.parse(await readStdin()), projectRoot);
    const redacted = redactTrajectory(normalized, projectRoot);
    const fitted = fitTrajectoryToBytes(redacted, limits.sessionMaxBytes);
    const stored = await putTrajectory(projectRoot, fitted, limits);
    const { linkActiveWorkEvidence } = await import("./work-evidence-store.js");
    await linkActiveWorkEvidence(projectRoot, { kind: "trajectory", trajectory_id: stored.session_id });
}

async function capturePi(args: string[]): Promise<void> {
    const [projectRoot] = args;
    if (!projectRoot) throw new Error("capture-pi requires a project root.");
    const limits = getTrajectoryLimits();
    const normalized = normalizePiSession(JSON.parse(await readStdin()), projectRoot);
    const redacted = redactTrajectory(normalized, projectRoot);
    const fitted = fitTrajectoryToBytes(redacted, limits.sessionMaxBytes);
    const stored = await putTrajectory(projectRoot, fitted, limits);
    const { linkActiveWorkEvidence } = await import("./work-evidence-store.js");
    await linkActiveWorkEvidence(projectRoot, { kind: "trajectory", trajectory_id: stored.session_id });
}

async function main(): Promise<void> {
    const [command = "help", ...args] = process.argv.slice(2);
    if (command === "capture-claude" || command === "capture-opencode" || command === "capture-pi") {
        try {
            if (command === "capture-claude") await captureClaude(args);
            else if (command === "capture-opencode") await captureOpenCode(args);
            else await capturePi(args);
        } catch {
            process.stderr.write("trajectory capture skipped: local validation or persistence failed\n");
        }
        return;
    }

    try {
        if (command === "list") {
            const value = await listTrajectories(process.cwd());
            process.stdout.write(`${hasFlag(args, "--json") ? JSON.stringify(value) : humanList(value)}\n`);
            return;
        }
        if (command === "show") {
            const identifier = args.find((arg) => !arg.startsWith("-"));
            if (!identifier) throw new Error("show requires a session ID or unambiguous prefix.");
            const value = await showTrajectory(identifier, process.cwd());
            process.stdout.write(`${hasFlag(args, "--json") ? JSON.stringify(value) : humanShow(value)}\n`);
            return;
        }
        if (command === "prune") {
            const value = await pruneTrajectories(process.cwd(), getTrajectoryLimits(), hasFlag(args, "--dry-run"));
            process.stdout.write(`${hasFlag(args, "--json") ? JSON.stringify(value) : humanPrune(value)}\n`);
            return;
        }
        if (command === "doctor") {
            const value = await doctorTrajectoryStore(process.cwd(), hasFlag(args, "--repair"));
            process.stdout.write(`${JSON.stringify(value)}\n`);
            if (!value.ok) process.exitCode = 2;
            return;
        }
        if (command === "help" || command === "--help" || command === "-h") {
            process.stdout.write(usage());
            return;
        }
        throw new Error(`unknown trajectory command "${command}".`);
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        process.stderr.write(`cairn trajectory: ${message}\n`);
        process.exitCode = 2;
    }
}

await main();
