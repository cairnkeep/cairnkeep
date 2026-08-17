import { createHash, randomBytes } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { lstat, mkdir, open, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { atomicReplace, hardenPrivatePath, privatePathIsSafe } from "./platform-security.js";
import {
    PLAYBOOK_ACTION_IDS,
    PLAYBOOK_CHANGE_TYPES,
    PLAYBOOK_PROFILES,
    PLAYBOOK_SCHEMA_VERSION,
    playbookActorSchema,
    playbookConfigSchema,
    playbookEvidenceSchema,
    playbookSignalsSchema,
    type PlaybookActionId,
    type PlaybookActor,
    type PlaybookChangeType,
    type PlaybookConfig,
    type PlaybookEvent,
    type PlaybookEvidence,
    type PlaybookMode,
    type PlaybookProfile,
    type PlaybookSignals,
} from "./playbook-schema.js";

const MAX_CONFIG_BYTES = 64 * 1024;
const LOCK_ATTEMPTS = 200;
const LOCK_WAIT_MS = 10;
const SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type PlaybookActionDefinition = {
    id: PlaybookActionId;
    title: string;
    command: string;
    description: string;
};

export const PLAYBOOK_ACTIONS: readonly PlaybookActionDefinition[] = Object.freeze([
    { id: "context.recall", title: "Recall durable context", command: "/recall <task topic>", description: "Read accepted project memory and derived knowledge before committing to an approach." },
    { id: "context.explore", title: "Explore focused code context", command: "/context-explore <question>", description: "Collect compact citations when the relevant code is unfamiliar or structurally complex." },
    { id: "work.plan", title: "Write a bounded plan", command: "Write and track a concise implementation plan.", description: "Plan non-trivial work before editing and keep the plan proportional to the task." },
    { id: "verify.tests", title: "Run relevant verification", command: "Run the smallest sufficient tests, then broader gates when risk warrants.", description: "Verify changed behavior before claiming completion." },
    { id: "review.repository", title: "Review the repository change", command: "/repo-review", description: "Review bugs, security, and maintainability after material code changes." },
    { id: "review.security", title: "Run the governed security audit", command: "/security-audit", description: "Audit security-sensitive changes through the existing governed workflow." },
    { id: "docs.update", title: "Align documentation", command: "Update and verify affected operating, API, compatibility, and learning documentation.", description: "Keep public behavior and operator guidance synchronized with the implementation." },
    { id: "learning.capture", title: "Capture reviewed learnings", command: "/remember or stage a candidate for /memory-review", description: "Propose stable decisions, pitfalls, and patterns without automatically promoting them." },
]);

const PROFILE_MODES: Readonly<Record<PlaybookProfile, Readonly<Record<PlaybookActionId, PlaybookMode>>>> = Object.freeze({
    minimal: Object.freeze({
        "context.recall": "may",
        "context.explore": "may",
        "work.plan": "may",
        "verify.tests": "must",
        "review.repository": "may",
        "review.security": "should",
        "docs.update": "should",
        "learning.capture": "may",
    }),
    balanced: Object.freeze({
        "context.recall": "should",
        "context.explore": "should",
        "work.plan": "should",
        "verify.tests": "must",
        "review.repository": "should",
        "review.security": "must",
        "docs.update": "should",
        "learning.capture": "should",
    }),
    strict: Object.freeze({
        "context.recall": "must",
        "context.explore": "must",
        "work.plan": "must",
        "verify.tests": "must",
        "review.repository": "must",
        "review.security": "must",
        "docs.update": "must",
        "learning.capture": "should",
    }),
});

export type PlaybookIssue = "invalid-config" | "unsafe-config" | "invalid-environment-profile";

export type PlaybookStatus = {
    schema_version: 1;
    profile: PlaybookProfile;
    source: "environment" | "project" | "default";
    overrides: Partial<Record<PlaybookActionId, PlaybookMode>>;
    modes: Record<PlaybookActionId, PlaybookMode>;
    policy_digest: string;
    config_exists: boolean;
    issues: PlaybookIssue[];
};

export type PlaybookEvaluationOptions = {
    projectRoot?: string;
    env?: Record<string, string | undefined>;
    event: PlaybookEvent;
    actor: PlaybookActor;
    sessionId: string;
    signals: PlaybookSignals;
    evidence?: PlaybookEvidence[];
};

export type PlaybookDecision = {
    schema_version: 1;
    event: PlaybookEvent;
    project_identity: string;
    actor: PlaybookActor;
    session_id: string;
    profile: PlaybookProfile;
    policy_digest: string;
    decision_digest: string;
    signals: PlaybookSignals;
    actions: Array<PlaybookActionDefinition & {
        mode: PlaybookMode;
        rationale: string;
        outcome: "pending" | PlaybookEvidence["outcome"];
        reason: string;
        blocking: boolean;
    }>;
    blocking_actions: PlaybookActionId[];
    advisory_actions: PlaybookActionId[];
    issues: PlaybookIssue[];
};

function sha256(value: string | Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function canonicalRoot(projectRoot: string): Promise<string> {
    const root = resolve(projectRoot);
    const canonical = await realpath(root);
    const info = await stat(canonical);
    if (!info.isDirectory()) throw new Error("Playbook project root is not a directory.");
    return canonical;
}

export async function playbookProjectIdentity(projectRoot = process.cwd()): Promise<string> {
    const root = await canonicalRoot(projectRoot);
    const info = await stat(root);
    return sha256(`cairn:playbook-project:v1\0${root}\0${String(info.dev)}\0${String(info.ino)}`);
}

async function paths(projectRoot: string): Promise<{ root: string; directory: string; config: string; lock: string }> {
    const root = await canonicalRoot(projectRoot);
    const directory = join(root, ".ai");
    const config = join(directory, "playbooks.json");
    const lock = join(directory, ".playbooks.lock");
    if (dirname(directory) !== root || dirname(config) !== directory || dirname(lock) !== directory) {
        throw new Error("Playbook configuration path is outside the project root.");
    }
    return { root, directory, config, lock };
}

async function safeDirectory(directory: string, create: boolean): Promise<void> {
    try {
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Playbook configuration directory is unsafe.");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (!create) return;
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Playbook configuration directory is unsafe.");
    }
}

async function readBounded(path: string): Promise<Buffer | undefined> {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_CONFIG_BYTES) throw new Error("Playbook configuration is invalid.");
        const bytes = await handle.readFile();
        if (bytes.byteLength > MAX_CONFIG_BYTES) throw new Error("Playbook configuration is invalid.");
        return bytes;
    } finally {
        await handle.close();
    }
}

async function readProjectConfig(projectRoot: string): Promise<{ config?: PlaybookConfig; exists: boolean; issues: PlaybookIssue[] }> {
    const { directory, config } = await paths(projectRoot);
    try {
        await safeDirectory(directory, false);
        if (!existsSync(config)) return { exists: false, issues: [] };
        const info = await lstat(config);
        if (!info.isFile() || info.isSymbolicLink() || !privatePathIsSafe(config)) {
            return { exists: true, issues: ["unsafe-config"] };
        }
        const bytes = await readBounded(config);
        if (!bytes) return { exists: false, issues: [] };
        return { config: playbookConfigSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown), exists: true, issues: [] };
    } catch {
        return { exists: existsSync(config), issues: ["invalid-config"] };
    }
}

function orderedOverrides(overrides: Partial<Record<PlaybookActionId, PlaybookMode>>): Partial<Record<PlaybookActionId, PlaybookMode>> {
    const result: Partial<Record<PlaybookActionId, PlaybookMode>> = {};
    for (const id of PLAYBOOK_ACTION_IDS) if (overrides[id] !== undefined) result[id] = overrides[id];
    return result;
}

function orderedConfig(profile: PlaybookProfile, overrides: Partial<Record<PlaybookActionId, PlaybookMode>>): PlaybookConfig {
    return playbookConfigSchema.parse({ schema_version: PLAYBOOK_SCHEMA_VERSION, profile, overrides: orderedOverrides(overrides) });
}

export async function resolvePlaybookStatus(options: { projectRoot?: string; env?: Record<string, string | undefined> } = {}): Promise<PlaybookStatus> {
    const projectRoot = options.projectRoot ?? process.cwd();
    const env = options.env ?? process.env;
    const stored = await readProjectConfig(projectRoot);
    const issues = [...stored.issues];
    let profile: PlaybookProfile = stored.config?.profile ?? "balanced";
    let source: PlaybookStatus["source"] = stored.config ? "project" : "default";
    const rawEnvironmentProfile = env.CAIRN_PLAYBOOK_PROFILE?.trim();
    if (rawEnvironmentProfile) {
        if ((PLAYBOOK_PROFILES as readonly string[]).includes(rawEnvironmentProfile)) {
            profile = rawEnvironmentProfile as PlaybookProfile;
            source = "environment";
        } else issues.push("invalid-environment-profile");
    }
    const overrides = orderedOverrides(stored.config?.overrides ?? {});
    const modes = {} as Record<PlaybookActionId, PlaybookMode>;
    for (const id of PLAYBOOK_ACTION_IDS) modes[id] = overrides[id] ?? PROFILE_MODES[profile][id];
    const policyDigest = sha256(JSON.stringify({ schema_version: PLAYBOOK_SCHEMA_VERSION, profile, modes: PLAYBOOK_ACTION_IDS.map((id) => [id, modes[id]]) }));
    return {
        schema_version: PLAYBOOK_SCHEMA_VERSION,
        profile,
        source,
        overrides,
        modes,
        policy_digest: policyDigest,
        config_exists: stored.exists,
        issues,
    };
}

async function acquireLock(lock: string): Promise<() => Promise<void>> {
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
        try {
            await mkdir(lock, { mode: 0o700 });
            return () => rm(lock, { recursive: true, force: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            const info = await lstat(lock);
            if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Playbook configuration lock is unsafe.");
            await delay(LOCK_WAIT_MS);
        }
    }
    throw new Error("Playbook configuration is locked; retry after the active update finishes.");
}

async function atomicConfigWrite(path: string, value: PlaybookConfig): Promise<void> {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    let handle;
    try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = undefined;
        hardenPrivatePath(temporary);
        await atomicReplace(temporary, path);
        hardenPrivatePath(path);
    } finally {
        if (handle) await handle.close().catch(() => undefined);
        await rm(temporary, { force: true });
    }
}

async function mutatePolicy(projectRoot: string, mutation: (current: PlaybookConfig | undefined) => PlaybookConfig, requireMissing = false): Promise<PlaybookStatus> {
    const target = await paths(projectRoot);
    await safeDirectory(target.directory, true);
    const release = await acquireLock(target.lock);
    try {
        const read = await readProjectConfig(target.root);
        if (read.issues.length) throw new Error("Existing playbook configuration is invalid or unsafe.");
        if (requireMissing && read.config) throw new Error("Playbook configuration already exists.");
        await atomicConfigWrite(target.config, mutation(read.config));
    } finally {
        await release();
    }
    return resolvePlaybookStatus({ projectRoot: target.root, env: {} });
}

export async function initializePlaybook(projectRoot: string, profile: PlaybookProfile): Promise<PlaybookStatus> {
    return mutatePolicy(projectRoot, () => orderedConfig(profile, {}), true);
}

export async function setPlaybookProfile(projectRoot: string, profile: PlaybookProfile): Promise<PlaybookStatus> {
    return mutatePolicy(projectRoot, (current) => orderedConfig(profile, current?.overrides ?? {}));
}

export async function setPlaybookOverride(projectRoot: string, action: PlaybookActionId, mode: PlaybookMode): Promise<PlaybookStatus> {
    return mutatePolicy(projectRoot, (current) => orderedConfig(current?.profile ?? "balanced", { ...(current?.overrides ?? {}), [action]: mode }));
}

export async function resetPlaybookOverride(projectRoot: string, action: PlaybookActionId): Promise<PlaybookStatus> {
    return mutatePolicy(projectRoot, (current) => {
        const overrides = { ...(current?.overrides ?? {}) };
        delete overrides[action];
        return orderedConfig(current?.profile ?? "balanced", overrides);
    });
}

export async function resetPlaybook(projectRoot: string): Promise<PlaybookStatus> {
    const target = await paths(projectRoot);
    await safeDirectory(target.directory, false);
    if (!existsSync(target.directory)) return resolvePlaybookStatus({ projectRoot: target.root, env: {} });
    const release = await acquireLock(target.lock);
    try {
        if (!existsSync(target.config)) return resolvePlaybookStatus({ projectRoot: target.root, env: {} });
        const info = await lstat(target.config);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error("Playbook configuration is unsafe.");
        await rm(target.config);
    } finally {
        await release();
    }
    return resolvePlaybookStatus({ projectRoot: target.root, env: {} });
}

export function normalizeChangedPaths(values: string[]): string[] {
    if (values.length > 256) throw new Error("Too many changed paths.");
    return [...new Set(values.map((raw) => {
        const value = raw.replaceAll("\\", "/").replace(/^\.\//, "");
        if (!value || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value) || isAbsolute(value)
            || /^[A-Za-z]:\//.test(value) || value.split("/").some((part) => part === ".." || part === "")) {
            throw new Error("Changed paths must be safe project-relative paths.");
        }
        return value;
    }))].sort();
}

export function inferChangeTypes(paths: string[], explicit: PlaybookChangeType[] = []): PlaybookChangeType[] {
    const result = new Set<PlaybookChangeType>(explicit);
    for (const path of normalizeChangedPaths(paths)) {
        const lower = path.toLowerCase();
        const testFile = /(^|\/)(test|tests|spec|specs|__tests__)(\/|$)|\.(test|spec)\./.test(lower);
        if (testFile) result.add("tests");
        if (/(^|\/)(docs?|readme|changelog|license)(\/|\.|$)|\.md$/.test(lower)) result.add("docs");
        if (/(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|cargo\.lock|go\.(mod|sum))$/.test(lower)) result.add("dependencies");
        if (/(^|\/)(auth|security|crypto|permission|permissions|acl|secret|secrets|token|tokens|network|http|cors)(\/|\.|-|_)/.test(lower)) result.add("security");
        if (/\.(json|ya?ml|toml|ini|conf|config)$|(^|\/)(dockerfile|\.github|\.gitlab-ci\.yml)(\/|$)/.test(lower)) result.add("config");
        if (!testFile && /\.(c|cc|cpp|cs|go|java|js|jsx|kt|mjs|py|rb|rs|sh|swift|ts|tsx)$/.test(lower)) result.add("code");
    }
    return PLAYBOOK_CHANGE_TYPES.filter((value) => result.has(value));
}

function applicability(id: PlaybookActionId, event: PlaybookEvent, signals: PlaybookSignals): string | null {
    const types = new Set(signals.change_types);
    const materialCode = types.has("code") || types.has("dependencies") || types.has("security");
    switch (id) {
        case "context.recall": return event === "start" ? "Task start benefits from durable project context." : null;
        case "context.explore": return event !== "finish" && (signals.familiarity !== "known" || signals.complexity === "complex")
            ? "Focused exploration applies because the context is not fully known or the task is complex." : null;
        case "work.plan": return event !== "finish" && signals.complexity !== "trivial"
            ? "A bounded plan applies to standard or complex work." : null;
        case "verify.tests": return event === "finish" && materialCode
            ? "Behavior-affecting files changed and require verification." : null;
        case "review.repository": return event === "finish" && materialCode
            ? "Material code, dependency, or security changes warrant repository review." : null;
        case "review.security": return event === "finish" && (types.has("security") || types.has("dependencies") || signals.risk === "security" || signals.risk === "high")
            ? "Security-sensitive paths, dependencies, or elevated risk trigger the governed audit." : null;
        case "docs.update": return event === "finish" && (signals.public_change || types.has("config") || types.has("dependencies"))
            ? "Public behavior, configuration, or dependency behavior may require documentation alignment." : null;
        case "learning.capture": return event === "finish" && (materialCode || signals.complexity !== "trivial")
            ? "Material work should offer stable learnings to the reviewed memory gate." : null;
    }
}

function evidenceMap(evidence: PlaybookEvidence[]): Map<PlaybookActionId, PlaybookEvidence> {
    const result = new Map<PlaybookActionId, PlaybookEvidence>();
    for (const entry of evidence) {
        const parsed = playbookEvidenceSchema.parse(entry);
        if (result.has(parsed.action)) throw new Error(`Duplicate evidence for ${parsed.action}.`);
        result.set(parsed.action, parsed);
    }
    return result;
}

export async function evaluatePlaybook(options: PlaybookEvaluationOptions): Promise<PlaybookDecision> {
    if (!SESSION_PATTERN.test(options.sessionId)) throw new Error("Invalid playbook session ID.");
    const actor = playbookActorSchema.parse(options.actor);
    const signals = playbookSignalsSchema.parse({
        ...options.signals,
        changed_paths: normalizeChangedPaths(options.signals.changed_paths),
        change_types: PLAYBOOK_CHANGE_TYPES.filter((value) => options.signals.change_types.includes(value)),
    });
    const status = await resolvePlaybookStatus({ projectRoot: options.projectRoot, env: options.env });
    const evidence = evidenceMap(options.evidence ?? []);
    const actions: PlaybookDecision["actions"] = [];
    for (const definition of PLAYBOOK_ACTIONS) {
        const rationale = applicability(definition.id, options.event, signals);
        const mode = status.modes[definition.id];
        if (!rationale || mode === "off") continue;
        const observed = evidence.get(definition.id);
        const outcome = observed?.outcome ?? "pending";
        const blocking = mode === "must" && outcome !== "completed";
        actions.push({ ...definition, mode, rationale, outcome, reason: observed?.reason ?? "", blocking });
    }
    const projectIdentity = await playbookProjectIdentity(options.projectRoot);
    const digestInput = {
        schema_version: PLAYBOOK_SCHEMA_VERSION,
        event: options.event,
        project_identity: projectIdentity,
        profile: status.profile,
        policy_digest: status.policy_digest,
        signals,
        actions: actions.map(({ id, mode, outcome, reason }) => ({ id, mode, outcome, reason })),
    };
    const decisionDigest = sha256(JSON.stringify(digestInput));
    return {
        schema_version: PLAYBOOK_SCHEMA_VERSION,
        event: options.event,
        project_identity: projectIdentity,
        actor,
        session_id: options.sessionId,
        profile: status.profile,
        policy_digest: status.policy_digest,
        decision_digest: decisionDigest,
        signals,
        actions,
        blocking_actions: actions.filter(({ blocking }) => blocking).map(({ id }) => id),
        advisory_actions: actions.filter(({ mode, outcome }) => mode !== "must" && outcome === "pending").map(({ id }) => id),
        issues: status.issues,
    };
}
