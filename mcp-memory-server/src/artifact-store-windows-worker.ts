import { AgentFS } from "agentfs-sdk";

import type { ArtifactKind, ArtifactLimits, ArtifactNodeRef } from "./artifact-schema.js";
import {
    deleteArtifactForWindowsWorker,
    doctorArtifactStore,
    getArtifactDbPath,
    listArtifacts,
    pruneArtifactsForWindowsWorker,
    putArtifact,
    readArtifact,
    readLatestCompaction,
    recordUnsupportedCompactionAdapter,
} from "./artifact-store.js";

type Request = {
    operation: string;
    projectRoot: string;
    identifier?: string;
    candidate?: unknown;
    limits?: ArtifactLimits;
    options?: { dryRun?: boolean; includeProtected?: boolean; now?: string; fault?: "after-full-write" };
    filters?: { kind?: ArtifactKind; session_ref?: string; node_ref?: ArtifactNodeRef; limit?: number; cursor?: string };
    sessionRef?: string;
    repair?: boolean;
    diagnostic?: { harness?: string; harness_version?: string; reason?: string };
    action?: "list" | "get" | "set" | "delete";
    key?: string;
    prefix?: string;
    value?: unknown;
};

async function readRequest(): Promise<Request> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Request;
    if (!parsed || typeof parsed.operation !== "string" || typeof parsed.projectRoot !== "string") {
        throw new Error("Invalid Windows artifact worker request.");
    }
    return parsed;
}

function resolvedOptions(options: Request["options"] = {}) {
    const { now, ...rest } = options;
    return { ...rest, ...(now ? { now: new Date(now) } : {}) };
}

async function rawOperation(request: Request): Promise<unknown> {
    const agent = await AgentFS.open({ id: "artifacts", path: getArtifactDbPath(request.projectRoot) });
    try {
        if (request.action === "list") return await agent.kv.list(request.prefix ?? "");
        if (request.action === "get") return await agent.kv.get(request.key ?? "");
        if (request.action === "set") {
            await agent.kv.set(request.key ?? "", request.value);
            return null;
        }
        if (request.action === "delete") {
            await agent.kv.delete(request.key ?? "");
            return null;
        }
        throw new Error("Unsupported raw Windows artifact operation.");
    } finally {
        await agent.close();
    }
}

async function dispatch(request: Request): Promise<{ result: unknown; rewritePath?: string }> {
    const limits = request.limits;
    if (request.operation === "put" && limits) {
        return { result: await putArtifact(request.projectRoot, request.candidate, limits, resolvedOptions(request.options)) };
    }
    if (request.operation === "read" && request.identifier) {
        return { result: await readArtifact(request.identifier, request.projectRoot) };
    }
    if (request.operation === "list") {
        return { result: await listArtifacts(request.projectRoot, request.filters) };
    }
    if (request.operation === "latest") {
        return { result: await readLatestCompaction(request.projectRoot, request.sessionRef) };
    }
    if (request.operation === "delete" && request.identifier) {
        return deleteArtifactForWindowsWorker(request.identifier, request.projectRoot, request.options);
    }
    if (request.operation === "prune" && limits) {
        return pruneArtifactsForWindowsWorker(request.projectRoot, limits, resolvedOptions(request.options));
    }
    if (request.operation === "record-unsupported") {
        await recordUnsupportedCompactionAdapter(request.projectRoot, request.diagnostic);
        return { result: null };
    }
    if (request.operation === "doctor" && limits) {
        return { result: await doctorArtifactStore(request.projectRoot, request.repair, limits) };
    }
    if (request.operation === "raw") return { result: await rawOperation(request) };
    throw new Error("Unsupported Windows artifact worker operation.");
}

dispatch(await readRequest())
    .then((response) => process.stdout.write(JSON.stringify(response)))
    .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
