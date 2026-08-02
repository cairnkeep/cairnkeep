#!/usr/bin/env node
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { resolveCapabilityStatus } from "./capability-config.js";
import { isGraphCapabilityCompatible } from "./capability-registry.js";

const INSPECTION_TIMEOUT_MS = 30_000;
const BUILD_TIMEOUT_MS = 300_000;
const MAX_GRAPH_BYTES = 256 * 1024 * 1024;
const MAX_AUXILIARY_BYTES = 64 * 1024 * 1024;
const MAX_SUBPROCESS_OUTPUT_BYTES = 16 * 1024 * 1024;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

type GraphRecord = Record<string, unknown> & {
    nodes: unknown[];
    edges?: unknown[];
    links?: unknown[];
    hyperedges?: unknown[];
};

function usage(): string {
    return `cairn graph — build and inspect the optional local Graphify graph

Usage:
  cairn graph build [--force]
  cairn graph query <term>
  cairn graph status
  cairn graph diff
  cairn graph explain <symbol>
  cairn graph path <from> <to>
`;
}

function graphEdges(graph: GraphRecord): unknown[] {
    return Array.isArray(graph.edges) ? graph.edges : Array.isArray(graph.links) ? graph.links : [];
}

function graphHyperedges(graph: GraphRecord): unknown[] {
    return Array.isArray(graph.hyperedges) ? graph.hyperedges : [];
}

function plural(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

async function readBoundedFile(path: string, maximumBytes: number): Promise<Buffer> {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maximumBytes) {
        throw new Error("graph artifact is missing, unsafe, or too large.");
    }
    const bytes = await readFile(path);
    if (bytes.byteLength > maximumBytes) throw new Error("graph artifact is too large.");
    return bytes;
}

function parseGraph(bytes: Buffer): GraphRecord {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("graph.json is not a JSON object.");
    }
    const graph = value as GraphRecord;
    if (!Array.isArray(graph.nodes)
        || (!Array.isArray(graph.edges) && !Array.isArray(graph.links))) {
        throw new Error("graph.json is missing its node or edge arrays.");
    }
    return graph;
}

async function readGraph(path: string): Promise<GraphRecord> {
    try {
        return parseGraph(await readBoundedFile(path, MAX_GRAPH_BYTES));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error("no published graph found; run /graphify build first.");
        }
        throw error;
    }
}

function publishedGraphPath(projectRoot: string): string {
    return join(projectRoot, ".planning", "graphs", "graph.json");
}

async function requireGraphCapability(projectRoot: string): Promise<void> {
    const status = await resolveCapabilityStatus({ projectRoot });
    const graph = status.capabilities.find(({ id }) => id === "graph");
    const enabled = status.contract_enabled
        ? graph?.enabled === true
        : await isGraphCapabilityCompatible(projectRoot);
    if (!enabled) {
        throw new Error("graph capability is disabled; use `cairn capabilities enable graph` with the managed contract, or enable `graphify.enabled` in .planning/config.json.");
    }
}

function graphifyEnvironment(): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = { PYTHONUNBUFFERED: "1" };
    for (const name of [
        "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL",
        "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "VIRTUAL_ENV", "PYTHONPATH",
    ]) {
        if (process.env[name] !== undefined) environment[name] = process.env[name];
    }
    return environment;
}

function executeGraphify(
    projectRoot: string,
    args: string[],
    timeout: number,
): SpawnSyncReturns<string> {
    const result = spawnSync("graphify", args, {
        cwd: projectRoot,
        encoding: "utf8",
        shell: false,
        timeout,
        maxBuffer: MAX_SUBPROCESS_OUTPUT_BYTES,
        env: graphifyEnvironment(),
    });

    if (result.error) {
        const code = (result.error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
            throw new Error("Graphify CLI not found; install it with `uv tool install graphifyy` (or `pipx install graphifyy`).");
        }
        if (code === "ETIMEDOUT") throw new Error(`Graphify timed out after ${Math.round(timeout / 1000)} seconds.`);
        if (code === "ENOBUFS") throw new Error("Graphify exceeded the 16 MiB subprocess-output limit.");
        throw new Error("Graphify could not start.");
    }
    if (result.signal) throw new Error("Graphify terminated before completion.");
    return result;
}

function forwardResult(result: SpawnSyncReturns<string>): boolean {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status === 0) return true;
    process.exitCode = result.status ?? 1;
    return false;
}

async function ensureSafeDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("graph directory is unsafe.");
}

async function ensureSafeGraphBoundary(projectRoot: string, createGraphs: boolean): Promise<void> {
    const planningDirectory = join(projectRoot, ".planning");
    let planningInfo;
    try {
        planningInfo = await lstat(planningDirectory);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error("planning directory not found; run `cairn bootstrap` first.");
        }
        throw error;
    }
    if (!planningInfo.isDirectory() || planningInfo.isSymbolicLink()) {
        throw new Error("planning directory is unsafe.");
    }
    const graphsDirectory = join(planningDirectory, "graphs");
    try {
        const graphsInfo = await lstat(graphsDirectory);
        if (!graphsInfo.isDirectory() || graphsInfo.isSymbolicLink()) {
            throw new Error("graph directory is unsafe.");
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (createGraphs) await ensureSafeDirectory(graphsDirectory);
    }
}

async function atomicWrite(path: string, bytes: Buffer | string): Promise<void> {
    const temporary = join(
        dirname(path),
        `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
    );
    try {
        await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
    } finally {
        await rm(temporary, { force: true });
    }
}

async function publishOptional(source: string, destination: string): Promise<boolean> {
    try {
        await atomicWrite(destination, await readBoundedFile(source, MAX_AUXILIARY_BYTES));
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await rm(destination, { force: true });
        return false;
    }
}

async function isolatePublishedArtifacts(projectRoot: string): Promise<{
    previousGraph?: GraphRecord;
    finish: (keepNewArtifact: boolean) => Promise<void>;
}> {
    const directory = join(projectRoot, ".planning", "graphs");
    const managedPaths = [
        join(directory, "graph.json"),
        join(directory, "graph.html"),
        join(directory, "GRAPH_REPORT.md"),
        join(directory, ".last-build-snapshot.json"),
    ];
    const saved = new Map<string, Buffer>();
    try {
        for (const [destination, maximumBytes] of [
            [managedPaths[0], MAX_GRAPH_BYTES],
            [managedPaths[1], MAX_AUXILIARY_BYTES],
            [managedPaths[2], MAX_AUXILIARY_BYTES],
            [managedPaths[3], MAX_GRAPH_BYTES],
        ] as const) {
            try {
                saved.set(destination, await readBoundedFile(destination, maximumBytes));
                await rm(destination);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
        }
        const previousBytes = saved.get(join(directory, "graph.json"));
        const previousGraph = previousBytes ? parseGraph(previousBytes) : undefined;
        return {
            previousGraph,
            finish: async (keepNewArtifact: boolean) => {
                if (!keepNewArtifact) {
                    for (const path of managedPaths) await rm(path, { force: true });
                    for (const [path, bytes] of saved) await atomicWrite(path, bytes);
                }
            },
        };
    } catch (error) {
        for (const [path, bytes] of saved) await atomicWrite(path, bytes);
        throw error;
    }
}

async function buildGraph(projectRoot: string, force: boolean): Promise<void> {
    const outputDirectory = join(projectRoot, "graphify-out");
    try {
        const info = await lstat(outputDirectory);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Graphify output directory is unsafe.");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const isolatedArtifacts = await isolatePublishedArtifacts(projectRoot);
    let published = false;
    try {
        const result = executeGraphify(projectRoot, ["update", ".", ...(force ? ["--force"] : [])], BUILD_TIMEOUT_MS);
        if (result.status !== 0) {
            forwardResult(result);
            return;
        }
        if (result.stderr) process.stderr.write(result.stderr);

        const sourceGraphPath = join(outputDirectory, "graph.json");
        const sourceGraphBytes = await readBoundedFile(sourceGraphPath, MAX_GRAPH_BYTES);
        const sourceGraph = parseGraph(sourceGraphBytes);
        const graphsDirectory = join(projectRoot, ".planning", "graphs");
        await ensureSafeDirectory(graphsDirectory);

        const destinationGraphPath = publishedGraphPath(projectRoot);
        if (isolatedArtifacts.previousGraph) {
            const previous = isolatedArtifacts.previousGraph;
            await atomicWrite(join(graphsDirectory, ".last-build-snapshot.json"), `${JSON.stringify({
                version: 1,
                timestamp: new Date().toISOString(),
                nodes: previous.nodes,
                edges: graphEdges(previous),
            }, null, 2)}\n`);
        }

        await atomicWrite(destinationGraphPath, sourceGraphBytes);
        const publishedNames = ["graph.json"];
        for (const name of ["graph.html", "GRAPH_REPORT.md"]) {
            if (await publishOptional(join(outputDirectory, name), join(graphsDirectory, name))) publishedNames.push(name);
        }
        published = true;

        process.stdout.write(
            `Built local code graph: ${plural(sourceGraph.nodes.length, "node")}, ${plural(graphEdges(sourceGraph).length, "edge")}, ${plural(graphHyperedges(sourceGraph).length, "hyperedge")}.\n`
            + `Published: ${publishedNames.join(", ")} in .planning/graphs/.\n`,
        );
    } finally {
        await isolatedArtifacts.finish(published);
    }
}

async function showStatus(projectRoot: string): Promise<void> {
    const path = publishedGraphPath(projectRoot);
    const [graph, info] = await Promise.all([readGraph(path), lstat(path)]);
    const ageMs = Math.max(0, Date.now() - info.mtimeMs);
    process.stdout.write(
        `Graph: ${plural(graph.nodes.length, "node")}, ${plural(graphEdges(graph).length, "edge")}, ${plural(graphHyperedges(graph).length, "hyperedge")}.\n`
        + `Freshness: ${ageMs > STALE_AFTER_MS ? "STALE" : "FRESH"}; built ${new Date(info.mtimeMs).toISOString()}.\n`,
    );
}

function keyedNodes(graph: GraphRecord): Map<string, unknown> {
    return new Map(graph.nodes.flatMap((node) => {
        if (!node || typeof node !== "object" || Array.isArray(node)) return [];
        const id = (node as Record<string, unknown>).id;
        return typeof id === "string" ? [[id, node] as const] : [];
    }));
}

function keyedEdges(graph: GraphRecord): Map<string, unknown> {
    return new Map(graphEdges(graph).flatMap((edge) => {
        if (!edge || typeof edge !== "object" || Array.isArray(edge)) return [];
        const row = edge as Record<string, unknown>;
        if (typeof row.source !== "string" || typeof row.target !== "string") return [];
        return [[`${row.source}\u0000${row.target}\u0000${String(row.relation ?? row.label ?? "")}`, edge] as const];
    }));
}

function delta(current: Map<string, unknown>, previous: Map<string, unknown>) {
    let added = 0;
    let removed = 0;
    let changed = 0;
    for (const [key, value] of current) {
        if (!previous.has(key)) added += 1;
        else if (JSON.stringify(previous.get(key)) !== JSON.stringify(value)) changed += 1;
    }
    for (const key of previous.keys()) if (!current.has(key)) removed += 1;
    return { added, removed, changed };
}

async function showDiff(projectRoot: string): Promise<void> {
    const current = await readGraph(publishedGraphPath(projectRoot));
    const snapshotPath = join(projectRoot, ".planning", "graphs", ".last-build-snapshot.json");
    let previous: GraphRecord;
    try {
        previous = await readGraph(snapshotPath);
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("no published graph found")) {
            throw new Error("no previous graph snapshot found; run /graphify build again after a code change.");
        }
        throw error;
    }
    const nodes = delta(keyedNodes(current), keyedNodes(previous));
    const edges = delta(keyedEdges(current), keyedEdges(previous));
    process.stdout.write(
        `Nodes: ${nodes.added} added, ${nodes.removed} removed, ${nodes.changed} changed.\n`
        + `Edges: ${edges.added} added, ${edges.removed} removed, ${edges.changed} changed.\n`,
    );
}

function validInspectionArguments(command: string, args: string[]): boolean {
    const expected = command === "path" ? 2 : 1;
    return args.length === expected
        && args.every((value) => value.length > 0 && value.length <= 1024 && !value.startsWith("-"));
}

async function main(): Promise<void> {
    const [command = "help", ...args] = process.argv.slice(2);
    if (command === "help" || command === "--help" || command === "-h") {
        process.stdout.write(usage());
        return;
    }

    const valid = (command === "build" && (args.length === 0 || (args.length === 1 && args[0] === "--force")))
        || ((command === "status" || command === "diff") && args.length === 0)
        || (["query", "explain", "path"].includes(command) && validInspectionArguments(command, args));
    if (!valid) {
        process.stderr.write(usage());
        process.exitCode = 2;
        return;
    }

    try {
        const projectRoot = resolve(process.cwd());
        await requireGraphCapability(projectRoot);
        await ensureSafeGraphBoundary(projectRoot, command === "build");
        if (command === "build") {
            await buildGraph(projectRoot, args[0] === "--force");
            return;
        }
        if (command === "status") {
            await showStatus(projectRoot);
            return;
        }
        if (command === "diff") {
            await showDiff(projectRoot);
            return;
        }

        await readGraph(publishedGraphPath(projectRoot));
        const result = executeGraphify(
            projectRoot,
            [command, ...args, "--graph", publishedGraphPath(projectRoot)],
            INSPECTION_TIMEOUT_MS,
        );
        forwardResult(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : "operation failed.";
        process.stderr.write(`cairn graph: ${message}\n`);
        process.exitCode = 1;
    }
}

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
});

await main();
