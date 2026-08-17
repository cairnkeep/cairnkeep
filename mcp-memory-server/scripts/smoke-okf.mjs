import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    applyContextPackUpdate,
    doctorContextPacks,
    enableContextPack,
    inspectContextPackUpdate,
    installOkfContextPack,
    listVisibleContext,
    readVisibleContext,
    relatedVisibleContext,
    searchVisibleContext,
} from "../dist/context-pack.js";
import { applyOkfExport, planOkfExport, validateOkfBundle } from "../dist/okf.js";

const root = mkdtempSync(join(tmpdir(), "cairn-okf-"));
process.env.CAIRN_PACK_BASE_DIR = join(root, "store");

function makeWritable(path) {
    if (!existsSync(path) || process.platform === "win32") return;
    const info = lstatSync(path);
    chmodSync(path, info.isDirectory() ? 0o700 : 0o600);
    if (info.isDirectory()) for (const entry of readdirSync(path)) makeWritable(join(path, entry));
}

function write(path, value) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, value, "utf8");
}

try {
    const source = join(root, "source");
    mkdirSync(join(source, "concepts"), { recursive: true });
    write(join(source, "index.md"), `---
okf_version: "0.2"
---
# Synthetic catalog

* [Activity metric](concepts/activity.md) - Synthetic metric fixture.
* [Response playbook](concepts/response.md) - Synthetic playbook fixture.
* [Bounded computation](concepts/computation.md) - Metadata-only computation fixture.
`);
    write(join(source, "concepts", "activity.md"), `---
type: Metric
title: Activity metric
description: Deterministic synthetic activity definition.
resource: urn:example:metric:activity
tags: [metrics, synthetic]
generated: { by: process:fixture, at: 2026-08-01T00:00:00Z }
verified:
  - { by: human:reviewer, at: 2026-08-02T00:00:00Z }
status: stable
stale_after: 2000-01-01
sources:
  - id: policy
    resource: https://example.invalid/policy
    title: Synthetic policy
---
# Computation

The weekly activity algorithm uses the reviewed synthetic definition.[^policy]

See the [response playbook](/concepts/response.md) and a [missing concept](./missing.md).

[^policy]: Synthetic policy
`);
    write(join(source, "concepts", "response.md"), `---
type: Playbook
title: Response playbook
description: Deterministic synthetic response procedure.
tags: [operations, synthetic]
generated: { by: process:fixture, at: 2026-08-01T00:00:00Z }
status: stable
---
# Steps

Follow the bounded response procedure. Return to the [activity metric](./activity.md).
`);
    write(join(source, "concepts", "computation.md"), `---
type: Attested Computation
title: Bounded computation
description: Metadata is preserved but never executed.
runtime: python
parameters:
  - { name: value, type: integer, required: true }
computation: ../references/calculate.py
executor: { resource: ../references/run.py, receipt: [result] }
attester: { resource: ../references/check.py }
sources:
  - { id: activity, resource: ./activity.md }
---
# Computation

The declared files are retrieval links, not executable authority.
`);
    write(join(source, "references", "calculate.py"), "# inert fixture\n");
    write(join(source, "references", "run.py"), "# inert fixture\n");
    write(join(source, "references", "check.py"), "# inert fixture\n");
    write(join(source, ".git", "config"), "repository metadata must not become bundle content\n");

    const validated = await validateOkfBundle(source);
    assert.equal(validated.version, "0.2");
    assert.equal(validated.concepts.length, 3);
    assert.ok(validated.diagnostics.some(({ code }) => code === "broken-link"));
    assert.ok(validated.diagnostics.some(({ code }) => code === "stale"));
    assert.ok(validated.diagnostics.some(({ code, path }) => code === "missing-sources" && path === "concepts/response.md"));
    assert.ok(validated.diagnostics.some(({ code, path }) => code === "unverified" && path === "concepts/response.md"));
    const computation = validated.files.find(({ path }) => path === "concepts/computation.md");
    assert.equal(computation.concept.metadata.runtime, "python");
    assert.deepEqual(computation.outbound, ["concepts/activity.md", "references/calculate.py", "references/check.py", "references/run.py"]);
    const cliValidation = spawnSync(process.execPath, ["dist/context-pack-cli.js", "validate-okf", source, "--json"], {
        cwd: new URL("..", import.meta.url), encoding: "utf8", env: process.env,
    });
    assert.equal(cliValidation.status, 0, cliValidation.stderr);
    assert.equal(JSON.parse(cliValidation.stdout).version, "0.2");

    const installed = await installOkfContextPack(source, {
        id: "synthetic-catalog",
        version: "1.0.0",
        title: "Synthetic catalog",
        description: "Synthetic OKF interoperability fixture.",
        license: "CC0-1.0",
    });
    assert.equal(installed.pack.manifest.source_format?.name, "okf");
    assert.equal(installed.pack.manifest.source_format?.version, "0.2");
    assert.equal(existsSync(join(source, "context-pack.json")), false, "import must not modify its source");

    const project = join(root, "project");
    mkdirSync(project);
    await enableContextPack(installed.pack.digest, { projectRoot: project });
    const listed = await listVisibleContext({ projectRoot: project });
    const activity = listed.packs[0].files.find(({ path }) => path === "concepts/activity.md");
    assert.equal(activity.okf.type, "Metric");
    assert.equal(activity.okf.trust_tier, "human-reviewed");
    assert.equal(activity.okf.stale, true);
    assert.equal(activity.okf.sources[0].id, "policy");
    const listedComputation = listed.packs[0].files.find(({ path }) => path === "concepts/computation.md");
    assert.equal(listedComputation.okf.metadata.executor.resource, "../references/run.py");

    const search = await searchVisibleContext("weekly activity algorithm", { projectRoot: project });
    assert.equal(search.results[0].path, "concepts/activity.md", "deterministic lexical retrieval finds the expected concept first");
    assert.equal(search.results[0].okf.concept_id, "concepts/activity");
    const read = await readVisibleContext("synthetic-catalog", "concepts/activity.md", { projectRoot: project });
    assert.equal(read.okf.status, "stable");
    const related = await relatedVisibleContext("synthetic-catalog", "concepts/activity.md", { projectRoot: project, direction: "outbound" });
    assert.deepEqual(related.results.map(({ path }) => path), ["concepts/response.md"]);
    assert.equal((await doctorContextPacks()).ok, true);

    write(join(source, "concepts", "response.md"), readFileSync(join(source, "concepts", "response.md"), "utf8") + "\nUpdated source bytes.\n");
    const update = await inspectContextPackUpdate("synthetic-catalog", { projectRoot: project });
    assert.equal(update.changed, true);
    assert.equal(update.source_format, "okf");
    assert.equal(existsSync(join(process.env.CAIRN_PACK_BASE_DIR, "objects", update.candidate_digest)), false, "OKF update check must not install the candidate");
    const appliedUpdate = await applyContextPackUpdate("synthetic-catalog", update.candidate_digest, { projectRoot: project });
    assert.equal(appliedUpdate.applied, true);
    assert.ok(related.diagnostics.some(({ code }) => code === "broken-link"));

    const v01 = join(root, "v01");
    mkdirSync(v01);
    write(join(v01, "legacy.md"), `---
type: Reference
title: Legacy concept
timestamp: 2026-01-01T00:00:00Z
---
Legacy OKF v0.1 content.
`);
    const legacy = await validateOkfBundle(v01);
    assert.equal(legacy.version, "0.1");
    assert.equal(legacy.concepts[0].timestamp, "2026-01-01T00:00:00Z");

    const missingType = join(root, "missing-type");
    mkdirSync(missingType);
    write(join(missingType, "bad.md"), "---\ntitle: Missing type\n---\nBad.\n");
    await assert.rejects(() => validateOkfBundle(missingType), /type/i);

    const aliases = join(root, "aliases");
    mkdirSync(aliases);
    write(join(aliases, "bad.md"), "---\ntype: Reference\ntags: &tags [one]\nalso: *tags\n---\nBad.\n");
    await assert.rejects(() => validateOkfBundle(aliases), /alias/i);

    if (process.platform !== "win32") {
        const linked = join(root, "linked");
        mkdirSync(linked);
        symlinkSync(join(source, "concepts", "activity.md"), join(linked, "bad.md"));
        await assert.rejects(() => validateOkfBundle(linked), /symlink/i);
    }

    const exportProject = join(root, "export-project");
    const output = join(root, "exported-okf");
    mkdirSync(join(exportProject, "docs"), { recursive: true });
    process.env.CAIRN_EXPORT_TEST_SECRET = "synthetic-secret-value";
    write(join(exportProject, "docs", "reviewed.md"), "# Reviewed guide\n\nUse token=synthetic-secret-value only in this redaction fixture.\n");
    write(join(exportProject, "docs", "ignored.md"), "# Not selected\n\nThis file must not be exported.\n");
    const exportOptions = {
        projectRoot: exportProject,
        outputDirectory: output,
        files: ["docs/reviewed.md"],
        noteIds: [],
    };
    const plan = await planOkfExport(exportOptions);
    const windowsStylePlan = await planOkfExport({ ...exportOptions, files: ["docs\\reviewed.md"] });
    assert.equal(windowsStylePlan.confirmation_digest, plan.confirmation_digest);
    assert.equal(existsSync(output), false, "export check performs no writes");
    assert.equal(plan.redaction_replacements, 2);
    await assert.rejects(() => applyOkfExport(exportOptions, "0".repeat(64)), /confirmation/i);
    assert.equal(existsSync(output), false, "failed confirmation leaves no output");
    const applied = await applyOkfExport(exportOptions, plan.confirmation_digest);
    assert.equal(applied.confirmation_digest, plan.confirmation_digest);
    const exported = readFileSync(join(output, "docs", "reviewed.md"), "utf8");
    assert.match(exported, /\[REDACTED/);
    assert.doesNotMatch(exported, /synthetic-secret-value/);
    assert.equal(existsSync(join(output, "docs", "ignored.md")), false);
    assert.equal((await validateOkfBundle(output)).version, "0.2");

    const blockedOptions = { ...exportOptions, outputDirectory: join(root, "blocked"), files: [".ai/.env"] };
    mkdirSync(join(exportProject, ".ai"), { recursive: true });
    write(join(exportProject, ".ai", ".env"), "TOKEN=never-export\n");
    await assert.rejects(() => planOkfExport(blockedOptions), /private|sensitive/i);

    console.log("PASS: OKF import, provenance, graph retrieval, regression, and privacy export contracts");
} finally {
    delete process.env.CAIRN_EXPORT_TEST_SECRET;
    makeWritable(root);
    rmSync(root, { recursive: true, force: true });
}
