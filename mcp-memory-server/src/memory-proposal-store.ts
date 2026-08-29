import {
    constants,
    closeSync,
    existsSync,
    fstatSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    openSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { extractMemoryCandidates, type ExtractionCategory } from "./memory-extraction.js";
import {
    MEMORY_PROPOSAL_MAX_BYTES,
    MEMORY_PROPOSAL_MAX_CANDIDATES,
    digestText,
    digestValue,
    expectedMemoryProposalOperation,
    memoryProposalBodySchema,
    sealProposal,
    verifyProposal,
    type MemoryProposal,
} from "./memory-proposal-schema.js";
import { applyProposalCandidates, readMemoryBaseHashes, resolveMemoryScopePath, type ReviewedMemoryOptions } from "./reviewed-memory-store.js";
import { redactLocalValue } from "./trajectory-redaction.js";
import { showTrajectory } from "./trajectory-store.js";
import { isTypedMemoryNodesEnabled } from "./node-schema.js";
import { atomicReplace, hardenPrivatePath, privatePathIsSafe } from "./platform-security.js";

const PROPOSAL_FILE_PATTERN = /^[a-f0-9]{64}\.json$/;
const PROPOSAL_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const MAX_PROPOSAL_FILES = 1024;
const MAX_PROPOSAL_STORE_BYTES = 64 * 1024 * 1024;
const MAX_EXTRACTION_INPUT_BYTES = 1024 * 1024;

function canonicalProjectRoot(projectRoot: string): string {
    const resolved = resolve(projectRoot);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new Error(`Project directory does not exist: ${resolved}`);
    const root = realpathSync(resolved);
    const info = lstatSync(root);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Project directory is unsafe: ${root}`);
    return root;
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | null {
    try { return lstatSync(path); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

function assertDirectory(path: string, label: string, requirePrivate: boolean): void {
    const info = lstatIfPresent(path);
    if (!info) return;
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} is not a regular directory.`);
    if (requirePrivate && !privatePathIsSafe(path)) throw new Error(`${label} is not private.`);
}

export function memoryProposalDirectory(projectRoot = process.cwd()): string {
    const root = canonicalProjectRoot(projectRoot);
    const runtimeDirectory = join(root, ".agentfs");
    assertDirectory(runtimeDirectory, "Project .agentfs path", false);
    const directory = join(runtimeDirectory, "memory-proposals");
    assertDirectory(directory, "Memory proposal store", true);
    return directory;
}

function ensureDirectory(projectRoot: string): string {
    const root = canonicalProjectRoot(projectRoot);
    const runtimeDirectory = join(root, ".agentfs");
    const runtimeInfo = lstatIfPresent(runtimeDirectory);
    if (!runtimeInfo) {
        mkdirSync(runtimeDirectory, { mode: 0o700 });
        hardenPrivatePath(runtimeDirectory);
    } else if (runtimeInfo.isSymbolicLink() || !runtimeInfo.isDirectory()) {
        throw new Error("Project .agentfs path is not a regular directory.");
    }
    assertDirectory(runtimeDirectory, "Project .agentfs path", false);
    const directory = join(runtimeDirectory, "memory-proposals");
    const storeInfo = lstatIfPresent(directory);
    if (!storeInfo) {
        mkdirSync(directory, { mode: 0o700 });
        hardenPrivatePath(directory);
    } else if (storeInfo.isSymbolicLink() || !storeInfo.isDirectory()) {
        throw new Error("Memory proposal store is not a regular directory.");
    }
    assertDirectory(directory, "Memory proposal store", true);
    return directory;
}

function strictFiles(directory: string): string[] {
    const directoryInfo = lstatIfPresent(directory);
    if (!directoryInfo) return [];
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) throw new Error("Memory proposal store is not a regular directory.");
    const names = readdirSync(directory).sort();
    if (names.length > MAX_PROPOSAL_FILES) throw new Error("Memory proposal store exceeds its file-count limit.");
    let total = 0;
    for (const name of names) {
        if (!PROPOSAL_FILE_PATTERN.test(name)) throw new Error(`Unexpected file in memory proposal store: ${name}`);
        const path = join(directory, name);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Memory proposal is not a regular file: ${name}`);
        if (stat.size > MEMORY_PROPOSAL_MAX_BYTES) throw new Error(`Memory proposal exceeds its size limit: ${name}`);
        total += stat.size;
        if (total > MAX_PROPOSAL_STORE_BYTES) throw new Error("Memory proposal store exceeds its byte limit.");
    }
    return names;
}

function parseFile(path: string): MemoryProposal {
    const info = lstatIfPresent(path);
    if (!info) throw new Error("Memory proposal not found.");
    if (info.isSymbolicLink() || !info.isFile()) throw new Error("Memory proposal is not a regular file.");
    if (info.size > MEMORY_PROPOSAL_MAX_BYTES) throw new Error("Memory proposal exceeds its size limit.");
    if (!privatePathIsSafe(path)) throw new Error("Memory proposal is not private.");
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes: Buffer;
    try {
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.size > MEMORY_PROPOSAL_MAX_BYTES
            || opened.dev !== info.dev || opened.ino !== info.ino) {
            throw new Error("Memory proposal changed during validation.");
        }
        bytes = readFileSync(fd);
    } finally { closeSync(fd); }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new Error("Memory proposal is not valid UTF-8 JSON."); }
    const proposal = verifyProposal(value);
    if (`${proposal.digest}.json` !== basename(path)) throw new Error("Memory proposal filename does not match its digest.");
    return proposal;
}

async function writeImmutable(projectRoot: string, proposal: MemoryProposal): Promise<void> {
    const bytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`, "utf8");
    if (bytes.byteLength > MEMORY_PROPOSAL_MAX_BYTES) throw new Error("Memory proposal exceeds its size limit.");
    const directory = ensureDirectory(projectRoot);
    const finalPath = join(directory, `${proposal.digest}.json`);
    if (lstatIfPresent(finalPath)) {
        const existing = parseFile(finalPath);
        if (existing.digest !== proposal.digest) throw new Error("Conflicting immutable memory proposal.");
        return;
    }
    const existing = strictFiles(directory);
    const existingBytes = existing.reduce((total, name) => total + statSync(join(directory, name)).size, 0);
    if (existing.length >= MAX_PROPOSAL_FILES || existingBytes + bytes.byteLength > MAX_PROPOSAL_STORE_BYTES) {
        throw new Error("Memory proposal store limit reached.");
    }
    const temporary = join(dirname(finalPath), `.${proposal.digest}.${randomUUID()}.tmp`);
    let fd: number | undefined;
    try {
        fd = openSync(temporary, "wx", 0o600);
        writeFileSync(fd, bytes);
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        hardenPrivatePath(temporary);
        await atomicReplace(temporary, finalPath);
        hardenPrivatePath(finalPath);
        parseFile(finalPath);
    } catch (error) {
        if (fd !== undefined) closeSync(fd);
        rmSync(temporary, { force: true });
        throw error;
    }
}

export async function createMemoryProposal(options: {
    projectRoot?: string;
    sessionId: string;
    scope: string;
    model?: string;
    category?: ExtractionCategory;
    reviewedOptions?: ReviewedMemoryOptions;
}): Promise<MemoryProposal> {
    if (options.scope === "all") throw new Error('Proposal scope must be concrete; "all" is not allowed.');
    const projectRoot = canonicalProjectRoot(options.projectRoot ?? process.cwd());
    resolveMemoryScopePath(options.scope, { cwd: projectRoot, ...options.reviewedOptions });
    const trajectory = await showTrajectory(options.sessionId, projectRoot);
    const sourceDigest = digestValue(trajectory);
    const redacted = redactLocalValue(trajectory, projectRoot).value;
    const outbound = JSON.stringify(redacted);
    if (Buffer.byteLength(outbound, "utf8") > MAX_EXTRACTION_INPUT_BYTES) throw new Error("Redacted trajectory exceeds the extraction input limit.");

    // Persistence intentionally happens only after the outbound request succeeds.
    const extraction = await extractMemoryCandidates(outbound, options.model, options.category);
    if (extraction.candidates.length > MEMORY_PROPOSAL_MAX_CANDIDATES) {
        throw new Error(`Extraction returned more than ${MEMORY_PROPOSAL_MAX_CANDIDATES} candidates.`);
    }
    const deduped = new Map<string, typeof extraction.candidates[number]>();
    for (const candidate of extraction.candidates) {
        if (candidate.key.length > 512 || Buffer.byteLength(candidate.value, "utf8") > 64 * 1024) {
            throw new Error(`Extraction candidate "${candidate.key.slice(0, 80)}" exceeds proposal limits.`);
        }
        if (deduped.has(candidate.key)) throw new Error(`Extraction returned duplicate memory key "${candidate.key}".`);
        deduped.set(candidate.key, candidate);
    }
    if (deduped.size === 0) throw new Error("Extraction produced no durable memory candidates; no proposal was stored.");
    const bases = await readMemoryBaseHashes(options.scope, [...deduped.keys()], { cwd: projectRoot, ...options.reviewedOptions });
    const candidates = [...deduped.values()].map((candidate) => {
        const base = bases.get(candidate.key)!;
        const valueHash = digestText(candidate.value);
        return {
            ...candidate,
            operation: expectedMemoryProposalOperation(base.hash, valueHash),
            base_hash: base.hash,
            value_hash: valueHash,
        };
    });
    const body = memoryProposalBodySchema.parse({
        schema_version: 1,
        created_at: new Date().toISOString(),
        project_root: projectRoot,
        scope: options.scope,
        source: { kind: "trajectory", session_id: trajectory.session_id, digest: sourceDigest },
        extraction: { model: extraction.model },
        candidates,
    });
    const proposal = sealProposal(body);
    await writeImmutable(projectRoot, proposal);
    return proposal;
}

export function listMemoryProposals(projectRoot = process.cwd()): MemoryProposal[] {
    const directory = memoryProposalDirectory(projectRoot);
    return strictFiles(directory).map((name) => parseFile(join(directory, name)));
}

export function showMemoryProposal(digest: string, projectRoot = process.cwd()): MemoryProposal {
    if (!PROPOSAL_DIGEST_PATTERN.test(digest)) throw new Error("Proposal apply/show requires the full exact SHA-256 digest.");
    const directory = memoryProposalDirectory(projectRoot);
    const path = join(directory, `${digest}.json`);
    if (!lstatIfPresent(path)) throw new Error(`Memory proposal ${digest} not found.`);
    return parseFile(path);
}

export async function applyMemoryProposal(digest: string, projectRoot = process.cwd()): Promise<Record<string, unknown>> {
    const root = canonicalProjectRoot(projectRoot);
    const proposal = showMemoryProposal(digest, root);
    if (proposal.project_root !== root) throw new Error("Memory proposal belongs to a different project.");
    const trajectory = await showTrajectory(proposal.source.session_id, root);
    if (digestValue(trajectory) !== proposal.source.digest) throw new Error("Memory proposal source trajectory is stale.");
    return applyProposalCandidates(proposal.scope, proposal.digest, proposal.candidates, {
        cwd: root,
        typed: isTypedMemoryNodesEnabled(),
    });
}

export function doctorMemoryProposals(projectRoot = process.cwd()): {
    ok: boolean;
    directory: string;
    count: number;
    issues: string[];
} {
    let directory = join(resolve(projectRoot), ".agentfs", "memory-proposals");
    const issues: string[] = [];
    let count = 0;
    try {
        directory = memoryProposalDirectory(projectRoot);
        const names = strictFiles(directory);
        count = names.length;
        for (const name of names) {
            const path = join(directory, name);
            try {
                parseFile(path);
            } catch (error) {
                issues.push(`${name}: ${error instanceof Error ? error.message : "invalid proposal"}`);
            }
        }
    } catch (error) {
        issues.push(error instanceof Error ? error.message : "invalid proposal store");
    }
    return { ok: issues.length === 0, directory, count, issues };
}
