import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { hardenPrivatePath, privatePathIsSafe } from './platform-security.js';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const roles = z.array(z.enum(['reader', 'contributor', 'reviewer', 'maintainer', 'auditor'])).max(5);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.iso.datetime();
const memoryKey = z.string().regex(/^(decisions|patterns|constraints|pitfalls|conventions|bugs)\/[a-z0-9][a-z0-9-]{0,95}$/);
const text = z.string().min(1).refine(value => Buffer.byteLength(value, 'utf8') <= 64 * 1024 && !value.includes('\0') && Buffer.from(value, 'utf8').toString('utf8') === value);
const proposalInput = z.object({ request_id: z.string().uuid(), key: memoryKey, value: text, source_scope: z.enum(['selected-local', 'selected-project']), source_digest: digest, base_revision: digest.nullable(), expires_at: date, confirm: digest }).strict();
const proposalSchema = z.object({ schema_version: z.literal(1), id: z.string().uuid(), organization: id, project: id, subject: id, policy_digest: digest, created_at: date, input: proposalInput, digest }).strict();
const revisionSchema = z.object({ schema_version: z.literal(1), organization: id, project: id, key: memoryKey, value: text, proposal_id: z.string().uuid(), proposal_digest: digest, reviewer: id, source_scope: z.enum(['selected-local', 'selected-project']), source_digest: digest, base_revision: digest.nullable(), created_at: date, revision_digest: digest }).strict();
const reviewSchema = z.object({ proposal_id: z.string().uuid(), proposal_digest: digest, reviewer: id, decision: z.enum(['approve', 'reject']), revision_digest: digest.nullable(), at: date }).strict();
const credentialSchema = z.object({ id: z.string().uuid(), subject: id, credential_class: z.enum(['human', 'workload']), expires_at: date, revoked: z.boolean(), audience: z.literal('cairnkeep-team-v1') }).strict();
const projectSchema = z.object({ id, policy_revision: z.number().int().nonnegative() }).strict();
const memberSchema = z.object({ subject: id, roles }).strict();
const adminSchema = z.discriminatedUnion('operation', [
    z.object({ operation: z.literal('project-create'), project: id }).strict(),
    z.object({ operation: z.literal('member-set'), project: id, subject: id, roles }).strict(),
    z.object({ operation: z.literal('credential-revoke'), credential: z.string().uuid() }).strict(),
    z.object({ operation: z.literal('memory-delete'), project: id, key: memoryKey, confirm: digest }).strict(),
]);
const auditEntrySchema = z.object({ schema_version: z.literal(1), sequence: z.number().int().positive(), organization: id, project: id.or(z.literal('')), subject: id, credential_class: z.enum(['human', 'workload', 'local-os']), operation: z.enum(['project-create', 'member-set', 'credential-revoke', 'credential-issue', 'memory-delete', 'list', 'audit', 'read', 'history', 'search', 'propose', 'proposals', 'proposal-show', 'review', 'snapshot', 'restore']), result: z.enum(['accepted', 'denied', 'conflict', 'invalid']), object_digest: digest.nullable(), previous_digest: digest.nullable(), request_id: z.string().uuid(), at: date }).strict();
const snapshotSchema = z.object({ schema_version: z.literal(1), organization: id, records: z.array(z.object({ organization: id, project: id.or(z.literal('')), kind: z.enum(['project', 'member', 'credential', 'proposal', 'review', 'revision', 'head']), id: z.string().min(1).max(128), value: z.unknown() }).strict()).max(32768), audit: z.array(z.object({ sequence: z.number().int().positive(), organization: id, project: id.or(z.literal('')), value: z.string().max(4096), digest }).strict()).max(100000), digest }).strict();
export type TeamSnapshot = z.infer<typeof snapshotSchema>;
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
const MAX_AUDIT_BYTES = 16 * 1024 * 1024;
export const TEAM_SNAPSHOT_MAX_BYTES = 64 * 1024 * 1024;
const requestBase = { organization: id, project: id };
const requestSchema = z.discriminatedUnion('operation', [
    z.object({ ...requestBase, operation: z.literal('list') }).strict(),
    z.object({ ...requestBase, operation: z.literal('audit') }).strict(),
    z.object({ ...requestBase, operation: z.literal('search'), query: z.string().min(1).max(256) }).strict(),
    z.object({ ...requestBase, operation: z.literal('read'), key: memoryKey, revision: digest.optional() }).strict(),
    z.object({ ...requestBase, operation: z.literal('history'), key: memoryKey }).strict(),
    z.object({ ...requestBase, operation: z.literal('propose'), ...proposalInput.shape }).strict(),
    z.object({ ...requestBase, operation: z.literal('proposals') }).strict(),
    z.object({ ...requestBase, operation: z.literal('proposal-show'), proposal_id: z.string().uuid() }).strict(),
    z.object({ ...requestBase, operation: z.literal('review'), proposal_id: z.string().uuid(), confirm: digest, decision: z.enum(['approve', 'reject']) }).strict(),
]);
type Credential = z.infer<typeof credentialSchema>;
type TeamDatabase = { getDatabase(): DatabaseSync; close(): Promise<void> };
// Every connection in this process shares a queue. Other processes synchronize
// with SQLite BEGIN IMMEDIATE, not a pathname lock or a read-then-write gap.
const queues = new Map<string, Promise<unknown>>();
async function immediate<T>(db: DatabaseSync, operation: () => Promise<T>): Promise<T> {
    db.exec('BEGIN IMMEDIATE');
    try { const result = await operation(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
}
export class TeamError extends Error {
    constructor(public readonly code: 'disabled' | 'invalid' | 'unauthorized' | 'denied' | 'conflict' | 'integrity') { super(`Team ${code}.`); }
}
export function teamDigest(text: string): string { return createHash('sha256').update(text).digest('hex'); }
function checkedProposal(input: unknown): z.infer<typeof proposalSchema> {
    const value = valid(proposalSchema, input); const { digest: stored, ...body } = value;
    if (teamDigest(JSON.stringify(body)) !== stored || value.id !== value.input.request_id || value.input.confirm !== teamDigest(value.input.value)) throw new TeamError('integrity');
    return value;
}
function checkedRevision(input: unknown): z.infer<typeof revisionSchema> {
    const value = valid(revisionSchema, input); const { revision_digest: stored, ...body } = value;
    if (teamDigest(JSON.stringify(body)) !== stored) throw new TeamError('integrity');
    return value;
}
export function verifyTeamSnapshot(input: unknown): TeamSnapshot {
    try {
        if (Buffer.byteLength(JSON.stringify(input)) > TEAM_SNAPSHOT_MAX_BYTES) throw new Error();
        const snapshot = valid(snapshotSchema, input); const { digest: stored, ...body } = snapshot;
        if (teamDigest(JSON.stringify(body)) !== stored) throw new Error();
        const records = new Map<string, unknown>();
        const recordKey = (project: string, kind: string, key: string) => JSON.stringify([project, kind, key]);
        let recordBytes = 0;
        for (const row of snapshot.records) {
            const key = recordKey(row.project, row.kind, row.id);
            if (row.organization !== snapshot.organization || records.has(key)) throw new Error();
            records.set(key, row.value); recordBytes += Buffer.byteLength(JSON.stringify(row.value));
            if (row.kind === 'credential') { valid(digest, row.id); valid(credentialSchema, row.value); if (row.project !== '') throw new Error(); }
            else {
                valid(id, row.project);
                if (row.kind === 'project') { const project = valid(projectSchema, row.value); if (project.id !== row.id || project.id !== row.project) throw new Error(); }
                else if (row.kind === 'member') { const member = valid(memberSchema, row.value); if (member.subject !== row.id) throw new Error(); }
                else if (row.kind === 'proposal') { const proposal = checkedProposal(row.value); if (proposal.organization !== row.organization || proposal.project !== row.project || proposal.id !== row.id) throw new Error(); }
                else if (row.kind === 'revision') { const revision = checkedRevision(row.value); if (revision.organization !== row.organization || revision.project !== row.project || revision.revision_digest !== row.id) throw new Error(); }
                else if (row.kind === 'review') { const review = valid(reviewSchema, row.value); if (review.proposal_id !== row.id) throw new Error(); }
                else { valid(memoryKey, row.id); valid(digest, row.value); }
            }
        }
        if (recordBytes > MAX_RECORD_BYTES) throw new Error();
        for (const row of snapshot.records.filter(row => row.kind !== 'credential')) {
            if (!records.has(recordKey(row.project, 'project', row.project))) throw new Error();
            if (row.kind === 'head') {
                const revision = checkedRevision(records.get(recordKey(row.project, 'revision', sqlText(row.value))));
                if (revision.key !== row.id) throw new Error();
            }
            if (row.kind === 'review') {
                const review = valid(reviewSchema, row.value);
                const proposal = checkedProposal(records.get(recordKey(row.project, 'proposal', row.id)));
                if (review.proposal_digest !== proposal.digest || review.reviewer === proposal.subject) throw new Error();
                if (review.decision === 'approve') {
                    const revision = checkedRevision(records.get(recordKey(row.project, 'revision', review.revision_digest ?? '')));
                    if (revision.proposal_id !== row.id || revision.reviewer !== review.reviewer) throw new Error();
                } else if (review.revision_digest !== null) throw new Error();
            }
            if (row.kind === 'revision') {
                const revision = checkedRevision(row.value);
                const proposal = checkedProposal(records.get(recordKey(row.project, 'proposal', revision.proposal_id)));
                const review = valid(reviewSchema, records.get(recordKey(row.project, 'review', revision.proposal_id)));
                if (revision.proposal_digest !== proposal.digest || revision.key !== proposal.input.key || revision.value !== proposal.input.value
                    || revision.source_scope !== proposal.input.source_scope || revision.source_digest !== proposal.input.source_digest
                    || revision.base_revision !== proposal.input.base_revision || review.decision !== 'approve'
                    || review.revision_digest !== revision.revision_digest || review.reviewer !== revision.reviewer || review.at !== revision.created_at) throw new Error();
                if (revision.base_revision !== null) {
                    const base = checkedRevision(records.get(recordKey(row.project, 'revision', revision.base_revision)));
                    if (base.key !== revision.key) throw new Error();
                }
            }
        }
        let previous: string | null = null; let sequence = 0; let auditBytes = 0;
        for (const row of snapshot.audit) {
            const entry = valid(auditEntrySchema, JSON.parse(row.value));
            auditBytes += Buffer.byteLength(row.value);
            if (row.organization !== snapshot.organization || row.sequence !== ++sequence || entry.sequence !== sequence || entry.previous_digest !== previous || entry.organization !== row.organization || entry.project !== row.project || row.digest !== teamDigest(row.value)) throw new Error();
            previous = row.digest;
        }
        if (auditBytes > MAX_AUDIT_BYTES + 256 * 1024) throw new Error();
        return snapshot;
    } catch { throw new TeamError('integrity'); }
}
function valid<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new TeamError('invalid');
    return result.data;
}
function sqlText(value: unknown): string {
    if (typeof value !== 'string') throw new TeamError('integrity');
    return value;
}
function privateDirectory(root: string, create: boolean): void {
    if (!isAbsolute(root) || root === parse(root).root) throw new TeamError('invalid');
    // Resolve nothing through links. Existing ancestors must not be writable by
    // other non-owner users; the storage directory itself must be private.
    let current = root;
    while (current !== dirname(current)) {
        if (existsSync(current)) {
            const info = lstatSync(current);
            if (!info.isDirectory() || info.isSymbolicLink()) throw new TeamError('integrity');
            if (process.platform !== 'win32' && (info.mode & 0o022) !== 0 && (info.mode & 0o1000) === 0) throw new TeamError('integrity');
        }
        current = dirname(current);
    }
    if (!existsSync(root)) {
        if (!create) throw new TeamError('invalid');
        mkdirSync(root, { recursive: true, mode: 0o700 });
        hardenPrivatePath(root);
    }
    if (!privatePathIsSafe(root)) throw new TeamError('integrity');
}

/** Separate single-organization storage. Local administration trusts the OS
 * owner, not a client-supplied actor label. All remote authority is credential
 * derived and checked inside the same transaction as state and audit writes. */
export class TeamStore {
    private constructor(private readonly agent: TeamDatabase, public readonly organization: string, private readonly root: string) {}
    static async open(root: string, options: { create?: boolean; organization?: string } = {}): Promise<TeamStore> {
        if (process.env.CAIRN_TEAM !== '1') throw new TeamError('disabled');
        if (options.organization !== undefined) valid(id, options.organization);
        const { DatabaseSync } = await import('node:sqlite');
        root = resolve(root);
        privateDirectory(root, !!options.create);
        const path = join(root, 'team.db');
        if (!existsSync(path)) {
            if (!options.create || !options.organization) throw new TeamError('invalid');
            const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
            closeSync(fd);
            hardenPrivatePath(path);
        }
        for (const file of [path, `${path}-wal`, `${path}-shm`]) {
            if (!existsSync(file)) continue;
            const info = lstatSync(file);
            if (!info.isFile() || info.isSymbolicLink() || !privatePathIsSafe(file)) throw new TeamError('integrity');
        }
        // Built-in SQLite is available without a flag from Node 22.13 onward.
        // Resolve it only after opt-in, so disabled mode performs no team reads.
        const connection = new DatabaseSync(path);
        const agent: TeamDatabase = { getDatabase: () => connection, close: async () => connection.close() };
        try {
            const initialized = (queues.get(root) ?? Promise.resolve()).then(async () => {
                const db = agent.getDatabase();
                db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
                await db.exec(`CREATE TABLE IF NOT EXISTS team_records (organization TEXT NOT NULL, project TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(organization, project, kind, id));
                    CREATE TABLE IF NOT EXISTS team_meta (id TEXT PRIMARY KEY, value TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS team_audit (sequence INTEGER PRIMARY KEY, organization TEXT NOT NULL, project TEXT NOT NULL, value TEXT NOT NULL, digest TEXT NOT NULL);`);
                const org = await immediate(db, async () => {
                    const row = await db.prepare('SELECT value FROM team_meta WHERE id = ?').get('organization');
                    if (row) {
                        const org = valid(id, row.value);
                        if (options.organization && org !== options.organization) throw new TeamError('denied');
                        return org;
                    }
                    if (!options.create || !options.organization) throw new TeamError('integrity');
                    await db.prepare('INSERT INTO team_meta(id,value) VALUES(?,?)').run('organization', options.organization);
                    await db.prepare('INSERT INTO team_meta(id,value) VALUES(?,?)').run('schema_version', '1');
                    return options.organization;
                });
                const version = await db.prepare('SELECT value FROM team_meta WHERE id = ?').get('schema_version');
                if (version?.value !== '1') throw new TeamError('integrity');
                const store = new TeamStore(agent, org, root);
                store.harden();
                return store;
            });
            queues.set(root, initialized.catch(() => undefined));
            return await initialized;
        } catch (error) { await agent.close(); throw error; }
    }
    private harden(): void {
        for (const suffix of ['', '-wal', '-shm']) {
            const file = join(this.root, `team.db${suffix}`);
            if (existsSync(file)) hardenPrivatePath(file);
        }
    }
    private async transaction<T>(operation: () => Promise<T>): Promise<T> {
        const result = (queues.get(this.root) ?? Promise.resolve()).then(async () => {
            privateDirectory(this.root, false);
            try { return await immediate(this.agent.getDatabase(), operation); }
            finally { this.harden(); }
        });
        queues.set(this.root, result.catch(() => undefined));
        return result;
    }
    private async rows(kind: string, project: string): Promise<Array<{ id: string; value: unknown }>> {
        const rows = await this.agent.getDatabase().prepare('SELECT id,value FROM team_records WHERE organization=? AND project=? AND kind=? ORDER BY id').all(this.organization, project, kind);
        return rows.map(row => {
            try { return { id: sqlText(row.id), value: JSON.parse(sqlText(row.value)) }; } catch { throw new TeamError('integrity'); }
        });
    }
    private async get(kind: string, project: string, recordId: string): Promise<unknown | undefined> {
        const row = await this.agent.getDatabase().prepare('SELECT value FROM team_records WHERE organization=? AND project=? AND kind=? AND id=?').get(this.organization, project, kind, recordId);
        if (!row) return undefined;
        try { return JSON.parse(sqlText(row.value)); } catch { throw new TeamError('integrity'); }
    }
    private async set(kind: string, project: string, recordId: string, value: unknown, immutable = false): Promise<void> {
        const sql = immutable ? 'INSERT INTO team_records(organization,project,kind,id,value) VALUES(?,?,?,?,?)'
            : 'INSERT INTO team_records(organization,project,kind,id,value) VALUES(?,?,?,?,?) ON CONFLICT(organization,project,kind,id) DO UPDATE SET value=excluded.value';
        await this.agent.getDatabase().prepare(sql).run(this.organization, project, kind, recordId, JSON.stringify(value));
        const size = this.agent.getDatabase().prepare('SELECT count(*) AS entries,coalesce(sum(length(CAST(value AS BLOB))),0) AS bytes FROM team_records').get();
        if (Number(size?.entries) > 32768 || Number(size?.bytes) > MAX_RECORD_BYTES) throw new TeamError('conflict');
    }
    private async appendAudit(project: string, subject: string, credentialClass: string, operation: string, result: string, objectDigest: string | null = null): Promise<void> {
        const db = this.agent.getDatabase();
        const last = await db.prepare('SELECT sequence,digest FROM team_audit ORDER BY sequence DESC LIMIT 1').get();
        const sequence = valid(z.number().int().nonnegative(), last?.sequence ?? 0) + 1;
        const entry = { schema_version: 1, sequence, organization: this.organization, project, subject, credential_class: credentialClass, operation, result, object_digest: objectDigest, previous_digest: last?.digest ?? null, request_id: randomUUID(), at: new Date().toISOString() };
        const value = JSON.stringify(entry);
        const size = db.prepare('SELECT count(*) AS entries,coalesce(sum(length(CAST(value AS BLOB))),0) AS bytes FROM team_audit').get();
        // Reserve bounded space for local revocation/recovery after a client's
        // audit allowance is exhausted. Full stores fail closed, never discard.
        const allowance = MAX_AUDIT_BYTES + (credentialClass === 'local-os' ? 256 * 1024 : 0);
        const entryAllowance = credentialClass === 'local-os' ? 100000 : 99000;
        if (Number(size?.entries) >= entryAllowance || Number(size?.bytes) + Buffer.byteLength(value) > allowance) throw new TeamError('conflict');
        await db.prepare('INSERT INTO team_audit(sequence,organization,project,value,digest) VALUES(?,?,?,?,?)').run(sequence, this.organization, project, value, teamDigest(value));
    }
    async admin(input: unknown): Promise<void> {
        const request = valid(adminSchema, input);
        await this.transaction(async () => {
            if (request.operation === 'project-create') {
                if (await this.get('project', request.project, request.project)) throw new TeamError('conflict');
                await this.set('project', request.project, request.project, { id: request.project, policy_revision: 0 }, true);
            } else if (request.operation === 'member-set') {
                const project = valid(projectSchema, await this.get('project', request.project, request.project));
                await this.set('member', request.project, request.subject, { subject: request.subject, roles: [...new Set(request.roles)].sort() });
                await this.set('project', request.project, request.project, { ...project, policy_revision: project.policy_revision + 1 });
            } else if (request.operation === 'memory-delete') {
                if (await this.get('head', request.project, request.key) !== request.confirm) throw new TeamError('conflict');
                const db = this.agent.getDatabase();
                for (const row of await this.rows('proposal', request.project)) {
                    if (checkedProposal(row.value).input.key !== request.key) continue;
                    db.prepare('DELETE FROM team_records WHERE organization=? AND project=? AND kind IN (?,?) AND id=?').run(this.organization, request.project, 'proposal', 'review', row.id);
                }
                for (const row of await this.rows('revision', request.project)) {
                    if (checkedRevision(row.value).key === request.key) db.prepare('DELETE FROM team_records WHERE organization=? AND project=? AND kind=? AND id=?').run(this.organization, request.project, 'revision', row.id);
                }
                db.prepare('DELETE FROM team_records WHERE organization=? AND project=? AND kind=? AND id=?').run(this.organization, request.project, 'head', request.key);
            } else {
                const rows = await this.agent.getDatabase().prepare('SELECT id,value FROM team_records WHERE organization=? AND project=? AND kind=?').all(this.organization, '', 'credential');
                const found = rows.find(row => valid(credentialSchema, JSON.parse(String(row.value))).id === request.credential);
                if (!found) throw new TeamError('invalid');
                const credential = valid(credentialSchema, JSON.parse(String(found.value)));
                await this.set('credential', '', sqlText(found.id), { ...credential, revoked: true });
            }
            await this.appendAudit('project' in request ? request.project : '', 'local-operator', 'local-os', request.operation, 'accepted', request.operation === 'memory-delete' ? request.confirm : null);
        });
    }
    async issue(input: unknown): Promise<{ id: string; token: string }> {
        const request = valid(credentialSchema.omit({ id: true, revoked: true, audience: true }), input);
        if (Date.parse(request.expires_at) <= Date.now() || Date.parse(request.expires_at) > Date.now() + 366 * 86400000) throw new TeamError('invalid');
        const token = randomBytes(32).toString('base64url');
        const credential: Credential = { ...request, id: randomUUID(), revoked: false, audience: 'cairnkeep-team-v1' };
        await this.transaction(async () => {
            await this.set('credential', '', teamDigest(token), credential, true);
            await this.appendAudit('', request.subject, 'local-os', 'credential-issue', 'accepted');
        });
        return { id: credential.id, token };
    }
    private async authenticate(token: string): Promise<Credential> {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new TeamError('unauthorized');
        const raw = await this.get('credential', '', teamDigest(token));
        if (!raw) throw new TeamError('unauthorized');
        const credential = valid(credentialSchema, raw);
        if (credential.revoked || Date.parse(credential.expires_at) <= Date.now()) throw new TeamError('unauthorized');
        return credential;
    }
    async checkCredential(token: string): Promise<{ subject: string }> {
        return this.transaction(async () => ({ subject: (await this.authenticate(token)).subject }));
    }
    async execute(token: string, input: unknown): Promise<unknown> {
        const request = valid(requestSchema, input);
        try { return await this.transaction(async () => {
            const credential = await this.authenticate(token);
            const member = valid(memberSchema, await this.get('member', request.project, credential.subject) ?? { subject: credential.subject, roles: [] });
            const required = request.operation === 'audit' ? 'auditor' : ['propose', 'proposals', 'proposal-show'].includes(request.operation) ? 'contributor' : request.operation === 'review' ? 'reviewer' : 'reader';
            const proposalAccess = ['proposals', 'proposal-show'].includes(request.operation) && (member.roles.includes('contributor') || member.roles.includes('reviewer'));
            if (request.organization !== this.organization || (!proposalAccess && !member.roles.includes(required))) throw new TeamError('denied');
            if (request.operation === 'review' && credential.credential_class !== 'human') throw new TeamError('denied');
            const project = valid(projectSchema, await this.get('project', request.project, request.project));
            let result: unknown;
            let objectDigest: string | null = null;
            if (request.operation === 'audit') {
                const rows = await this.agent.getDatabase().prepare('SELECT value,digest FROM team_audit WHERE organization=? AND project=? ORDER BY sequence DESC LIMIT 100').all(this.organization, request.project);
                result = rows.map(row => ({ ...JSON.parse(sqlText(row.value)), digest: row.digest }));
            } else if (request.operation === 'propose') {
                const { organization: _org, project: _project, operation: _op, ...rawInput } = request;
                const selected = valid(proposalInput, rawInput);
                if (selected.confirm !== teamDigest(selected.value) || Date.parse(selected.expires_at) <= Date.now() || Date.parse(selected.expires_at) > Date.now() + 30 * 86400000) throw new TeamError('invalid');
                const prior = await this.get('proposal', request.project, selected.request_id);
                if (prior) {
                    const proposal = checkedProposal(prior);
                    if (proposal.subject !== credential.subject || JSON.stringify(proposal.input) !== JSON.stringify(selected)) throw new TeamError('conflict');
                    result = { id: proposal.id, digest: proposal.digest };
                } else {
                    const body = { schema_version: 1 as const, id: selected.request_id, organization: this.organization, project: request.project, subject: credential.subject, policy_digest: teamDigest(JSON.stringify(project)), created_at: new Date().toISOString(), input: selected };
                    const proposal = { ...body, digest: teamDigest(JSON.stringify(body)) };
                    await this.set('proposal', request.project, proposal.id, proposal, true);
                    objectDigest = proposal.digest;
                    result = { id: proposal.id, digest: proposal.digest };
                }
            } else if (request.operation === 'review') {
                const proposal = checkedProposal(await this.get('proposal', request.project, request.proposal_id));
                if (proposal.subject === credential.subject) throw new TeamError('denied');
                if (proposal.digest !== request.confirm) throw new TeamError('conflict');
                const prior = await this.get('review', request.project, request.proposal_id);
                if (prior) {
                    const review = valid(reviewSchema, prior);
                    if (review.reviewer !== credential.subject || review.decision !== request.decision) throw new TeamError('conflict');
                    result = review;
                } else {
                    if (Date.parse(proposal.input.expires_at) <= Date.now() || proposal.policy_digest !== teamDigest(JSON.stringify(project))) throw new TeamError('conflict');
                    const head = await this.get('head', request.project, proposal.input.key);
                    if (request.decision === 'approve' && (head ?? null) !== proposal.input.base_revision) throw new TeamError('conflict');
                    const at = new Date().toISOString();
                    let revisionDigest: string | null = null;
                    if (request.decision === 'approve') {
                        const body = { schema_version: 1 as const, organization: this.organization, project: request.project, key: proposal.input.key, value: proposal.input.value, proposal_id: proposal.id, proposal_digest: proposal.digest, reviewer: credential.subject, source_scope: proposal.input.source_scope, source_digest: proposal.input.source_digest, base_revision: proposal.input.base_revision, created_at: at };
                        revisionDigest = teamDigest(JSON.stringify(body));
                        await this.set('revision', request.project, revisionDigest, { ...body, revision_digest: revisionDigest }, true);
                        await this.set('head', request.project, proposal.input.key, revisionDigest);
                    }
                    const review = { proposal_id: proposal.id, proposal_digest: proposal.digest, reviewer: credential.subject, decision: request.decision, revision_digest: revisionDigest, at };
                    await this.set('review', request.project, proposal.id, review, true);
                    objectDigest = revisionDigest ?? proposal.digest;
                    result = review;
                }
            } else if (request.operation === 'proposal-show' || request.operation === 'proposals') {
                const visible = (await this.rows('proposal', request.project)).map(row => checkedProposal(row.value)).filter(proposal => member.roles.includes('reviewer') || proposal.subject === credential.subject);
                if (request.operation === 'proposal-show') {
                    const proposal = visible.find(proposal => proposal.id === request.proposal_id);
                    if (!proposal) throw new TeamError('denied');
                    result = proposal;
                } else {
                    result = await Promise.all(visible.slice(0, 100).map(async proposal => ({ id: proposal.id, digest: proposal.digest, key: proposal.input.key, subject: proposal.subject, expires_at: proposal.input.expires_at, status: (await this.get('review', request.project, proposal.id)) ? 'reviewed' : 'pending' })));
                }
            } else if (request.operation === 'read') {
                const revisionDigest = request.revision ?? await this.get('head', request.project, request.key);
                if (!revisionDigest) result = null;
                else {
                    const revision = checkedRevision(await this.get('revision', request.project, valid(digest, revisionDigest)));
                    if (revision.key !== request.key) throw new TeamError('denied');
                    result = this.presentRevision(revision);
                    objectDigest = revision.revision_digest;
                }
            } else if (request.operation === 'history') {
                result = (await this.rows('revision', request.project)).map(row => checkedRevision(row.value)).filter(revision => revision.key === request.key).sort((a, b) => b.created_at.localeCompare(a.created_at) || a.revision_digest.localeCompare(b.revision_digest)).slice(0, 100).map(({ value: _value, ...metadata }) => metadata);
            } else {
                const heads = await this.rows('head', request.project);
                const revisions = await Promise.all(heads.map(async head => checkedRevision(await this.get('revision', request.project, valid(digest, head.value)))));
                if (request.operation === 'search') {
                    const needle = request.query.toLowerCase();
                    result = revisions.filter(revision => `${revision.key}\n${revision.value}`.toLowerCase().includes(needle)).slice(0, 10).map(revision => this.presentRevision(revision));
                } else result = revisions.slice(0, 100).map(({ value: _value, ...metadata }) => metadata);
            }
            await this.appendAudit(request.project, credential.subject, credential.credential_class, request.operation, 'accepted', objectDigest);
            return result;
        }); } catch (error) {
            // A failed transaction rolls back ALL publication writes. Record only
            // bounded metadata afterward, never input text or bearer credentials.
            if (error instanceof TeamError && ['denied', 'conflict', 'invalid'].includes(error.code)) {
                await this.transaction(async () => {
                    const credential = await this.authenticate(token);
                    await this.appendAudit(request.organization === this.organization ? request.project : '', credential.subject, credential.credential_class, request.operation, error.code === 'denied' ? 'denied' : error.code);
                }).catch(() => undefined);
            }
            throw error;
        }
    }
    private presentRevision(revision: z.infer<typeof revisionSchema>): unknown {
        const { value, ...provenance } = revision;
        return { key: revision.key, value, provenance };
    }
    private collectSnapshot(): TeamSnapshot {
        const db = this.agent.getDatabase();
        const records = db.prepare('SELECT organization,project,kind,id,value FROM team_records ORDER BY organization,project,kind,id').all().map(row => ({ organization: sqlText(row.organization), project: sqlText(row.project), kind: sqlText(row.kind), id: sqlText(row.id), value: JSON.parse(sqlText(row.value)) }));
        const audit = db.prepare('SELECT sequence,organization,project,value,digest FROM team_audit ORDER BY sequence').all();
        const body = { schema_version: 1, organization: this.organization, records, audit };
        return verifyTeamSnapshot({ ...body, digest: teamDigest(JSON.stringify(body)) });
    }
    async snapshot(): Promise<TeamSnapshot> {
        return this.transaction(async () => {
            await this.appendAudit('', 'local-operator', 'local-os', 'snapshot', 'accepted');
            return this.collectSnapshot();
        });
    }
    async doctor(): Promise<{ ok: true; records: number; audit_events: number; digest: string; temporary_remnants: number }> {
        return this.transaction(async () => {
            if (this.agent.getDatabase().prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new TeamError('integrity');
            const snapshot = this.collectSnapshot();
            // Report only a count. Never select a restore, expose paths or delete remnants.
            const remnants = readdirSync(dirname(this.root)).filter(name => name.startsWith('.team-restore-') || name === `.${basename(this.root)}.restore.lock`).length;
            return { ok: true, records: snapshot.records.length, audit_events: snapshot.audit.length, digest: snapshot.digest, temporary_remnants: remnants };
        });
    }
    static async restore(root: string, input: unknown, confirm: string): Promise<TeamStore> {
        if (process.env.CAIRN_TEAM !== '1') throw new TeamError('disabled');
        const snapshot = verifyTeamSnapshot(input);
        if (snapshot.digest !== confirm) throw new TeamError('conflict');
        root = resolve(root); privateDirectory(dirname(root), false);
        const absent = () => { try { lstatSync(root); throw new TeamError('conflict'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } };
        absent();
        const lock = join(dirname(root), `.${basename(root)}.restore.lock`);
        const lockFd = openSync(lock, 'wx', 0o600);
        let temporary: string | undefined;
        let store: TeamStore | undefined;
        try {
            hardenPrivatePath(lock);
            temporary = mkdtempSync(join(dirname(root), '.team-restore-'));
            hardenPrivatePath(temporary);
            absent();
            store = await TeamStore.open(temporary, { create: true, organization: snapshot.organization });
            await store.transaction(async () => {
                const db = store!.agent.getDatabase();
                for (const row of snapshot.records) {
                    const value = row.kind === 'credential' ? { ...valid(credentialSchema, row.value), revoked: true } : row.value;
                    db.prepare('INSERT INTO team_records(organization,project,kind,id,value) VALUES(?,?,?,?,?)').run(row.organization, row.project, row.kind, row.id, JSON.stringify(value));
                }
                for (const row of snapshot.audit) db.prepare('INSERT INTO team_audit(sequence,organization,project,value,digest) VALUES(?,?,?,?,?)').run(row.sequence, row.organization, row.project, row.value, row.digest);
                await store!.appendAudit('', 'local-operator', 'local-os', 'restore', 'accepted', snapshot.digest);
            });
            await store.doctor(); await store.close(); store = undefined;
            absent(); renameSync(temporary, root);
            return await TeamStore.open(root);
        } finally {
            try { await store?.close(); }
            finally {
                try { if (temporary && existsSync(temporary)) rmSync(temporary, { recursive: true, force: true }); }
                finally { closeSync(lockFd); unlinkSync(lock); }
            }
        }
    }
    async close(): Promise<void> { await queues.get(this.root); await this.agent.close(); }
}
export const openTeamStore = TeamStore.open;
export const restoreTeamSnapshot = TeamStore.restore;
export const prepareTeamPrivateDirectory = privateDirectory;
