import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
    chmod,
    lstat,
    mkdir,
    open,
    rename,
    rm,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { CAPABILITY_REGISTRY } from "./capability-registry.js";
import {
    CAPABILITY_IDS,
    CAPABILITY_SCHEMA_VERSION,
    capabilityIdSchema,
    capabilityManagedConfigSchema,
    capabilityStatusSchema,
    type CapabilityId,
    type CapabilityIssue,
    type CapabilityManagedConfig,
    type CapabilitySource,
    type CapabilityStatus,
} from "./capability-schema.js";

const MAX_CONFIG_BYTES = 64 * 1024;
const LOCK_WAIT_MS = 10;
const LOCK_ATTEMPTS = 200;
const truthyPattern = /^(?:1|true|yes|on)$/i;
const falsyPattern = /^(?:0|false|no|off)$/i;

type Environment = Record<string, string | undefined>;

type ReadConfig = {
    schema_version: typeof CAPABILITY_SCHEMA_VERSION;
    capabilities: Partial<Record<CapabilityId, boolean>>;
    logging: { callbacks?: boolean };
};

export type CapabilityConfigReadResult = {
    config: ReadConfig;
    issues: CapabilityIssue[];
};

export type ResolveCapabilityStatusOptions = {
    projectRoot?: string;
    env?: Environment;
    graphifyEnabled?: boolean;
};

type MutationOptions = {
    projectRoot?: string;
};

type CapabilityOverrideMutation = MutationOptions & {
    id: CapabilityId;
    enabled: boolean;
};

type CapabilityOverrideReset = MutationOptions & {
    id: CapabilityId | "all";
};

type CapabilityLoggingMutation = MutationOptions & {
    enabled: boolean;
};

function emptyConfig(): ReadConfig {
    return {
        schema_version: CAPABILITY_SCHEMA_VERSION,
        capabilities: {},
        logging: {},
    };
}

function configPaths(projectRoot: string): {
    root: string;
    directory: string;
    config: string;
    lock: string;
} {
    if (typeof projectRoot !== "string" || projectRoot.length === 0) {
        throw new Error("A project root is required.");
    }
    const root = resolve(projectRoot);
    const directory = join(root, ".ai");
    const config = join(directory, "capabilities.json");
    const lock = join(directory, ".capabilities.lock");
    if (dirname(directory) !== root || dirname(config) !== directory || dirname(lock) !== directory) {
        throw new Error("Capability configuration path is outside the project root.");
    }
    return { root, directory, config, lock };
}

async function assertSafeDirectory(directory: string, create: boolean): Promise<void> {
    try {
        const value = await lstat(directory);
        if (!value.isDirectory() || value.isSymbolicLink()) {
            throw new Error("Capability configuration directory is unsafe.");
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (!create) return;
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const value = await lstat(directory);
        if (!value.isDirectory() || value.isSymbolicLink()) {
            throw new Error("Capability configuration directory is unsafe.");
        }
    }
}

async function readBoundedConfig(path: string): Promise<Buffer | undefined> {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_CONFIG_BYTES) {
            throw new Error("Capability configuration is invalid.");
        }
        const bytes = await handle.readFile();
        if (bytes.byteLength > MAX_CONFIG_BYTES) {
            throw new Error("Capability configuration is invalid.");
        }
        return bytes;
    } finally {
        await handle.close();
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseConfig(value: unknown): CapabilityConfigReadResult {
    const config = emptyConfig();
    const issues: CapabilityIssue[] = [];
    if (!isRecord(value)
        || value.schema_version !== CAPABILITY_SCHEMA_VERSION
        || !isRecord(value.capabilities)
        || !isRecord(value.logging)
        || Object.keys(value).some((key) => !["schema_version", "capabilities", "logging"].includes(key))) {
        return { config, issues: [{ code: "invalid-config" }] };
    }

    for (const [id, raw] of Object.entries(value.capabilities)) {
        const parsedId = capabilityIdSchema.safeParse(id);
        if (!parsedId.success) {
            issues.push({ code: "unknown-capability" });
        } else if (typeof raw !== "boolean") {
            issues.push({ code: "invalid-capability-value", capability_id: parsedId.data });
        } else {
            config.capabilities[parsedId.data] = raw;
        }
    }

    const loggingKeys = Object.keys(value.logging);
    if (loggingKeys.some((key) => key !== "callbacks")
        || (Object.hasOwn(value.logging, "callbacks") && typeof value.logging.callbacks !== "boolean")) {
        issues.push({ code: "invalid-logging-value", setting: "logging.callbacks" });
    } else if (typeof value.logging.callbacks === "boolean") {
        config.logging.callbacks = value.logging.callbacks;
    }
    return { config, issues };
}

export function isCapabilityContractEnabled(
    value = process.env.CAIRN_CAPABILITY_CONTRACT,
): boolean {
    return truthyPattern.test(value?.trim() ?? "");
}

export async function readCapabilityConfig(
    options: { projectRoot?: string } = {},
): Promise<CapabilityConfigReadResult> {
    const { directory, config: configPath } = configPaths(options.projectRoot ?? process.cwd());
    try {
        await assertSafeDirectory(directory, false);
        try {
            const info = await lstat(configPath);
            if (info.isSymbolicLink() || !info.isFile()) {
                return { config: emptyConfig(), issues: [{ code: "invalid-config" }] };
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return { config: emptyConfig(), issues: [] };
            }
            throw error;
        }
        const bytes = await readBoundedConfig(configPath);
        if (!bytes) return { config: emptyConfig(), issues: [] };
        return parseConfig(JSON.parse(bytes.toString("utf8")) as unknown);
    } catch {
        return { config: emptyConfig(), issues: [{ code: "invalid-config" }] };
    }
}

function parseEnvironmentBoolean(value: string | undefined): boolean | undefined | null {
    if (value === undefined) return undefined;
    const normalized = value.trim();
    if (truthyPattern.test(normalized)) return true;
    if (falsyPattern.test(normalized)) return false;
    return null;
}

async function resolveBoolean(
    environmentValue: string | undefined,
    projectHasValue: boolean,
    projectValue: boolean | undefined,
    compatibility: () => boolean | Promise<boolean>,
    invalidIssue: CapabilityIssue,
    issues: CapabilityIssue[],
): Promise<{ enabled: boolean; source: CapabilitySource }> {
    const parsedEnvironment = parseEnvironmentBoolean(environmentValue);
    if (parsedEnvironment === null) {
        issues.push(invalidIssue);
        return { enabled: await compatibility(), source: "compatibility" };
    }
    if (parsedEnvironment !== undefined) {
        return { enabled: parsedEnvironment, source: "environment" };
    }
    if (projectHasValue) {
        return { enabled: projectValue as boolean, source: "project" };
    }
    return { enabled: await compatibility(), source: "compatibility" };
}

export async function resolveCapabilityStatus(
    options: ResolveCapabilityStatusOptions = {},
): Promise<CapabilityStatus> {
    const projectRoot = options.projectRoot ?? process.cwd();
    const env = options.env ?? process.env;
    const contractEnabled = isCapabilityContractEnabled(env.CAIRN_CAPABILITY_CONTRACT);
    const { config, issues } = await readCapabilityConfig({ projectRoot });

    const capabilities = [];
    for (const row of CAPABILITY_REGISTRY) {
        const state = await resolveBoolean(
            env[row.environment],
            Object.hasOwn(config.capabilities, row.id),
            config.capabilities[row.id],
            () => row.resolveCompatibility({ projectRoot, env, graphifyEnabled: options.graphifyEnabled }),
            { code: "invalid-capability-value", capability_id: row.id },
            issues,
        );
        capabilities.push({
            id: row.id,
            kind: row.kind,
            enabled: state.enabled,
            source: state.source,
            restart_required: row.restart_required,
        });
    }

    const logging = await resolveBoolean(
        env.CAIRN_CAPABILITY_LOGGING,
        Object.hasOwn(config.logging, "callbacks"),
        config.logging.callbacks,
        () => false,
        { code: "invalid-logging-value", setting: "logging.callbacks" },
        issues,
    );
    const digestInput = {
        schema_version: CAPABILITY_SCHEMA_VERSION,
        contract_enabled: contractEnabled,
        capabilities: capabilities.map(({ id, enabled }) => ({ id, enabled })),
        logging: { callbacks: logging.enabled },
    };
    const configurationDigest = createHash("sha256")
        .update(JSON.stringify(digestInput), "utf8")
        .digest("hex");

    return capabilityStatusSchema.parse({
        schema_version: CAPABILITY_SCHEMA_VERSION,
        contract_enabled: contractEnabled,
        logging,
        configuration_digest: configurationDigest,
        capabilities,
        issues,
    });
}

function orderedConfig(config: ReadConfig): CapabilityManagedConfig {
    const capabilities: Partial<Record<CapabilityId, boolean>> = {};
    for (const id of CAPABILITY_IDS) {
        if (Object.hasOwn(config.capabilities, id)) capabilities[id] = config.capabilities[id];
    }
    return capabilityManagedConfigSchema.parse({
        schema_version: CAPABILITY_SCHEMA_VERSION,
        capabilities,
        logging: Object.hasOwn(config.logging, "callbacks")
            ? { callbacks: config.logging.callbacks }
            : {},
    });
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
        try {
            await mkdir(lockPath, { mode: 0o700 });
            return () => rm(lockPath, { recursive: true, force: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            const info = await lstat(lockPath);
            if (info.isSymbolicLink() || !info.isDirectory()) {
                throw new Error("Capability configuration lock is unsafe.");
            }
            await delay(LOCK_WAIT_MS);
        }
    }
    throw new Error("Capability configuration is locked; retry after the active update finishes.");
}

function requireCapabilityId(value: unknown): CapabilityId {
    const parsed = capabilityIdSchema.safeParse(value);
    if (!parsed.success) throw new Error("Unknown capability ID.");
    return parsed.data;
}

async function atomicWriteConfig(path: string, config: ReadConfig): Promise<void> {
    const parsed = orderedConfig(config);
    const bytes = `${JSON.stringify(parsed, null, 2)}\n`;
    const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    let handle;
    try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(bytes, { encoding: "utf8" });
        await handle.sync();
        await handle.close();
        handle = undefined;
        await chmod(temporary, 0o600);
        await rename(temporary, path);
        await chmod(path, 0o600);
    } finally {
        if (handle) await handle.close().catch(() => undefined);
        await rm(temporary, { force: true });
    }
}

async function mutateConfig(
    projectRoot: string,
    mutate: (config: ReadConfig) => void,
): Promise<CapabilityManagedConfig> {
    const { directory, config: configPath, lock } = configPaths(projectRoot);
    await assertSafeDirectory(directory, true);
    const release = await acquireLock(lock);
    try {
        const current = await readCapabilityConfig({ projectRoot });
        mutate(current.config);
        await atomicWriteConfig(configPath, current.config);
        return orderedConfig(current.config);
    } finally {
        await release();
    }
}

export async function setCapabilityOverride(
    options: CapabilityOverrideMutation,
): Promise<CapabilityManagedConfig> {
    const id = requireCapabilityId(options.id);
    if (typeof options.enabled !== "boolean") throw new Error("Capability state must be boolean.");
    const projectRoot = options.projectRoot ?? process.cwd();
    return mutateConfig(projectRoot, (config) => {
        config.capabilities[id] = options.enabled;
    });
}

export async function resetCapabilityOverride(
    options: CapabilityOverrideReset,
): Promise<CapabilityManagedConfig> {
    if (options.id !== "all") requireCapabilityId(options.id);
    const projectRoot = options.projectRoot ?? process.cwd();
    return mutateConfig(projectRoot, (config) => {
        if (options.id === "all") {
            config.capabilities = {};
            config.logging = {};
        } else {
            delete config.capabilities[options.id];
        }
    });
}

export async function setCapabilityLogging(
    options: CapabilityLoggingMutation,
): Promise<CapabilityManagedConfig> {
    if (typeof options.enabled !== "boolean") throw new Error("Capability logging state must be boolean.");
    const projectRoot = options.projectRoot ?? process.cwd();
    return mutateConfig(projectRoot, (config) => {
        config.logging.callbacks = options.enabled;
    });
}

export async function resetCapabilityLogging(
    options: MutationOptions = {},
): Promise<CapabilityManagedConfig> {
    const projectRoot = options.projectRoot ?? process.cwd();
    return mutateConfig(projectRoot, (config) => {
        delete config.logging.callbacks;
    });
}
