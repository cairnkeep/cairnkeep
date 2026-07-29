import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { homedir } from "node:os";
import {
    chmod,
    lstat,
    mkdir,
    open,
    readdir,
    realpath,
    rename,
    rm,
    stat,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { z } from "zod";

import {
    isCapabilityContractEnabled,
    resolveCapabilityStatus,
} from "./capability-config.js";
import {
    operatingCapabilityHandleSchema,
    type OperatingCapabilityHandle,
} from "./capability-adapter.js";
import {
    CAPABILITY_CALLBACK_SCHEMA_VERSION,
    isOperatingCapabilitySettled,
    issueOperatingCapability,
    settleOperatingCapability,
    type CapabilityCallbackErrorCode,
    type CapabilityCallbackOutcome,
    type CapabilityCallbackRecord,
} from "./capability-store.js";
import { isTrajectoryCaptureEnabled } from "./trajectory-schema.js";
import type { CapabilityId, CapabilityStatus } from "./capability-schema.js";

const LEASE_DIRECTORY_NAME = "capability-leases-v1";
const LEASE_SCHEMA_VERSION = 1 as const;
const MAX_LEASE_BYTES = 4_096;
const MAX_LEASES = 10_000;
const LEASE_TIMEOUT_MS = 30 * 60 * 1_000;

const harnessSchema = z.enum(["claude-code", "opencode"]);
const sessionIdSchema = z.string()
    .min(1)
    .max(256)
    .regex(/^(?:cairn:)?[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/)
    .refine((value) => value !== "unknown");
const projectRootSchema = z.string().min(1).max(4_096);
const commandSchema = z.enum([
    "wiki-ingest",
    "wiki-query",
    "wiki-lint",
    "graphify",
    "security-audit",
]);

export const harnessCapabilityBeforeInputSchema = z.strictObject({
    schema_version: z.literal(LEASE_SCHEMA_VERSION),
    harness: harnessSchema,
    command: commandSchema,
    session_id: sessionIdSchema,
    project_root: projectRootSchema,
});

export const harnessCapabilityTerminalInputSchema = z.strictObject({
    schema_version: z.literal(LEASE_SCHEMA_VERSION),
    harness: harnessSchema,
    session_id: sessionIdSchema,
    outcome: z.enum(["success", "error", "timeout", "abandoned"]),
});

const harnessCapabilityAbandonInputSchema = z.strictObject({
    schema_version: z.literal(LEASE_SCHEMA_VERSION),
    harness: harnessSchema,
    session_id: sessionIdSchema,
});

const harnessCapabilityCwdChangedInputSchema = z.strictObject({
    schema_version: z.literal(LEASE_SCHEMA_VERSION),
    harness: harnessSchema,
    session_id: sessionIdSchema,
    old_cwd: projectRootSchema,
    new_cwd: projectRootSchema,
});

const harnessCapabilityLeaseSchema = z.strictObject({
    schema_version: z.literal(LEASE_SCHEMA_VERSION),
    harness: harnessSchema,
    session_id: sessionIdSchema,
    command: commandSchema,
    project_root: projectRootSchema,
    project_identity: z.string().regex(/^[a-f0-9]{64}$/),
    expires_at: z.iso.datetime(),
    phase: z.enum(["active", "terminal"]),
    outcome: z.enum(["success", "error", "timeout", "disabled"]).optional(),
    handle: operatingCapabilityHandleSchema,
}).superRefine((lease, context) => {
    if ((lease.phase === "terminal") !== (lease.outcome !== undefined)) {
        context.addIssue({ code: "custom", path: ["outcome"], message: "Terminal leases require one outcome." });
    }
});

type HarnessCapabilityBeforeInput = z.infer<typeof harnessCapabilityBeforeInputSchema>;
type HarnessCapabilityTerminalInput = z.infer<typeof harnessCapabilityTerminalInputSchema>;
type HarnessCapabilityLease = z.infer<typeof harnessCapabilityLeaseSchema>;
type HarnessCapabilityStateOptions = { state_root?: string };
type HarnessCrashPoint = "before-claim" | "after-claim" | "after-settlement";

export type HarnessCapabilityDecision =
    | { schema_version: 1; decision: "allow" }
    | { schema_version: 1; decision: "block"; reason: "capability-disabled" };

const ALLOW: HarnessCapabilityDecision = { schema_version: 1, decision: "allow" };
const BLOCK: HarnessCapabilityDecision = {
    schema_version: 1,
    decision: "block",
    reason: "capability-disabled",
};

export function commandCapability(command: string): CapabilityId | undefined {
    switch (command) {
        case "wiki-ingest":
        case "wiki-query":
        case "wiki-lint":
            return "wiki";
        case "graphify":
            return "graph";
        case "security-audit":
            return "security.audit";
        default:
            return undefined;
    }
}

function stateRoot(options: HarnessCapabilityStateOptions = {}): string {
    const configured = options.state_root ?? process.env.CAIRN_HARNESS_STATE_DIR;
    const root = configured ?? join(
        process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
        "cairn",
        "harness",
    );
    if (!isAbsolute(root) && configured !== undefined) {
        throw new Error("Harness state root must be absolute.");
    }
    return resolve(root);
}

export function getHarnessCapabilityLeaseDirectory(
    options: HarnessCapabilityStateOptions = {},
): string {
    const root = stateRoot(options);
    const directory = resolve(root, LEASE_DIRECTORY_NAME);
    const child = relative(root, directory);
    if (child.startsWith("..") || isAbsolute(child)) {
        throw new Error("Harness lease directory is outside local state.");
    }
    return directory;
}

function leaseName(harness: string, sessionId: string, invocationId: string): string {
    return `${createHash("sha256").update(`${harness}\0${sessionId}\0${invocationId}`, "utf8").digest("hex")}.json`;
}

function legacyLeaseName(harness: string, sessionId: string): string {
    return `${createHash("sha256").update(`${harness}\0${sessionId}`, "utf8").digest("hex")}.json`;
}

function leaseNameMatches(lease: HarnessCapabilityLease, name: string): boolean {
    return name === leaseName(lease.harness, lease.session_id, lease.handle.invocation_id)
        || name === legacyLeaseName(lease.harness, lease.session_id);
}

function leasePath(lease: HarnessCapabilityLease, options: HarnessCapabilityStateOptions = {}): string {
    return join(
        getHarnessCapabilityLeaseDirectory(options),
        leaseName(lease.harness, lease.session_id, lease.handle.invocation_id),
    );
}

async function ensureLeaseDirectory(options: HarnessCapabilityStateOptions = {}): Promise<string> {
    const root = stateRoot(options);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Harness state root is unsafe.");
    const directory = getHarnessCapabilityLeaseDirectory(options);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Harness lease directory is unsafe.");
    await chmod(directory, 0o700);
    return directory;
}

async function canonicalProjectBinding(rawRoot: string): Promise<{
    project_root: string;
    project_identity: string;
}> {
    const projectRoot = await realpath(rawRoot);
    const info = await stat(projectRoot);
    if (!info.isDirectory()) throw new Error("Harness project root is not a directory.");
    const projectIdentity = createHash("sha256")
        .update(`cairn:harness-project:v1\0${projectRoot}\0${String(info.dev)}\0${String(info.ino)}`, "utf8")
        .digest("hex");
    return { project_root: projectRoot, project_identity: projectIdentity };
}

async function bindingMatches(lease: HarnessCapabilityLease): Promise<boolean> {
    try {
        const binding = await canonicalProjectBinding(lease.project_root);
        return binding.project_root === lease.project_root
            && binding.project_identity === lease.project_identity;
    } catch {
        return false;
    }
}

async function writeLease(lease: HarnessCapabilityLease, options: HarnessCapabilityStateOptions = {}): Promise<void> {
    const parsed = harnessCapabilityLeaseSchema.parse(lease);
    const bytes = Buffer.from(`${JSON.stringify(parsed)}\n`, "utf8");
    if (bytes.byteLength > MAX_LEASE_BYTES) throw new Error("Harness capability lease is too large.");
    const directory = await ensureLeaseDirectory(options);
    const name = leaseName(parsed.harness, parsed.session_id, parsed.handle.invocation_id);
    const path = join(directory, name);
    let replacing = false;
    try {
        const existing = await lstat(path);
        if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("Harness capability lease path is unsafe.");
        replacing = true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!replacing) {
        const entries = await readdir(directory, { withFileTypes: true });
        if (entries.filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name)).length >= MAX_LEASES) {
            throw new Error("Harness capability lease limit reached.");
        }
    }
    const temporary = join(directory, `.${name}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    let handle;
    try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = undefined;
        await chmod(temporary, 0o600);
        await rename(temporary, path);
        await chmod(path, 0o600);
    } finally {
        if (handle) await handle.close().catch(() => undefined);
        await rm(temporary, { force: true });
    }
}

async function readLease(path: string): Promise<HarnessCapabilityLease | undefined> {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_LEASE_BYTES || (info.mode & 0o077) !== 0) return undefined;
        const bytes = await handle.readFile();
        if (bytes.byteLength > MAX_LEASE_BYTES) return undefined;
        return harnessCapabilityLeaseSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
    } catch {
        return undefined;
    } finally {
        if (handle) await handle.close().catch(() => undefined);
    }
}

async function removeLease(path: string): Promise<void> {
    await rm(path, { force: true });
}

function capabilityState(snapshot: CapabilityStatus, id: CapabilityId): CapabilityStatus["capabilities"][number] {
    const state = snapshot.capabilities.find((row) => row.id === id);
    if (!state) throw new Error("Harness capability state is unavailable.");
    return state;
}

function makeHandle(
    input: HarnessCapabilityBeforeInput,
    snapshot: CapabilityStatus,
    capabilityId: CapabilityId,
    startedAt: string,
): OperatingCapabilityHandle {
    const state = capabilityState(snapshot, capabilityId);
    return operatingCapabilityHandleSchema.parse({
        schema_version: CAPABILITY_CALLBACK_SCHEMA_VERSION,
        capability_id: capabilityId,
        invocation_id: `cap:${randomUUID()}`,
        correlation_id: input.session_id,
        harness: input.harness,
        source: "operating-command",
        transport: "harness-command",
        started_at: startedAt,
        state_source: state.source,
        configuration_digest: snapshot.configuration_digest,
    });
}

function finalRecord(
    handle: OperatingCapabilityHandle,
    outcome: CapabilityCallbackOutcome,
): CapabilityCallbackRecord {
    const finishedAt = new Date().toISOString();
    const errorCode: CapabilityCallbackErrorCode | undefined = outcome === "success"
        ? undefined
        : outcome === "disabled"
            ? "capability-disabled"
            : outcome === "timeout"
                ? "callback-timeout"
                : "callback-error";
    return {
        ...handle,
        finished_at: finishedAt,
        duration_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(handle.started_at)),
        outcome,
        ...(errorCode === undefined ? {} : { error_code: errorCode }),
    };
}

function leaseFor(
    input: HarnessCapabilityBeforeInput,
    binding: { project_root: string; project_identity: string },
    handle: OperatingCapabilityHandle,
    outcome?: CapabilityCallbackOutcome,
): HarnessCapabilityLease {
    return harnessCapabilityLeaseSchema.parse({
        schema_version: LEASE_SCHEMA_VERSION,
        harness: input.harness,
        session_id: input.session_id,
        command: input.command,
        ...binding,
        expires_at: new Date(Date.parse(handle.started_at) + LEASE_TIMEOUT_MS).toISOString(),
        phase: outcome === undefined ? "active" : "terminal",
        ...(outcome === undefined ? {} : { outcome }),
        handle,
    });
}

async function settleLease(lease: HarnessCapabilityLease): Promise<boolean> {
    if (lease.phase !== "terminal" || lease.outcome === undefined) return false;
    const settled = await settleOperatingCapability(
        lease.project_root,
        lease.handle,
        finalRecord(lease.handle, lease.outcome),
    );
    return settled || isOperatingCapabilitySettled(lease.project_root, lease.handle);
}

async function matchingLeases(
    input: Pick<HarnessCapabilityBeforeInput, "harness" | "session_id">,
    options: HarnessCapabilityStateOptions = {},
): Promise<Array<{ path: string; lease: HarnessCapabilityLease }>> {
    const directory = getHarnessCapabilityLeaseDirectory(options);
    let entries;
    try {
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) return [];
        entries = (await readdir(directory, { withFileTypes: true }))
            .sort((left, right) => left.name.localeCompare(right.name))
            .slice(0, MAX_LEASES);
    } catch {
        return [];
    }
    const matches: Array<{ path: string; lease: HarnessCapabilityLease }> = [];
    for (const entry of entries) {
        const path = join(directory, entry.name);
        if (!entry.isFile()) {
            if (entry.isSymbolicLink()) await removeLease(path);
            continue;
        }
        if (!/^[a-f0-9]{64}\.json$/.test(entry.name)) {
            await removeLease(path);
            continue;
        }
        const lease = await readLease(path);
        if (!lease
            || !leaseNameMatches(lease, entry.name)
            || !await bindingMatches(lease)) {
            await removeLease(path);
            continue;
        }
        if (lease.harness === input.harness && lease.session_id === input.session_id) {
            matches.push({ path, lease });
        }
    }
    return matches;
}

export async function beginHarnessCapability(
    rawInput: HarnessCapabilityBeforeInput,
): Promise<HarnessCapabilityDecision> {
    const input = harnessCapabilityBeforeInputSchema.parse(rawInput);
    if (!isCapabilityContractEnabled()) return ALLOW;
    const capabilityId = commandCapability(input.command);
    if (!capabilityId) return ALLOW;

    let binding;
    try {
        binding = await canonicalProjectBinding(input.project_root);
    } catch {
        return ALLOW;
    }

    const snapshot = await resolveCapabilityStatus({ projectRoot: binding.project_root });
    const state = capabilityState(snapshot, capabilityId);
    const measured = snapshot.logging.enabled && isTrajectoryCaptureEnabled();
    if (!state.enabled) {
        if (!measured) return BLOCK;
        const handle = makeHandle(input, snapshot, capabilityId, new Date().toISOString());
        const lease = leaseFor(input, binding, handle, "disabled");
        const path = leasePath(lease);
        try {
            await writeLease(lease);
            const issued = await issueOperatingCapability(binding.project_root, handle);
            if (!issued || await settleLease(lease)) await removeLease(path);
        } catch {
            await removeLease(path).catch(() => undefined);
        }
        return BLOCK;
    }

    if (!measured) return ALLOW;
    const handle = makeHandle(input, snapshot, capabilityId, new Date().toISOString());
    const lease = leaseFor(input, binding, handle);
    try {
        await writeLease(lease);
    } catch {
        return ALLOW;
    }
    const issued = await issueOperatingCapability(binding.project_root, handle);
    if (!issued) await removeLease(leasePath(lease)).catch(() => undefined);
    return ALLOW;
}

export async function finishHarnessCapability(
    rawInput: HarnessCapabilityTerminalInput,
    options: { testCrashAt?: HarnessCrashPoint } = {},
): Promise<{ schema_version: 1; finalized: boolean }> {
    const input = harnessCapabilityTerminalInputSchema.parse(rawInput);
    if (input.outcome === "abandoned") {
        return abandonHarnessCapability({
            schema_version: input.schema_version,
            harness: input.harness,
            session_id: input.session_id,
        });
    }
    const priors = await matchingLeases(input);
    if (priors.length === 0) return { schema_version: 1, finalized: false };
    const terminals = priors.map(({ path, lease }) => ({
        path,
        lease: lease.phase === "terminal" ? lease : harnessCapabilityLeaseSchema.parse({
            ...lease,
            phase: "terminal",
            outcome: input.outcome,
        }),
    }));
    for (const terminal of terminals) await writeLease(terminal.lease);
    if (options.testCrashAt === "before-claim") throw crashInjection();
    for (const terminal of terminals) await writeLease(terminal.lease);
    if (options.testCrashAt === "after-claim") throw crashInjection();
    let finalized = false;
    for (const terminal of terminals) {
        const settled = await settleLease(terminal.lease);
        if (settled) {
            await removeLease(terminal.path);
            finalized = true;
        }
    }
    if (options.testCrashAt === "after-settlement") throw crashInjection();
    return { schema_version: 1, finalized };
}

function crashInjection(): Error {
    const error = new Error("Injected harness lifecycle crash.");
    error.name = "HarnessCrashInjection";
    return error;
}

export async function abandonHarnessCapability(
    rawInput: z.infer<typeof harnessCapabilityAbandonInputSchema>,
): Promise<{ schema_version: 1; finalized: boolean }> {
    const input = harnessCapabilityAbandonInputSchema.parse(rawInput);
    const priors = await matchingLeases(input);
    let finalized = false;
    for (const prior of priors) {
        if (prior.lease.phase === "terminal") {
            finalized = await settleLease(prior.lease) || finalized;
        } else {
            await settleOperatingCapability(prior.lease.project_root, prior.lease.handle);
        }
        await removeLease(prior.path);
    }
    return { schema_version: 1, finalized };
}

export async function observeHarnessCwdChanged(
    rawInput: z.infer<typeof harnessCapabilityCwdChangedInputSchema>,
): Promise<{ schema_version: 1; observed: boolean }> {
    const input = harnessCapabilityCwdChangedInputSchema.parse(rawInput);
    const priors = await matchingLeases(input);
    return { schema_version: 1, observed: priors.length > 0 };
}

export async function recoverHarnessCapabilities(
    options: HarnessCapabilityStateOptions = {},
): Promise<{ schema_version: 1; recovered: number; pruned: number; pending: number }> {
    let directory: string;
    try {
        directory = await ensureLeaseDirectory(options);
    } catch {
        return { schema_version: 1, recovered: 0, pruned: 0, pending: 0 };
    }
    const entries = (await readdir(directory, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name));
    let recovered = 0;
    let pruned = 0;
    let pending = 0;
    for (const entry of entries.slice(0, MAX_LEASES)) {
        let path = join(directory, entry.name);
        if (!entry.isFile()) {
            if (entry.isSymbolicLink()) {
                await removeLease(path);
                pruned += 1;
            }
            continue;
        }
        if (!/^[a-f0-9]{64}\.json$/.test(entry.name)) {
            await removeLease(path);
            pruned += 1;
            continue;
        }
        const lease = await readLease(path);
        if (!lease
            || !leaseNameMatches(lease, entry.name)
            || !await bindingMatches(lease)) {
            await removeLease(path);
            pruned += 1;
            continue;
        }
        if (entry.name === legacyLeaseName(lease.harness, lease.session_id)) {
            await writeLease(lease, options);
            await removeLease(path);
            path = leasePath(lease, options);
        }
        let terminal = lease;
        if (lease.phase === "active" && Date.parse(lease.expires_at) <= Date.now()) {
            terminal = harnessCapabilityLeaseSchema.parse({ ...lease, phase: "terminal", outcome: "timeout" });
            await writeLease(terminal, options);
        }
        if (terminal.phase === "terminal") {
            if (await settleLease(terminal)) {
                await removeLease(path);
                recovered += 1;
            } else {
                await removeLease(path);
                pruned += 1;
            }
        } else pending += 1;
    }
    for (const entry of entries.slice(MAX_LEASES)) {
        if (entry.isFile() || entry.isSymbolicLink()) {
            await removeLease(join(directory, entry.name));
            pruned += 1;
        }
    }
    return { schema_version: 1, recovered, pruned, pending };
}
