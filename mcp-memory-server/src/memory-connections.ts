import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
    CONTEXT_ENTITY_TABLE, CONTEXT_LINK_TABLE, CONTEXT_CONNECTION_SQL, CONTEXT_STORE_TABLE,
    memoryEntityInputSchema, memoryLinkInputSchema, memoryConnectionRemoveSchema,
    memoryEntitySchema, memoryLinkSchema, type MemoryEntity, type MemoryLink, type MemorySourceRef,
} from './memory-context-schema.js';
import { MemoryDatabase } from './memory-database.js';
import { memoryError } from './memory-database-protocol.js';
import { probeOrdinaryMemoryFormat, readMemorySourceRef, validateMemoryContextFormat } from './memory-store-format.js';
import { canonicalMemoryPath, memoryStoreIdentity, openOrdinaryMemoryStore, openOrdinaryMemoryView } from './ordinary-memory-store.js';

type Target = { path: string; scope: string };
type Mutation = Target & { input: unknown; operation?: 'set' | 'remove' };
type Kind = 'entity' | 'link';
type Row<T> = { id: string; revision: number; present: number; assertion: T | null };
type State = { initialized: boolean; entities: Map<string, Row<MemoryEntity>>; links: Map<string, Row<MemoryLink>> };
const MAX_ROWS = 5000, MAX_SCAN_BYTES = 8 * 1024 * 1024;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code = 'MEMORY_CONNECTION_INVALID'): never => { throw memoryError(code); };
const table = (kind: Kind) => kind === 'entity' ? CONTEXT_ENTITY_TABLE : CONTEXT_LINK_TABLE;
const sourceKeys = (entity: MemoryEntity) => [entity.anchor.key, ...entity.claims.map(claim => claim.source.key)];
const querySchema = z.object({ entity: z.string().min(1).max(512).refine(value => Buffer.byteLength(value) <= 512),
    direction: z.enum(['outbound', 'inbound', 'both']).default('outbound'),
    depth: z.number().int().min(1).max(2).default(1), limit: z.number().int().min(1).max(50).default(50) }).strict();
type Query = z.infer<typeof querySchema>;
type Node = MemoryEntity & { assertion_digest: string };
type Edge = MemoryLink & { assertion_digest: string };
type Conflict = { entity_id: string; attribute: string; claims: MemoryEntity['claims'] };
type Result = { schema_version: 1; tracked: boolean; scope: string; entity: string; direction: Query['direction']; depth: number;
    ambiguous: boolean; matches: Array<{ id: string; title: string; anchor: MemorySourceRef; assertion_digest: string }>;
    nodes: Node[]; edges: Edge[]; conflicts: Conflict[]; possible_conflicts: boolean; truncated: boolean };

export const memoryConnectionsResponse = <T>(payload: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload });
const fits = (payload: Result) => Buffer.byteLength(JSON.stringify(memoryConnectionsResponse({ ...payload,
    ambiguous: false, possible_conflicts: false, truncated: false }))) <= 32768;
const empty = (target: Target, query: Query, tracked: boolean): Result => ({ schema_version: 1, tracked, scope: target.scope,
    entity: query.entity, direction: query.direction, depth: query.depth, ambiguous: false, matches: [], nodes: [], edges: [],
    conflicts: [], possible_conflicts: false, truncated: false });

async function withStore<T>(target: Target, write: boolean, action: (db: MemoryDatabase) => Promise<T>): Promise<T> {
    if (probeOrdinaryMemoryFormat(target.path).kind !== 'context-v1') return fail('MEMORY_FRESH_STORE_REQUIRED');
    const view = await (write ? openOrdinaryMemoryStore(target.path, target.scope) : openOrdinaryMemoryView(target.path, target.scope));
    if (!view) return fail('MEMORY_SOURCE_MISSING');
    try {
        const db = view.getDatabase();
        if (!(db instanceof MemoryDatabase)) return fail('MEMORY_FRESH_STORE_REQUIRED');
        const run = db.transaction(() => action(db));
        return await (write ? run.immediate() : run());
    } finally { await view.close(); }
}

async function loadState(db: MemoryDatabase, target: Target): Promise<State> {
    const owner = memoryStoreIdentity(target.path, target.scope);
    const marker = await validateMemoryContextFormat(db, owner);
    const objects = await db.prepare('SELECT name,type,sql FROM sqlite_master WHERE name IN (?,?) ORDER BY name')
        .all(CONTEXT_ENTITY_TABLE, CONTEXT_LINK_TABLE);
    const state: State = { initialized: objects.length > 0, entities: new Map(), links: new Map() };
    if (!objects.length) return state;
    if (objects.length !== 2 || objects.some(row => row.type !== 'table'
        || row.sql !== CONTEXT_CONNECTION_SQL[[CONTEXT_ENTITY_TABLE, CONTEXT_LINK_TABLE].indexOf(String(row.name))])) return fail('MEMORY_CONTEXT_DAMAGED');
    const budget = await db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(assertion_json AS BLOB))),0) AS bytes FROM
        (SELECT assertion_json FROM ${CONTEXT_ENTITY_TABLE} UNION ALL SELECT assertion_json FROM ${CONTEXT_LINK_TABLE} LIMIT 5001)`).get();
    if (!budget || Number(budget.count) > MAX_ROWS || Number(budget.bytes) > MAX_SCAN_BYTES) return fail('MEMORY_CONNECTION_LIMIT');
    const validateSource = (source: MemorySourceRef) => {
        if (source.owner_domain !== marker.owner_domain || source.scope !== marker.scope || source.store_uuid !== marker.store_uuid) return fail('MEMORY_CONTEXT_DAMAGED');
        // Prior restore epochs remain recorded evidence, but can never become active.
        if (Buffer.byteLength(source.key) > 4096 || source.key === '__history__' || source.key.startsWith('__history__/')
            || source.key === '__reviewed__' || source.key.startsWith('__reviewed__/')) return fail('MEMORY_CONTEXT_DAMAGED');
    };
    for (const kind of ['entity', 'link'] as const) {
        const rows = await db.prepare(`SELECT id,revision,present,CASE WHEN length(CAST(assertion_json AS BLOB))<=65536 THEN assertion_json END AS assertion_json FROM ${table(kind)} ORDER BY id LIMIT 5001`).all();
        for (const row of rows) {
            if (!z.uuid().safeParse(row.id).success || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1
                || (row.present !== 0 && row.present !== 1) || (row.present === 0 && row.assertion_json !== null)) return fail('MEMORY_CONTEXT_DAMAGED');
            let assertion: MemoryEntity | MemoryLink | null = null;
            if (row.present === 1) {
                try {
                    if (typeof row.assertion_json !== 'string') return fail('MEMORY_CONTEXT_DAMAGED');
                    assertion = (kind === 'entity' ? memoryEntitySchema : memoryLinkSchema).parse(JSON.parse(row.assertion_json));
                    if (assertion.id !== row.id || assertion.revision !== row.revision) return fail('MEMORY_CONTEXT_DAMAGED');
                    for (const source of 'anchor' in assertion ? [assertion.anchor, ...assertion.claims.map(claim => claim.source)] : assertion.evidence) validateSource(source);
                } catch { return fail('MEMORY_CONTEXT_DAMAGED'); }
            }
            const record = { id: String(row.id), revision: Number(row.revision), present: Number(row.present), assertion };
            if (kind === 'entity') state.entities.set(record.id, record as Row<MemoryEntity>);
            else state.links.set(record.id, record as Row<MemoryLink>);
        }
    }
    return state;
}

function sourceReader(db: MemoryDatabase, target: Target) {
    const seen = new Map<string, MemorySourceRef | null>();
    return async (key: string) => {
        if (seen.has(key)) return seen.get(key)!;
        if (seen.size === MAX_ROWS) return fail('MEMORY_CONNECTION_LIMIT');
        const size = await db.prepare('SELECT length(CAST(value AS BLOB)) AS bytes FROM kv_store WHERE key=?').get(key);
        if (size && Number(size.bytes) > 32768) return fail('MEMORY_CONNECTION_LIMIT');
        const source = await readMemorySourceRef(db, memoryStoreIdentity(target.path, target.scope), key);
        seen.set(key, source); return source;
    };
}
async function liveGraph(db: MemoryDatabase, target: Target, state: State) {
    const read = sourceReader(db, target);
    const current = async (source: MemorySourceRef) => digest(await read(source.key)) === digest(source);
    const entities = new Map<string, Node>(), links = new Map<string, Edge>();
    for (const row of state.entities.values()) {
        const entity = row.assertion;
        if (!row.present || !entity || !await current(entity.anchor)) continue;
        const claims = [];
        for (const claim of entity.claims) if (await current(claim.source)) claims.push(claim);
        entities.set(entity.id, { ...entity, claims, assertion_digest: digest(entity) });
    }
    for (const row of state.links.values()) {
        const link = row.assertion;
        if (!row.present || !link || entities.get(link.from.id)?.assertion_digest !== link.from.digest
            || entities.get(link.to.id)?.assertion_digest !== link.to.digest) continue;
        let valid = true;
        for (const evidence of link.evidence) if (!await current(evidence)) valid = false;
        if (valid) links.set(link.id, { ...link, assertion_digest: digest(link) });
    }
    return { entities, links };
}
function conflictsFor(entities: Node[], key?: string): Conflict[] {
    const conflicts: Conflict[] = [];
    for (const entity of entities) {
        const attributes = [...new Set(entity.claims.map(claim => claim.attribute))].sort();
        for (const attribute of attributes) {
            const claims = entity.claims.filter(claim => claim.attribute === attribute);
            if ((!key || claims.some(claim => claim.source.key === key)) && new Set(claims.map(claim => claim.source.key)).size > 1
                && new Set(claims.map(claim => claim.value)).size > 1) conflicts.push({ entity_id: entity.id, attribute, claims });
        }
    }
    return conflicts;
}

async function mutationPlan(db: MemoryDatabase, target: Mutation, kind: Kind) {
    const operation = target.operation ?? 'set';
    if (!['set', 'remove'].includes(operation)) return fail();
    let input: z.infer<typeof memoryEntityInputSchema> | z.infer<typeof memoryLinkInputSchema> | z.infer<typeof memoryConnectionRemoveSchema>;
    try {
        if (Buffer.byteLength(JSON.stringify(target.input)) > 65536) return fail();
        input = (operation === 'remove' ? memoryConnectionRemoveSchema : kind === 'entity' ? memoryEntityInputSchema : memoryLinkInputSchema).parse(target.input);
    } catch { return fail(); }
    const state = await loadState(db, target), records = kind === 'entity' ? state.entities : state.links;
    const previous = records.get(input.id), revision = (previous?.revision ?? 0) + 1;
    if (!Number.isSafeInteger(revision)) return fail('MEMORY_CONTEXT_REVISION_EXHAUSTED');
    if (operation === 'remove' && !previous?.present) return fail('MEMORY_CONNECTION_MISSING');
    if (!previous && state.entities.size + state.links.size >= MAX_ROWS) return fail('MEMORY_CONNECTION_LIMIT');
    const read = sourceReader(db, target), observed = new Map<string, MemorySourceRef | null>();
    const requireSource = async (key: string) => {
        const source = await read(key); observed.set(key, source);
        if (!source) return fail('MEMORY_SOURCE_MISSING');
        return source;
    };
    let record: Omit<MemoryEntity, 'captured_at'> | Omit<MemoryLink, 'captured_at'> | null = null;
    if (operation === 'set' && kind === 'entity') {
        const entityInput = memoryEntityInputSchema.parse(input);
        const claims = [];
        for (const claim of entityInput.claims) claims.push({ attribute: claim.attribute, value: claim.value, source: await requireSource(claim.key) });
        const anchor = await requireSource(entityInput.anchor_key);
        const counts = new Map<string, number>();
        for (const row of state.entities.values()) if (row.id !== input.id && row.present && row.assertion) {
            for (const claim of row.assertion.claims) counts.set(claim.source.key, (counts.get(claim.source.key) ?? 0) + 1);
        }
        for (const claim of claims) {
            const count = (counts.get(claim.source.key) ?? 0) + 1;
            if (count > 16) return fail('MEMORY_CONNECTION_LIMIT');
            counts.set(claim.source.key, count);
        }
        record = { schema_version: 1, id: input.id, revision, title: entityInput.title, aliases: entityInput.aliases, anchor, claims };
    } else if (operation === 'set' && kind === 'link') {
        const linkInput = memoryLinkInputSchema.parse(input);
        const graph = await liveGraph(db, target, state);
        const from = graph.entities.get(linkInput.from), to = graph.entities.get(linkInput.to);
        if (!from || !to) return fail('MEMORY_CONNECTION_STALE_SOURCE');
        const evidence = [];
        for (const key of linkInput.evidence_keys) evidence.push(await requireSource(key));
        // Endpoint anchors and claims are part of the exact pre-state even when
        // they are not also listed as evidence for this particular association.
        for (const entity of [from, to]) for (const key of sourceKeys(entity)) observed.set(key, await read(key));
        record = { schema_version: 1, id: input.id, revision, from: { id: from.id, digest: from.assertion_digest },
            to: { id: to.id, digest: to.assertion_digest }, predicate: linkInput.predicate, evidence };
    } else if (operation === 'remove' && previous?.assertion) {
        const keys = 'anchor' in previous.assertion ? sourceKeys(previous.assertion) : previous.assertion.evidence.map(source => source.key);
        for (const key of keys) observed.set(key, await read(key));
    }
    // Input size alone is insufficient: resolving keys adds full provenance.
    // Reserve the fixed-width capture timestamp before presenting an apply plan.
    if (record && Buffer.byteLength(JSON.stringify({ ...record, captured_at: '2000-01-01T00:00:00.000Z' })) > 65536) return fail('MEMORY_CONNECTION_LIMIT');
    const marker = await validateMemoryContextFormat(db, memoryStoreIdentity(target.path, target.scope));
    const body = { schema_version: 1 as const, kind, operation, path: canonicalMemoryPath(target.path), marker, input,
        graph_digest: digest([[...state.entities.values()], [...state.links.values()]]),
        observed_sources: [...observed.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0), record, revision };
    return { ...body, digest: digest(body) };
}
const planChange = (target: Mutation, kind: Kind) => withStore(target, false, db => mutationPlan(db, target, kind));
async function applyChange(target: Mutation & { confirm: string }, kind: Kind) {
    if (!/^[a-f0-9]{64}$/.test(target.confirm)) return fail('MEMORY_CONNECTION_STALE_PLAN');
    return withStore(target, true, async db => {
        const plan = await mutationPlan(db, target, kind);
        if (plan.digest !== target.confirm) return fail('MEMORY_CONNECTION_STALE_PLAN');
        const state = await loadState(db, target);
        if (!state.initialized) for (const sql of CONTEXT_CONNECTION_SQL) await db.exec(sql);
        const assertion = plan.record === null ? null : (kind === 'entity' ? memoryEntitySchema : memoryLinkSchema)
            .parse({ ...plan.record, captured_at: new Date().toISOString() });
        await db.prepare(`INSERT INTO ${table(kind)}(id,revision,present,assertion_json) VALUES(?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,present=excluded.present,assertion_json=excluded.assertion_json`)
            .run(plan.input.id, plan.revision, assertion ? 1 : 0, assertion ? JSON.stringify(assertion) : null);
        // Check the total budget before commit, including the new record.
        await loadState(db, target);
        return { schema_version: 1, applied: true, kind, operation: plan.operation, id: plan.input.id, revision: plan.revision, digest: plan.digest };
    });
}
export const planMemoryEntityChange = (target: Mutation) => planChange(target, 'entity');
export const applyMemoryEntityChange = (target: Mutation & { confirm: string }) => applyChange(target, 'entity');
export const planMemoryLinkChange = (target: Mutation) => planChange(target, 'link');
export const applyMemoryLinkChange = (target: Mutation & { confirm: string }) => applyChange(target, 'link');

async function queryOnce(target: Target, query: Query): Promise<Result> {
    const kind = probeOrdinaryMemoryFormat(target.path).kind;
    if (kind === 'missing' || kind === 'legacy') return empty(target, query, false);
    return withStore(target, false, async db => {
        const state = await loadState(db, target), graph = await liveGraph(db, target, state), result = empty(target, query, true);
        const candidates = z.uuid().safeParse(query.entity).success ? [...graph.entities.values()].filter(row => row.id === query.entity)
            : [...graph.entities.values()].filter(row => row.title === query.entity || row.aliases.includes(query.entity));
        result.ambiguous = candidates.length > 1;
        for (const entity of candidates) {
            const match = { id: entity.id, title: entity.title, anchor: entity.anchor, assertion_digest: entity.assertion_digest };
            const proposal = { ...result, matches: [...result.matches, match] };
            if (result.matches.length === query.limit || !fits(proposal)) { result.truncated = true; break; }
            result.matches.push(match);
        }
        if (result.ambiguous || !candidates.length) return result;
        const nodes = new Set<string>(), edges = new Set<string>();
        const appendNode = (node: Node) => {
            if (nodes.has(node.id)) return true;
            if (nodes.size >= query.limit || !fits({ ...result, nodes: [...result.nodes, node] })) { result.truncated = true; return false; }
            result.nodes.push(node); nodes.add(node.id); return true;
        };
        const seed = candidates[0];
        if (!appendNode(seed)) return result;
        let frontier = [seed.id];
        const expanded = new Set<string>();
        for (let level = 0; level < query.depth && frontier.length; level++) {
            const next: string[] = [];
            for (const id of frontier.sort()) {
                if (expanded.has(id)) continue;
                expanded.add(id);
                for (const edge of graph.links.values()) {
                    const destination = query.direction !== 'inbound' && edge.from.id === id ? edge.to.id
                        : query.direction !== 'outbound' && edge.to.id === id ? edge.from.id : undefined;
                    if (!destination || edges.has(edge.id)) continue;
                    if (!appendNode(graph.entities.get(destination)!)) continue;
                    if (edges.size === 100 || !fits({ ...result, edges: [...result.edges, edge] })) { result.truncated = true; continue; }
                    result.edges.push(edge); edges.add(edge.id); next.push(destination);
                }
            }
            frontier = next;
        }
        for (const conflict of conflictsFor(result.nodes)) {
            if (!fits({ ...result, conflicts: [...result.conflicts, conflict] })) { result.truncated = true; break; }
            result.conflicts.push(conflict);
        }
        result.possible_conflicts = result.conflicts.length > 0;
        return result;
    });
}

/** One trusted physical scope only; no graph, count or error joins across stores. */
export async function relatedMemoryContext(target: Target & { entity: string; direction?: Query['direction']; depth?: number; limit?: number }) {
    let query: Query;
    try { query = querySchema.parse({ entity: target.entity, direction: target.direction, depth: target.depth, limit: target.limit }); }
    catch { return fail(); }
    const framing = empty(target, query, false);
    if (!fits(framing)) return fail('MEMORY_CONNECTION_LIMIT');
    const first = await queryOnce(target, query), second = await queryOnce(target, query);
    // A second snapshot must agree before exposing any association. Do not
    // retry on races or pretend these independent reads are linearizable.
    return digest(first) === digest(second) ? first : { ...empty(target, query, second.tracked), truncated: true };
}

/** Internal snapshot helper for the separate gated freshness inspection tool. */
export async function readMemoryClaimConflicts(db: MemoryDatabase, target: Target, key: string): Promise<Conflict[]> {
    const state = await loadState(db, target);
    if (!state.initialized) return [];
    const graph = await liveGraph(db, target, state);
    return conflictsFor([...graph.entities.values()], key);
}
export async function inspectMemoryClaimConflicts(target: Target & { key: string }): Promise<Conflict[]> {
    if (['missing', 'legacy'].includes(probeOrdinaryMemoryFormat(target.path).kind)) return [];
    return withStore(target, false, db => readMemoryClaimConflicts(db, target, target.key));
}

/** Bounded map projection, within the caller's admitted snapshot. Only anchors
 * in its visible source set may contribute titles, aliases or counts. No links
 * or claims are exposed, and a missing/stale anchor cannot become navigation. */
export async function readMemoryMapEntities(db: MemoryDatabase, sources: Map<string, MemorySourceRef>, remaining: number, byteBudget: number) {
    const objects = await db.prepare('SELECT name,type,sql FROM sqlite_master WHERE name IN (?,?) ORDER BY name').all(CONTEXT_ENTITY_TABLE, CONTEXT_LINK_TABLE);
    const entities: Array<{ id: string; revision: number; title: string; aliases: string[]; anchor: MemorySourceRef }> = [];
    if (!objects.length) return { entities, truncated: false, scanned: 0, bytes: 0 };
    if (objects.length !== 2 || objects.some(row => row.type !== 'table'
        || row.sql !== CONTEXT_CONNECTION_SQL[[CONTEXT_ENTITY_TABLE, CONTEXT_LINK_TABLE].indexOf(String(row.name))])) return fail('MEMORY_CONTEXT_DAMAGED');
    if (remaining === 0 || byteBudget === 0) return { entities, scanned: 0, bytes: 0,
        truncated: Boolean(await db.prepare(`SELECT 1 FROM ${CONTEXT_ENTITY_TABLE} LIMIT 1`).get()) };
    let cursor = '', scanned = 0, bytes = 0, truncated = false;
    scan: for (;;) {
        const rows = await db.prepare(`SELECT id,present,revision,CASE WHEN length(CAST(assertion_json AS BLOB))<=65536 THEN assertion_json END AS assertion_json
            FROM ${CONTEXT_ENTITY_TABLE} WHERE id>? ORDER BY id LIMIT 32`).all(cursor);
        if (!rows.length) break;
        for (const row of rows) {
            cursor = String(row.id);
            if (scanned === remaining) { truncated = true; break scan; }
            scanned++;
            if (!z.uuid().safeParse(row.id).success || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1
                || (row.present !== 0 && row.present !== 1)) return fail('MEMORY_CONTEXT_DAMAGED');
            if (!row.present) { if (row.assertion_json !== null) return fail('MEMORY_CONTEXT_DAMAGED'); continue; }
            if (typeof row.assertion_json !== 'string') return fail('MEMORY_CONTEXT_DAMAGED');
            bytes += Buffer.byteLength(row.assertion_json);
            if (bytes > byteBudget) { truncated = true; break scan; }
            let entity: MemoryEntity;
            try { entity = memoryEntitySchema.parse(JSON.parse(row.assertion_json)); } catch { return fail('MEMORY_CONTEXT_DAMAGED'); }
            if (entity.id !== row.id || entity.revision !== row.revision) return fail('MEMORY_CONTEXT_DAMAGED');
            if (!sources.has(entity.anchor.key) || digest(sources.get(entity.anchor.key)) !== digest(entity.anchor)) continue;
            entities.push({ id: entity.id, revision: entity.revision, title: entity.title, aliases: entity.aliases, anchor: entity.anchor });
        }
        if (rows.length < 32) break;
    }
    return { entities, truncated, scanned, bytes: Math.min(bytes, byteBudget) };
}
export async function memoryConnectionsStoreStatus(target: { path: string; scope?: string }) {
    const kind = probeOrdinaryMemoryFormat(target.path).kind;
    if (kind === 'legacy' || kind === 'missing') return { initialized: false, entities: 0, links: 0, tombstones: 0 };
    if (kind !== 'context-v1') return fail('MEMORY_FORMAT_UNSUPPORTED');
    const view = await openOrdinaryMemoryView(target.path, target.scope);
    if (!view) return fail('MEMORY_SOURCE_MISSING');
    try {
        const db = view.getDatabase();
        if (!(db instanceof MemoryDatabase)) return fail('MEMORY_FRESH_STORE_REQUIRED');
        return await db.transaction(async () => {
            // The admitted backend already validates this marker. Recover its
            // logical scope for fleet diagnosis, never infer it from a filename.
            const marker = await db.prepare(`SELECT scope FROM ${CONTEXT_STORE_TABLE} WHERE id=1`).get();
            const state = await loadState(db, { path: target.path, scope: target.scope ?? String(marker?.scope) });
            return { initialized: state.initialized, entities: [...state.entities.values()].filter(row => row.present).length,
                links: [...state.links.values()].filter(row => row.present).length,
                tombstones: [...state.entities.values(), ...state.links.values()].filter(row => !row.present).length };
        })();
    } finally { await view.close(); }
}
