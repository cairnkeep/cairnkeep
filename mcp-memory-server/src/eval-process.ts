import { spawn, spawnSync, type ChildProcess } from "node:child_process";

import type { ZodType } from "zod";

import {
    evalAdapterRequestSchema,
    evalAdapterResultSchema,
    type EvalAdapterRequest,
    type EvalAdapterResult,
    type EvalCommand,
} from "./eval-schema.js";

export const EVAL_PROCESS_ERROR_CODES = [
    "spawn_error",
    "timeout",
    "cancelled",
    "stdout_overflow",
    "invalid_utf8",
    "multiple_json",
    "invalid_json",
    "invalid_request",
    "invalid_result",
    "adapter_error",
    "stdin_error",
    "cleanup_failed",
] as const;

export type EvalProcessErrorCode = (typeof EVAL_PROCESS_ERROR_CODES)[number];
export type EvalCleanupOutcome = "closed" | "terminated" | "killed" | "failed";
export type EvalTerminationScope = "process-group" | "process-tree";

type SharedCommandOptions = {
    command: EvalCommand;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout_ms: number;
    max_stdout_bytes: number;
    kill_grace_ms?: number;
    signal?: AbortSignal;
};

export type BoundedCommandOptions = SharedCommandOptions & {
    stdout_mode: "raw" | "exit-only";
};

export type BoundedCommandResult = {
    exit_code: number | null;
    signal: NodeJS.Signals | null;
    cleanup: EvalCleanupOutcome;
    termination_scope: EvalTerminationScope;
    stdout?: string;
};

export type BoundedJsonAdapterOptions = SharedCommandOptions & {
    request: EvalAdapterRequest;
};

export type BoundedJsonAdapterResult = Omit<BoundedCommandResult, "stdout"> & {
    result: EvalAdapterResult;
};

export type BoundedJsonProcessOptions<Request, Result> = SharedCommandOptions & {
    request: Request;
    request_schema: ZodType<Request>;
    result_schema: ZodType<Result>;
};

export type BoundedJsonProcessResult<Result> = Omit<BoundedCommandResult, "stdout"> & {
    result: Result;
};

export class EvalProcessError extends Error {
    readonly code: EvalProcessErrorCode;
    readonly exit_code: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly cleanup: EvalCleanupOutcome;
    readonly termination_scope: EvalTerminationScope;

    constructor(
        code: EvalProcessErrorCode,
        details: {
            exit_code?: number | null;
            signal?: NodeJS.Signals | null;
            cleanup?: EvalCleanupOutcome;
            termination_scope?: EvalTerminationScope;
        } = {},
    ) {
        super(code);
        this.name = "EvalProcessError";
        this.code = code;
        this.exit_code = details.exit_code ?? null;
        this.signal = details.signal ?? null;
        this.cleanup = details.cleanup ?? "closed";
        this.termination_scope = details.termination_scope ?? terminationScope();
    }
}

type InternalCommandOptions = BoundedCommandOptions & {
    stdin_document?: Buffer;
};

const DEFAULT_KILL_GRACE_MS = 1_000;
const MAX_TIMER_MS = 2_147_483_647;

function terminationScope(): EvalTerminationScope {
    return process.platform === "win32" ? "process-tree" : "process-group";
}

function assertOptions(options: SharedCommandOptions): void {
    if (!Number.isSafeInteger(options.timeout_ms) || options.timeout_ms <= 0 || options.timeout_ms > MAX_TIMER_MS) {
        throw new EvalProcessError("invalid_request");
    }
    if (!Number.isSafeInteger(options.max_stdout_bytes) || options.max_stdout_bytes < 0) {
        throw new EvalProcessError("invalid_request");
    }
    if (options.kill_grace_ms !== undefined
        && (!Number.isSafeInteger(options.kill_grace_ms) || options.kill_grace_ms < 0 || options.kill_grace_ms > MAX_TIMER_MS)) {
        throw new EvalProcessError("invalid_request");
    }
    if (!options.command.program || options.command.program.includes("\u0000")
        || options.command.args.some((argument) => argument.includes("\u0000"))) {
        throw new EvalProcessError("invalid_request");
    }
}

function signalChild(child: ChildProcess, signal: NodeJS.Signals): boolean {
    if (child.pid === undefined) return false;
    try {
        if (process.platform !== "win32") {
            process.kill(-child.pid, signal);
            return true;
        }
        const args = ["/PID", String(child.pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])];
        const result = spawnSync("taskkill.exe", args, { stdio: "ignore", windowsHide: true });
        return result.status === 0 || child.kill(signal);
    } catch {
        try {
            return child.kill(signal);
        } catch {
            return false;
        }
    }
}

async function runCommandInternal(options: InternalCommandOptions): Promise<BoundedCommandResult> {
    assertOptions(options);
    if (options.signal?.aborted) throw new EvalProcessError("cancelled");

    return new Promise((resolvePromise, rejectPromise) => {
        const scope = terminationScope();
        const graceMs = options.kill_grace_ms ?? DEFAULT_KILL_GRACE_MS;
        const captureStdout = options.stdout_mode === "raw";
        const chunks: Buffer[] = [];
        let stdoutBytes = 0;
        let terminalCode: EvalProcessErrorCode | null = null;
        let cleanup: EvalCleanupOutcome = "closed";
        let settled = false;
        let closed = false;
        let termSent = false;
        let killSent = false;
        let exitCode: number | null = null;
        let exitSignal: NodeJS.Signals | null = null;
        let graceTimer: NodeJS.Timeout | undefined;
        let closeTimer: NodeJS.Timeout | undefined;

        const child = spawn(options.command.program, options.command.args, {
            cwd: options.cwd,
            env: options.env,
            shell: false,
            detached: process.platform !== "win32",
            windowsHide: true,
            stdio: [options.stdin_document ? "pipe" : "ignore", captureStdout ? "pipe" : "ignore", "inherit"],
        });

        const clearTimers = (): void => {
            clearTimeout(timeoutTimer);
            if (graceTimer) clearTimeout(graceTimer);
            if (closeTimer) clearTimeout(closeTimer);
            options.signal?.removeEventListener("abort", onAbort);
        };

        const finish = (): void => {
            if (settled) return;
            settled = true;
            clearTimers();
            if (terminalCode) {
                rejectPromise(new EvalProcessError(terminalCode, {
                    exit_code: exitCode,
                    signal: exitSignal,
                    cleanup,
                    termination_scope: scope,
                }));
                return;
            }
            let stdout: string | undefined;
            if (captureStdout) {
                try {
                    stdout = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, stdoutBytes));
                } catch {
                    rejectPromise(new EvalProcessError("invalid_utf8", {
                        exit_code: exitCode,
                        signal: exitSignal,
                        cleanup,
                        termination_scope: scope,
                    }));
                    return;
                }
            }
            resolvePromise({
                exit_code: exitCode,
                signal: exitSignal,
                cleanup,
                termination_scope: scope,
                ...(stdout === undefined ? {} : { stdout }),
            });
        };

        const forceKill = (): void => {
            if (closed || killSent) return;
            killSent = true;
            cleanup = signalChild(child, "SIGKILL") ? "killed" : "failed";
            closeTimer = setTimeout(() => {
                if (closed) return;
                cleanup = "failed";
                terminalCode = terminalCode ?? "cleanup_failed";
                finish();
            }, Math.max(graceMs, 100));
            closeTimer.unref();
        };

        const terminate = (code: EvalProcessErrorCode): void => {
            if (terminalCode !== null || settled) return;
            terminalCode = code;
            child.stdout?.destroy();
            child.stdin?.destroy();
            if (!termSent) {
                termSent = true;
                cleanup = signalChild(child, "SIGTERM") ? "terminated" : "failed";
            }
            if (closed) {
                finish();
                return;
            }
            graceTimer = setTimeout(forceKill, graceMs);
            graceTimer.unref();
        };

        const onAbort = (): void => terminate("cancelled");
        options.signal?.addEventListener("abort", onAbort, { once: true });

        const timeoutTimer = setTimeout(() => terminate("timeout"), options.timeout_ms);
        timeoutTimer.unref();

        child.once("error", () => {
            if (closed || settled) return;
            terminalCode = terminalCode ?? "spawn_error";
            cleanup = "failed";
            finish();
        });

        child.stdout?.on("data", (value: Buffer | string) => {
            if (terminalCode !== null) return;
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
            stdoutBytes += chunk.byteLength;
            if (stdoutBytes > options.max_stdout_bytes) {
                chunks.length = 0;
                terminate("stdout_overflow");
                return;
            }
            chunks.push(Buffer.from(chunk));
        });

        child.once("close", (code, signal) => {
            if (settled) return;
            closed = true;
            exitCode = code;
            exitSignal = signal;
            if (!terminalCode) cleanup = "closed";
            finish();
        });

        if (options.stdin_document) {
            child.stdin?.once("error", () => terminate("stdin_error"));
            child.stdin?.end(options.stdin_document);
        }
    });
}

export async function runBoundedCommand(options: BoundedCommandOptions): Promise<BoundedCommandResult> {
    return runCommandInternal(options);
}

function hasTrailingJsonDocument(value: string): boolean {
    const document = value.trimStart();
    if (document[0] !== "{" && document[0] !== "[") return false;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < document.length; index += 1) {
        const character = document[index];
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === '"') quoted = false;
            continue;
        }
        if (character === '"') quoted = true;
        else if (character === "{" || character === "[") depth += 1;
        else if (character === "}" || character === "]") {
            depth -= 1;
            if (depth === 0) return document.slice(index + 1).trim().length > 0;
        }
    }
    return false;
}

export async function runBoundedJsonProcess<Request, Result>(
    options: BoundedJsonProcessOptions<Request, Result>,
): Promise<BoundedJsonProcessResult<Result>> {
    const request = options.request_schema.safeParse(options.request);
    if (!request.success) throw new EvalProcessError("invalid_request");
    const commandResult = await runCommandInternal({
        command: options.command,
        cwd: options.cwd,
        env: options.env,
        timeout_ms: options.timeout_ms,
        max_stdout_bytes: options.max_stdout_bytes,
        kill_grace_ms: options.kill_grace_ms,
        signal: options.signal,
        stdout_mode: "raw",
        stdin_document: Buffer.from(JSON.stringify(request.data), "utf8"),
    });
    if (commandResult.exit_code !== 0 || commandResult.signal !== null || commandResult.cleanup !== "closed") {
        throw new EvalProcessError("adapter_error", commandResult);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(commandResult.stdout ?? "");
    } catch {
        throw new EvalProcessError(
            hasTrailingJsonDocument(commandResult.stdout ?? "") ? "multiple_json" : "invalid_json",
            commandResult,
        );
    }
    const result = options.result_schema.safeParse(parsed);
    if (!result.success) throw new EvalProcessError("invalid_result", commandResult);
    const { stdout: _stdout, ...processResult } = commandResult;
    return { ...processResult, result: result.data };
}

export async function runBoundedJsonAdapter(options: BoundedJsonAdapterOptions): Promise<BoundedJsonAdapterResult> {
    const request = evalAdapterRequestSchema.safeParse(options.request);
    if (!request.success) throw new EvalProcessError("invalid_request");
    const commandResult = await runCommandInternal({
        ...options,
        stdout_mode: "raw",
        stdin_document: Buffer.from(JSON.stringify(request.data), "utf8"),
    });
    if (commandResult.exit_code !== 0 || commandResult.signal !== null || commandResult.cleanup !== "closed") {
        throw new EvalProcessError("adapter_error", commandResult);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(commandResult.stdout ?? "");
    } catch {
        throw new EvalProcessError(
            hasTrailingJsonDocument(commandResult.stdout ?? "") ? "multiple_json" : "invalid_json",
            commandResult,
        );
    }
    const result = evalAdapterResultSchema.safeParse(parsed);
    if (!result.success) throw new EvalProcessError("invalid_result", commandResult);
    const { stdout: _stdout, ...processResult } = commandResult;
    return { ...processResult, result: result.data };
}
