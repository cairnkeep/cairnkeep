import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readStableJson } from './stable-file.js';
import { openTeamStore, restoreTeamSnapshot, verifyTeamSnapshot, TEAM_SNAPSHOT_MAX_BYTES, TeamError, type TeamStore } from './team-store.js';
import { writePrivateExclusive } from './team-files.js';
export { writePrivateExclusive } from './team-files.js';
import { createTeamHttpServer, teamRequest } from './team-http.js';
import { createTeamMcpServer, teamClientToken } from './team-mcp.js';
import { readTeamConnection, connectionToken } from './team-client.js';
import { verifyTeamAuditArchive } from './team-audit.js';

const HELP = `cairn team — experimental token-first team continuity (default off)

CAIRN_TEAM=1 is required. Personal memory is never uploaded.

  cairn team init --organization ID [--data DIR]
  cairn team project create ID [--data DIR]
  cairn team member set SUBJECT --project ID --roles LIST [--data DIR]
  cairn team member remove SUBJECT --project ID [--data DIR]
  cairn team credential issue SUBJECT --class human|workload --expires-at ISO --output FILE [--data DIR]
  cairn team credential revoke ID [--data DIR]
  cairn team serve [--data DIR] [--port PORT]  # requires CAIRN_TEAM_HTTP=1; loopback only
  cairn team connect [--project-root PATH] [--url URL --organization ID --project ID --token-file FILE --harness LIST] [--access read-only|full] [--apply --yes]
  cairn team disconnect [--project-root PATH] [--apply --yes]
  cairn team doctor --client [--project-root PATH]
  cairn team mcp [--project-root PATH | --connection FILE] # local stdio MCP; no review/admin tools
  cairn team list --project ID [--page-size N --cursor CURSOR]
  cairn team proposals --project ID
  cairn team audit --project ID             # scoped, value-free metadata
  cairn team read --project ID --key KEY [--revision DIGEST]
  cairn team history --project ID --key KEY
  cairn team search --project ID --query TEXT
  cairn team proposal-show --project ID --proposal ID
  cairn team propose --project ID --input FILE --confirm VALUE_DIGEST
  cairn team review --project ID --proposal ID --decision approve|reject --confirm PROPOSAL_DIGEST
  cairn team doctor [--data DIR]             # capacity and audit checkpoint
  cairn team backup --output FILE [--read-only] [--data DIR]
  cairn team audit-export --backup FILE --output FILE [--data DIR]
  cairn team audit-verify --input FILE [--previous FILE]
  cairn team audit-archive --input FILE --backup FILE --confirm DIGEST [--apply] [--data DIR]
  cairn team restore --input FILE --confirm SNAPSHOT_DIGEST --data NEW_DIR
  cairn team memory-delete --project ID --key KEY --confirm REVISION_DIGEST [--data DIR]

Clients require CAIRN_TEAM_URL, CAIRN_TEAM_ORGANIZATION and CAIRN_TEAM_TOKEN_FILE.
Never put tokens in command arguments, source trees or harness config.
Team API is not OAuth MCP HTTP. Independent production security review and a
deployment-specific approved real-data pilot remain admission gates. See docs/team.md.
Paging is optional for list/search/history/proposals/audit. Repeat filters and
page size with the returned next_cursor. Search pages are at most ten items.
Audit export is metadata-only and does not mutate the store. Archival defaults
to a no-write plan, retains files, and explicitly upgrades the team store to v2.
`;
function parse(args: string[]): { words: string[]; flags: Record<string, string> } {
    const words: string[] = []; const flags: Record<string, string> = {};
    const known = new Set(['data', 'organization', 'project', 'roles', 'class', 'expires-at', 'output', 'port', 'project-root', 'key', 'revision', 'query', 'proposal', 'input', 'confirm', 'decision', 'connection','backup','apply','read-only','page-size','cursor','previous']);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const name = arg.slice(2);
            if(['apply','read-only'].includes(name)) {
                if(flags[name]!==undefined) throw new TeamError('invalid');
                flags[name]='true'; continue;
            }
            if (!known.has(name) || flags[name] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new TeamError('invalid');
            flags[name] = args[++i];
        } else words.push(arg);
    }
    return { words, flags };
}
async function main(args: string[]): Promise<void> {
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
    if (process.env.CAIRN_TEAM !== '1') throw new TeamError('disabled');
    const { words, flags } = parse(args);
    const [command, subcommand, subject] = words;
    const allowed: Record<string, string[]> = {
        init: ['data', 'organization'], project: ['data'], member: subcommand === 'remove' ? ['data', 'project'] : ['data', 'project', 'roles'],
        credential: subcommand === 'issue' ? ['data', 'class', 'expires-at', 'output'] : ['data'],
        serve: ['data', 'port'], mcp: ['project-root', 'connection'], doctor: ['data'], backup: ['data', 'output','read-only'],
        'audit-export':['data','backup','output'], 'audit-archive':['data','backup','input','confirm','apply'],
        'audit-verify':['input','previous'],
        restore: ['data', 'input', 'confirm'], 'memory-delete': ['data', 'project', 'key', 'confirm'],
        list: ['project','page-size','cursor'], proposals: ['project','page-size','cursor'], audit: ['project','page-size','cursor'], read: ['project', 'key', 'revision'],
        history: ['project', 'key','page-size','cursor'], search: ['project', 'query','page-size','cursor'], 'proposal-show': ['project', 'proposal'],
        propose: ['project', 'input', 'confirm'], review: ['project', 'proposal', 'decision', 'confirm'],
    };
    if (!allowed[command] || Object.keys(flags).some(flag => !allowed[command].includes(flag))) throw new TeamError('invalid');
    const memberRoles = (flags.roles ?? '').split(',').filter(Boolean);
    if (command === 'member' && (!['set', 'remove'].includes(subcommand) || !subject || words.length !== 3 || !flags.project || (subcommand === 'set' && memberRoles.length === 0))) throw new TeamError('invalid');
    const root = resolve(flags.data ?? process.env.CAIRN_TEAM_BASE_DIR ?? join(homedir(), '.cairnkeep', 'team'));
    const print = (result: unknown) => console.log(JSON.stringify(result, null, 2));
    let store: TeamStore | undefined;
    try {
        if(command==='audit-verify') {
            if(words.length!==1 || !flags.input) throw new TeamError('invalid');
            const load=(path:string)=>verifyTeamAuditArchive(readStableJson(resolve(path),{label:'Team audit archive',maxBytes:TEAM_SNAPSHOT_MAX_BYTES,private:true}));
            const archive=load(flags.input);
            if(flags.previous) {
                const previous=load(flags.previous),last=previous.entries[previous.entries.length-1],checkpoint=archive.previous_checkpoint;
                if(previous.organization!==archive.organization || !checkpoint || checkpoint.archive_digest!==previous.digest || checkpoint.backup_digest!==previous.backup_digest || checkpoint.sequence!==last.sequence || checkpoint.digest!==last.digest || checkpoint.previous_archive_digest!==(previous.previous_checkpoint?.archive_digest ?? null)) throw new TeamError('integrity');
            }
            print({verified:true,archive_digest:archive.digest,events:archive.entries.length,first_sequence:archive.entries[0].sequence,last_sequence:archive.entries[archive.entries.length-1].sequence,previous_archive_digest:archive.previous_checkpoint?.archive_digest ?? null,previous_link_verified:!!flags.previous,history_scope:'single-segment-and-optional-previous-link'});return;
        }
        if (command === 'mcp') {
            if (words.length !== 1) throw new TeamError('invalid');
            if (flags.connection && flags['project-root']) throw new TeamError('invalid');
            const connection = flags.connection ? readTeamConnection(resolve(flags.connection)) : undefined;
            const token = connection ? () => connectionToken(connection) : () => teamClientToken();
            token(); // validate private credential before startup
            const server = await createTeamMcpServer(connection
                ? { url: connection.url, organization: connection.organization, project: connection.project, readOnly: connection.access === 'read-only', token, projectRoot: connection.project_root }
                : { url: process.env.CAIRN_TEAM_URL ?? '', organization: process.env.CAIRN_TEAM_ORGANIZATION ?? '', token, projectRoot: flags['project-root'] });
            await server.connect(new StdioServerTransport());
            return;
        }
        if (command === 'restore') {
            if (words.length !== 1 || !flags.input || !flags.confirm || !flags.data) throw new TeamError('invalid');
            const snapshot = verifyTeamSnapshot(readStableJson(resolve(flags.input), { label: 'Team snapshot', maxBytes: TEAM_SNAPSHOT_MAX_BYTES, private: true }));
            store = await restoreTeamSnapshot(root, snapshot, flags.confirm);
            print({ restored: true, organization: store.organization, credentials_revoked: true }); return;
        }
        if (['init', 'project', 'member', 'credential', 'serve', 'doctor', 'backup', 'memory-delete','audit-export','audit-archive'].includes(command)) {
            if (command === 'init' && (words.length !== 1 || !flags.organization)) throw new TeamError('invalid');
            store = await openTeamStore(root, command === 'init' ? { create: true, organization: flags.organization } : {});
            if (command === 'doctor' && words.length === 1) { print(await store.doctor()); return; }
            if (command === 'backup' && words.length === 1) {
                if (!flags.output) throw new TeamError('invalid');
                const snapshot = await store.snapshot({audit:flags['read-only']!=='true'});
                writePrivateExclusive(flags.output, `${JSON.stringify(snapshot)}\n`);
                print({ snapshot_digest: snapshot.digest, written: true }); return;
            }
            if(['audit-export','audit-archive'].includes(command) && words.length===1) {
                if(!flags.backup) throw new TeamError('invalid');
                const backup=verifyTeamSnapshot(readStableJson(resolve(flags.backup),{label:'Team archival backup',maxBytes:TEAM_SNAPSHOT_MAX_BYTES,private:true}));
                if(command==='audit-export') {
                    if(!flags.output) throw new TeamError('invalid');
                    const archive=await store.exportAudit(backup);
                    writePrivateExclusive(flags.output,`${JSON.stringify(archive)}\n`);
                    print({written:true,archive_digest:archive.digest,backup_digest:archive.backup_digest,events:archive.entries.length});
                } else {
                    if(!flags.input || !flags.confirm) throw new TeamError('invalid');
                    const archive=verifyTeamAuditArchive(readStableJson(resolve(flags.input),{label:'Team audit archive',maxBytes:TEAM_SNAPSHOT_MAX_BYTES,private:true}));
                    print(await store.archiveAudit(archive,backup,flags.confirm,flags.apply==='true'));
                }
                return;
            }
            if (command === 'memory-delete' && words.length === 1) { await store.admin({ operation: 'memory-delete', project: flags.project, key: flags.key, confirm: flags.confirm }); print({ deleted: true, backup_copies_retained: true }); return; }
            if (command === 'init') { print({ initialized: true, organization: store.organization, experimental: true }); return; }
            if (command === 'project' && subcommand === 'create' && subject && words.length === 3) { await store.admin({ operation: 'project-create', project: subject }); print({ created: true }); return; }
            if (command === 'member') { await store.admin({ operation: 'member-set', subject, project: flags.project, roles: subcommand === 'remove' ? [] : memberRoles }); print(subcommand === 'remove' ? { removed: true } : { updated: true }); return; }
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
        if (['list', 'proposals', 'audit'].includes(command)) input = common;
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
        if(flags['page-size'] || flags.cursor) {
            const raw=flags['page-size'] ?? '100';
            if(!/^[1-9][0-9]{0,2}$/.test(raw) || Number(raw)>100 || (command==='search' && Number(raw)>10)) throw new TeamError('invalid');
            input.page={size:Number(raw),...(flags.cursor ? {cursor:flags.cursor} : {})};
        }
        print(await teamRequest(process.env.CAIRN_TEAM_URL ?? '', teamClientToken(), input));
    } finally { await store?.close(); }
}
void main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error instanceof TeamError ? error.message : 'Team operation failed; no credential or input content is logged.'}\n`);
    process.exitCode = 1;
});
