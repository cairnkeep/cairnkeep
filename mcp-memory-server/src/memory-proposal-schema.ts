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

export const memoryProposalBodySchema = z.object({
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

export const memoryProposalSchema = memoryProposalBodySchema.extend({ digest: digestSchema }).strict();
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
    return memoryProposalSchema.parse({ ...parsed, digest: digestValue(parsed) });
}

export function verifyProposal(value: unknown): MemoryProposal {
    const parsed = memoryProposalSchema.parse(value);
    const { digest, ...body } = parsed;
    if (digestValue(body) !== digest) throw new Error("Memory proposal digest mismatch.");
    assertCandidateConsistency(parsed.candidates);
    return parsed;
}
