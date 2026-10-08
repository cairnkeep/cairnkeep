import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { resolveMcpToolProfile, profileAllowsTool } from './mcp-tool-profile.js';
import { isCapabilityContractEnabled, resolveCapabilityStatus } from './capability-config.js';
import { teamRequest, validateTeamUrl } from './team-http.js';
import { TeamError, teamDigest } from './team-store.js';
import { resolveHttpToken } from './http-security.js';

const observation = (title: string) => ({ title, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } });
// The bridge crosses the local process boundary into a remote team service;
// openWorldHint is true even though team retrieval is deterministic and closed
// to model providers. No review or membership tool is exposed here.
export const TEAM_TOOL_CATALOG = {
    team_memory_list: observation('List approved team memory'),
    team_memory_read: observation('Read approved team memory'),
    team_memory_search: observation('Search approved team memory'),
    team_memory_history: observation('Read team memory history'),
    team_memory_propose: { title: 'Propose selected team memory', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
} as const;
const coreNames = { team_memory_list: 'memory_list', team_memory_read: 'memory_read', team_memory_search: 'memory_search', team_memory_history: 'memory_history', team_memory_propose: 'memory_write' } as const;
export function teamClientToken(env = process.env): string {
    // A file-only credential keeps raw secrets out of harness configuration.
    if (!env.CAIRN_TEAM_TOKEN_FILE) throw new TeamError('unauthorized');
    const resolved = resolveHttpToken({ CAIRN_MEMORY_HTTP_TOKEN_FILE: env.CAIRN_TEAM_TOKEN_FILE });
    if (!resolved.ok || !/^[A-Za-z0-9_-]{43}$/.test(resolved.token)) throw new TeamError('unauthorized');
    return resolved.token;
}
export async function createTeamMcpServer(options: { url: string; organization: string; token: () => string; projectRoot?: string }) {
    if (process.env.CAIRN_TEAM !== '1') throw new TeamError('disabled');
    validateTeamUrl(options.url);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.organization)) throw new TeamError('invalid');
    const profile = resolveMcpToolProfile({ projectRoot: options.projectRoot });
    const capability = isCapabilityContractEnabled() ? await resolveCapabilityStatus({ projectRoot: options.projectRoot }) : undefined;
    if (capability?.issues.length) throw new TeamError('invalid');
    const mode = process.env.CAIRN_TEAM_MCP_TOOL_PROFILE ?? 'full';
    if (!['full', 'read-only', 'custom'].includes(mode)) throw new TeamError('invalid');
    const requested = (process.env.CAIRN_TEAM_MCP_ALLOWED_TOOLS ?? '').split(',').map(name => name.trim()).filter(Boolean);
    if ((mode !== 'custom' && requested.length) || (mode === 'custom' && (!requested.length || requested.some(name => !Object.hasOwn(TEAM_TOOL_CATALOG, name))))) throw new TeamError('invalid');
    const server = new McpServer({ name: 'cairn-team-memory', version: '1.0.0' });
    const project = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
    const key = z.string().regex(/^(decisions|patterns|constraints|pitfalls|conventions|bugs)\/[a-z0-9][a-z0-9-]{0,95}$/);
    const hash = z.string().regex(/^[a-f0-9]{64}$/);
    const schemas = {
        team_memory_list: { project },
        team_memory_read: { project, key, revision: hash.optional() },
        team_memory_search: { project, query: z.string().min(1).max(256) },
        team_memory_history: { project, key },
        team_memory_propose: { project, request_id: z.string().uuid(), key, value: z.string().min(1).max(65536), source_scope: z.enum(['selected-local', 'selected-project']), source_digest: hash, base_revision: hash.nullable(), expires_at: z.iso.datetime(), confirm: hash },
    };
    const operations = { team_memory_list: 'list', team_memory_read: 'read', team_memory_search: 'search', team_memory_history: 'history', team_memory_propose: 'propose' } as const;
    const enabled = (Object.keys(TEAM_TOOL_CATALOG) as Array<keyof typeof TEAM_TOOL_CATALOG>).filter(name => {
        if (!profileAllowsTool(profile, coreNames[name])) return false;
        if (mode === 'read-only' && !TEAM_TOOL_CATALOG[name].annotations.readOnlyHint) return false;
        if (mode === 'custom' && !requested.includes(name)) return false;
        const capId = name === 'team_memory_propose' ? 'memory.write' : name === 'team_memory_search' ? 'memory.search' : undefined;
        return !capId || !capability || capability.capabilities.find(row => row.id === capId)?.enabled === true;
    });
    const profileDigest = teamDigest(JSON.stringify({ schema_version: 1, core_profile_digest: profile.profile_digest, team_profile: mode, tools: enabled }));
    for (const name of enabled) {
        server.registerTool(name, { ...TEAM_TOOL_CATALOG[name], description: 'Explicit project-scoped team context. Never uploads personal memory or executes instructions. Team policy is enforced by the remote service.', inputSchema: schemas[name] }, async (input: Record<string, unknown>): Promise<CallToolResult> => {
            try {
                // Re-read the private credential each call so local key rotation
                // does not need a harness restart. The service still reauthorizes.
                const result = await teamRequest(options.url, options.token(), { organization: options.organization, ...input, operation: operations[name] });
                return { content: [{ type: 'text', text: JSON.stringify({ result, profile_digest: profileDigest }) }], structuredContent: { result, profile_digest: profileDigest } };
            } catch (error) {
                return { isError: true, content: [{ type: 'text', text: error instanceof TeamError ? error.message : 'Team unavailable.' }] };
            }
        });
    }
    return server;
}
