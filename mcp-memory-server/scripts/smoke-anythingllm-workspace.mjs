import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
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

writeProjects([{ slug: "engineering-patterns", path: repoA }]);
check("mapping cannot select the shared patterns workspace as a project default",
    defaultAnythingLLMWorkspace(config, repoA, env) === "legacy-project-docs");
writeProjects([{ slug: "unsafe/docs", path: repoA }]);
check("mapping skips unsafe workspace identifiers", workspaceForDirectory(repoA, env) === undefined);
writeProjects([{ slug: "relative-docs", path: "." }]);
check("relative project declarations do not float with the process directory",
    workspaceForDirectory(process.cwd(), env) === undefined);
writeProjects([{ slug: "tilde-docs", path: "~" }]);
check("project paths do not expand tildes differently from the sync script",
    workspaceForDirectory(homedir(), env) === undefined);
writeProjects([{ slug: "xdg-docs", path: repoA }]);
const legacyDir = join(root, "legacy");
mkdirSync(legacyDir);
writeFileSync(join(legacyDir, "anythingllm-projects.json"), JSON.stringify({ projects: [{ slug: "legacy-docs", path: repoA }] }));
check("legacy mapping precedes XDG exactly as the bundled sync script does",
    workspaceForDirectory(repoA, env, legacyDir) === "legacy-docs");
writeFileSync(projectsFile, JSON.stringify({ projects: [{ slug: "oversized-docs", path: repoA }], padding: "x".repeat(1024 * 1024) }));
check("oversized mappings fall back under a fixed byte cap", workspaceForDirectory(repoA, env) === undefined);
writeProjects(Array.from({ length: 4097 }, () => ({ slug: "too-many-docs", path: repoA })));
check("mapping entry count is bounded", workspaceForDirectory(repoA, env) === undefined);
writeFileSync(projectsFile, Buffer.concat([
    Buffer.from(JSON.stringify({ projects: [{ slug: "invalid-text-docs", path: repoA }] }).slice(0, -1) + ',"note":"'),
    Buffer.from([0xff]), Buffer.from('"}'),
]));
check("invalid UTF-8 mappings are not admitted", workspaceForDirectory(repoA, env) === undefined);
writeProjects([{ slug: "alpha-docs", path: repoA }, { slug: "beta-docs", path: repoA }]);
assert.throws(() => workspaceForDirectory(repoA, env), /Ambiguous project workspace mapping/);
writeProjects([{ slug: "alpha-docs", path: repoA }, { slug: "alpha-docs", path: repoA }]);
check("identical repeated declarations remain deterministic", workspaceForDirectory(repoA, env) === "alpha-docs");
const dotted = join(repoA, "..cache");
mkdirSync(dotted);
check("a child name beginning with dots is still inside its project", workspaceForDirectory(dotted, env) === "alpha-docs");
if (process.platform !== "win32") {
    unlinkSync(projectsFile);
    symlinkSync(override, projectsFile);
    check("symlinked mappings fall back without following their content", workspaceForDirectory(repoA, env) === undefined);
    unlinkSync(projectsFile);
    assert.equal(spawnSync("mkfifo", [projectsFile]).status, 0);
    const worker = spawnSync(process.execPath, ["--input-type=module", "-e",
        `import { workspaceForDirectory } from ${JSON.stringify(new URL("../dist/anythingllm-workspace.js", import.meta.url).href)}; process.exit(workspaceForDirectory(process.argv[1], {XDG_CONFIG_HOME:process.argv[2]}) === undefined ? 0 : 1);`, repoA, configHome], { timeout: 3000 });
    assert.ifError(worker.error);
    check("FIFO mapping is rejected without blocking", worker.status === 0);
}

rmSync(root, { recursive: true, force: true });
if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
}
console.log("PASS: anythingllm workspace resolution");
