import { localContextArgs, localContextMain } from './local-context-cli.js';
import { readLocalInput } from './local-context-record.js';
import { planWikiEvidence, publishWikiEvidence, checkWikiEvidence } from './wiki-evidence.js';

await localContextMain(() => {
    const [command = 'help', ...args] = process.argv.slice(2);
    if (['help', '--help', '-h'].includes(command)) {
        console.log('cairn wiki-evidence plan --input MANIFEST --project PATH [--json]\n'
            + 'cairn wiki-evidence apply --input PLAN --confirm DIGEST --project PATH [--json]\n'
            + 'cairn wiki-evidence check DIGEST --project PATH [--json]\n'
            + 'Local, explicit source integrity and quotation checks; not semantic truth. No background jobs.'); return;
    }
    const allowed = ['--project', '--json', ...(command === 'check' ? [] : ['--input']), ...(command === 'apply' ? ['--confirm'] : [])];
    const { options, positional } = localContextArgs(args, allowed);
    const root = options.get('--project') ?? process.cwd();
    let result;
    if (command === 'check' && positional.length === 1) {
        result = checkWikiEvidence(root, positional[0]);
        if (!result.ok) process.exitCode = 1;
    } else if (['plan', 'apply'].includes(command) && !positional.length && options.has('--input')) {
        const input = readLocalInput(options.get('--input')!);
        result = command === 'plan' ? planWikiEvidence(root, input) : publishWikiEvidence(root, input, options.get('--confirm') ?? '');
    } else throw new Error('Invalid evidence command.');
    console.log(JSON.stringify(result));
});
