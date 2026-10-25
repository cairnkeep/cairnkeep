import { dirname, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readStableJson, readStableFile } from './stable-file.js';
import { teamClientToken } from './team-mcp.js';
import { teamRequest, validateTeamUrl } from './team-http.js';
import { TeamError } from './team-store.js';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const path = z.string().min(1).max(4096).refine(value => isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value));
const schema = z.object({
    schema_version: z.literal(1), project_root: path,
    organization: id, project: id, url: z.string().max(4096), token_file: path,
    access: z.enum(['read-only', 'full']),
}).strict();
export type TeamConnection = z.infer<typeof schema>;
export class TeamClientError extends Error {}
export function validateTeamConnection(value: unknown): TeamConnection {
    const result = schema.safeParse(value);
    if (!result.success) throw new TeamClientError('Team connection fields are invalid; check organization/project IDs, absolute paths and access profile.');
    try { validateTeamUrl(result.data.url); }
    catch { throw new TeamClientError('Team connection URL must be loopback HTTP or HTTPS without credentials, query, fragment or path prefix.'); }
    return result.data;
}
export function readTeamConnection(path: string): TeamConnection {
    const { bytes } = readStableFile(path, { label: 'Team connection', maxBytes: 32768, private: true });
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new TeamClientError('Team connection contains invalid UTF-8 or JSON.'); }
    const connection = validateTeamConnection(value);
    const receipt = readStableJson(join(dirname(path), 'receipt.json'), { label: 'Team connection activation', maxBytes: 16 * 1024 * 1024, private: true });
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
        || (receipt as Record<string, unknown>).schema_version !== 1
        || (receipt as Record<string, unknown>).status !== 'connected'
        || (receipt as Record<string, unknown>).project_root !== connection.project_root) throw new TeamClientError('Team connection is incomplete or disconnected; inspect recovery state.');
    if ((receipt as Record<string, unknown>).connection_digest !== createHash('sha256').update(bytes).digest('hex')) throw new TeamClientError('Team connection activation changed; inspect recovery state.');
    return connection;
}
export function connectionToken(connection: TeamConnection): string {
    try { return teamClientToken({ CAIRN_TEAM_TOKEN_FILE: connection.token_file }); }
    catch { throw new TeamClientError('Team credential file is unsafe or unreadable; use an owner-only file issued by the operator.'); }
}
/** Authenticate and check reader membership without retrieving memory or proposals.
 * Expiry and roles come from the service, never from guesses about opaque tokens. */
export async function connectionDoctor(connection: TeamConnection) {
    connection = validateTeamConnection(connection);
    const token = connectionToken(connection);
    const result = await teamRequest(connection.url, token, { organization: connection.organization, project: connection.project, operation: 'connection-check' });
    const metadata = z.object({ schema_version: z.literal(1), organization: id, project: id,
        subject: id, credential_id: z.string().uuid(), credential_class: z.enum(['human', 'workload']),
        expires_at: z.iso.datetime(), roles: z.array(z.enum(['reader', 'contributor', 'reviewer', 'maintainer', 'auditor'])).max(5),
    }).strict().safeParse(result);
    if (!metadata.success || metadata.data.organization !== connection.organization || metadata.data.project !== connection.project
        || !metadata.data.roles.includes('reader') || Date.parse(metadata.data.expires_at) <= Date.now()) throw new TeamError('integrity');
    return { ok: true, ...metadata.data, access: connection.access, experimental: true };
}
