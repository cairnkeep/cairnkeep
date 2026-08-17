import { createHash, randomBytes } from "node:crypto";
import { constants, existsSync, readdirSync } from "node:fs";
import { link, lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";

import { hardenPrivatePath, privatePathIsSafe } from "./platform-security.js";
import { playbookProjectIdentity, resolvePlaybookStatus } from "./playbook.js";
import {
    PLAYBOOK_SCHEMA_VERSION,
    playbookActionIdSchema,
    playbookActorSchema,
    playbookEventSchema,
    playbookOutcomeSchema,
    playbookReasonSchema,
    type PlaybookActionId,
    type PlaybookActor,
    type PlaybookEvent,
    type PlaybookOutcome,
} from "./playbook-schema.js";

const MAX_RECEIPT_BYTES = 8 * 1024;
const MAX_RECEIPTS = 10_000;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RECEIPT_PATTERN = /^pbk_[a-f0-9]{32}$/;

const receiptSchema = z.strictObject({
    schema_version: z.literal(PLAYBOOK_SCHEMA_VERSION),
    receipt_id: z.string().regex(RECEIPT_PATTERN),
    project_identity: z.string().regex(DIGEST_PATTERN),
    policy_digest: z.string().regex(DIGEST_PATTERN),
    decision_digest: z.string().regex(DIGEST_PATTERN),
    actor: playbookActorSchema,
    session_id: z.string().regex(SESSION_PATTERN),
    event: playbookEventSchema,
    action: playbookActionIdSchema,
    outcome: playbookOutcomeSchema,
    reason: playbookReasonSchema,
    recorded_at: z.string().datetime({ offset: true }),
});

export type PlaybookReceipt = z.infer<typeof receiptSchema>;

export type RecordPlaybookReceiptOptions = {
    projectRoot?: string;
    policyDigest: string;
    decisionDigest: string;
    actor: PlaybookActor;
    sessionId: string;
    event: PlaybookEvent;
    action: PlaybookActionId;
    outcome: PlaybookOutcome;
    reason?: string;
    now?: Date;
};

function sha256(value: string | Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}

async function layout(projectRoot = process.cwd()): Promise<{ root: string; agentfs: string; store: string; receipts: string }> {
    const root = await realpath(resolve(projectRoot));
    const agentfs = join(root, ".agentfs");
    const store = join(agentfs, "playbooks");
    const receipts = join(store, "receipts");
    if (dirname(agentfs) !== root || dirname(store) !== agentfs || dirname(receipts) !== store) {
        throw new Error("Playbook receipt store escapes the project root.");
    }
    return { root, agentfs, store, receipts };
}

async function ensureDirectory(path: string, parent: string): Promise<void> {
    if (existsSync(path)) {
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink() || !privatePathIsSafe(path)) {
            throw new Error("Playbook receipt storage contains an unsafe path.");
        }
        return;
    }
    const parentInfo = await lstat(parent);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error("Playbook receipt storage parent is unsafe.");
    await mkdir(path, { mode: 0o700 });
    hardenPrivatePath(path);
}

async function ensureStore(projectRoot: string): Promise<string> {
    const target = await layout(projectRoot);
    if (!existsSync(target.agentfs)) await mkdir(target.agentfs, { mode: 0o700 });
    const agentInfo = await lstat(target.agentfs);
    if (!agentInfo.isDirectory() || agentInfo.isSymbolicLink()) throw new Error("Project .agentfs path is unsafe.");
    await ensureDirectory(target.store, target.agentfs);
    await ensureDirectory(target.receipts, target.store);
    return target.receipts;
}

async function safeRead(path: string): Promise<PlaybookReceipt> {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_RECEIPT_BYTES || !privatePathIsSafe(path)) {
        throw new Error("Unsafe playbook receipt.");
    }
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const opened = await handle.stat();
        if (!opened.isFile() || opened.size > MAX_RECEIPT_BYTES || opened.dev !== info.dev || opened.ino !== info.ino) {
            throw new Error("Playbook receipt changed during validation.");
        }
        return receiptSchema.parse(JSON.parse((await handle.readFile()).toString("utf8")) as unknown);
    } finally {
        await handle?.close().catch(() => undefined);
    }
}

async function atomicReceipt(path: string, value: PlaybookReceipt): Promise<boolean> {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    if (bytes.byteLength > MAX_RECEIPT_BYTES) throw new Error("Playbook receipt exceeds its storage limit.");
    const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    let handle;
    try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = undefined;
        hardenPrivatePath(temporary);
        try {
            await link(temporary, path);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
            throw error;
        }
        hardenPrivatePath(path);
        return true;
    } finally {
        if (handle) await handle.close().catch(() => undefined);
        await rm(temporary, { force: true });
    }
}

function receiptFiles(directory: string): string[] {
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter((name) => RECEIPT_PATTERN.test(name.replace(/\.json$/, "")) && name.endsWith(".json")).sort();
}

export async function recordPlaybookReceipt(options: RecordPlaybookReceiptOptions): Promise<PlaybookReceipt> {
    const projectRoot = options.projectRoot ?? process.cwd();
    if (!DIGEST_PATTERN.test(options.policyDigest) || !DIGEST_PATTERN.test(options.decisionDigest)) throw new Error("Invalid playbook digest.");
    if (!SESSION_PATTERN.test(options.sessionId)) throw new Error("Invalid playbook session ID.");
    const actor = playbookActorSchema.parse(options.actor);
    const event = playbookEventSchema.parse(options.event);
    const action = playbookActionIdSchema.parse(options.action);
    const outcome = playbookOutcomeSchema.parse(options.outcome);
    const reason = playbookReasonSchema.parse(options.reason ?? "");
    if ((outcome === "skipped" || outcome === "failed") && reason.trim().length === 0) {
        throw new Error("Skipped or failed playbook actions require a bounded reason.");
    }
    const status = await resolvePlaybookStatus({ projectRoot });
    if (status.issues.length || status.policy_digest !== options.policyDigest) throw new Error("Playbook policy digest is stale or invalid.");
    const projectIdentity = await playbookProjectIdentity(projectRoot);
    const identity = {
        schema_version: PLAYBOOK_SCHEMA_VERSION,
        project_identity: projectIdentity,
        policy_digest: options.policyDigest,
        decision_digest: options.decisionDigest,
        actor,
        session_id: options.sessionId,
        event,
        action,
        outcome,
        reason,
    };
    const receiptId = `pbk_${sha256(JSON.stringify(identity)).slice(0, 32)}`;
    const directory = await ensureStore(projectRoot);
    if (receiptFiles(directory).length >= MAX_RECEIPTS) throw new Error("Playbook receipt limit reached; archive or remove old project state.");
    const path = join(directory, `${receiptId}.json`);
    if (existsSync(path)) return safeRead(path);
    const receipt = receiptSchema.parse({ ...identity, receipt_id: receiptId, recorded_at: (options.now ?? new Date()).toISOString() });
    return await atomicReceipt(path, receipt) ? receipt : safeRead(path);
}

export async function listPlaybookReceipts(projectRoot = process.cwd()): Promise<{ schema_version: 1; receipts: PlaybookReceipt[] }> {
    const { receipts } = await layout(projectRoot);
    if (!existsSync(receipts)) return { schema_version: PLAYBOOK_SCHEMA_VERSION, receipts: [] };
    const info = await lstat(receipts);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Playbook receipt store is unsafe.");
    const values = [];
    for (const name of receiptFiles(receipts)) values.push(await safeRead(join(receipts, name)));
    values.sort((left, right) => right.recorded_at.localeCompare(left.recorded_at) || left.receipt_id.localeCompare(right.receipt_id));
    return { schema_version: PLAYBOOK_SCHEMA_VERSION, receipts: values };
}

export async function readPlaybookReceipt(selector: string, projectRoot = process.cwd()): Promise<PlaybookReceipt> {
    if (!/^(?:pbk_)?[a-f0-9]{6,32}$/.test(selector)) throw new Error("Invalid playbook receipt selector.");
    const values = (await listPlaybookReceipts(projectRoot)).receipts.filter(({ receipt_id }) => receipt_id === selector || receipt_id.startsWith(selector.startsWith("pbk_") ? selector : `pbk_${selector}`));
    if (values.length === 0) throw new Error("Playbook receipt not found.");
    if (values.length > 1) throw new Error("Playbook receipt selector is ambiguous.");
    return values[0];
}

export async function doctorPlaybooks(projectRoot = process.cwd()): Promise<{
    schema_version: 1;
    ok: boolean;
    policy: { ok: boolean; issues: string[] };
    receipts: { ok: boolean; count: number; issues: string[] };
}> {
    const status = await resolvePlaybookStatus({ projectRoot });
    const policyIssues: string[] = [...status.issues];
    const receiptIssues: string[] = [];
    let count = 0;
    try {
        const target = await layout(projectRoot);
        const ai = join(target.root, ".ai");
        if (existsSync(ai)) {
            const info = await lstat(ai);
            if (!info.isDirectory() || info.isSymbolicLink()) policyIssues.push("unsafe playbook configuration directory");
            else {
                for (const name of readdirSync(ai).sort()) {
                    if (name === ".playbooks.lock" || /^\.playbooks\.json\..+\.tmp$/.test(name)) {
                        policyIssues.push(`playbook configuration remnant: ${name}`);
                    }
                }
            }
        }
        if (existsSync(target.store)) {
            const info = await lstat(target.store);
            if (!info.isDirectory() || info.isSymbolicLink() || !privatePathIsSafe(target.store)) {
                receiptIssues.push("unsafe playbook receipt root");
            } else {
                for (const name of readdirSync(target.store).sort()) {
                    if (name !== "receipts") receiptIssues.push(`unexpected playbook store entry: ${name}`);
                }
            }
        }
        if (existsSync(target.receipts)) {
            const info = await lstat(target.receipts);
            if (!info.isDirectory() || info.isSymbolicLink() || !privatePathIsSafe(target.receipts)) receiptIssues.push("unsafe receipt directory");
            else {
                const names = readdirSync(target.receipts).sort();
                for (const name of names) {
                    if (!name.endsWith(".json") || !RECEIPT_PATTERN.test(name.slice(0, -5))) {
                        receiptIssues.push(`unexpected receipt entry: ${name}`);
                        continue;
                    }
                    try { await safeRead(join(target.receipts, name)); count += 1; }
                    catch { receiptIssues.push(`invalid receipt: ${name}`); }
                }
            }
        }
    } catch {
        receiptIssues.push("receipt store diagnostic failed");
    }
    return {
        schema_version: PLAYBOOK_SCHEMA_VERSION,
        ok: policyIssues.length === 0 && receiptIssues.length === 0,
        policy: { ok: policyIssues.length === 0, issues: policyIssues },
        receipts: { ok: receiptIssues.length === 0, count, issues: receiptIssues },
    };
}
