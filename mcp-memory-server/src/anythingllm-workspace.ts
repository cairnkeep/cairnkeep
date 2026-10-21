import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

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

    const configHome = env.XDG_CONFIG_HOME
        ? resolve(expandHome(env.XDG_CONFIG_HOME))
        : join(homedir(), ".config");
    const standard = join(configHome, "cairnkeep", "anythingllm-projects.json");
    if (existsSync(standard)) return standard;

    if (legacyDir) {
        const legacy = join(legacyDir, "anythingllm-projects.json");
        if (existsSync(legacy)) return legacy;
    }
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
        const parsed = JSON.parse(readFileSync(file, "utf8")) as { projects?: unknown };
        if (!Array.isArray(parsed?.projects)) return undefined;
        entries = parsed.projects as ProjectEntry[];
    } catch {
        // A malformed or unreadable mapping must not break workspace resolution;
        // fall back to the configured list rather than failing the tool call.
        return undefined;
    }

    const here = resolve(cwd);
    let bestSlug: string | undefined;
    let bestDepth = -1;

    for (const entry of entries) {
        const slug = typeof entry?.slug === "string" ? entry.slug.trim() : "";
        const path = typeof entry?.path === "string" ? entry.path.trim() : "";
        if (!slug || !path) continue;

        const root = resolve(expandHome(path));
        const rel = relative(root, here);
        const contains = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
        if (contains && root.length > bestDepth) {
            bestSlug = slug;
            bestDepth = root.length;
        }
    }

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
