export function localContextArgs(args: string[], allowed: string[]) {
    const options = new Map<string, string>(); const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg.startsWith('-')) { positional.push(arg); continue; }
        if (!allowed.includes(arg) || options.has(arg)) throw new Error('Unknown or repeated local context option.');
        if (arg === '--json') { options.set(arg, '1'); continue; }
        const value = args[++i];
        if (!value || value.startsWith('--')) throw new Error('Local context option requires a value.');
        options.set(arg, value);
    }
    return { options, positional };
}

export async function localContextMain(run: () => void | Promise<void>) {
    try { await run(); }
    catch { process.stderr.write('cairn: local context operation refused; check input schema, project, digest, evidence, permissions and limits.\n'); process.exitCode = 2; }
}
