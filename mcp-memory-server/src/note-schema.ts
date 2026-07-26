export {
    NODE_SCHEMA_VERSION as NOTE_SCHEMA_VERSION,
    failureFrameSchema,
    failureLookupKeysSchema,
    failureSignatureSchema,
    noteEnrichmentContentSchema,
    noteNodeSchema,
    noteOccurrenceSchema,
    type FailureFrame,
    type FailureSignature,
    type NoteEnrichmentContent,
    type NoteNode,
    type NoteOccurrence,
} from "./node-schema.js";

export function isNoteDistillationEnabled(value = process.env.CAIRN_NOTE_DISTILLATION): boolean {
    return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}
