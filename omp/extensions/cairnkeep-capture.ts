import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// omp port of the claude/hooks memory-capture + memory-wakeup pair (D-03/D-04,
// OCP-01/OCP-05 contracts).
//
// CAPTURE: on the first `session_stop` of a main session (the event never
// fires for task/subagent sessions and is awaited while the process is fully
// alive), the session branch is converted to transcript text and piped to a
// DETACHED, unref'd `node scripts/lib/omp-capture-stage.mjs` child that runs
// the shared `extract` subcommand and stages candidates under
// .planning/memory-staging/ — so staging survives even if the agent process
// exits before the extraction call returns. Extraction candidates are staged
// for review only; writes to AgentFS stay agent-gated via the memory_* tools
// from cairnkeep-memory.ts.
//
// WAKEUP: on `session_start` of the main session (and only when the extension
// runtime is initialized — omp's title-generation ephemeral agents rebind
// extensions with uninitialized action stubs), staged candidates are surfaced
// via a UI notification and a `deliverAs: "nextTurn"` context message injected
// at the next real user turn. `/cairn-staged` lists staged files on demand.
//
// Fail-open everywhere: every guard is a cheap check and every path is
// try/caught so a throw can never reach the extension runner.
const CAIRN_ROOT = "@@INFRA_ROOT@@";
const SERVER_ENTRY = join(CAIRN_ROOT, "mcp-memory-server", "dist", "index.js");
const STAGE_ENTRY = join(CAIRN_ROOT, "scripts", "lib", "omp-capture-stage.mjs");

const MAX_TEXT_CHARS = 12000;
const STAGED_MAX_FILES = 5;
const STAGED_FILE_READ_CAP = 8192;
const STAGED_CUSTOM_TYPE = "sh.cairnkeep.staged-memory";

// Minimal structural view of omp's persisted SessionEntry (entry.type
// "message", camelCase role per docs/extensions.md); anything else is skipped.
type BranchEntry = {
    type?: string;
    message?: {
        role?: string;
        content?: unknown;
    };
};

type SessionStopLike = {
    type: "session_stop";
    session_id?: string;
};

function transcriptText(branch: BranchEntry[]): string {
    const turns: string[] = [];
    for (const entry of branch) {
        if (entry?.type !== "message") continue;
        const role = entry.message?.role;
        if (role !== "user" && role !== "assistant") continue;
        if (!Array.isArray(entry.message?.content)) continue;
        const text = (entry.message.content as Array<{ type?: string; text?: unknown }>)
            .filter((block) => block && block.type === "text" && typeof block.text === "string")
            .map((block) => block.text as string)
            .join("\n")
            .trim();
        if (!text) continue;
        turns.push(`${role === "user" ? "USER" : "ASSISTANT"}: ${text}`);
    }
    let out = turns.join("\n\n");
    if (out.length > MAX_TEXT_CHARS) out = out.slice(-MAX_TEXT_CHARS);
    return out;
}

// Same detection as cairnkeep-memory.ts: omp rebinds extensions to ephemeral
// side-turn runtimes whose action methods are uninitialized throwing stubs.
function runtimeUninitialized(pi: ExtensionAPI): boolean {
    try {
        pi.getAllTools();
        return false;
    } catch (error) {
        if (error instanceof Error && error.message.includes("Extension runtime not initialized")) return true;
        throw error;
    }
}

type StagedCandidate = {
    file: string;
    count: number;
};

// Bounded staged-candidate scan: the STAGED_MAX_FILES most recent *.json
// files, each read capped, malformed JSON skipped (fail-open).
function stagedCandidates(repo: string): StagedCandidate[] {
    const stagingDir = join(repo, ".planning", "memory-staging");
    if (!existsSync(stagingDir)) return [];
    const files = readdirSync(stagingDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => ({ name, mtime: statSync(join(stagingDir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, STAGED_MAX_FILES)
        .map(({ name }) => name);
    const staged: StagedCandidate[] = [];
    for (const file of files) {
        try {
            const path = join(stagingDir, file);
            if (statSync(path).size > STAGED_FILE_READ_CAP) continue;
            const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
            const count = Array.isArray((parsed as { candidates?: unknown })?.candidates)
                ? ((parsed as { candidates: unknown[] }).candidates.length)
                : 0;
            if (count > 0) staged.push({ file, count });
        } catch {
            // Malformed staged file — skip it, never wedge session start.
        }
    }
    return staged;
}

export default function cairnCaptureExtension(pi: ExtensionAPI): void {
    const capturedSessions = new Set<string>();

    pi.on("session_stop", async (event: SessionStopLike, ctx: ExtensionContext) => {
        try {
            if (ctx.agent?.kind !== "main") return;
            const sessionId = typeof event?.session_id === "string" ? event.session_id : "";
            // One capture attempt per session, no matter how many times
            // session_stop fires for it (continuation cap).
            if (!sessionId || capturedSessions.has(sessionId)) return;

            const repo = ctx.cwd;
            // Cheap guards first, mirroring the claude hook's ordering.
            if (!existsSync(join(repo, ".agentfs", "project.db"))) return;
            if (!existsSync(SERVER_ENTRY)) return;
            if (!existsSync(STAGE_ENTRY)) return;
            const apiKey = process.env.CAIRN_LLM_API_KEY;
            const model = process.env.CAIRN_LLM_EXTRACTION_MODEL;
            if (!apiKey || !model) return;

            // Mark before the async boundary so a re-fire never double-stages.
            capturedSessions.add(sessionId);

            let text = "";
            try {
                text = transcriptText(ctx.sessionManager.getBranch() as BranchEntry[]);
            } catch {
                return;
            }
            if (!text) return;

            // Detached + unref'd: the staging child outlives the agent process,
            // so the result lands even if omp exits right after settle.
            const child = spawn(
                process.execPath,
                [STAGE_ENTRY, repo, SERVER_ENTRY, model],
                { detached: true, stdio: ["pipe", "ignore", "ignore"] },
            );
            child.on("error", () => undefined);
            child.stdin.on("error", () => undefined);
            child.stdin.write(text);
            child.stdin.end();
            child.unref();
        } catch {
            // Fail open — never block session settle because capture failed.
        }
    });

    pi.on("session_start", async (_event, ctx: ExtensionContext) => {
        try {
            if (ctx.agent?.kind !== "main") return;
            if (runtimeUninitialized(pi)) return;
            const staged = stagedCandidates(ctx.cwd);
            if (staged.length === 0) return;

            const notice =
                `${staged.length} memory candidate file(s) staged for review in ` +
                `.planning/memory-staging/ (${staged.reduce((total, { count }) => total + count, 0)} candidate(s) from ` +
                "the previous session's transcript). Review them and write accepted ones with the memory_write tool " +
                "(agent-gated), then remove or rename the staged file. Do not write to AgentFS without that review.";
            if (ctx.hasUI) ctx.ui.notify(notice, "info");
            pi.sendMessage(
                {
                    customType: STAGED_CUSTOM_TYPE,
                    content: notice,
                    attribution: "agent",
                    display: false,
                },
                { deliverAs: "nextTurn" },
            );
        } catch {
            // Fail open — never block session start because wakeup failed.
        }
    });

    pi.registerCommand("cairn-staged", {
        description: "List staged memory candidates awaiting review",
        handler: async (_args, ctx: ExtensionContext) => {
            try {
                const stagingDir = join(ctx.cwd, ".planning", "memory-staging");
                if (!existsSync(stagingDir)) {
                    if (ctx.hasUI) ctx.ui.notify("No staged memory candidates (.planning/memory-staging is absent).", "info");
                    return;
                }
                const files = readdirSync(stagingDir)
                    .filter((name) => name.endsWith(".json"))
                    .map((name) => ({ name, mtime: statSync(join(stagingDir, name)).mtimeMs }))
                    .sort((a, b) => b.mtime - a.mtime)
                    .slice(0, STAGED_MAX_FILES)
                    .map(({ name }) => name);
                if (files.length === 0) {
                    if (ctx.hasUI) ctx.ui.notify("No staged memory candidates.", "info");
                    return;
                }
                const sections = files.map((file) => {
                    let body: string;
                    try {
                        body = readFileSync(join(stagingDir, file), "utf8").slice(0, STAGED_FILE_READ_CAP);
                    } catch {
                        body = "(unreadable)";
                    }
                    return `### ${file}\n${body}`;
                });
                const listing = `Staged memory candidates — review, then accept via memory_write or discard.\n\n${sections.join("\n\n")}`;
                if (ctx.hasUI) ctx.ui.notify(listing, "info");
            } catch {
                // Fail open — command inspection is best-effort.
            }
        },
    });
}
