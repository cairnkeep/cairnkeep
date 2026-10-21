import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    anythingllmProjectsFile,
    workspaceForDirectory,
    defaultAnythingLLMWorkspace,
} from "../dist/anythingllm-workspace.js";

let failures = 0;
function check(name, condition) {
    console.log(`${condition ? "ok" : "FAIL"}: ${name}`);
    if (!condition) failures += 1;
}

const root = mkdtempSync(join(tmpdir(), "cairn-ws-"));
const configHome = join(root, "config");
const repoA = join(root, "repos", "alpha");
const repoB = join(root, "repos", "beta");
const nested = join(repoA, "vendor", "inner");
for (const dir of [join(configHome, "cairnkeep"), nested, repoB, join(repoA, "src")]) mkdirSync(dir, { recursive: true });

const projectsFile = join(configHome, "cairnkeep", "anythingllm-projects.json");
function writeProjects(projects) {
    writeFileSync(projectsFile, JSON.stringify({ projects }, null, 2));
}
writeProjects([
    { slug: "alpha-project-docs", path: repoA },
    { slug: "beta-project-docs", path: repoB },
    { slug: "inner-project-docs", path: nested },
]);

const env = { XDG_CONFIG_HOME: configHome };
const config = { anythingllm_workspaces: ["engineering-patterns", "legacy-project-docs"] };

check("locates the projects file under XDG_CONFIG_HOME", anythingllmProjectsFile(env) === projectsFile);
check("maps a repository root to its declared workspace", workspaceForDirectory(repoA, env) === "alpha-project-docs");
check("maps a subdirectory to the containing project", workspaceForDirectory(join(repoA, "src"), env) === "alpha-project-docs");
check("keeps sibling repositories distinct", workspaceForDirectory(repoB, env) === "beta-project-docs");
check("prefers the deepest matching project", workspaceForDirectory(nested, env) === "inner-project-docs");
check("returns nothing for an undeclared directory", workspaceForDirectory(root, env) === undefined);

check("default uses the project workspace when declared", defaultAnythingLLMWorkspace(config, repoB, env) === "beta-project-docs");
check("default falls back to the configured list when undeclared", defaultAnythingLLMWorkspace(config, root, env) === "legacy-project-docs");
check("default never selects the shared patterns workspace",
    defaultAnythingLLMWorkspace({ anythingllm_workspaces: ["engineering-patterns"] }, root, env) === undefined);

// An explicit override wins over the XDG location.
const override = join(root, "elsewhere.json");
writeFileSync(override, JSON.stringify({ projects: [{ slug: "override-docs", path: repoA }] }));
check("honours CAIRN_ANYTHINGLLM_PROJECTS_FILE",
    workspaceForDirectory(repoA, { ...env, CAIRN_ANYTHINGLLM_PROJECTS_FILE: override }) === "override-docs");
check("ignores a missing override path",
    anythingllmProjectsFile({ ...env, CAIRN_ANYTHINGLLM_PROJECTS_FILE: join(root, "nope.json") }) === undefined);

// Resolution must degrade to the old behaviour rather than throwing.
writeFileSync(projectsFile, "{ not json");
check("malformed mapping falls back instead of failing", defaultAnythingLLMWorkspace(config, repoA, env) === "legacy-project-docs");
writeProjects([{ slug: "", path: repoA }, { path: repoB }, { slug: "ok-docs", path: repoB }]);
check("skips entries missing slug or path", workspaceForDirectory(repoB, env) === "ok-docs");
check("no projects file leaves previous behaviour intact",
    defaultAnythingLLMWorkspace(config, repoA, { XDG_CONFIG_HOME: join(root, "empty") }) === "legacy-project-docs");

rmSync(root, { recursive: true, force: true });
if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
}
console.log("PASS: anythingllm workspace resolution");
