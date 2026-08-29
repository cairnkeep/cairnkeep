import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
    doctorContextPacks,
    disableContextPack,
    enableContextPack,
    initializeContextPack,
    installContextPack,
    lockContextPack,
    removeContextPack,
    searchVisibleContext,
    treeVisibleContext,
} from "../dist/context-pack.js";
import { metadataForTool } from "../dist/mcp-tool-catalog.js";

const root = mkdtempSync(join(tmpdir(), "cairn-context-retrieval-"));
process.env.CAIRN_PACK_BASE_DIR = join(root, "store");
const source = join(root, "source");
const project = join(root, "project");
mkdirSync(join(source, "architecture"), { recursive: true });
mkdirSync(join(source, "operations"), { recursive: true });
mkdirSync(join(source, "private"), { recursive: true });
mkdirSync(project);
let installedDigest;

writeFileSync(join(source, "architecture", "cache.md"), "# Cache design\n\nThe lunar cache uses immutable digest keys.\n\n## Eviction\n\nEvict only unreferenced entries.\n");
writeFileSync(join(source, "architecture", "chatty.md"), Array.from({ length: 24 }, (_, index) => `# Entry ${index}\n\nshared-query ${"x".repeat(8180)}\n\n`).join(""));
writeFileSync(join(source, "architecture", "multibyte.md"), `# Multibyte\n\n${"🪨".repeat(800)}\n`);
writeFileSync(join(source, "operations", "runbook.md"), "# Operations\n\nRestart the worker after draining the queue. shared-query\n");
writeFileSync(join(source, "private", "deploy.md"), "# Hidden deployment skill\n\nThe forbidden-needle must never be exposed.\n");

try {
    await initializeContextPack(source, {
        id: "retrieval-guide",
        version: "1.0.0",
        title: "Retrieval guide",
        description: "Hierarchical retrieval fixture",
        license: "Apache-2.0",
    });
    const manifestPath = join(source, "context-pack.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.files.find(({ path }) => path === "private/deploy.md").kind = "skill";
    const multibyte = manifest.files.find(({ path }) => path === "architecture/multibyte.md");
    multibyte.description = "🪨".repeat(180);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await lockContextPack(source);
    const installed = await installContextPack(source);
    installedDigest = installed.pack.digest;
    await enableContextPack(installed.pack.digest, { projectRoot: project });

    const legacy = await searchVisibleContext("lunar cache", { projectRoot: project });
    const explicitFlat = await searchVisibleContext("lunar cache", { projectRoot: project, strategy: "flat", detail: "content" });
    assert.deepEqual(explicitFlat, legacy, "explicit default options preserve the legacy response byte-for-byte");

    const summaryLimited = await searchVisibleContext("shared-query", {
        projectRoot: project,
        strategy: "flat",
        detail: "abstract",
        limit: 2,
    });
    assert.deepEqual(summaryLimited.results.map(({ path }) => path), ["architecture/chatty.md", "operations/runbook.md"], "summary mode deduplicates files before applying the public limit");

    const hierarchical = await searchVisibleContext("lunar cache", {
        projectRoot: project,
        strategy: "hierarchical",
        detail: "overview",
        explain: true,
    });
    assert.equal(hierarchical.strategy, "hierarchical");
    assert.equal(hierarchical.detail, "overview");
    assert.equal(hierarchical.results[0].path, "architecture/cache.md");
    assert.match(hierarchical.results[0].text, /Cache design|lunar cache/);
    assert.ok(hierarchical.trace.events.length <= 64, "trace is bounded");
    assert.doesNotMatch(JSON.stringify(hierarchical.trace), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "trace contains no absolute paths");
    assert.doesNotMatch(JSON.stringify(hierarchical), /forbidden-needle/, "unapproved skills never leak into hierarchy, summaries, or trace");

    const exact = await searchVisibleContext("architecture/cache.md", {
        projectRoot: project,
        strategy: "hierarchical",
        detail: "content",
        explain: true,
    });
    assert.equal(exact.results[0].path, "architecture/cache.md");
    assert.equal(exact.trace.exact_leaf_bypass, true);

    const tree = await treeVisibleContext({ projectRoot: project, detail: "abstract" });
    assert.equal(tree.packs.length, 1);
    assert.match(JSON.stringify(tree), /architecture\/cache\.md/);
    assert.doesNotMatch(JSON.stringify(tree), /private\/deploy\.md|forbidden-needle/);
    const abstractLeaf = tree.packs[0].tree.children
        .find(({ path }) => path === "architecture").children
        .find(({ path }) => path === "architecture/multibyte.md");
    assert.ok(Buffer.byteLength(abstractLeaf.abstract, "utf8") <= 512, "abstract byte cap includes the ellipsis");
    assert.doesNotMatch(abstractLeaf.abstract, /�/, "abstract truncation preserves multibyte boundaries");
    const overviewTree = await treeVisibleContext({ projectRoot: project, detail: "overview" });
    const overviewLeaf = overviewTree.packs[0].tree.children
        .find(({ path }) => path === "architecture").children
        .find(({ path }) => path === "architecture/multibyte.md");
    assert.ok(Buffer.byteLength(overviewLeaf.overview, "utf8") <= 2048, "overview byte cap includes the ellipsis");
    assert.doesNotMatch(overviewLeaf.overview, /�/, "overview truncation preserves multibyte boundaries");
    assert.deepEqual(metadataForTool("context_pack_tree").annotations, {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
    });

    const contextCacheDirectory = join(process.env.CAIRN_PACK_BASE_DIR, "cache", "context", installed.pack.digest);
    const [cacheEntry] = readdirSync(contextCacheDirectory).filter((name) => name.endsWith(".json"));
    assert.ok(cacheEntry, "hierarchical retrieval creates a derived cache entry");
    const progressiveCachePath = join(contextCacheDirectory, cacheEntry);
    const projectsDirectory = join(process.env.CAIRN_PACK_BASE_DIR, "projects");
    const pointersBeforeRepair = readdirSync(projectsDirectory)
        .sort()
        .map((name) => [name, readFileSync(join(projectsDirectory, name), "utf8")]);
    assert.equal((await doctorContextPacks()).ok, true, "doctor accepts the declared deterministic derivation algorithm");

    const invalidAlgorithm = JSON.parse(readFileSync(progressiveCachePath, "utf8"));
    invalidAlgorithm.algorithm = "untrusted-derivation-v0";
    writeFileSync(progressiveCachePath, `${JSON.stringify(invalidAlgorithm)}\n`);
    writeFileSync(`${progressiveCachePath}.interrupted.tmp`, "partial");
    symlinkSync(join(source, "architecture", "cache.md"), join(contextCacheDirectory, "unexpected-link.json"));

    const corruptDoctor = await doctorContextPacks();
    assert.equal(corruptDoctor.ok, false, "doctor rejects corrupted progressive cache state");
    assert.ok(corruptDoctor.issues.some((issue) => issue.includes("progressive context cache")), "doctor reports cache corruption");
    assert.ok(corruptDoctor.temporary_remnants.some((path) => path.includes("cache") && path.endsWith(".tmp")), "doctor reports interrupted cache writes");

    const repairedDoctor = JSON.parse(execFileSync(process.execPath, [
        fileURLToPath(new URL("../dist/context-pack-cli.js", import.meta.url)),
        "doctor",
        "--repair",
        "--json",
    ], { encoding: "utf8", env: process.env }));
    assert.equal(repairedDoctor.ok, true, "repair deletes only invalid derived cache state");
    assert.deepEqual(
        readdirSync(projectsDirectory).sort().map((name) => [name, readFileSync(join(projectsDirectory, name), "utf8")]),
        pointersBeforeRepair,
        "derived-cache repair never changes project enablement or skill approvals",
    );
    assert.equal(existsSync(progressiveCachePath), false, "corrupted cache record is deleted");
    assert.equal(existsSync(`${progressiveCachePath}.interrupted.tmp`), false, "temporary cache remnant is deleted");
    assert.equal(existsSync(join(contextCacheDirectory, "unexpected-link.json")), false, "unexpected cache symlink is deleted");

    const rebuilt = await treeVisibleContext({ projectRoot: project, detail: "overview" });
    assert.ok(existsSync(progressiveCachePath), "the next read deterministically rebuilds the derived cache");
    assert.doesNotMatch(JSON.stringify(rebuilt), /restricted production deploy/i, "repair and rebuild do not expose unapproved skills");

    const cachePath = join(process.env.CAIRN_PACK_BASE_DIR, "cache", "context", installed.pack.digest);
    assert.equal(existsSync(cachePath), true, "digest-bound derived cache lives outside immutable pack objects");
    assert.equal(existsSync(join(process.env.CAIRN_PACK_BASE_DIR, "objects", installed.pack.digest, ".cairn-context-cache.json")), false);

    console.log("context pack progressive retrieval smoke test passed");
} finally {
    if (installedDigest) {
        await disableContextPack(installedDigest, { projectRoot: project });
        await removeContextPack(installedDigest);
    }
    rmSync(root, { recursive: true, force: true });
}

await import("./smoke-context-pack-v216-compat.mjs");
