import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, lstatSync, openSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { MCP_TOOL_CATALOG, MCP_TOOL_NAMES, isCairnToolName, type CairnToolName } from "./mcp-tool-catalog.js";
import { atomicReplace, hardenPrivatePath, privatePathIsSafe } from "./platform-security.js";

export type McpToolProfileMode = "full" | "read-only" | "custom";
export type McpToolProfileConfig = {
    schema_version: 1;
    mode: McpToolProfileMode;
    allowed_tools: CairnToolName[];
};
export type McpToolProfileStatus = McpToolProfileConfig & {
    source: "environment" | "project" | "default";
    profile_digest: string;
    project_root: string;
    config_path: string;
    issues: string[];
};

const MAX_CONFIG_BYTES = 64 * 1024;

function paths(projectRoot: string): { root: string; directory: string; config: string } {
    const root = resolve(projectRoot);
    const directory = join(root, ".ai");
    const config = join(directory, "mcp-tools.json");
    if (dirname(directory) !== root || dirname(config) !== directory) throw new Error("MCP tool profile path is unsafe.");
    return { root, directory, config };
}

function exactAllowed(mode: McpToolProfileMode, requested: readonly string[]): CairnToolName[] {
    if (mode === "full") return [...MCP_TOOL_NAMES];
    if (mode === "read-only") {
        return MCP_TOOL_NAMES.filter((name) => MCP_TOOL_CATALOG[name].annotations.readOnlyHint);
    }
    const unknown = requested.filter((name) => !isCairnToolName(name));
    if (unknown.length) throw new Error(`Unknown MCP tool name${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
    if (requested.length === 0) throw new Error("A custom MCP tool profile requires at least one allowed tool.");
    const selected = new Set(requested as CairnToolName[]);
    return MCP_TOOL_NAMES.filter((name) => selected.has(name));
}

function canonicalProfile(mode: McpToolProfileMode, allowed: readonly string[]): McpToolProfileConfig {
    return { schema_version: 1, mode, allowed_tools: exactAllowed(mode, allowed) };
}

function storedProfile(mode: McpToolProfileMode, allowed: readonly string[]): McpToolProfileConfig {
    const effective = exactAllowed(mode, allowed);
    return { schema_version: 1, mode, allowed_tools: mode === "custom" ? effective : [] };
}

export function mcpToolProfileDigest(config: McpToolProfileConfig): string {
    return createHash("sha256").update(JSON.stringify(config), "utf8").digest("hex");
}

function parseConfig(value: unknown): McpToolProfileConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid MCP tool profile configuration.");
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["schema_version", "mode", "allowed_tools"].includes(key))
        || row.schema_version !== 1
        || !["full", "read-only", "custom"].includes(String(row.mode))
        || !Array.isArray(row.allowed_tools)
        || row.allowed_tools.some((name) => typeof name !== "string")) {
        throw new Error("Invalid MCP tool profile configuration.");
    }
    const mode = row.mode as McpToolProfileMode;
    const requested = row.allowed_tools as string[];
    const canonical = storedProfile(mode, requested);
    if (mode !== "custom" && requested.length > 0) throw new Error("Only custom MCP tool profiles may contain allowed_tools.");
    if (mode === "custom" && new Set(requested).size !== requested.length) throw new Error("Duplicate MCP tool names are not allowed.");
    return canonical;
}

function readProjectConfig(projectRoot: string): McpToolProfileConfig | undefined {
    const { directory, config } = paths(projectRoot);
    if (!existsSync(config)) return undefined;
    const dirInfo = lstatSync(directory);
    const info = lstatSync(config);
    if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink() || !info.isFile() || info.isSymbolicLink()
        || info.size > MAX_CONFIG_BYTES || !privatePathIsSafe(config)) {
        throw new Error("MCP tool profile configuration is unsafe.");
    }
    const fd = requireNoFollow(config);
    try {
        const bytes = readFileSync(fd);
        if (bytes.byteLength > MAX_CONFIG_BYTES) throw new Error("MCP tool profile configuration is too large.");
        return parseConfig(JSON.parse(bytes.toString("utf8")) as unknown);
    } finally {
        // readFileSync does not own numeric descriptors.
        closeSync(fd);
    }
}

function requireNoFollow(path: string): number {
    return openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
}

function environmentConfig(env: NodeJS.ProcessEnv): McpToolProfileConfig | undefined {
    const rawMode = env.CAIRN_MCP_TOOL_PROFILE?.trim();
    if (!rawMode) return undefined;
    if (!["full", "read-only", "custom"].includes(rawMode)) throw new Error("CAIRN_MCP_TOOL_PROFILE must be full, read-only, or custom.");
    const allowed = (env.CAIRN_MCP_ALLOWED_TOOLS ?? "").split(",").map((name) => name.trim()).filter(Boolean);
    if (rawMode !== "custom" && allowed.length) throw new Error("CAIRN_MCP_ALLOWED_TOOLS is valid only with the custom profile.");
    return storedProfile(rawMode as McpToolProfileMode, allowed);
}

export function resolveMcpToolProfile(options: { projectRoot?: string; env?: NodeJS.ProcessEnv } = {}): McpToolProfileStatus {
    const projectRoot = options.projectRoot ?? process.cwd();
    const env = options.env ?? process.env;
    const { root, config } = paths(projectRoot);
    const environment = environmentConfig(env);
    const project = environment ? undefined : readProjectConfig(root);
    const source = environment ? "environment" : project ? "project" : "default";
    const selected = environment ?? project ?? storedProfile("full", []);
    const effective = canonicalProfile(selected.mode, selected.allowed_tools);
    return { ...effective, source, profile_digest: mcpToolProfileDigest(effective), project_root: root, config_path: config, issues: [] };
}

async function atomicWrite(path: string, value: McpToolProfileConfig): Promise<void> {
    if (existsSync(dirname(path))) {
        const existingDirectory = lstatSync(dirname(path));
        if (!existingDirectory.isDirectory() || existingDirectory.isSymbolicLink()) throw new Error("MCP tool profile directory is unsafe.");
    } else {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    }
    const directoryInfo = lstatSync(dirname(path));
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error("MCP tool profile directory is unsafe.");
    if (existsSync(path)) {
        const existing = lstatSync(path);
        if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("MCP tool profile configuration is unsafe.");
    }
    const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    let handle;
    try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await chmod(temporary, 0o600);
        hardenPrivatePath(temporary);
        await atomicReplace(temporary, path);
        hardenPrivatePath(path);
    } finally {
        if (handle) await handle.close().catch(() => undefined);
        await rm(temporary, { force: true });
    }
}

export async function setMcpToolProfile(options: { projectRoot?: string; mode: McpToolProfileMode; allowedTools?: string[] }): Promise<McpToolProfileStatus> {
    const { root, config } = paths(options.projectRoot ?? process.cwd());
    const value = storedProfile(options.mode, options.allowedTools ?? []);
    await atomicWrite(config, value);
    return resolveMcpToolProfile({ projectRoot: root, env: {} });
}

export async function resetMcpToolProfile(projectRoot = process.cwd()): Promise<void> {
    const { config } = paths(projectRoot);
    if (!existsSync(config)) return;
    const info = lstatSync(config);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("MCP tool profile configuration is unsafe.");
    rmSync(config);
}

export function profileAllowsTool(status: McpToolProfileStatus, name: string): boolean {
    return status.allowed_tools.includes(name as CairnToolName);
}

export function canonicalProjectRoot(projectRoot: string): string {
    const resolved = resolve(projectRoot);
    return existsSync(resolved) ? realpathSync(resolved) : resolved;
}
