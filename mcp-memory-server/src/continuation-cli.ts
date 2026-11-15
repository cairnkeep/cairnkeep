import { localContextArgs, localContextMain } from './local-context-cli.js';
import { readLocalInput } from './local-context-record.js';
import { createContinuation, readContinuation } from './continuation.js';

await localContextMain(() => {
    const [command = 'help', ...args] = process.argv.slice(2);
    if (['help', '--help', '-h'].includes(command)) {
        console.log('cairn continuation create --input FILE --project PATH [--json]\n'
            + 'cairn continuation show DIGEST --project PATH [--max-bytes 1024..32768] [--json]\n'
            + 'Explicit project-bound, non-consuming context. No automatic capture, startup injection, task claim or authorization.'); return;
    }
    const { options, positional } = localContextArgs(args, ['--project', '--json', ...(command === 'create' ? ['--input'] : ['--max-bytes'])]);
    const root = options.get('--project') ?? process.cwd();
    if (command === 'create' && !positional.length && options.has('--input')) {
        const packet = createContinuation(root, readLocalInput(options.get('--input')!));
        console.log(JSON.stringify({ schema_version: 1, digest: packet.digest, created: true, entry_count: packet.entries.length }));
    } else if (command === 'show' && positional.length === 1) {
        console.log(JSON.stringify(readContinuation(root, positional[0], options.has('--max-bytes') ? Number(options.get('--max-bytes')) : undefined)));
    } else throw new Error('Invalid continuation command.');
});
