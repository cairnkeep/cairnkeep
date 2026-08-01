import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

import { isNoteDistillationEnabled } from "./note-schema.js";
import {
    CAPABILITY_IDS,
    type CapabilityId,
    type CapabilityKind,
} from "./capability-schema.js";

const MAX_COMPATIBILITY_CONFIG_BYTES = 64 * 1024;

export type CapabilityCompatibilityContext = {
    projectRoot: string;
    env: Record<string, string | undefined>;
    graphifyEnabled?: boolean;
};

export type CapabilityRegistryRow = {
    id: CapabilityId;
    kind: CapabilityKind;
    owner: string;
    environment: string;
    compatibility_default: boolean;
    restart_required: boolean;
    logging_policy: "final-callback";
    resolveCompatibility: (context: CapabilityCompatibilityContext) => boolean | Promise<boolean>;
};

function environmentName(id: CapabilityId): string {
    return `CAIRN_CAPABILITY_${id.toUpperCase().replaceAll(".", "_")}`;
}

export async function isGraphCapabilityCompatible(projectRoot: string): Promise<boolean> {
    const planningDirectory = join(projectRoot, ".planning");
    const configPath = join(planningDirectory, "config.json");
    try {
        const [directoryStat, fileStat] = await Promise.all([
            lstat(planningDirectory),
            lstat(configPath),
        ]);
        if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return false;
        if (fileStat.isSymbolicLink() || !fileStat.isFile()) return false;
        if (fileStat.size > MAX_COMPATIBILITY_CONFIG_BYTES) return false;

        const bytes = await readFile(configPath);
        if (bytes.byteLength > MAX_COMPATIBILITY_CONFIG_BYTES) return false;
        const parsed: unknown = JSON.parse(bytes.toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
        const graphify = (parsed as Record<string, unknown>).graphify;
        return Boolean(graphify && typeof graphify === "object" && !Array.isArray(graphify)
            && (graphify as Record<string, unknown>).enabled === true);
    } catch {
        return false;
    }
}

const alwaysEnabled = (): boolean => true;

export const CAPABILITY_REGISTRY: readonly CapabilityRegistryRow[] = [
    {
        id: "memory.write",
        kind: "mcp-tool",
        owner: "mcp-memory-server:index#memory_write",
        environment: environmentName("memory.write"),
        compatibility_default: true,
        restart_required: true,
        logging_policy: "final-callback",
        resolveCompatibility: alwaysEnabled,
    },
    {
        id: "memory.search",
        kind: "mcp-tool",
        owner: "mcp-memory-server:index#memory_search",
        environment: environmentName("memory.search"),
        compatibility_default: true,
        restart_required: true,
        logging_policy: "final-callback",
        resolveCompatibility: alwaysEnabled,
    },
    {
        id: "notes.distill",
        kind: "offline-job",
        owner: "mcp-memory-server:note-cli#distill",
        environment: environmentName("notes.distill"),
        compatibility_default: false,
        restart_required: false,
        logging_policy: "final-callback",
        resolveCompatibility: ({ env }) => isNoteDistillationEnabled(env.CAIRN_NOTE_DISTILLATION),
    },
    {
        id: "wiki",
        kind: "operating-workflow",
        owner: "operating-layer:wiki",
        environment: environmentName("wiki"),
        compatibility_default: true,
        restart_required: false,
        logging_policy: "final-callback",
        resolveCompatibility: alwaysEnabled,
    },
    {
        id: "graph",
        kind: "operating-workflow",
        owner: "operating-layer:graph",
        environment: environmentName("graph"),
        compatibility_default: false,
        restart_required: false,
        logging_policy: "final-callback",
        resolveCompatibility: ({ projectRoot, graphifyEnabled }) => graphifyEnabled ?? isGraphCapabilityCompatible(projectRoot),
    },
    {
        id: "security.audit",
        kind: "operating-workflow",
        owner: "operating-layer:security-audit",
        environment: environmentName("security.audit"),
        compatibility_default: true,
        restart_required: false,
        logging_policy: "final-callback",
        resolveCompatibility: alwaysEnabled,
    },
    {
        id: "route.check",
        kind: "mcp-tool",
        owner: "mcp-memory-server:index#route_check",
        environment: environmentName("route.check"),
        compatibility_default: true,
        restart_required: true,
        logging_policy: "final-callback",
        resolveCompatibility: alwaysEnabled,
    },
    {
        id: "context.explore",
        kind: "mcp-tool",
        owner: "mcp-memory-server:index#context_explore",
        environment: environmentName("context.explore"),
        compatibility_default: true,
        restart_required: true,
        logging_policy: "final-callback",
        resolveCompatibility: alwaysEnabled,
    },
] as const;

if (CAPABILITY_REGISTRY.length !== CAPABILITY_IDS.length
    || CAPABILITY_REGISTRY.some((row, index) => row.id !== CAPABILITY_IDS[index])) {
    throw new Error("Capability registry order does not match the canonical capability IDs.");
}
