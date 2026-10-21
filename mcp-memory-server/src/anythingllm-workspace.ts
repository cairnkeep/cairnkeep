import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { readStableJson } from "./stable-file.js";

/**
 * Resolution of the default AnythingLLM workspace.
 *
 * Previously the default was simply the first configured workspace that was not
 * `engineering-patterns`. That is correct only when a machine holds one project:
 * with several checkouts sharing one global memory config, every repository
 * resolved to the same workspace, and a query made from the wrong repository
 * answered "there is no relevant information" rather than reporting that it had
 * searched somewhere unrelated.
 *
 * `anythingllm-projects.json` already maps an absolute project `path` to the
 * workspace `slug` that the bundled sync script embeds into, so this reuses that
 * mapping instead of inventing a second convention or guessing a slug from the
 * directory name. Guessing would be unsafe for `domain_knowledge_sync`, which
 * writes: an unmatched guess could embed documents into the wrong workspace.
 */

/** Subset of the memory config this module needs; avoids a cycle with index.ts. */
export type WorkspaceConfig = { anythingllm_workspaces?: string[] };

type ProjectEntry = { slug?: unknown; path?: unknown };

/** Shared workspace that is never a project default; it holds cross-project patterns. */
const SHARED_WORKSPACE = "engineering-patterns";
const WORKSPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_MAPPING_BYTES = 1024 * 1024;
const MAX_PROJECTS = 4096;

function expandHome(value: string): string {
    if (value === "~") return homedir();
    if (value.startsWith("~/")) return join(homedir(), value.slice(2));
    return value;
}

/**
 * Locate `anythingllm-projects.json`.
 *
 * Mirrors the precedence in `examples/anythingllm/sync_to_anythingllm.py` so the
 * resolver and the sync script can never disagree about which mapping is live.
 */
export function anythingllmProjectsFile(
    env: NodeJS.ProcessEnv = process.env,
    legacyDir?: string,
): string | undefined {
    const override = env.CAIRN_ANYTHINGLLM_PROJECTS_FILE;
    if (override) {
        const explicit = resolve(expandHome(override));
        return existsSync(explicit) ? explicit : undefined;
    }

    if (legacyDir) {
        const legacy = join(legacyDir, "anythingllm-projects.json");
        if (existsSync(legacy)) return legacy;
    }
    const configHome = env.XDG_CONFIG_HOME
        ? resolve(expandHome(env.XDG_CONFIG_HOME))
        : join(homedir(), ".config");
    const standard = join(configHome, "cairnkeep", "anythingllm-projects.json");
    if (existsSync(standard)) return standard;
    return undefined;
}

/**
 * Workspace slug declared for the project containing `cwd`, if any.
 *
 * The deepest matching `path` wins so a checkout nested inside another project
 * resolves to its own workspace rather than its parent's.
 */
export function workspaceForDirectory(
    cwd: string,
    env: NodeJS.ProcessEnv = process.env,
    legacyDir?: string,
): string | undefined {
    const file = anythingllmProjectsFile(env, legacyDir);
    if (!file) return undefined;

    let entries: ProjectEntry[];
    try {
        const parsed = readStableJson(file, { label: "Workspace mapping", maxBytes: MAX_MAPPING_BYTES }) as { projects?: unknown };
        if (!Array.isArray(parsed?.projects) || parsed.projects.length > MAX_PROJECTS) return undefined;
        entries = parsed.projects as ProjectEntry[];
    } catch {
        // A malformed or unreadable mapping must not break workspace resolution;
        // fall back to the configured list rather than failing the tool call.
        return undefined;
    }

    let here: string;
    try { here = realpathSync.native(cwd); } catch { return undefined; }
    let bestSlug: string | undefined;
    let bestDepth = -1;
    let ambiguous = false;

    for (const entry of entries) {
        const slug = typeof entry?.slug === "string" ? entry.slug : "";
        const path = typeof entry?.path === "string" ? expandHome(entry.path) : "";
        if (!WORKSPACE_PATTERN.test(slug) || slug === SHARED_WORKSPACE || !isAbsolute(path)) continue;

        let root: string;
        try { root = realpathSync.native(path); } catch { continue; }
        const rel = relative(root, here);
        const contains = rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel));
        if (contains && root.length > bestDepth) {
            bestSlug = slug;
            bestDepth = root.length;
            ambiguous = false;
        } else if (contains && root.length === bestDepth && slug !== bestSlug) {
            ambiguous = true;
        }
    }

    if (ambiguous) throw new Error("Ambiguous project workspace mapping; specify workspace explicitly.");
    return bestSlug;
}

/**
 * Default workspace for a tool call: the project containing `cwd` when it is
 * declared, otherwise the previous behaviour so existing single-project setups
 * keep working unchanged.
 */
export function defaultAnythingLLMWorkspace(
    config: WorkspaceConfig,
    cwd: string = process.cwd(),
    env: NodeJS.ProcessEnv = process.env,
    legacyDir?: string,
): string | undefined {
    return (
        workspaceForDirectory(cwd, env, legacyDir) ??
        config.anythingllm_workspaces?.find((workspace) => workspace !== SHARED_WORKSPACE)
    );
}
