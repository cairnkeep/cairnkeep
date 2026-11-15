import { createHash } from "node:crypto";
import { z } from "zod";

export const MEMORY_PROPOSAL_SCHEMA_VERSION = 1 as const;
export const MEMORY_PROPOSAL_MAX_BYTES = 1024 * 1024;
export const MEMORY_PROPOSAL_MAX_CANDIDATES = 128;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const candidateSchema = z.object({
    key: z.string().min(1).max(512),
    value: z.string().max(64 * 1024),
    category: z.string().max(64).optional(),
    importance: z.number().min(0).max(1).optional(),
    operation: z.enum(["create", "update", "noop"]),
    base_hash: digestSchema.nullable(),
    value_hash: digestSchema,
}).strict();

const singleProposalBodySchema = z.object({
    schema_version: z.literal(MEMORY_PROPOSAL_SCHEMA_VERSION),
    created_at: z.iso.datetime(),
    project_root: z.string().min(1),
    scope: z.string().regex(/^(?:project|[a-z0-9][a-z0-9-]*)$/),
    source: z.object({
        kind: z.literal("trajectory"),
        session_id: z.string().min(1).max(256),
        digest: digestSchema,
    }).strict(),
    extraction: z.object({ model: z.string().min(1).max(256) }).strict(),
    candidates: z.array(candidateSchema).min(1).max(MEMORY_PROPOSAL_MAX_CANDIDATES),
}).strict();

export const consolidationEvidenceSchema = z.object({
    session_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
    sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    quote: z.string().min(1).max(4096).refine(s => Buffer.byteLength(s) <= 4096),
}).strict();
const consolidationFields = {
    status: z.enum(['observed', 'asserted', 'hypothesis']),
    preserve: z.array(z.string().min(1).max(4096)).min(1).max(16),
    evidence: z.array(consolidationEvidenceSchema).min(1).max(16),
};
export const consolidationInputSchema = z.object({ schema_version: z.literal(1),
    candidates: z.array(z.object({ key: z.string().min(1).max(512), value: z.string().min(1).max(64 * 1024),
        ...consolidationFields }).strict()).min(1).max(MEMORY_PROPOSAL_MAX_CANDIDATES),
}).strict();
const consolidationBodySchema = singleProposalBodySchema.extend({
    schema_version: z.literal(2),
    source: z.object({ kind: z.literal('trajectories'), sessions: z.array(z.object({
        session_id: z.string().min(1).max(256), digest: digestSchema,
    }).strict()).min(2).max(8).refine(s => new Set(s.map(v => v.session_id)).size === s.length) }).strict(),
    candidates: z.array(candidateSchema.extend(consolidationFields)).min(1).max(MEMORY_PROPOSAL_MAX_CANDIDATES),
});
export const memoryProposalBodySchema = z.discriminatedUnion('schema_version', [singleProposalBodySchema, consolidationBodySchema]);
export const memoryProposalSchema = z.discriminatedUnion('schema_version', [
    singleProposalBodySchema.extend({ digest: digestSchema }).strict(),
    consolidationBodySchema.extend({ digest: digestSchema }).strict(),
]);
export type MemoryProposalBody = z.infer<typeof memoryProposalBodySchema>;
export type MemoryProposal = z.infer<typeof memoryProposalSchema>;
export type MemoryProposalCandidate = z.infer<typeof candidateSchema>;

export function expectedMemoryProposalOperation(
    baseHash: string | null,
    valueHash: string,
): MemoryProposalCandidate["operation"] {
    if (baseHash === null) return "create";
    return baseHash === valueHash ? "noop" : "update";
}

export function assertMemoryProposalCandidateConsistency(candidate: MemoryProposalCandidate): void {
    const actualValueHash = digestText(candidate.value);
    if (candidate.value_hash !== actualValueHash) {
        throw new Error(`Memory proposal candidate "${candidate.key}" value hash mismatch.`);
    }
    const expectedOperation = expectedMemoryProposalOperation(candidate.base_hash, actualValueHash);
    if (candidate.operation !== expectedOperation) {
        throw new Error(
            `Memory proposal candidate "${candidate.key}" operation is inconsistent: expected ${expectedOperation}.`,
        );
    }
}

function assertCandidateConsistency(candidates: MemoryProposalCandidate[]): void {
    for (const candidate of candidates) assertMemoryProposalCandidateConsistency(candidate);
}

function assertConsolidationConsistency(body: MemoryProposalBody): void {
    if (body.schema_version !== 2) return;
    if (new Set(body.candidates.map(c => c.key)).size !== body.candidates.length) throw new Error('Duplicate consolidation memory key.');
    const sessions = new Set(body.source.sessions.map(s => s.session_id));
    for (const c of body.candidates) {
        if (!c.value.startsWith(`[${c.status}]\n`)) throw new Error('Consolidation status must remain explicit in ordinary memory.');
        if (c.evidence.some(e => !sessions.has(e.session_id))) throw new Error('Consolidation evidence refers to an unselected session.');
        if (c.preserve.some(p => !c.value.includes(p) || !c.evidence.some(e => e.quote.includes(p))))
            throw new Error('Consolidation literal preservation failed.');
    }
}

export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    return `{${Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
        .join(",")}}`;
}

export function digestValue(value: unknown): string {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function digestText(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

export function sealProposal(body: MemoryProposalBody): MemoryProposal {
    const parsed = memoryProposalBodySchema.parse(body);
    assertCandidateConsistency(parsed.candidates);
    assertConsolidationConsistency(parsed);
    return memoryProposalSchema.parse({ ...parsed, digest: digestValue(parsed) });
}

export function verifyProposal(value: unknown): MemoryProposal {
    const parsed = memoryProposalSchema.parse(value);
    const { digest, ...body } = parsed;
    if (digestValue(body) !== digest) throw new Error("Memory proposal digest mismatch.");
    assertCandidateConsistency(parsed.candidates);
    assertConsolidationConsistency(parsed);
    return parsed;
}
