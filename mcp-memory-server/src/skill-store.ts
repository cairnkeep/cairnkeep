import { createHash, randomBytes } from "node:crypto";
import { constants, existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

import { canonicalDigest } from "./eval-schema.js";
import { EvalProcessError, runBoundedJsonProcess } from "./eval-process.js";
import { noteNodeSchema } from "./node-schema.js";
import { getNoteLayout, listAddressedNotes } from "./note-store.js";
import { hardenPrivatePath, privatePathIsSafe } from "./platform-security.js";
import {
    MAX_SKILL_BYTES,
    SKILL_SCHEMA_VERSION,
    skillAdapterConfigSchema,
    skillApplicationSchema,
    skillCandidateSchema,
    skillEvaluationSchema,
    skillProposalRequestSchema,
    skillProposalResponseSchema,
    skillProposalSchema,
    skillRelativePathSchema,
    type SkillAdapterConfig,
    type SkillApplication,
    type SkillCandidate,
    type SkillEdit,
    type SkillEvaluation,
    type SkillProposal,
} from "./skill-schema.js";

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const PROTECTED_ADAPTER_ENVIRONMENT = new Set([
    "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "PATH", "PWD", "OLDPWD", "INIT_CWD",
    "TMPDIR", "TMP", "TEMP", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
    "XDG_STATE_HOME", "XDG_RUNTIME_DIR", "LANG", "LC_ALL", "NODE_OPTIONS", "NODE_PATH",
    "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
    "BASH_ENV", "ENV", "SHELLOPTS", "PYTHONHOME", "PYTHONPATH", "RUBYOPT", "PERL5OPT",
]);

export type SkillStore = {
    project_root: string;
    root: string;
    candidates: string;
    proposals: string;
    evaluations: string;
    applications: string;
    backups: string;
    adapter_tmp: string;
};

function sha256(value: string | Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}

export function sha256File(path: string): string {
    const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    try {
        let bytesRead = 0;
        do {
            bytesRead = readSync(descriptor, buffer, 0, buffer.byteLength, null);
            if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
        } while (bytesRead > 0);
        return hash.digest("hex");
    } finally {
        closeSync(descriptor);
    }
}

function isContained(root: string, candidate: string): boolean {
    const path = relative(root, candidate);
    return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function pathCrossesSymlink(path: string): boolean {
    const absolute = resolve(path);
    const root = parse(absolute).root;
    let cursor = root;
    for (const segment of absolute.slice(root.length).split(sep).filter(Boolean)) {
        cursor = join(cursor, segment);
        if (lstatSync(cursor).isSymbolicLink()) return true;
    }
    return false;
}

function requireProjectRoot(projectRoot: string): string {
    const absolute = resolve(projectRoot);
    const info = lstatSync(absolute);
    if (!info.isDirectory() || pathCrossesSymlink(absolute)) {
        throw new Error("Project root must be a real, non-symlink directory.");
    }
    return absolute;
}

function privateDirectory(path: string): void {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const info = lstatSync(path);
    if (!info.isDirectory() || pathCrossesSymlink(path)) {
        throw new Error(`Unsafe skill state directory: ${path}`);
    }
    hardenPrivatePath(path);
}

export function getSkillStore(projectRoot = process.cwd(), create = true): SkillStore {
    const rootProject = requireProjectRoot(projectRoot);
    const root = resolve(rootProject, ".agentfs", "skills");
    if (!isContained(rootProject, root) || root === rootProject) throw new Error("Skill state path escapes the project.");
    const store = {
        project_root: rootProject,
        root,
        candidates: join(root, "candidates"),
        proposals: join(root, "proposals"),
        evaluations: join(root, "evaluations"),
        applications: join(root, "applications"),
        backups: join(root, "backups"),
        adapter_tmp: join(root, "adapter-tmp"),
    };
    if (create) {
        privateDirectory(resolve(rootProject, ".agentfs"));
        for (const path of Object.values(store).slice(1)) privateDirectory(path);
    }
    return store;
}

function artifactPath(directory: string, id: string): string {
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) throw new Error("Artifact ID is not canonical.");
    const path = resolve(directory, `${id}.json`);
    if (!isContained(directory, path) || path === directory) throw new Error("Artifact path is unsafe.");
    return path;
}

function atomicWrite(path: string, value: unknown): void {
    privateDirectory(dirname(path));
    const bytes = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(bytes, "utf8") > MAX_ARTIFACT_BYTES) throw new Error("Skill artifact exceeds the storage limit.");
    const temporary = join(dirname(path), `.tmp-${randomBytes(16).toString("hex")}`);
    const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
        writeFileSync(descriptor, bytes, "utf8");
    } finally {
        closeSync(descriptor);
    }
    hardenPrivatePath(temporary);
    renameSync(temporary, path);
    hardenPrivatePath(path);
}

function readJson(path: string): unknown {
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_ARTIFACT_BYTES || !privatePathIsSafe(path)) {
        throw new Error(`Unsafe skill artifact: ${path}`);
    }
    const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        return JSON.parse(readFileSync(descriptor, "utf8"));
    } finally {
        closeSync(descriptor);
    }
}

function listJson<T>(directory: string, parse: (value: unknown) => T): T[] {
    if (!existsSync(directory)) return [];
    const info = lstatSync(directory);
    if (info.isSymbolicLink() || !info.isDirectory() || !privatePathIsSafe(directory)) throw new Error("Unsafe skill artifact directory.");
    return [...new Set(readdirSync(directory))]
        .filter((name) => /^[a-z0-9][a-z0-9._-]{0,127}\.json$/.test(name))
        .sort()
        .map((name) => parse(readJson(join(directory, name))));
}

function candidateId(noteId: string): string {
    return `candidate-${sha256(`cairnkeep:skill:candidate:v1\0${noteId}`).slice(0, 24)}`;
}

export function harvestSkillCandidates(options: { projectRoot: string; minimumOccurrences?: number }): {
    schema_version: 1;
    candidates: SkillCandidate[];
    skipped: number;
} {
    const minimum = options.minimumOccurrences ?? 2;
    if (!Number.isSafeInteger(minimum) || minimum < 2 || minimum > 1024) {
        throw new Error("Minimum occurrences must be an integer from 2 through 1024.");
    }
    const store = getSkillStore(options.projectRoot);
    const layout = getNoteLayout(store.project_root);
    const addressed = listAddressedNotes({
        address_space: "project-notes",
        prefix: "hindsight/",
        projectRoot: store.project_root,
        node_types: ["hindsight"],
    });
    const candidates: SkillCandidate[] = [];
    let skipped = 0;
    for (const entry of addressed) {
        const note = noteNodeSchema.parse(JSON.parse(entry.value));
        if (!note.signature || !note.project_id) {
            skipped += 1;
            continue;
        }
        const failureSessions = new Set(note.occurrences.filter(({ outcome }) => outcome === "failure").map(({ session_id }) => session_id));
        const resolutionSessions = new Set(note.occurrences.filter(({ outcome }) => outcome === "resolution").map(({ session_id }) => session_id));
        if (failureSessions.size < minimum || resolutionSessions.size < 1) {
            skipped += 1;
            continue;
        }
        const selectedOccurrences: typeof note.occurrences = [];
        const occurrenceKeys = new Set<string>();
        const selectedFailureSessions = new Set<string>();
        const addOccurrence = (occurrence: typeof note.occurrences[number]): void => {
            const key = `${occurrence.session_digest}:${occurrence.sequence}:${occurrence.outcome}`;
            if (occurrenceKeys.has(key) || selectedOccurrences.length >= 64) return;
            occurrenceKeys.add(key);
            selectedOccurrences.push(occurrence);
        };
        const newestFirst = [...note.occurrences].reverse();
        const resolutionEvidence = newestFirst.find(({ outcome }) => outcome === "resolution");
        if (resolutionEvidence) addOccurrence(resolutionEvidence);
        for (const occurrence of newestFirst) {
            if (occurrence.outcome !== "failure" || selectedFailureSessions.has(occurrence.session_id)) continue;
            addOccurrence(occurrence);
            selectedFailureSessions.add(occurrence.session_id);
            if (selectedFailureSessions.size >= Math.min(minimum, 63)) break;
        }
        for (const occurrence of newestFirst) addOccurrence(occurrence);
        selectedOccurrences.sort((left, right) => left.ended_at.localeCompare(right.ended_at)
            || left.session_id.localeCompare(right.session_id)
            || left.sequence - right.sequence);
        const occurrences = selectedOccurrences.map(({ session_id, session_digest, ended_at, outcome, tool_name, evidence }) => ({
            session_id,
            session_digest,
            ended_at,
            outcome,
            ...(tool_name ? { tool_name } : {}),
            evidence,
        }));
        const sourceDigest = canonicalDigest({
            note_id: note.id,
            signature: note.signature,
            failure_count: failureSessions.size,
            resolution_count: resolutionSessions.size,
            occurrences,
            enrichment: note.enrichment ?? null,
        });
        const id = candidateId(note.id);
        let prior: SkillCandidate | null = null;
        const path = artifactPath(store.candidates, id);
        if (existsSync(path)) prior = skillCandidateSchema.parse(readJson(path));
        const now = new Date().toISOString();
        const unchangedApproved = prior?.source_digest === sourceDigest && prior.status === "approved";
        const candidate = skillCandidateSchema.parse({
            schema_version: SKILL_SCHEMA_VERSION,
            id,
            project_id: layout.project_id,
            status: unchangedApproved ? "approved" : "pending_review",
            note_id: note.id,
            source_digest: sourceDigest,
            title: note.title,
            description: note.description,
            failure_family: note.signature.family,
            failure_count: failureSessions.size,
            resolution_count: resolutionSessions.size,
            occurrences,
            lessons: note.enrichment?.lessons ?? [],
            caveats: note.enrichment?.caveats ?? [],
            created_at: prior?.created_at ?? now,
            reviewed_at: unchangedApproved ? prior?.reviewed_at ?? now : null,
        });
        atomicWrite(path, candidate);
        candidates.push(candidate);
    }
    return { schema_version: SKILL_SCHEMA_VERSION, candidates, skipped };
}

export function listSkillCandidates(projectRoot: string): SkillCandidate[] {
    const store = getSkillStore(projectRoot);
    return listJson(store.candidates, (value) => skillCandidateSchema.parse(value));
}

export function readSkillCandidate(projectRoot: string, id: string): SkillCandidate {
    return skillCandidateSchema.parse(readJson(artifactPath(getSkillStore(projectRoot).candidates, id)));
}

export function approveSkillCandidate(projectRoot: string, id: string): SkillCandidate {
    const store = getSkillStore(projectRoot);
    const candidate = readSkillCandidate(store.project_root, id);
    const approved = skillCandidateSchema.parse({ ...candidate, status: "approved", reviewed_at: new Date().toISOString() });
    atomicWrite(artifactPath(store.candidates, id), approved);
    return approved;
}

function assertSafeTarget(projectRoot: string, relativePath: string): { path: string; content: string; digest: string; mode: number } {
    const canonicalPath = skillRelativePathSchema.parse(relativePath);
    const root = requireProjectRoot(projectRoot);
    const target = resolve(root, canonicalPath);
    if (!isContained(root, target) || target === root) throw new Error("Skill target escapes the project.");
    let cursor = root;
    for (const segment of canonicalPath.split("/")) {
        cursor = join(cursor, segment);
        const info = lstatSync(cursor);
        if (info.isSymbolicLink()) throw new Error("Skill target crosses a symlink.");
    }
    const info = lstatSync(target);
    if (!info.isFile() || info.size > MAX_SKILL_BYTES) throw new Error("Skill target must be a regular file no larger than 256 KiB.");
    const content = readFileSync(target, "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_SKILL_BYTES) throw new Error("Skill target exceeds 256 KiB.");
    return { path: target, content, digest: sha256(content), mode: info.mode & 0o777 };
}

export function readSkillTarget(projectRoot: string, relativePath: string): {
    path: string;
    content: string;
    digest: string;
    mode: number;
} {
    return assertSafeTarget(projectRoot, relativePath);
}

function occurrenceCount(value: string, needle: string): number {
    if (!needle) return 0;
    let count = 0;
    let index = 0;
    while ((index = value.indexOf(needle, index)) >= 0) {
        count += 1;
        index += needle.length;
    }
    return count;
}

export function applySkillEdits(baseline: string, edits: SkillEdit[]): string {
    let value = baseline;
    for (const edit of edits) {
        if (edit.operation === "add") {
            if (value.includes(edit.content)) throw new Error("Skill edit would duplicate existing content.");
            if (edit.anchor === null) {
                value = `${value.replace(/\s*$/, "")}\n\n${edit.content.trim()}\n`;
                continue;
            }
            if (occurrenceCount(value, edit.anchor) !== 1) throw new Error("Skill edit anchor must match exactly once.");
            value = value.replace(edit.anchor, () => `${edit.anchor}\n${edit.content}`);
            continue;
        }
        if (edit.anchor === null || occurrenceCount(value, edit.anchor) !== 1) {
            throw new Error("Skill edit anchor must match exactly once.");
        }
        const replacement = edit.operation === "replace" ? edit.content : "";
        value = value.replace(edit.anchor, () => replacement);
    }
    if (Buffer.byteLength(value, "utf8") > MAX_SKILL_BYTES) throw new Error("Candidate skill exceeds 256 KiB.");
    if (value === baseline) throw new Error("Skill proposal does not change the target.");
    return value;
}

function loadAdapterConfig(path: string): { config: SkillAdapterConfig; digest: string; program_digest: string } {
    const absolute = resolve(path);
    const info = lstatSync(absolute);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 1024 * 1024) throw new Error("Adapter config must be a bounded regular file.");
    const config = skillAdapterConfigSchema.parse(readJsonUnrestricted(absolute));
    if (config.environment_allowlist.some((name) => PROTECTED_ADAPTER_ENVIRONMENT.has(name))) {
        throw new Error("Skill adapter environment allowlist contains an isolation-controlled variable.");
    }
    if (!isAbsolute(config.command.program)) throw new Error("Skill adapter program must be an absolute path.");
    const programInfo = lstatSync(config.command.program);
    const windowsRunnable = /\.(?:cjs|mjs|js|exe|com)$/i.test(config.command.program);
    if (!programInfo.isFile()
        || pathCrossesSymlink(config.command.program)
        || (process.platform === "win32" ? !windowsRunnable : (programInfo.mode & 0o111) === 0)) {
        throw new Error("Skill adapter program must be a real executable file.");
    }
    return { config, digest: canonicalDigest(config), program_digest: sha256File(config.command.program) };
}

function readJsonUnrestricted(path: string): unknown {
    const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        return JSON.parse(readFileSync(descriptor, "utf8"));
    } finally {
        closeSync(descriptor);
    }
}

function adapterEnvironment(config: SkillAdapterConfig, home: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        HOME: home,
        TMPDIR: home,
        TMP: home,
        TEMP: home,
        XDG_CACHE_HOME: join(home, ".cache"),
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_DATA_HOME: join(home, ".local", "share"),
        XDG_STATE_HOME: join(home, ".local", "state"),
        PATH: [...new Set([dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin"])].join(delimiter),
        LANG: process.env.LANG ?? "C",
        LC_ALL: process.env.LC_ALL ?? process.env.LANG ?? "C",
    };
    for (const name of config.environment_allowlist) {
        const value = process.env[name];
        if (value === undefined) throw new Error(`Allowlisted adapter environment variable is not set: ${name}`);
        env[name] = value;
    }
    return env;
}

export async function proposeSkill(options: {
    projectRoot: string;
    candidateId: string;
    targetPath: string;
    adapterPath: string;
    editBudget?: number;
    signal?: AbortSignal;
}): Promise<SkillProposal> {
    const store = getSkillStore(options.projectRoot);
    const candidate = readSkillCandidate(store.project_root, options.candidateId);
    if (candidate.status !== "approved" || !candidate.reviewed_at) throw new Error("Candidate evidence must be approved before proposal generation.");
    const target = assertSafeTarget(store.project_root, options.targetPath);
    const editBudget = options.editBudget ?? 4;
    if (!Number.isSafeInteger(editBudget) || editBudget < 1 || editBudget > 16) throw new Error("Edit budget must be from 1 through 16.");
    const adapter = loadAdapterConfig(options.adapterPath);
    const request = skillProposalRequestSchema.parse({
        schema_version: SKILL_SCHEMA_VERSION,
        operation: "propose",
        candidate,
        candidate_digest: canonicalDigest(candidate),
        target: { path: options.targetPath, baseline_digest: target.digest, content: target.content },
        edit_budget: editBudget,
    });
    const invocation = `adapter-${randomBytes(16).toString("hex")}`;
    const adapterHome = join(store.adapter_tmp, invocation);
    privateDirectory(adapterHome);
    try {
        const result = await runBoundedJsonProcess({
            command: adapter.config.command,
            request,
            request_schema: skillProposalRequestSchema,
            result_schema: skillProposalResponseSchema,
            cwd: store.root,
            env: adapterEnvironment(adapter.config, adapterHome),
            timeout_ms: adapter.config.limits.elapsed_ms,
            max_stdout_bytes: adapter.config.limits.stdout_bytes,
            signal: options.signal,
        });
        if (result.result.status !== "completed") throw new Error(`Skill adapter failed: ${result.result.error_code ?? "adapter_error"}`);
        if (sha256File(adapter.config.command.program) !== adapter.program_digest) {
            throw new Error("Skill adapter executable changed during proposal generation.");
        }
        if (result.result.edits.length > editBudget) throw new Error("Skill adapter exceeded the approved edit budget.");
        const candidateContent = applySkillEdits(target.content, result.result.edits);
        const identity = {
            candidate_id: candidate.id,
            candidate_digest: canonicalDigest(candidate),
            target_path: options.targetPath,
            baseline_digest: target.digest,
            candidate_content_digest: sha256(candidateContent),
            adapter_config_digest: adapter.digest,
            adapter_program_digest: adapter.program_digest,
            edits: result.result.edits,
        };
        const proposal = skillProposalSchema.parse({
            schema_version: SKILL_SCHEMA_VERSION,
            id: `proposal-${canonicalDigest(identity).slice(0, 24)}`,
            ...identity,
            candidate_content: candidateContent,
            target_mode: target.mode,
            adapter_id: adapter.config.id,
            created_at: new Date().toISOString(),
        });
        atomicWrite(artifactPath(store.proposals, proposal.id), proposal);
        return proposal;
    } catch (error) {
        if (error instanceof EvalProcessError) throw new Error(`Skill adapter execution failed: ${error.code}`);
        throw error;
    } finally {
        rmSync(adapterHome, { recursive: true, force: true });
    }
}

export function listSkillProposals(projectRoot: string): SkillProposal[] {
    const store = getSkillStore(projectRoot);
    return listJson(store.proposals, (value) => skillProposalSchema.parse(value));
}

export function readSkillProposal(projectRoot: string, id: string): SkillProposal {
    return skillProposalSchema.parse(readJson(artifactPath(getSkillStore(projectRoot).proposals, id)));
}

export function writeSkillEvaluation(projectRoot: string, evaluation: SkillEvaluation): void {
    atomicWrite(artifactPath(getSkillStore(projectRoot).evaluations, evaluation.id), skillEvaluationSchema.parse(evaluation));
}

export function readSkillEvaluation(projectRoot: string, id: string): SkillEvaluation {
    return skillEvaluationSchema.parse(readJson(artifactPath(getSkillStore(projectRoot).evaluations, id)));
}

export function listSkillEvaluations(projectRoot: string): SkillEvaluation[] {
    const store = getSkillStore(projectRoot);
    return listJson(store.evaluations, (value) => skillEvaluationSchema.parse(value));
}

function atomicWriteTarget(path: string, content: string, mode: number): void {
    const temporary = join(dirname(path), `.cairn-skill-${randomBytes(16).toString("hex")}`);
    const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
        writeFileSync(descriptor, content, "utf8");
    } finally {
        closeSync(descriptor);
    }
    chmodSync(temporary, mode);
    renameSync(temporary, path);
}

export function applySkillProposal(options: {
    projectRoot: string;
    proposalId: string;
    evaluationId: string;
    confirmDigest: string;
}): SkillApplication {
    const store = getSkillStore(options.projectRoot);
    const proposal = readSkillProposal(store.project_root, options.proposalId);
    const evaluation = readSkillEvaluation(store.project_root, options.evaluationId);
    const proposalDigest = canonicalDigest(proposal);
    if (options.confirmDigest !== proposalDigest) throw new Error("Confirmation digest does not match the proposal.");
    if (evaluation.proposal_id !== proposal.id || evaluation.proposal_digest !== proposalDigest || evaluation.status !== "eligible") {
        throw new Error("Proposal does not have an eligible matching evaluation.");
    }
    if (!evaluation.confirmation
        || evaluation.exploration.unknown > 0
        || evaluation.confirmation.unknown > 0
        || evaluation.exploration.regressions > 0
        || evaluation.confirmation.regressions > 0
        || evaluation.exploration.improvements < evaluation.minimum_improvement
        || evaluation.confirmation.improvements < evaluation.minimum_improvement) {
        throw new Error("Eligible evaluation evidence does not satisfy the application gate.");
    }
    const target = assertSafeTarget(store.project_root, proposal.target_path);
    if (target.digest !== proposal.baseline_digest) throw new Error("Skill target changed after proposal generation.");
    if (sha256(proposal.candidate_content) !== proposal.candidate_content_digest) {
        throw new Error("Skill proposal content does not match its recorded digest.");
    }
    const evaluationDigest = canonicalDigest(evaluation);
    const nonce = randomBytes(16).toString("hex");
    const applicationId = `application-${canonicalDigest({ proposal: proposalDigest, evaluation: evaluationDigest, nonce }).slice(0, 24)}`;
    const backupRelative = `.agentfs/skills/backups/${applicationId}.before`;
    const backupPath = resolve(store.project_root, backupRelative);
    if (!isContained(store.backups, backupPath)) throw new Error("Skill backup path is unsafe.");
    const application = skillApplicationSchema.parse({
        schema_version: SKILL_SCHEMA_VERSION,
        id: applicationId,
        proposal_id: proposal.id,
        proposal_digest: proposalDigest,
        evaluation_id: evaluation.id,
        evaluation_digest: evaluationDigest,
        target_path: proposal.target_path,
        before_digest: proposal.baseline_digest,
        applied_digest: proposal.candidate_content_digest,
        backup_path: backupRelative,
        target_mode: proposal.target_mode,
        state: "applied",
        applied_at: new Date().toISOString(),
        rolled_back_at: null,
    });
    writeFileSync(backupPath, target.content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    hardenPrivatePath(backupPath);
    try {
        atomicWriteTarget(target.path, proposal.candidate_content, proposal.target_mode);
        if (sha256(readFileSync(target.path)) !== proposal.candidate_content_digest) {
            throw new Error("Applied skill digest verification failed.");
        }
        atomicWrite(artifactPath(store.applications, application.id), application);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        let currentDigest: string | null = null;
        try {
            currentDigest = sha256(readFileSync(target.path));
        } catch {
            // The private backup remains available for manual recovery.
        }
        if (currentDigest === proposal.candidate_content_digest) {
            let restored = false;
            try {
                atomicWriteTarget(target.path, target.content, target.mode);
                if (sha256(readFileSync(target.path)) !== target.digest) throw new Error("restore_digest_mismatch");
                restored = true;
            } catch {
                // The private backup remains available for manual recovery.
            }
            if (!restored) throw new Error(`Skill application failed and automatic restore failed; backup retained at ${backupRelative}: ${reason}`);
            rmSync(backupPath, { force: true });
            throw new Error(`Skill application failed; the original was restored: ${reason}`);
        }
        if (currentDigest === target.digest) {
            rmSync(backupPath, { force: true });
            throw new Error(`Skill application failed; the original target is unchanged: ${reason}`);
        }
        throw new Error(`Skill application failed and the target changed concurrently; backup retained at ${backupRelative}: ${reason}`);
    }
    return application;
}

export function listSkillApplications(projectRoot: string): SkillApplication[] {
    const store = getSkillStore(projectRoot);
    return listJson(store.applications, (value) => skillApplicationSchema.parse(value));
}

export function readSkillApplication(projectRoot: string, id: string): SkillApplication {
    return skillApplicationSchema.parse(readJson(artifactPath(getSkillStore(projectRoot).applications, id)));
}

export function rollbackSkillApplication(options: { projectRoot: string; applicationId: string; confirm: boolean }): SkillApplication {
    if (!options.confirm) throw new Error("Rollback requires --confirm.");
    const store = getSkillStore(options.projectRoot);
    const application = readSkillApplication(store.project_root, options.applicationId);
    if (application.state !== "applied") throw new Error("Skill application is not in the applied state.");
    const target = assertSafeTarget(store.project_root, application.target_path);
    if (target.digest !== application.applied_digest) throw new Error("Skill target changed after application; rollback requires manual resolution.");
    const backup = resolve(store.project_root, application.backup_path);
    const backupInfo = lstatSync(backup);
    if (!isContained(store.backups, backup) || backupInfo.isSymbolicLink() || !backupInfo.isFile()
        || backupInfo.size > MAX_SKILL_BYTES || !privatePathIsSafe(backup)) {
        throw new Error("Skill backup is missing or unsafe.");
    }
    const original = readFileSync(backup, "utf8");
    if (sha256(original) !== application.before_digest) throw new Error("Skill backup digest does not match the application ledger.");
    atomicWriteTarget(target.path, original, application.target_mode);
    if (sha256(readFileSync(target.path)) !== application.before_digest) {
        throw new Error("Skill rollback digest verification failed; the application remains marked as applied.");
    }
    const rolledBack = skillApplicationSchema.parse({
        ...application,
        state: "rolled_back",
        rolled_back_at: new Date().toISOString(),
    });
    atomicWrite(artifactPath(store.applications, application.id), rolledBack);
    return rolledBack;
}
