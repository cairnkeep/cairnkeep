import { parseArgs } from 'node:util';
import { resolveMemoryScopePath } from './reviewed-memory-store.js';
import { planContextStoreInit, applyContextStoreInit, contextStoreStatus } from './ordinary-memory-store.js';

const HELP = `Usage: cairn memory-context <init|status|doctor> --scope SCOPE [--project PATH] [--json]
  init                 Print a no-write plan for a fresh, absent store.
  init --apply --confirm DIGEST
                       Create exactly the inspected fresh store.
  status | doctor      Read-only format and integrity diagnosis.
Existing stores (including empty files) are never converted or replaced.
Context stores require Node 22.16+ with the built-in SQLite API.
`;

export async function runMemoryContextCli(args = process.argv.slice(2)): Promise<number> {
    try {
        const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
            scope: { type: 'string' }, project: { type: 'string' }, json: { type: 'boolean' },
            apply: { type: 'boolean' }, confirm: { type: 'string' }, help: { type: 'boolean', short: 'h' },
        } });
        if (values.help || positionals.length === 0) { process.stdout.write(HELP); return 0; }
        const [command] = positionals;
        if (positionals.length !== 1 || !['init', 'status', 'doctor'].includes(command) || !values.scope
            || (command !== 'init' && (values.apply || values.confirm)) || Boolean(values.apply) !== Boolean(values.confirm)) throw new Error('MEMORY_ARGUMENTS_INVALID');
        const path = resolveMemoryScopePath(values.scope, { cwd: values.project });
        const result = command === 'init'
            ? values.apply ? await applyContextStoreInit({ path, scope: values.scope, confirm: values.confirm! }) : await planContextStoreInit({ path, scope: values.scope })
            : await contextStoreStatus(path, values.scope);
        process.stdout.write(`${JSON.stringify(result, null, values.json ? 0 : 2)}\n`);
        return 'format' in result && result.format === 'unsupported' ? 1 : 0;
    } catch (error) {
        // Diagnostics contain categories, never source values or database paths.
        const code = (error as { code?: string }).code;
        process.stderr.write(`${code && /^[A-Z_]+$/.test(code) ? code : 'MEMORY_OPERATION_FAILED'}: inspect with cairn memory-context doctor; existing stores are never converted.\n`);
        return 1;
    }
}

process.exitCode = await runMemoryContextCli();
