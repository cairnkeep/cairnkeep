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
import { applyOkfExport, indexOkfBundle, okfStale, planOkfExport, validateOkfBundle } from "../dist/okf.js";

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

    const modern = join(root, "v03");
    write(join(modern, "index.md"), `---
okf_version: "0.3"
title: Modern catalog
description: Synthetic current-format bundle.
license: CC0-1.0
x-fixture: { preserved: true }
---
# Catalog
`);
    write(join(modern, "README.md"), "# Packaging notes\nNot a concept.\n");
    write(join(modern, "SKILL.md"), "---\nname: inert-instructions\n---\nNever activate this file.\n");
    write(join(modern, ".private", "hidden.md"), "not valid YAML or public context\n");
    write(join(modern, "concepts", "current.md"), `---
type: Unregistered Type
tags: synthetic
sources: { resource: /concepts/replacement.md, last_modified: 2026-08-01T12:00:00+02:00, x-source: retained }
usage_window: { from: 2026-08-01, to: 2026-08-02T00:00:00Z, x-window: retained }
generated: { by: process:fixture, at: 2026-08-03T00:00:00Z, x-generation: retained }
verified:
  - { by: human:reviewer, at: 2026-08-02T00:00:00Z, x-review: retained }
  - { by: process:checker, at: 2026-08-03T02:00:00+02:00 }
  - { by: human:missing-date }
status: deprecated
superseded_by: ./replacement.md
stale_after: 2000-01-01T12:00:00+02:00
---
See [replacement][next] and [packaging notes](/README.md).

[next]: /concepts/replacement.md
`);
    write(join(modern, "concepts", "replacement.md"), "---\ntype: Reference\n---\nCurrent replacement.\n");
    const currentBundle = await validateOkfBundle(modern);
    assert.equal(currentBundle.version, "0.3");
    assert.equal(currentBundle.files.find(({ path }) => path === "index.md").title, "Modern catalog");
    assert.equal(currentBundle.files.some(({ path }) => /README|SKILL|hidden/.test(path)), false, "non-concepts and dot paths never enter imported context");
    assert.equal(currentBundle.diagnostics.some(({ code }) => code === "unsupported-version"), false);
    assert.ok(currentBundle.diagnostics.some(({ code }) => code === "ignored-file"));
    const currentConcept = currentBundle.concepts.find(({ concept_id }) => concept_id === "concepts/current");
    assert.equal(currentConcept.trust_tier, "machine-confirmed", "old human review cannot qualify rewritten content");
    assert.equal(currentConcept.stale, true);
    assert.deepEqual(currentConcept.tags, ["synthetic"]);
    assert.equal(currentConcept.generated["x-generation"], "retained");
    assert.equal(currentConcept.verified[0]["x-review"], "retained");
    assert.equal(currentConcept.sources[0]["x-source"], "retained");
    assert.deepEqual(currentBundle.files.find(({ path }) => path === "concepts/current.md").outbound, ["concepts/replacement.md"]);
    assert.ok(currentBundle.files.find(({ path }) => path === "concepts/current.md").broken_links.includes("README.md"), "ignored Markdown cannot create a graph edge missing from the installed object");
    const modernPack = await installOkfContextPack(modern, { id: "modern-catalog", version: "1.0.0", license: "CC0-1.0" });
    const modernProject = join(root, "modern-project");
    mkdirSync(modernProject);
    await enableContextPack(modernPack.pack.digest, { projectRoot: modernProject });
    const modernListed = await listVisibleContext({ projectRoot: modernProject });
    assert.equal(modernListed.packs[0].files.length, 3);
    assert.equal((await readVisibleContext("modern-catalog", "concepts/current.md", { projectRoot: modernProject })).okf.trust_tier, "machine-confirmed");
    assert.equal((await searchVisibleContext("Current replacement", { projectRoot: modernProject })).results[0].path, "concepts/replacement.md");
    assert.deepEqual((await relatedVisibleContext("modern-catalog", "concepts/current.md", { projectRoot: modernProject })).results.map(({ path }) => path), ["concepts/replacement.md"]);
    await assert.rejects(() => readVisibleContext("modern-catalog", "SKILL.md", { projectRoot: modernProject }));
    assert.equal((await doctorContextPacks()).ok, true);

    let probeNumber = 0;
    async function probe(metadata) {
        const directory = join(root, `metadata-${++probeNumber}`);
        write(join(directory, "index.md"), '---\nokf_version: "0.3"\n---\n');
        write(join(directory, "concept.md"), `---\ntype: Reference\n${metadata}\n---\nSynthetic.\n`);
        return (await validateOkfBundle(directory)).concepts[0];
    }
    assert.equal((await probe("generated: { by: process:fixture, at: 2026-08-03 }\nverified: { by: human:reviewer, at: 2026-08-02 }")).trust_tier, "unverified");
    assert.equal((await probe("generated: { by: process:fixture, at: 2026-08-03 }\nverified: { by: human:reviewer, at: 2026-08-03 }")).trust_tier, "human-reviewed");
    assert.equal((await probe("verified: { by: human:reviewer }")).trust_tier, "unverified");
    assert.equal((await probe("verified: { by: 'human:', at: 2026-08-03 }")).trust_tier, "machine-confirmed");
    assert.equal((await probe("generated: { by: process:fixture, at: nonsense }\nverified: { by: human:reviewer, at: 2026-08-03 }")).trust_tier, "unverified");
    assert.equal((await probe("generated: { by: process:fixture }\nverified: { by: process:checker, at: 2026-08-03 }")).trust_tier, "unverified", "undated generation cannot establish a current review");
    assert.equal((await probe("generated: { by: process:fixture, at: '2026-08-03T00:00:00.000000002Z' }\nverified: { by: human:reviewer, at: '2026-08-03T00:00:00.000000001Z' }")).trust_tier, "unverified", "submillisecond precision cannot round an old review up");
    assert.equal((await probe("generated: { by: process:fixture, at: '2026-08-03T00:00:00.000000001Z' }\nverified: { by: human:reviewer, at: '2026-08-03T02:00:00.000000002+02:00' }")).trust_tier, "human-reviewed");
    assert.equal((await probe("verified: { at: 2026-08-03 }\nsources: { title: Missing resource }\ntags: null")).sources.length, 0);
    assert.equal((await probe("verified: { by: human:reviewer, at: 2026-02-30T00:00:00Z }")).trust_tier, "unverified");
    assert.equal((await probe("verified: { by: human:reviewer, at: 2026-08-03T00:00:00 }")).trust_tier, "unverified");
    assert.equal((await probe("stale_after: nonsense")).stale, true, "malformed dates are never fresh");
    assert.equal((await probe("stale_after: 2999-01-01T00:00:00Z")).stale, false);
    assert.equal((await probe("stale_after: null\nverified: []\ngenerated: null\nstatus: provisional")).status, "provisional");
    const deadline = Date.parse("2026-08-03T00:00:00Z");
    assert.equal(okfStale("2026-08-03T02:00:00+02:00", deadline - 1), false);
    assert.equal(okfStale("2026-08-03T02:00:00+02:00", deadline), true);
    assert.equal(okfStale("2026-08-03", deadline), true);
    assert.equal(okfStale("2026-08-03T00:00:00.000000001Z", deadline), false);
    assert.equal(okfStale("2026-08-03T00:00:00.000000001Z", deadline + 1), true);
    assert.equal(okfStale("2026-02-30", deadline), true);
    assert.equal(okfStale("2026-08-03T00:00:00", deadline), true);
    const originalNow = Date.now;
    try {
        Date.now = () => Date.parse("1999-01-01T00:00:00Z");
        const beforeDeadline = await readVisibleContext("modern-catalog", "concepts/current.md", { projectRoot: modernProject });
        assert.equal(beforeDeadline.okf.stale, false, "live provenance must not freeze staleness in the graph cache");
        assert.equal(beforeDeadline.okf.diagnostics.some(({ code }) => code === "stale"), false);
        const beforeRelated = await relatedVisibleContext("modern-catalog", "concepts/current.md", { projectRoot: modernProject });
        assert.equal(beforeRelated.diagnostics.some(({ code }) => code === "stale"), false);
    } finally {
        Date.now = originalNow;
    }

    const beforeReviewDigest = modernPack.pack.digest;
    write(join(modern, "concepts", "current.md"), readFileSync(join(modern, "concepts", "current.md"), "utf8").replace("human:missing-date", "human:reviewer, at: 2026-08-04"));
    const reviewUpdate = await inspectContextPackUpdate("modern-catalog", { projectRoot: modernProject });
    assert.equal(reviewUpdate.changed, true);
    await applyContextPackUpdate("modern-catalog", reviewUpdate.candidate_digest, { projectRoot: modernProject });
    const reviewedRead = await readVisibleContext("modern-catalog", "concepts/current.md", { projectRoot: modernProject });
    assert.equal(reviewedRead.okf.trust_tier, "human-reviewed");
    assert.notEqual(reviewedRead.pack_digest, beforeReviewDigest);
    assert.equal((await indexOkfBundle(join(process.env.CAIRN_PACK_BASE_DIR, "objects", beforeReviewDigest), modernPack.pack.manifest.files.map(({ path }) => path), "0.3")).files.find(({ path }) => path === "concepts/current.md").concept.trust_tier, "machine-confirmed", "updating never rewrites the previous immutable object");

    for (const version of ["0.1", "0.2", "0.3"]) {
        const paths = join(root, `paths-${version}`);
        write(join(paths, "index.md"), `---\nokf_version: "${version}"\n---\n`);
        write(join(paths, "concepts", "from.md"), "---\ntype: Reference\nresource: concepts/target.md\ncomputation: ../../outside.md\n---\n[escape](%2e%2e/%2e%2e/outside.md)\n");
        write(join(paths, "concepts", "target.md"), "---\ntype: Reference\n---\nLocal.\n");
        const from = (await validateOkfBundle(paths)).files.find(({ path }) => path === "concepts/from.md");
        assert.deepEqual(from.outbound, version === "0.3" ? [] : ["concepts/target.md"], "legacy root fallback is version-bound and never reads outside the bundle");
        assert.ok(from.broken_links.includes("!unsafe-path"));
    }

    const references = join(root, "reference-links");
    write(join(references, "from.md"), `---
type: Reference
---
[Full][target], [Collapsed][], [Shortcut], [Inline](one.md).

[target]: one.md
[Collapsed]: two.md
[Shortcut]: three.md
[Unused]: unused.md
[Inline]: unused.md
`);
    for (const name of ["one", "two", "three", "unused"]) write(join(references, `${name}.md`), "---\ntype: Reference\n---\nSynthetic.\n");
    assert.deepEqual((await validateOkfBundle(references)).files.find(({ path }) => path === "from.md").outbound, ["one.md", "three.md", "two.md"]);
    await assert.rejects(() => indexOkfBundle(modern, ["index.md", "concepts/current.md"], "0.2"), /pinned manifest/);
    const duplicateYaml = join(root, "duplicate-yaml");
    write(join(duplicateYaml, "bad.md"), "---\ntype: Reference\ntype: Policy\n---\nSynthetic.\n");
    await assert.rejects(() => validateOkfBundle(duplicateYaml), /YAML/);
    const oversized = join(root, "oversized");
    write(join(oversized, "good.txt"), "x".repeat(1024 * 1024));
    assert.equal((await validateOkfBundle(oversized)).files[0].bytes, 1024 * 1024);
    write(join(oversized, "bad.md"), "x".repeat(1024 * 1024 + 1));
    await assert.rejects(() => validateOkfBundle(oversized), /OKF file is unsafe, changed or unreadable/);

    const missingType = join(root, "missing-type");
    mkdirSync(missingType);
    write(join(missingType, "bad.md"), "---\ntitle: Missing type\n---\nBad.\n");
    const skipped = await validateOkfBundle(missingType);
    assert.equal(skipped.concepts.length, 0);
    assert.ok(skipped.diagnostics.some(({ code }) => code === "ignored-file"));

    const aliases = join(root, "aliases");
    mkdirSync(aliases);
    write(join(aliases, "bad.md"), "---\ntype: Reference\ntags: &tags [one]\nalso: *tags\n---\nBad.\n");
    await assert.rejects(() => validateOkfBundle(aliases), /alias/i);

    const collision = join(root, "collision");
    mkdirSync(collision);
    write(join(collision, "docs.md"), "portable\n");
    await assert.rejects(
        () => indexOkfBundle(collision, ["docs.md", "Docs.md"]),
        /duplicate portable/i,
    );
    if (process.platform !== "win32") {
        const unicodeCollision = join(root, "unicode-collision");
        mkdirSync(unicodeCollision);
        write(join(unicodeCollision, "σ.md"), "sigma\n");
        write(join(unicodeCollision, "ς.md"), "final sigma\n");
        await assert.rejects(() => indexOkfBundle(unicodeCollision), /duplicate portable/i);

        const decomposedOnly = join(root, "decomposed-only");
        mkdirSync(decomposedOnly);
        write(join(decomposedOnly, "cafe\u0301.md"), `---
type: Reference
title: Canonical cafe
---
Validated through its retained physical path.
`);
        const decomposedBundle = await validateOkfBundle(decomposedOnly);
        assert.equal(decomposedBundle.files[0].path, "café.md");
        const decomposedInstalled = await installOkfContextPack(decomposedOnly, {
            id: "decomposed-okf", version: "1.0.0", title: "Decomposed OKF", description: "Raw path fixture", license: "none",
        });
        assert.equal(decomposedInstalled.pack.manifest.files[0].path, "café.md");
    }

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
