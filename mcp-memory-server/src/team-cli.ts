import { closeSync, existsSync, lstatSync, mkdirSync, openSync, writeFileSync, fsyncSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readStableFile, readStableJson } from './stable-file.js';
import { hardenPrivatePath, privatePathIsSafe } from './platform-security.js';
import { openTeamStore, TeamError, type TeamStore } from './team-store.js';
import { createTeamHttpServer, teamRequest } from './team-http.js';
import { createTeamMcpServer, teamClientToken } from './team-mcp.js';

const HELP = `cairn team — experimental token-first team continuity (default off)

CAIRN_TEAM=1 is required. Personal memory is never uploaded.

  cairn team init --organization ID [--data DIR]
  cairn team project create ID [--data DIR]
  cairn team member set SUBJECT --project ID --roles LIST [--data DIR]
  cairn team credential issue SUBJECT --class human|workload --expires-at ISO --output FILE [--data DIR]
  cairn team credential revoke ID [--data DIR]
  cairn team serve [--data DIR] [--port PORT]  # requires CAIRN_TEAM_HTTP=1; loopback only
  cairn team mcp [--project-root PATH]        # local stdio MCP; no review/admin tools
  cairn team list|proposals --project ID
  cairn team read|history --project ID --key KEY [--revision DIGEST]
  cairn team search --project ID --query TEXT
  cairn team proposal-show --project ID --proposal ID
  cairn team propose --project ID --input FILE --confirm VALUE_DIGEST
  cairn team review --project ID --proposal ID --decision approve|reject --confirm PROPOSAL_DIGEST

Clients require CAIRN_TEAM_URL, CAIRN_TEAM_ORGANIZATION and CAIRN_TEAM_TOKEN_FILE.
Never put tokens in command arguments, source trees or harness config.
Team API is not OAuth MCP HTTP. Independent security review and a separately
approved real pilot remain production admission gates. See docs/team.md.
`;
function parse(args: string[]): { words: string[]; flags: Record<string, string> } {
    const words: string[] = []; const flags: Record<string, string> = {};
    const known = new Set(['data', 'organization', 'project', 'roles', 'class', 'expires-at', 'output', 'port', 'project-root', 'key', 'revision', 'query', 'proposal', 'input', 'confirm', 'decision']);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const name = arg.slice(2);
            if (!known.has(name) || flags[name] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new TeamError('invalid');
            flags[name] = args[++i];
        } else words.push(arg);
    }
    return { words, flags };
}
export function writePrivateExclusive(path: string, bytes: string): void {
    path = resolve(path);
    const directory = dirname(path);
    if (!existsSync(directory)) { mkdirSync(directory, { recursive: true, mode: 0o700 }); hardenPrivatePath(directory); }
    const parent = lstatSync(directory);
    if (!parent.isDirectory() || parent.isSymbolicLink() || !privatePathIsSafe(directory)) throw new TeamError('integrity');
    const fd = openSync(path, 'wx', 0o600);
    try { hardenPrivatePath(path); writeFileSync(fd, bytes, 'utf8'); fsyncSync(fd); }
    finally { closeSync(fd); }
}
async function main(args: string[]): Promise<void> {
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
    if (process.env.CAIRN_TEAM !== '1') throw new TeamError('disabled');
    const { words, flags } = parse(args);
    const [command, subcommand, subject] = words;
    const root = resolve(flags.data ?? process.env.CAIRN_TEAM_BASE_DIR ?? join(homedir(), '.cairnkeep', 'team'));
    const print = (result: unknown) => console.log(JSON.stringify(result, null, 2));
    let store: TeamStore | undefined;
    try {
        if (command === 'mcp') {
            if (words.length !== 1) throw new TeamError('invalid');
            teamClientToken(); // validate private credential before startup
            const server = await createTeamMcpServer({ url: process.env.CAIRN_TEAM_URL ?? '', organization: process.env.CAIRN_TEAM_ORGANIZATION ?? '', token: () => teamClientToken(), projectRoot: flags['project-root'] });
            await server.connect(new StdioServerTransport());
            return;
        }
        if (['init', 'project', 'member', 'credential', 'serve'].includes(command)) {
            if (command === 'init' && (words.length !== 1 || !flags.organization)) throw new TeamError('invalid');
            store = await openTeamStore(root, command === 'init' ? { create: true, organization: flags.organization } : {});
            if (command === 'init') { print({ initialized: true, organization: store.organization, experimental: true }); return; }
            if (command === 'project' && subcommand === 'create' && subject && words.length === 3) { await store.admin({ operation: 'project-create', project: subject }); print({ created: true }); return; }
            if (command === 'member' && subcommand === 'set' && subject && words.length === 3) { await store.admin({ operation: 'member-set', subject, project: flags.project, roles: (flags.roles ?? '').split(',').filter(Boolean) }); print({ updated: true }); return; }
            if (command === 'credential' && subcommand === 'issue' && subject && words.length === 3) {
                if (!flags.output || existsSync(resolve(flags.output))) throw new TeamError('invalid');
                const credential = await store.issue({ subject, credential_class: flags.class, expires_at: flags['expires-at'] });
                try { writePrivateExclusive(flags.output, `${credential.token}\n`); }
                catch (error) { await store.admin({ operation: 'credential-revoke', credential: credential.id }); throw error; }
                print({ credential_id: credential.id, token_file_created: true }); return;
            }
            if (command === 'credential' && subcommand === 'revoke' && subject && words.length === 3) { await store.admin({ operation: 'credential-revoke', credential: subject }); print({ revoked: true }); return; }
            if (command === 'serve' && words.length === 1) {
                const raw = flags.port ?? '7955';
                if (!/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535) throw new TeamError('invalid');
                const server = createTeamHttpServer(store);
                await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(Number(raw), '127.0.0.1', resolve); });
                process.stderr.write(`Team preview API listening on loopback port ${raw}.\n`);
                await new Promise<void>(resolve => {
                    const stop = () => { server.close(() => resolve()); server.closeAllConnections(); };
                    process.once('SIGINT', stop); process.once('SIGTERM', stop);
                });
                return;
            }
            throw new TeamError('invalid');
        }
        if (words.length !== 1 || !flags.project) throw new TeamError('invalid');
        const common = { organization: process.env.CAIRN_TEAM_ORGANIZATION, project: flags.project, operation: command };
        let input: Record<string, unknown>;
        if (['list', 'proposals'].includes(command)) input = common;
        else if (['read', 'history'].includes(command)) input = { ...common, key: flags.key, ...(flags.revision ? { revision: flags.revision } : {}) };
        else if (command === 'search') input = { ...common, query: flags.query };
        else if (command === 'proposal-show') input = { ...common, proposal_id: flags.proposal };
        else if (command === 'review') input = { ...common, proposal_id: flags.proposal, decision: flags.decision, confirm: flags.confirm };
        else if (command === 'propose') {
            if (!flags.input || !flags.confirm) throw new TeamError('invalid');
            const selected = readStableJson(resolve(flags.input), { label: 'Team selected proposal', maxBytes: 512 * 1024, private: true });
            if (!selected || typeof selected !== 'object' || Array.isArray(selected)) throw new TeamError('invalid');
            input = { ...selected, ...common, confirm: flags.confirm };
        } else throw new TeamError('invalid');
        print(await teamRequest(process.env.CAIRN_TEAM_URL ?? '', teamClientToken(), input));
    } finally { await store?.close(); }
}
void main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error instanceof TeamError ? error.message : 'Team operation failed; no credential or input content is logged.'}\n`);
    process.exitCode = 1;
});
