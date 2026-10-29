import { parseArgs } from 'node:util';
import { resolveMemoryScopePath } from './reviewed-memory-store.js';
import { planContextStoreInit, applyContextStoreInit, contextStoreStatus, backupMemoryContextStore, planContextStoreRestore, applyContextStoreRestore } from './ordinary-memory-store.js';
import { readStableJson } from './stable-file.js';

const HELP = `Usage: cairn memory-context <init|status|doctor|backup|restore|inspect|set-freshness|entity|link|related|map> --scope SCOPE [--project PATH] [--json]
  init                 Print a no-write plan for a fresh, absent store.
  init --apply --confirm DIGEST
                       Create exactly the inspected fresh store.
  status | doctor      Read-only format and integrity diagnosis.
  backup --output FILE Create a private, no-overwrite online snapshot.
  restore --input FILE Print a no-write plan for an absent, same-owner target.
                       Apply with --apply --confirm DIGEST; renews restore epoch.
  inspect --key KEY    Read bounded ordinary memory and freshness assertions.
  set-freshness --key KEY --input FILE
                       Print a strict, no-write curation plan (64 KiB JSON max).
                       Apply with --apply --confirm DIGEST; stale plans refuse.
  entity set|remove --input FILE
  link set|remove --input FILE
                       Plan explicit revision-bound graph curation; apply with
                       --apply --confirm DIGEST. Removal retains a tombstone.
  related --entity ID_OR_ALIAS [--direction outbound|inbound|both]
                       Observe one store, --depth 1|2, --limit 1..50 (default 50).
  map [--max-bytes 1024..8192] [--limit 1..50]
                       Deterministic navigation, default 4096 UTF-8 bytes including
                       MCP framing; exact reads remain necessary. No providers.
Entity JSON: schema_version:1, UUID id, title, aliases:[], anchor_key, claims:[].
Claims contain key, attribute and value. Link JSON: schema_version:1, UUID id,
from/to entity UUIDs, predicate, evidence_keys:[]. Remove JSON: schema_version:1,id.
Ambiguous aliases never select an entity automatically. Links are not permission
to execute. Graph edits do not refresh source freshness or change ordinary text.
Freshness input: schema_version:1, source_refs:[], optional effective_at,
verified_at and review_after in UTC. References are opaque and never fetched.
Reads never advance verification. Status labels are assertions, not truth.
Existing stores (including empty files) are never converted or replaced.
Context stores require the Node 22.16+ API and a patched bundled SQLite
(3.51.3+ or documented backports 3.50.7/3.44.6); use a current Node release.
Stop clients before recovery. Raw copies and in-place restores are unsupported.
`;

export async function runMemoryContextCli(args = process.argv.slice(2)): Promise<number> {
    try {
        const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
            scope: { type: 'string' }, project: { type: 'string' }, json: { type: 'boolean' },
            apply: { type: 'boolean' }, confirm: { type: 'string' }, help: { type: 'boolean', short: 'h' },
            input: { type: 'string' }, output: { type: 'string' }, key: { type: 'string' },
            entity: { type: 'string' }, direction: { type: 'string' }, depth: { type: 'string' }, limit: { type: 'string' },
            'max-bytes': { type: 'string' },
        } });
        if (values.help || positionals.length === 0) { process.stdout.write(HELP); return 0; }
        const [command, operation] = positionals, curation = command === 'entity' || command === 'link';
        if (positionals.length !== (curation ? 2 : 1) || !['init', 'status', 'doctor', 'backup', 'restore', 'inspect', 'set-freshness', 'entity', 'link', 'related', 'map'].includes(command) || !values.scope
            || (curation && !['set', 'remove'].includes(operation))
            || (!['init', 'restore', 'set-freshness', 'entity', 'link'].includes(command) && (values.apply || values.confirm)) || Boolean(values.apply) !== Boolean(values.confirm)
            || (command === 'backup') !== Boolean(values.output) || (['restore', 'set-freshness', 'entity', 'link'].includes(command)) !== Boolean(values.input)
            || ['inspect', 'set-freshness'].includes(command) !== Boolean(values.key) || (command === 'related') !== Boolean(values.entity)
            || (command !== 'related' && (values.direction || values.depth)) || (!['related', 'map'].includes(command) && values.limit)
            || (command !== 'map' && values['max-bytes'] !== undefined)
            || (values['max-bytes'] !== undefined && (!/^[1-9][0-9]{3}$/.test(values['max-bytes']) || Number(values['max-bytes']) < 1024 || Number(values['max-bytes']) > 8192))
            || (values.depth !== undefined && !/^[12]$/.test(values.depth))
            || (values.limit !== undefined && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(values.limit))) throw new Error('MEMORY_ARGUMENTS_INVALID');
        const path = resolveMemoryScopePath(values.scope, { cwd: values.project });
        if (command === 'map') {
            const { buildMemoryMap } = await import('./memory-map.js');
            const result = await buildMemoryMap([{ path, scope: values.scope }], { max_bytes: values['max-bytes'] === undefined ? undefined : Number(values['max-bytes']),
                limit: values.limit === undefined ? undefined : Number(values.limit) });
            process.stdout.write(`${JSON.stringify(result)}\n`); return 0;
        }
        if (curation || command === 'related') {
            const feature = await import('./memory-connections.js');
            const input = curation ? readStableJson(values.input!, { label: 'Connection input', maxBytes: 65536 }) : undefined;
            const options = { path, scope: values.scope, input, operation: operation as 'set' | 'remove' };
            const result = command === 'related' ? await feature.relatedMemoryContext({ path, scope: values.scope, entity: values.entity!,
                direction: values.direction as 'inbound' | 'outbound' | 'both' | undefined,
                depth: values.depth === undefined ? undefined : Number(values.depth), limit: values.limit === undefined ? undefined : Number(values.limit) })
                : command === 'entity' ? values.apply ? await feature.applyMemoryEntityChange({ ...options, confirm: values.confirm! }) : await feature.planMemoryEntityChange(options)
                : values.apply ? await feature.applyMemoryLinkChange({ ...options, confirm: values.confirm! }) : await feature.planMemoryLinkChange(options);
            process.stdout.write(`${JSON.stringify(result)}\n`); return 0;
        }
        if (command === 'set-freshness' || command === 'inspect') {
            const feature = await import('./memory-context-store.js');
            const target = { path, scope: values.scope, key: values.key! };
            const result = command === 'inspect' ? await feature.inspectMemoryCandidates(values.key!, [target])
                : values.apply ? await feature.applyFreshnessChange({ ...target,
                    input: readStableJson(values.input!, { label: 'Freshness input', maxBytes: 65536 }), confirm: values.confirm! })
                : await feature.planFreshnessChange({ ...target, input: readStableJson(values.input!, { label: 'Freshness input', maxBytes: 65536 }) });
            process.stdout.write(`${JSON.stringify(result)}\n`); return 0;
        }
        const result = command === 'backup' ? await backupMemoryContextStore({ path, scope: values.scope, output: values.output! })
            : command === 'restore' ? values.apply
                ? await applyContextStoreRestore({ path, scope: values.scope, input: values.input!, confirm: values.confirm! })
                : await planContextStoreRestore({ path, scope: values.scope, input: values.input! })
            : command === 'init'
            ? values.apply ? await applyContextStoreInit({ path, scope: values.scope, confirm: values.confirm! }) : await planContextStoreInit({ path, scope: values.scope })
            : await contextStoreStatus(path, values.scope);
        if ((command === 'doctor' || command === 'status') && 'format' in result && result.format === 'context-v1') {
            const { memoryFreshnessStoreStatus } = await import('./memory-context-store.js');
            Object.assign(result, { freshness: await memoryFreshnessStoreStatus({ path, scope: values.scope }) });
            const { memoryConnectionsStoreStatus } = await import('./memory-connections.js');
            Object.assign(result, { connections: await memoryConnectionsStoreStatus({ path, scope: values.scope }) });
        }
        process.stdout.write(`${JSON.stringify(result, null, values.json ? 0 : 2)}\n`);
        return ('format' in result && result.format === 'unsupported') || ('ok' in result && !result.ok) ? 1 : 0;
    } catch (error) {
        // Diagnostics contain categories, never source values or database paths.
        const code = (error as { code?: string }).code;
        process.stderr.write(`${code && /^[A-Z_]+$/.test(code) ? code : 'MEMORY_OPERATION_FAILED'}: inspect with cairn memory-context doctor; existing stores are never converted.\n`);
        return 1;
    }
}

process.exitCode = await runMemoryContextCli();
