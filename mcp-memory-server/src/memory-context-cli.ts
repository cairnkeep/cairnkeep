import { parseArgs } from 'node:util';
import { resolveMemoryScopePath } from './reviewed-memory-store.js';
import { planContextStoreInit, applyContextStoreInit, contextStoreStatus, backupMemoryContextStore, planContextStoreRestore, applyContextStoreRestore } from './ordinary-memory-store.js';
import { readStableJson } from './stable-file.js';

const HELP = `Usage: cairn memory-context <init|status|doctor|backup|restore|inspect|set-freshness> --scope SCOPE [--project PATH] [--json]
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
        } });
        if (values.help || positionals.length === 0) { process.stdout.write(HELP); return 0; }
        const [command] = positionals;
        if (positionals.length !== 1 || !['init', 'status', 'doctor', 'backup', 'restore', 'inspect', 'set-freshness'].includes(command) || !values.scope
            || (!['init', 'restore', 'set-freshness'].includes(command) && (values.apply || values.confirm)) || Boolean(values.apply) !== Boolean(values.confirm)
            || (command === 'backup') !== Boolean(values.output) || ['restore', 'set-freshness'].includes(command) !== Boolean(values.input)
            || ['inspect', 'set-freshness'].includes(command) !== Boolean(values.key)) throw new Error('MEMORY_ARGUMENTS_INVALID');
        const path = resolveMemoryScopePath(values.scope, { cwd: values.project });
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
