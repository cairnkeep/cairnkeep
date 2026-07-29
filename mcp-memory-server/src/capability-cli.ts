#!/usr/bin/env node
import { lstat } from "node:fs/promises";
import { join } from "node:path";

import {
    capabilityAdapterClassificationSchema,
    finishOperatingCapability,
    operatingCapabilityBypassResultSchema,
    operatingCapabilityHandleSchema,
    startOperatingCapability,
} from "./capability-adapter.js";
import {
    readCapabilityConfig,
    resetCapabilityLogging,
    resetCapabilityOverride,
    resolveCapabilityStatus,
    setCapabilityLogging,
    setCapabilityOverride,
} from "./capability-config.js";
import {
    CAPABILITY_CALLBACK_SCHEMA_VERSION,
    doctorCapabilityRecords,
} from "./capability-store.js";
import {
    CAPABILITY_SCHEMA_VERSION,
    capabilityIdSchema,
    type CapabilityId,
    type CapabilityStatus,
} from "./capability-schema.js";
import {
    beginHarnessCapability,
    finishHarnessCapability,
    harnessCapabilityBeforeInputSchema,
    harnessCapabilityTerminalInputSchema,
    observeHarnessCwdChanged,
    recoverHarnessCapabilities,
} from "./capability-harness.js";

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
});

const sessionSchemaPattern = /^(?:cairn:)?[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const configName = ".ai/capabilities.json" as const;
const callbackStoreName = ".agentfs/trajectory.db" as const;
const MAX_HARNESS_INPUT_BYTES = 8 * 1024;

type OutputMode = "human" | "json";
type DoctorState = "PASS" | "WARN" | "FAIL";
type DoctorConfigIssue = CapabilityStatus["issues"][number] | { code: "unsafe-permissions" };
type DoctorCallbackIssue =
    | "sqlite-integrity-failed"
    | "schema-missing"
    | "schema-unsupported"
    | "invalid-record"
    | "diagnostic-failed";

function usage(): string {
    return `cairn capabilities — managed capability state

Usage:
  cairn capabilities list [--json]
  cairn capabilities status [--json]
  cairn capabilities enable <capability-id> [--json]
  cairn capabilities disable <capability-id> [--json]
  cairn capabilities reset <capability-id>|--all [--json]
  cairn capabilities logging <enable|disable|reset> [--json]

MCP capability changes require a memory-server restart. Operating capability
changes apply on the next invocation.
`;
}

function parseOutputArgs(args: string[], positionalCount: number): {
    positional: string[];
    mode: OutputMode;
} {
    const jsonCount = args.filter((arg) => arg === "--json").length;
    const positional = args.filter((arg) => arg !== "--json");
    if (jsonCount > 1 || positional.length !== positionalCount) {
        throw new Error("invalid-arguments");
    }
    return { positional, mode: jsonCount === 1 ? "json" : "human" };
}

function requireCapabilityId(value: string | undefined): CapabilityId {
    const parsed = capabilityIdSchema.safeParse(value);
    if (!parsed.success) throw new Error("invalid-capability-id");
    return parsed.data;
}

function humanList(status: CapabilityStatus): string {
    const heading = status.contract_enabled
        ? "Capability contract: enabled"
        : "Capability contract: disabled (showing staged state; legacy behavior remains active)";
    const rows = status.capabilities.map((row) => [
        row.id,
        row.kind,
        row.enabled ? "enabled" : "disabled",
        row.source,
        row.restart_required ? "restart required" : "next invocation",
    ].join("\t"));
    return [heading, ...rows].join("\n");
}

function humanStatus(status: CapabilityStatus): string {
    const issues = status.issues.length === 0
        ? ["Issues: none"]
        : ["Issues:", ...status.issues.map((issue) => {
            const subject = issue.capability_id ?? issue.setting;
            return `  ${issue.code}${subject === undefined ? "" : ` (${subject})`}`;
        })];
    return [
        humanList(status),
        `Logging callbacks: ${status.logging.enabled ? "enabled" : "disabled"} (${status.logging.source})`,
        `Configuration digest: ${status.configuration_digest}`,
        ...issues,
    ].join("\n");
}

function writeStatus(status: CapabilityStatus, mode: OutputMode, compact: boolean): void {
    process.stdout.write(`${mode === "json" ? JSON.stringify(status) : compact ? humanList(status) : humanStatus(status)}\n`);
}

async function currentStatus(): Promise<CapabilityStatus> {
    return resolveCapabilityStatus({ projectRoot: process.cwd() });
}

async function assertConfigCanMutate(allowInvalidReset: boolean): Promise<void> {
    if (allowInvalidReset) return;
    const { issues } = await readCapabilityConfig({ projectRoot: process.cwd() });
    if (issues.some(({ code }) => code === "invalid-config")) throw new Error("invalid-config");
}

function parsePrivateStartArgs(args: string[]): {
    capabilityId: CapabilityId;
    classification: {
        harness: "claude-code" | "opencode" | "pi" | "other";
        source: "mcp" | "notes-cli" | "audit-timer" | "operating-command" | "operating-workflow";
        transport: "stdio" | "http" | "local-process" | "harness-command";
    };
    correlationId?: string;
} {
    const capabilityId = requireCapabilityId(args[0]);
    const values = new Map<string, string>();
    for (let index = 1; index < args.length; index += 2) {
        const name = args[index];
        const value = args[index + 1];
        if (!name || !value || !["--harness", "--source", "--transport", "--session"].includes(name)
            || values.has(name)) {
            throw new Error("invalid-private-arguments");
        }
        values.set(name, value);
    }
    if (values.size < 3 || !values.has("--harness") || !values.has("--source") || !values.has("--transport")) {
        throw new Error("invalid-private-arguments");
    }
    const classification = capabilityAdapterClassificationSchema.parse({
        harness: values.get("--harness"),
        source: values.get("--source"),
        transport: values.get("--transport"),
    });
    const correlationId = values.get("--session");
    if (correlationId !== undefined
        && (!sessionSchemaPattern.test(correlationId) || correlationId === "unknown")) {
        throw new Error("invalid-session");
    }
    return { capabilityId, classification, ...(correlationId === undefined ? {} : { correlationId }) };
}

async function operatingOptions(args: string[]) {
    const parsed = parsePrivateStartArgs(args);
    return {
        projectRoot: process.cwd(),
        snapshot: await currentStatus(),
        capabilityId: parsed.capabilityId,
        classification: parsed.classification,
        ...(parsed.correlationId === undefined ? {} : { correlationId: parsed.correlationId }),
    };
}

async function privateGuard(args: string[]): Promise<void> {
    const options = await operatingOptions(args);
    const state = options.snapshot.capabilities.find(({ id }) => id === options.capabilityId);
    const result = options.snapshot.contract_enabled && state?.enabled === false
        ? await startOperatingCapability(options)
        : operatingCapabilityBypassResultSchema.parse({
            schema_version: CAPABILITY_CALLBACK_SCHEMA_VERSION,
            capability_id: options.capabilityId,
            disabled: false,
            measured: false,
        });
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function privateStart(args: string[]): Promise<void> {
    const result = await startOperatingCapability(await operatingOptions(args));
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function privateFinish(args: string[]): Promise<void> {
    if (args.length !== 4 || args[0] !== "--handle" || args[2] !== "--outcome") {
        throw new Error("invalid-private-arguments");
    }
    const handle = operatingCapabilityHandleSchema.parse(JSON.parse(args[1]) as unknown);
    if (!(["success", "error", "timeout"] as const).includes(args[3] as "success" | "error" | "timeout")) {
        throw new Error("invalid-outcome");
    }
    const result = await finishOperatingCapability(process.cwd(), handle, {
        outcome: args[3] as "success" | "error" | "timeout",
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function readBoundedHarnessInput(): Promise<unknown> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const rawChunk of process.stdin) {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
        total += chunk.byteLength;
        if (total > MAX_HARNESS_INPUT_BYTES) throw new Error("invalid-harness-input");
        chunks.push(chunk);
    }
    if (total === 0) throw new Error("invalid-harness-input");
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function privateHarnessBefore(args: string[]): Promise<void> {
    if (args.length !== 0) throw new Error("invalid-private-arguments");
    let result: { schema_version: 1; decision: "allow" } | { schema_version: 1; decision: "block"; reason: "capability-disabled" } = {
        schema_version: 1,
        decision: "allow",
    };
    try {
        const input = harnessCapabilityBeforeInputSchema.parse(await readBoundedHarnessInput());
        result = await beginHarnessCapability(input);
    } catch {
        // Native bridges validate their harness event before this fail-open local seam.
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function privateHarnessTerminal(args: string[]): Promise<void> {
    if (args.length !== 0) throw new Error("invalid-private-arguments");
    let result: { schema_version: 1; finalized: boolean } = { schema_version: 1, finalized: false };
    try {
        const input = harnessCapabilityTerminalInputSchema.parse(await readBoundedHarnessInput());
        result = await finishHarnessCapability(input);
    } catch {
        // Terminal failures cannot change owner results or disclose rejected input.
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function privateHarnessCwd(args: string[]): Promise<void> {
    if (args.length !== 0) throw new Error("invalid-private-arguments");
    let result: { schema_version: 1; observed: boolean } = { schema_version: 1, observed: false };
    try {
        const input = await readBoundedHarnessInput();
        result = await observeHarnessCwdChanged(input as Parameters<typeof observeHarnessCwdChanged>[0]);
    } catch {
        // CWD observations never rebind identity and remain fail-open.
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function privateHarnessRecover(args: string[]): Promise<void> {
    if (args.length !== 0) throw new Error("invalid-private-arguments");
    let result = { schema_version: 1 as const, recovered: 0, pruned: 0, pending: 0 };
    try {
        result = await recoverHarnessCapabilities();
    } catch {
        // Recovery is local, value-free, and fail-open.
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function configDoctor(): Promise<{
    name: typeof configName;
    state: DoctorState;
    exists: boolean;
    issues: DoctorConfigIssue[];
}> {
    const path = join(process.cwd(), configName);
    let exists = false;
    let unsafePermissions = false;
    try {
        const info = await lstat(path);
        exists = true;
        unsafePermissions = info.isSymbolicLink() || !info.isFile() || (info.mode & 0o077) !== 0;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") unsafePermissions = true;
    }
    const { issues: configIssues } = await readCapabilityConfig({ projectRoot: process.cwd() });
    const issues: DoctorConfigIssue[] = [
        ...configIssues,
        ...(unsafePermissions ? [{ code: "unsafe-permissions" as const }] : []),
    ];
    const state: DoctorState = issues.some(({ code }) => code === "invalid-config" || code === "unsafe-permissions")
        ? "FAIL"
        : issues.length > 0 ? "WARN" : "PASS";
    return { name: configName, state, exists, issues };
}

async function callbackDoctor(): Promise<{
    name: typeof callbackStoreName;
    state: "PASS" | "FAIL";
    exists: boolean;
    issues: DoctorCallbackIssue[];
}> {
    try {
        const result = await doctorCapabilityRecords(process.cwd());
        return {
            name: callbackStoreName,
            state: result.ok ? "PASS" : "FAIL",
            exists: result.exists,
            issues: result.issues,
        };
    } catch {
        return {
            name: callbackStoreName,
            state: "FAIL",
            exists: true,
            issues: ["diagnostic-failed"],
        };
    }
}

async function privateDoctor(args: string[]): Promise<void> {
    if (args.length !== 1 || args[0] !== "--json") throw new Error("invalid-private-arguments");
    const [configuration, callbacks] = await Promise.all([configDoctor(), callbackDoctor()]);
    const value = {
        schema_version: CAPABILITY_SCHEMA_VERSION,
        ok: configuration.state !== "FAIL" && callbacks.state !== "FAIL",
        configuration,
        callbacks,
    };
    process.stdout.write(`${JSON.stringify(value)}\n`);
    if (!value.ok) process.exitCode = 2;
}

async function main(): Promise<void> {
    const [command = "help", ...args] = process.argv.slice(2);
    try {
        if (command === "list" || command === "status") {
            const { mode } = parseOutputArgs(args, 0);
            writeStatus(await currentStatus(), mode, command === "list");
            return;
        }
        if (command === "enable" || command === "disable") {
            const { positional, mode } = parseOutputArgs(args, 1);
            const id = requireCapabilityId(positional[0]);
            await assertConfigCanMutate(false);
            await setCapabilityOverride({ projectRoot: process.cwd(), id, enabled: command === "enable" });
            writeStatus(await currentStatus(), mode, false);
            return;
        }
        if (command === "reset") {
            const { positional, mode } = parseOutputArgs(args, 1);
            const id = positional[0] === "--all" ? "all" : requireCapabilityId(positional[0]);
            await assertConfigCanMutate(id === "all");
            await resetCapabilityOverride({ projectRoot: process.cwd(), id });
            writeStatus(await currentStatus(), mode, false);
            return;
        }
        if (command === "logging") {
            const { positional, mode } = parseOutputArgs(args, 1);
            const operation = positional[0];
            if (!operation || !["enable", "disable", "reset"].includes(operation)) {
                throw new Error("invalid-logging-operation");
            }
            await assertConfigCanMutate(false);
            if (operation === "reset") await resetCapabilityLogging({ projectRoot: process.cwd() });
            else await setCapabilityLogging({ projectRoot: process.cwd(), enabled: operation === "enable" });
            writeStatus(await currentStatus(), mode, false);
            return;
        }
        if (command === "guard") {
            await privateGuard(args);
            return;
        }
        if (command === "start") {
            await privateStart(args);
            return;
        }
        if (command === "finish") {
            await privateFinish(args);
            return;
        }
        if (command === "doctor") {
            await privateDoctor(args);
            return;
        }
        if (command === "harness-before") {
            await privateHarnessBefore(args);
            return;
        }
        if (command === "harness-terminal") {
            await privateHarnessTerminal(args);
            return;
        }
        if (command === "harness-cwd") {
            await privateHarnessCwd(args);
            return;
        }
        if (command === "harness-recover" || command === "harness-prune") {
            await privateHarnessRecover(args);
            return;
        }
        if (command === "help" || command === "--help" || command === "-h") {
            if (args.length !== 0) throw new Error("invalid-arguments");
            process.stdout.write(usage());
            return;
        }
        throw new Error("unknown-command");
    } catch {
        process.stderr.write("cairn capabilities: invalid command, arguments, or managed state.\n");
        process.exitCode = 2;
    }
}

await main();
