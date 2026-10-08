import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { AgentFS } from 'agentfs-sdk';
import { z } from 'zod';
import { hardenPrivatePath, privatePathIsSafe } from './platform-security.js';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const roles = z.array(z.enum(['reader', 'contributor', 'reviewer', 'maintainer', 'auditor'])).max(5);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.iso.datetime();
const credentialSchema = z.object({ id: z.string().uuid(), subject: id, credential_class: z.enum(['human', 'workload']), expires_at: date, revoked: z.boolean(), audience: z.literal('cairnkeep-team-v1') }).strict();
const projectSchema = z.object({ id, policy_revision: z.number().int().nonnegative() }).strict();
const memberSchema = z.object({ subject: id, roles }).strict();
const adminSchema = z.discriminatedUnion('operation', [
    z.object({ operation: z.literal('project-create'), project: id }).strict(),
    z.object({ operation: z.literal('member-set'), project: id, subject: id, roles }).strict(),
    z.object({ operation: z.literal('credential-revoke'), credential: z.string().uuid() }).strict(),
]);
const requestBase = { organization: id, project: id };
const requestSchema = z.discriminatedUnion('operation', [
    z.object({ ...requestBase, operation: z.literal('list') }).strict(),
    z.object({ ...requestBase, operation: z.literal('audit') }).strict(),
]);
type Credential = z.infer<typeof credentialSchema>;
export class TeamError extends Error {
    constructor(public readonly code: 'disabled' | 'invalid' | 'unauthorized' | 'denied' | 'conflict' | 'integrity') { super(`Team ${code}.`); }
}
export function teamDigest(text: string): string { return createHash('sha256').update(text).digest('hex'); }
function valid<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new TeamError('invalid');
    return result.data;
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
    private queue: Promise<unknown> = Promise.resolve();
    private constructor(private readonly agent: AgentFS, public readonly organization: string, private readonly root: string) {}
    static async open(root: string, options: { create?: boolean; organization?: string } = {}): Promise<TeamStore> {
        if (process.env.CAIRN_TEAM !== '1') throw new TeamError('disabled');
        if (options.organization !== undefined) valid(id, options.organization);
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
        const agent = await AgentFS.open({ path });
        try {
            const db = agent.getDatabase();
            await db.exec(`CREATE TABLE IF NOT EXISTS team_records (organization TEXT NOT NULL, project TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(organization, project, kind, id));
                CREATE TABLE IF NOT EXISTS team_meta (id TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS team_audit (sequence INTEGER PRIMARY KEY, organization TEXT NOT NULL, project TEXT NOT NULL, value TEXT NOT NULL, digest TEXT NOT NULL);`);
            const tx = db.transaction(async () => {
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
            const org = await (tx as typeof tx & { immediate: typeof tx }).immediate();
            const version = await db.prepare('SELECT value FROM team_meta WHERE id = ?').get('schema_version');
            if (version?.value !== '1') throw new TeamError('integrity');
            const store = new TeamStore(agent, org, root);
            store.harden();
            return store;
        } catch (error) { await agent.close(); throw error; }
    }
    private harden(): void {
        for (const suffix of ['', '-wal', '-shm']) {
            const file = join(this.root, `team.db${suffix}`);
            if (existsSync(file)) hardenPrivatePath(file);
        }
    }
    private async transaction<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.queue.then(async () => {
            privateDirectory(this.root, false);
            const tx = this.agent.getDatabase().transaction(operation);
            try { return await (tx as typeof tx & { immediate: typeof tx }).immediate(); }
            finally { this.harden(); }
        });
        this.queue = result.catch(() => undefined);
        return result;
    }
    private async get(kind: string, project: string, recordId: string): Promise<unknown | undefined> {
        const row = await this.agent.getDatabase().prepare('SELECT value FROM team_records WHERE organization=? AND project=? AND kind=? AND id=?').get(this.organization, project, kind, recordId);
        if (!row) return undefined;
        try { return JSON.parse(row.value); } catch { throw new TeamError('integrity'); }
    }
    private async set(kind: string, project: string, recordId: string, value: unknown, immutable = false): Promise<void> {
        const sql = immutable ? 'INSERT INTO team_records(organization,project,kind,id,value) VALUES(?,?,?,?,?)'
            : 'INSERT INTO team_records(organization,project,kind,id,value) VALUES(?,?,?,?,?) ON CONFLICT(organization,project,kind,id) DO UPDATE SET value=excluded.value';
        await this.agent.getDatabase().prepare(sql).run(this.organization, project, kind, recordId, JSON.stringify(value));
    }
    private async appendAudit(project: string, subject: string, credentialClass: string, operation: string, result: string, objectDigest: string | null = null): Promise<void> {
        const db = this.agent.getDatabase();
        const last = await db.prepare('SELECT sequence,digest FROM team_audit ORDER BY sequence DESC LIMIT 1').get();
        const sequence = (last?.sequence ?? 0) + 1;
        const entry = { schema_version: 1, sequence, organization: this.organization, project, subject, credential_class: credentialClass, operation, result, object_digest: objectDigest, previous_digest: last?.digest ?? null, request_id: randomUUID(), at: new Date().toISOString() };
        const value = JSON.stringify(entry);
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
            } else {
                const rows = await this.agent.getDatabase().prepare('SELECT id,value FROM team_records WHERE organization=? AND project=? AND kind=?').all(this.organization, '', 'credential');
                const found = rows.find(row => valid(credentialSchema, JSON.parse(row.value)).id === request.credential);
                if (!found) throw new TeamError('invalid');
                const credential = valid(credentialSchema, JSON.parse(found.value));
                await this.set('credential', '', found.id, { ...credential, revoked: true });
            }
            await this.appendAudit('project' in request ? request.project : '', 'local-operator', 'local-os', request.operation, 'accepted');
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
    async execute(token: string, input: unknown): Promise<unknown> {
        const request = valid(requestSchema, input);
        return this.transaction(async () => {
            const credential = await this.authenticate(token);
            const member = valid(memberSchema, await this.get('member', request.project, credential.subject) ?? { subject: credential.subject, roles: [] });
            const permitted = request.organization === this.organization && member.roles.includes(request.operation === 'audit' ? 'auditor' : 'reader');
            if (!permitted) {
                // Commit denial evidence without committing any application writes.
                await this.appendAudit(request.organization === this.organization ? request.project : '', credential.subject, credential.credential_class, request.operation, 'denied');
                return { denied: true };
            }
            if (request.operation === 'audit') {
                const rows = await this.agent.getDatabase().prepare('SELECT value,digest FROM team_audit WHERE organization=? AND project=? ORDER BY sequence DESC LIMIT 100').all(this.organization, request.project);
                return rows.map(row => ({ ...JSON.parse(row.value), digest: row.digest }));
            }
            return [];
        }).then(result => {
            if (result && typeof result === 'object' && 'denied' in result) throw new TeamError('denied');
            return result;
        });
    }
    async close(): Promise<void> { await this.queue; await this.agent.close(); }
}
export const openTeamStore = TeamStore.open;
