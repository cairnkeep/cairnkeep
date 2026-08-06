import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { distillProject } from "../dist/note-distiller.js";
import { getNoteLayout, promoteNotes, searchHindsight } from "../dist/note-store.js";
import { getTrajectoryLimits, trajectorySessionSchema } from "../dist/trajectory-schema.js";
import { putTrajectory } from "../dist/trajectory-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures", "notes", "lifecycle-sessions.json"), "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "cairn-notes-distill-"));
const storeRoot = join(scratch, "store");
const projectA = join(scratch, "project-a");
const projectB = join(scratch, "project-b");
mkdirSync(projectA, { recursive: true });
mkdirSync(projectB, { recursive: true });

process.env.CAIRN_AGENTFS_BASE_DIR = storeRoot;
process.env.CAIRN_NOTE_DISTILLATION = "1";
delete process.env.CAIRN_NOTE_ENRICHMENT;
delete process.env.CAIRN_LLM_API_KEY;
delete process.env.CAIRN_LLM_API_URL;
delete process.env.CAIRN_NOTE_ENRICHMENT_MODEL;

function session(name, projectRoot) {
    const value = JSON.parse(JSON.stringify(fixture[name]), (_key, item) => (
        typeof item === "string" ? item.replaceAll("$PROJECT_ROOT", projectRoot) : item
    ));
    return trajectorySessionSchema.parse(value);
}

async function put(name, projectRoot) {
    await putTrajectory(projectRoot, session(name, projectRoot), getTrajectoryLimits());
}

function allFiles(root) {
    const result = [];
    function walk(path) {
        for (const name of readdirSync(path, { withFileTypes: true })) {
            const child = join(path, name.name);
            if (name.isDirectory()) walk(child);
            else result.push(child);
        }
    }
    walk(root);
    return result.sort();
}

function snapshot(root) {
    return allFiles(root).map((path) => [path.slice(root.length), readFileSync(path, "utf8")]);
}

try {
    await put("failure", projectA);
    const first = await distillProject({ projectRoot: projectA, sessionId: "note-failure-001" });
    assert.equal(first.created.length, 1);
    assert.equal(first.updated.length, 0);
    assert.equal(first.enrichment_skipped.length, 1);
    const created = first.created[0];
    assert.equal(created.status, "unresolved");
    assert.match(created.path, /projects\/project-a--[a-f0-9]+\/hindsight\/typeerror--[a-f0-9]+\.md$/);

    let markdown = readFileSync(created.path, "utf8");
    for (const field of ["id", "title", "description", "keywords", "node_type", "tags"]) {
        assert.match(markdown, new RegExp(`^${field}:`, "m"), `missing frontmatter ${field}`);
    }
    for (const field of ["signature_version", "fingerprint", "normalized_error", "stack_digest", "component", "first_seen", "last_seen", "occurrence_count"]) {
        assert.match(markdown, new RegExp(`^${field}:`, "m"), `missing hindsight frontmatter ${field}`);
    }
    assert.match(markdown, /status: unresolved/);
    assert.match(markdown, /<!-- cairnkeep:managed:v1:start -->/);
    assert.doesNotMatch(markdown, /private hidden reasoning|sk-live-/i);

    const manual = "\n## Maintainer notes\n\nKeep this exact sentence.\n";
    writeFileSync(created.path, `${markdown}${manual}`);

    await put("fix", projectA);
    const fixed = await distillProject({ projectRoot: projectA, sessionId: "note-fix-001" });
    assert.equal(fixed.updated.length, 1);
    assert.equal(fixed.updated[0].id, created.id);
    assert.equal(fixed.updated[0].status, "resolved");
    markdown = readFileSync(created.path, "utf8");
    assert.match(markdown, /status: resolved/);
    assert.match(markdown, /Keep this exact sentence\./);
    assert.match(markdown, /note-failure-001/);
    assert.match(markdown, /note-fix-001/);

    const before = snapshot(storeRoot);
    const repeated = await distillProject({ projectRoot: projectA, sessionId: "note-fix-001" });
    assert.equal(repeated.already_processed.length, 1);
    assert.deepEqual(snapshot(storeRoot), before, "idempotent rerun changed note bytes");

    const queryText = "TypeError: Cannot read properties of undefined (reading 'name')\n    at loadUser (/different/root/src/user.ts:999:1)";
    const child = spawnSync(process.execPath, [
        "--input-type=module",
        "--eval",
        `import { searchHindsight } from ${JSON.stringify(resolve(here, "../dist/note-store.js"))}; const value = await searchHindsight({projectRoot:${JSON.stringify(projectA)}, text:${JSON.stringify(queryText)}}); process.stdout.write(JSON.stringify(value));`,
    ], { encoding: "utf8", env: { ...process.env } });
    assert.equal(child.status, 0, child.stderr);
    const freshSearch = JSON.parse(child.stdout);
    assert.equal(freshSearch.results[0].id, created.id);
    assert.equal(freshSearch.results[0].status, "resolved");

    await put("recurrence", projectA);
    const reopened = await distillProject({ projectRoot: projectA, sessionId: "note-recurrence-001" });
    assert.equal(reopened.updated[0].id, created.id);
    assert.equal(reopened.updated[0].status, "unresolved");

    await put("abandoned", projectA);
    const abandoned = await distillProject({ projectRoot: projectA, sessionId: "note-abandoned-001" });
    assert.equal(abandoned.created[0].status, "abandoned");

    await put("provider_error", projectA);
    const provider = await distillProject({ projectRoot: projectA, sessionId: "note-provider-001" });
    assert.equal(provider.created[0].status, "unresolved");

    await put("no_failure", projectA);
    const skipped = await distillProject({ projectRoot: projectA, sessionId: "note-no-failure-001" });
    assert.equal(skipped.already_processed.length, 1);

    await put("failure", projectB);
    const other = await distillProject({ projectRoot: projectB, sessionId: "note-failure-001" });
    const promoted = await promoteNotes({ sourceNoteId: created.id, corroboratingNoteId: other.created[0].id, confirm: true });
    assert.equal(promoted.status, "promoted");
    assert.ok(promoted.shared_path.includes(`${sep}shared${sep}`));
    assert.equal(allFiles(join(storeRoot, "notes", "shared")).filter((path) => path.endsWith(".md")).length, 1);
    assert.match(readFileSync(created.path, "utf8"), /node_type: provenance/);
    assert.match(readFileSync(other.created[0].path, "utf8"), /node_type: provenance/);
    await assert.rejects(() => promoteNotes({ sourceNoteId: created.id, corroboratingNoteId: created.id, confirm: true }));
    await assert.rejects(() => promoteNotes({ sourceNoteId: created.id, corroboratingNoteId: other.created[0].id, confirm: false }));

    const layout = getNoteLayout(projectA);
    assert.ok(layout.project_id.startsWith("project-a--"));
    assert.ok(readFileSync(join(storeRoot, "notes", "README.md"), "utf8").includes("How to navigate"));
    assert.ok(readFileSync(join(layout.project_dir, "README.md"), "utf8").includes("Unresolved"));
    const direct = await searchHindsight({ projectRoot: projectA, text: queryText });
    assert.equal(direct.results[0].canonical_id, promoted.shared_id);

    console.log("PASS: deterministic note lifecycle, hierarchy, promotion and first-hit search");
} finally {
    rmSync(scratch, { recursive: true, force: true });
}
