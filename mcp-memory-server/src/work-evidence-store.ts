import { createHash, randomUUID } from "node:crypto";
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { basename, dirname, join, relative, resolve } from "node:path";

import { getArtifactLimits, isArtifactStoreEnabled } from "./artifact-schema.js";
import { putArtifact } from "./artifact-store.js";
import { hardenPrivatePath, privatePathIsSafe } from "./platform-security.js";
import {
    WORK_EVIDENCE_SCHEMA_VERSION,
    completeWorkEvidenceSchema,
    getWorkEvidenceLimits,
    isWorkEvidenceEnabled,
    isWorkEvidencePatchEnabled,
    pendingWorkEvidenceSchema,
    storedWorkEvidenceSchema,
    workEvidenceIdSchema,
    workEvidenceLinkSchema,
    type CompleteWorkEvidence,
    type GitEvidenceSnapshot,
    type PendingWorkEvidence,
    type StoredWorkEvidence,
    type WorkEvidenceHarness,
    type WorkEvidenceLimits,
    type WorkEvidenceLink,
} from "./work-evidence-schema.js";

const MAX_RECORD_BYTES = 1024 * 1024;
const STALE_PENDING_MS = 24 * 60 * 60 * 1000;
const EMPTY_DIGEST = createHash("sha256").update("").digest("hex");

type GitState = {
    root: string;
    snapshot: GitEvidenceSnapshot;
    pathFingerprints: Array<{ path: string; state_digest: string }>;
};

export type WorkEvidenceView = StoredWorkEvidence & { links: WorkEvidenceLink[] };
export type WorkEvidenceList = {
    schema_version: 1;
    evidence: WorkEvidenceView[];
    logical_bytes: number;
};

type WorkEvidenceRow = {
    stored: StoredWorkEvidence;
    links: WorkEvidenceLink[];
    bytes: number;
};

function sha256(value: string | Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right, "en"))
            .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function storeRoot(projectRoot: string): string {
    return resolve(projectRoot, ".agentfs", "work-evidence", "v1");
}

function recordsRoot(projectRoot: string): string {
    return join(storeRoot(projectRoot), "records");
}

function linksRoot(projectRoot: string, evidenceId: string): string {
    return join(storeRoot(projectRoot), "links", evidenceId);
}

function ensureStoreHierarchy(projectRoot: string, create: boolean): boolean {
    const project = resolve(projectRoot);
    const paths = [join(project, ".agentfs"), join(project, ".agentfs", "work-evidence"), storeRoot(project)];
    for (const path of paths) {
        if (!existsSync(path)) {
            if (!create) return false;
            mkdirSync(path, { mode: 0o700 });
        }
        const info = lstatSync(path);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Work-evidence storage ancestors must be real directories.");
        hardenPrivatePath(path);
    }
    return true;
}

function assertSafeDirectory(path: string, create: boolean): void {
    const parent = dirname(path);
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw new Error("Work-evidence storage parent must not be a symlink.");
    if (!existsSync(path)) {
        if (!create) return;
        mkdirSync(path, { recursive: true, mode: 0o700 });
    }
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Work-evidence storage must be a real directory.");
    hardenPrivatePath(path);
}

function atomicJson(path: string, value: unknown): void {
    assertSafeDirectory(dirname(path), true);
    const content = `${canonical(value)}\n`;
    if (Buffer.byteLength(content) > MAX_RECORD_BYTES) throw new Error("Work-evidence record exceeds its byte limit.");
    const temporary = join(dirname(path), `.tmp-${basename(path)}-${process.pid}-${randomUUID()}`);
    writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    hardenPrivatePath(temporary);
    if (process.platform === "win32" && existsSync(path)) {
        const backup = `${path}.replace-backup-${randomUUID()}`;
        const result = spawnSync("powershell.exe", [
            "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
            "[IO.File]::Replace($env:CK_INTERNAL_ATOMIC_SOURCE,$env:CK_INTERNAL_ATOMIC_DESTINATION,$env:CK_INTERNAL_ATOMIC_BACKUP,$true)",
        ], {
            encoding: "utf8",
            windowsHide: true,
            env: { ...process.env, CK_INTERNAL_ATOMIC_SOURCE: temporary, CK_INTERNAL_ATOMIC_DESTINATION: path, CK_INTERNAL_ATOMIC_BACKUP: backup },
        });
        rmSync(backup, { force: true });
        if (result.status !== 0) {
            rmSync(temporary, { force: true });
            throw new Error("Unable to atomically replace the work-evidence record.");
        }
    } else renameSync(temporary, path);
    hardenPrivatePath(path);
}

function readJson(path: string): unknown {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_RECORD_BYTES || !privatePathIsSafe(path)) {
        throw new Error("Unsafe work-evidence record.");
    }
    return JSON.parse(readFileSync(path, "utf8"));
}

function gitBuffer(root: string, args: string[], maxBuffer = 16 * 1024 * 1024): Buffer {
    return execFileSync("git", ["-C", root, ...args], {
        encoding: "buffer",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        maxBuffer,
    }) as Buffer;
}

function gitText(root: string, args: string[]): string {
    return gitBuffer(root, args).toString("utf8").trim();
}

function safePathLabel(raw: Buffer): string {
    const decoded = raw.toString("utf8");
    const roundTrip = Buffer.from(decoded, "utf8").equals(raw);
    const normalized = decoded.replaceAll("\\", "/");
    if (roundTrip
        && normalized.length > 0
        && normalized.length <= 4096
        && !normalized.startsWith("/")
        && !normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
        && !/[\u0000-\u001f\u007f]/.test(normalized)) return normalized;
    return `opaque-path-${sha256(raw).slice(0, 24)}`;
}

function statusEntries(root: string): Array<{ code: string; path: string; original?: string }> {
    const output = gitBuffer(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const fields: Buffer[] = [];
    let start = 0;
    for (let index = 0; index < output.length; index += 1) {
        if (output[index] !== 0) continue;
        fields.push(output.subarray(start, index));
        start = index + 1;
    }
    const result: Array<{ code: string; path: string; original?: string }> = [];
    for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
        if (field.length < 4 || field[2] !== 0x20) continue;
        const code = field.subarray(0, 2).toString("ascii");
        const path = safePathLabel(field.subarray(3));
        if (/^[RC]/.test(code) || /[RC]$/.test(code)) {
            const original = fields[++index];
            result.push({ code, path, ...(original ? { original: safePathLabel(original) } : {}) });
        } else result.push({ code, path });
    }
    return result
        .filter((entry) => entry.path !== ".agentfs/work-evidence" && !entry.path.startsWith(".agentfs/work-evidence/"))
        .sort((left, right) => left.path.localeCompare(right.path, "en") || left.code.localeCompare(right.code, "en"));
}

function pathDigest(root: string, entry: { code: string; path: string; original?: string }): string {
    let indexState = "";
    let worktreeState = "missing";
    try { indexState = gitText(root, ["ls-files", "-s", "--", entry.path]); } catch { /* absent from index */ }
    try { worktreeState = gitText(root, ["hash-object", "--no-filters", "--", entry.path]); } catch { /* deleted or unreadable */ }
    return sha256(canonical({ ...entry, index_state: indexState, worktree_state: worktreeState }));
}

function resolveGitRoot(projectRoot: string): string {
    return resolve(gitText(resolve(projectRoot), ["rev-parse", "--show-toplevel"]));
}

export function inspectGitState(projectRoot: string): GitState {
    const root = resolveGitRoot(projectRoot);
    let headCommit: string | null = null;
    try { headCommit = gitText(root, ["rev-parse", "--verify", "HEAD"]); } catch { /* unborn */ }
    let branch: string | null = null;
    try { branch = gitText(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) || null; } catch { /* detached */ }
    const entries = statusEntries(root);
    const pathFingerprints = entries.map((entry) => ({ path: entry.path, state_digest: pathDigest(root, entry) }));
    const statusDigest = entries.length ? sha256(canonical(entries)) : EMPTY_DIGEST;
    const workspaceDiffDigest = pathFingerprints.length ? sha256(canonical(pathFingerprints)) : EMPTY_DIGEST;
    return {
        root,
        snapshot: {
            head_commit: headCommit,
            branch,
            detached: headCommit !== null && branch === null,
            unborn: headCommit === null,
            dirty: entries.length > 0,
            status_digest: statusDigest,
            workspace_diff_digest: workspaceDiffDigest,
        },
        pathFingerprints,
    };
}

function recordPath(projectRoot: string, evidenceId: string): string {
    return join(recordsRoot(projectRoot), `${workEvidenceIdSchema.parse(evidenceId)}.json`);
}

function readStored(evidenceId: string, projectRoot: string): StoredWorkEvidence {
    return storedWorkEvidenceSchema.parse(readJson(recordPath(projectRoot, evidenceId)));
}

function readLinks(evidenceId: string, projectRoot: string): WorkEvidenceLink[] {
    const root = linksRoot(projectRoot, evidenceId);
    if (!existsSync(root)) return [];
    assertSafeDirectory(root, false);
    return readdirSync(root).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort()
        .map((name) => workEvidenceLinkSchema.parse(readJson(join(root, name))));
}

function resolveIdentifier(identifier: string, projectRoot: string): string {
    const records = recordsRoot(projectRoot);
    if (!existsSync(records)) throw new Error(`Work evidence "${identifier}" not found.`);
    assertSafeDirectory(records, false);
    const ids = readdirSync(records).filter((name) => /^wev_[0-9a-f-]{36}\.json$/i.test(name)).map((name) => name.slice(0, -5));
    const matches = ids.filter((id) => id === identifier || id.startsWith(identifier));
    if (matches.length === 0) throw new Error(`Work evidence "${identifier}" not found.`);
    const exact = matches.find((id) => id === identifier);
    if (!exact && matches.length > 1) throw new Error(`Work-evidence prefix "${identifier}" is ambiguous.`);
    return exact ?? matches[0];
}

export function startWorkEvidence(projectRoot: string, harness: WorkEvidenceHarness, now = new Date()): PendingWorkEvidence {
    if (!isWorkEvidenceEnabled()) throw new Error("Work evidence is not enabled.");
    const state = inspectGitState(projectRoot);
    ensureStoreHierarchy(state.root, true);
    const evidence = pendingWorkEvidenceSchema.parse({
        schema_version: WORK_EVIDENCE_SCHEMA_VERSION,
        evidence_id: `wev_${randomUUID()}`,
        status: "pending",
        harness,
        started_at: now.toISOString(),
        start: state.snapshot,
        path_fingerprints: state.pathFingerprints.slice(0, getWorkEvidenceLimits().maxTouchedPaths),
    });
    atomicJson(recordPath(state.root, evidence.evidence_id), evidence);
    return evidence;
}

function changedPaths(start: PendingWorkEvidence, end: GitState, limit: number): { paths: string[]; omitted: number } {
    const before = new Map(start.path_fingerprints.map((entry) => [entry.path, entry.state_digest]));
    const after = new Map(end.pathFingerprints.map((entry) => [entry.path, entry.state_digest]));
    const paths = Array.from(new Set([...before.keys(), ...after.keys()]))
        .filter((path) => before.get(path) !== after.get(path))
        .sort((left, right) => left.localeCompare(right, "en"));
    return { paths: paths.slice(0, limit), omitted: Math.max(0, paths.length - limit) };
}

function capturePatch(root: string, start: PendingWorkEvidence, maxBytes: number): { text?: string; reason?: CompleteWorkEvidence["patch"]["unavailable_reason"] } {
    if (!isWorkEvidencePatchEnabled()) return { reason: "not-requested" };
    if (!isArtifactStoreEnabled()) return { reason: "artifact-store-disabled" };
    if (!start.start.head_commit) return { reason: "unborn-start" };
    try {
        const output = gitBuffer(
            root,
            ["diff", "--binary", "--full-index", "--no-ext-diff", start.start.head_commit, "--"],
            Math.min(64 * 1024 * 1024, Math.max(16 * 1024 * 1024, maxBytes * 4)),
        );
        if (output.length === 0) return { reason: "unchanged" };
        return { text: output.toString("utf8") };
    } catch {
        return { reason: "capture-failed" };
    }
}

export async function finishWorkEvidence(
    projectRoot: string,
    evidenceId: string,
    exitStatus: number,
    options: { now?: Date; limits?: WorkEvidenceLimits } = {},
): Promise<CompleteWorkEvidence> {
    const root = resolveGitRoot(projectRoot);
    const start = readStored(workEvidenceIdSchema.parse(evidenceId), root);
    if (start.status === "complete") return start;
    const limits = options.limits ?? getWorkEvidenceLimits();
    const end = inspectGitState(root);
    if (end.root !== root) throw new Error("Work-evidence repository identity changed during the session.");
    const touched = changedPaths(start, end, limits.maxTouchedPaths);
    const patchCapture = capturePatch(root, start, limits.patchMaxBytes);
    let artifactId: string | null = null;
    if (patchCapture.text !== undefined) {
        const artifactLimits = getArtifactLimits();
        const result = await putArtifact(root, {
            kind: "diff",
            session_ref: start.evidence_id,
            media_type: "text/x-diff",
            provenance: {
                producer: "cairn-work-evidence",
                source_event: "launcher-exit",
                harness: start.harness === "claude" ? "claude-code" : ["opencode", "pi"].includes(start.harness) ? start.harness : undefined,
            },
            content: { text: patchCapture.text },
        }, { ...artifactLimits, artifactMaxBytes: Math.min(artifactLimits.artifactMaxBytes, limits.patchMaxBytes) });
        artifactId = result.artifact.artifact_id;
        await appendWorkEvidenceLink(root, start.evidence_id, { kind: "artifact", artifact_id: artifactId });
    }
    const completed = completeWorkEvidenceSchema.parse({
        schema_version: WORK_EVIDENCE_SCHEMA_VERSION,
        evidence_id: start.evidence_id,
        status: "complete",
        harness: start.harness,
        started_at: start.started_at,
        ended_at: (options.now ?? new Date()).toISOString(),
        exit_status: Math.max(0, Math.min(255, exitStatus)),
        start: start.start,
        end: end.snapshot,
        touched_paths: touched.paths,
        omitted_touched_paths: touched.omitted,
        change_digest: sha256(canonical({ start: start.start, end: end.snapshot, touched_paths: touched.paths, omitted: touched.omitted })),
        patch: {
            requested: isWorkEvidencePatchEnabled(),
            scope: artifactId ? "end-worktree-vs-start-commit" : null,
            artifact_id: artifactId,
            unavailable_reason: artifactId ? null : (patchCapture.reason ?? "capture-failed"),
        },
    });
    atomicJson(recordPath(root, start.evidence_id), completed);
    await pruneWorkEvidence(root, limits, { dryRun: false, preserve: completed.evidence_id });
    return completed;
}

export async function appendWorkEvidenceLink(
    projectRoot: string,
    evidenceId: string,
    value: { kind: "trajectory"; trajectory_id: string }
        | { kind: "artifact"; artifact_id: string }
        | { kind: "reviewed_memory"; scope: string; review_id: string; key: string },
    now = new Date(),
): Promise<WorkEvidenceLink | null> {
    if (!isWorkEvidenceEnabled()) return null;
    const id = workEvidenceIdSchema.parse(evidenceId);
    const root = resolve(projectRoot);
    if (!ensureStoreHierarchy(root, false)) return null;
    if (!existsSync(recordPath(root, id))) return null;
    const linkId = sha256(canonical({ evidence_id: id, ...value }));
    const link = workEvidenceLinkSchema.parse({
        schema_version: WORK_EVIDENCE_SCHEMA_VERSION,
        link_id: linkId,
        evidence_id: id,
        created_at: now.toISOString(),
        ...value,
    });
    const path = join(linksRoot(root, id), `${linkId}.json`);
    if (!existsSync(path)) atomicJson(path, link);
    return link;
}

export async function linkActiveWorkEvidence(
    projectRoot: string,
    value: Parameters<typeof appendWorkEvidenceLink>[2],
): Promise<WorkEvidenceLink | null> {
    const evidenceId = process.env.CAIRN_WORK_EVIDENCE_ID?.trim();
    if (!evidenceId || !isWorkEvidenceEnabled()) return null;
    try {
        const root = process.env.CAIRN_WORK_EVIDENCE_ROOT?.trim() || projectRoot;
        return await appendWorkEvidenceLink(resolve(root), evidenceId, value);
    } catch {
        return null;
    }
}

function storedWorkEvidenceRows(projectRoot: string, status?: "pending" | "complete"): WorkEvidenceRow[] {
    if (!ensureStoreHierarchy(projectRoot, false)) return [];
    const root = recordsRoot(projectRoot);
    if (!existsSync(root)) return [];
    assertSafeDirectory(root, false);
    return readdirSync(root).filter((name) => /^wev_[0-9a-f-]{36}\.json$/i.test(name)).map((name) => {
        const path = join(root, name);
        const stored = storedWorkEvidenceSchema.parse(readJson(path));
        const links = readLinks(stored.evidence_id, projectRoot);
        const linkBytes = links.reduce((sum, link) => sum + statSync(join(linksRoot(projectRoot, stored.evidence_id), `${link.link_id}.json`)).size, 0);
        return { stored, links, bytes: statSync(path).size + linkBytes };
    }).filter(({ stored }) => !status || stored.status === status)
        .sort((left, right) => Date.parse(right.stored.started_at) - Date.parse(left.stored.started_at)
            || right.stored.evidence_id.localeCompare(left.stored.evidence_id, "en"));
}

export function listWorkEvidence(projectRoot = process.cwd(), options: { status?: "pending" | "complete"; limit?: number } = {}): WorkEvidenceList {
    const rows = storedWorkEvidenceRows(projectRoot, options.status);
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Work-evidence list limit must be between 1 and 1000.");
    return {
        schema_version: WORK_EVIDENCE_SCHEMA_VERSION,
        evidence: rows.slice(0, limit).map(({ stored, links }) => ({ ...stored, links })),
        logical_bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    };
}

export function readWorkEvidence(identifier: string, projectRoot = process.cwd()): WorkEvidenceView {
    const evidenceId = resolveIdentifier(identifier, projectRoot);
    const stored = readStored(evidenceId, projectRoot);
    return { ...stored, links: readLinks(evidenceId, projectRoot) };
}

export function deleteWorkEvidence(identifier: string, projectRoot = process.cwd(), dryRun = false) {
    const evidenceId = resolveIdentifier(identifier, projectRoot);
    if (!dryRun) {
        rmSync(recordPath(projectRoot, evidenceId), { force: true });
        rmSync(linksRoot(projectRoot, evidenceId), { recursive: true, force: true });
    }
    return { schema_version: WORK_EVIDENCE_SCHEMA_VERSION, evidence_id: evidenceId, deleted: !dryRun, dry_run: dryRun };
}

export function pruneWorkEvidence(
    projectRoot: string,
    limits: WorkEvidenceLimits = getWorkEvidenceLimits(),
    options: { dryRun?: boolean; preserve?: string } = {},
) {
    const rows = storedWorkEvidenceRows(projectRoot);
    const evidence = rows.map(({ stored, links }) => ({ ...stored, links }));
    const cutoff = Date.now() - limits.retentionDays * 86400000;
    const complete = evidence.filter((row): row is WorkEvidenceView & CompleteWorkEvidence => row.status === "complete")
        .sort((left, right) => Date.parse(left.ended_at) - Date.parse(right.ended_at));
    const removed = new Map<string, "age" | "store_budget">();
    const bytesByEvidence = new Map(rows.map(({ stored, bytes }) => [stored.evidence_id, bytes]));
    for (const row of complete) {
        if (row.evidence_id !== options.preserve && Date.parse(row.ended_at) < cutoff) removed.set(row.evidence_id, "age");
    }
    let total = rows.reduce((sum, row) => sum + row.bytes, 0);
    for (const row of complete) {
        if (total <= limits.storeMaxBytes) break;
        if (row.evidence_id === options.preserve || removed.has(row.evidence_id)) continue;
        removed.set(row.evidence_id, "store_budget");
        total -= bytesByEvidence.get(row.evidence_id) ?? 0;
    }
    if (!options.dryRun) for (const evidenceId of removed.keys()) deleteWorkEvidence(evidenceId, projectRoot, false);
    return {
        schema_version: WORK_EVIDENCE_SCHEMA_VERSION,
        dry_run: options.dryRun ?? false,
        removed: Array.from(removed, ([evidence_id, reason]) => ({ evidence_id, reason })),
        remaining_evidence: evidence.length - removed.size,
    };
}

export function doctorWorkEvidence(projectRoot = process.cwd(), repair = false) {
    const root = storeRoot(projectRoot);
    if (!existsSync(root)) return { schema_version: 1 as const, exists: false, ok: true, repaired: false, records: 0, links: 0, issues: [] as string[] };
    const issues: string[] = [];
    let records = 0;
    let links = 0;
    let repaired = false;
    const temporary: string[] = [];
    try {
        ensureStoreHierarchy(projectRoot, false);
        assertSafeDirectory(root, false);
        const recordDir = recordsRoot(projectRoot);
        if (existsSync(recordDir)) {
            assertSafeDirectory(recordDir, false);
            for (const name of readdirSync(recordDir)) {
                const path = join(recordDir, name);
                if (name.startsWith(".tmp-")) { temporary.push(path); issues.push(`temporary remnant: ${name}`); continue; }
                if (!/^wev_[0-9a-f-]{36}\.json$/i.test(name)) { issues.push(`unexpected record: ${name}`); continue; }
                try {
                    const row = storedWorkEvidenceSchema.parse(readJson(path));
                    records += 1;
                    if (row.status === "pending" && Date.now() - Date.parse(row.started_at) > STALE_PENDING_MS) issues.push(`stale pending evidence: ${row.evidence_id}`);
                } catch { issues.push(`invalid record: ${name}`); }
            }
        }
        const linkBase = join(root, "links");
        if (existsSync(linkBase)) {
            assertSafeDirectory(linkBase, false);
            for (const evidenceId of readdirSync(linkBase)) {
                const dir = join(linkBase, evidenceId);
                try { workEvidenceIdSchema.parse(evidenceId); assertSafeDirectory(dir, false); } catch { issues.push(`unsafe link directory: ${evidenceId}`); continue; }
                for (const name of readdirSync(dir)) {
                    const path = join(dir, name);
                    if (name.startsWith(".tmp-")) { temporary.push(path); issues.push(`temporary remnant: links/${evidenceId}/${name}`); continue; }
                    try {
                        const link = workEvidenceLinkSchema.parse(readJson(path));
                        if (link.evidence_id !== evidenceId || `${link.link_id}.json` !== name) throw new Error("mismatch");
                        links += 1;
                    } catch { issues.push(`invalid link: ${evidenceId}/${name}`); }
                }
            }
        }
        if (repair && temporary.length > 0) {
            for (const path of temporary) rmSync(path, { force: true });
            for (let index = issues.length - 1; index >= 0; index -= 1) if (issues[index].startsWith("temporary remnant:")) issues.splice(index, 1);
            repaired = true;
        }
    } catch (error) {
        issues.push(error instanceof Error ? error.message : "work-evidence diagnostics failed");
    }
    return { schema_version: 1 as const, exists: true, ok: issues.length === 0, repaired, records, links, issues };
}

export function activeEvidenceEnvironment(evidence: PendingWorkEvidence, projectRoot: string): NodeJS.ProcessEnv {
    return {
        CAIRN_WORK_EVIDENCE_ID: evidence.evidence_id,
        CAIRN_WORK_EVIDENCE_ROOT: resolveGitRoot(projectRoot),
    };
}

export function getWorkEvidenceStorePath(projectRoot = process.cwd()): string {
    return storeRoot(projectRoot);
}
