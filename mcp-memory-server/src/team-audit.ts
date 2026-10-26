import { createHash } from 'node:crypto';
import { z } from 'zod';
import { TeamError } from './team-errors.js';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const teamAuditCheckpointSchema = z.object({ sequence: z.number().int().positive(), digest, archive_digest: digest, backup_digest: digest, previous_archive_digest: digest.nullable() }).strict();
export type TeamAuditCheckpoint = z.infer<typeof teamAuditCheckpointSchema>;
export const teamAuditRowSchema = z.object({ sequence: z.number().int().positive(), organization: id, project: id.or(z.literal('')), value: z.string().max(4096), digest }).strict();
export const teamAuditEntrySchema = z.object({ schema_version: z.literal(1), sequence: z.number().int().positive(), organization: id, project: id.or(z.literal('')), subject: id, credential_class: z.enum(['human','workload','local-os']), operation: z.enum(['project-create','member-set','credential-revoke','credential-issue','memory-delete','list','audit','read','history','search','propose','proposals','proposal-show','review','snapshot','restore','connection-check','audit-archive']), result: z.enum(['accepted','denied','conflict','invalid']), object_digest: digest.nullable(), previous_digest: digest.nullable(), request_id: z.string().uuid(), at: z.iso.datetime() }).strict();
const archiveSchema = z.object({ schema_version: z.literal(1), organization:id, backup_digest:digest, previous_checkpoint:teamAuditCheckpointSchema.nullable(), entries:z.array(teamAuditRowSchema).min(1).max(100000), digest }).strict();
export type TeamAuditArchive = z.infer<typeof archiveSchema>;
const hash = (text:string) => createHash('sha256').update(text).digest('hex');

export function verifyTeamAuditRows(organization:string, rows:z.infer<typeof teamAuditRowSchema>[], checkpoint:TeamAuditCheckpoint|null):void {
    try {
        let sequence=checkpoint?.sequence ?? 0, previous=checkpoint?.digest ?? null, bytes=0;
        for(const row of rows) {
            const entry=teamAuditEntrySchema.parse(JSON.parse(row.value));
            bytes+=Buffer.byteLength(row.value);
            if(row.organization!==organization || row.sequence!==++sequence || entry.sequence!==sequence || entry.organization!==organization || entry.project!==row.project || entry.previous_digest!==previous || hash(row.value)!==row.digest) throw new Error();
            previous=row.digest;
        }
        if(bytes>16*1024*1024+256*1024) throw new Error();
    } catch { throw new TeamError('integrity'); }
}
export function verifyTeamAuditArchive(input:unknown):TeamAuditArchive {
    try {
        if(Buffer.byteLength(JSON.stringify(input))>64*1024*1024) throw new Error();
        const archive=archiveSchema.parse(input), {digest,...body}=archive;
        if(hash(JSON.stringify(body))!==digest) throw new Error();
        verifyTeamAuditRows(archive.organization,archive.entries,archive.previous_checkpoint);
        return archive;
    } catch { throw new TeamError('integrity'); }
}
