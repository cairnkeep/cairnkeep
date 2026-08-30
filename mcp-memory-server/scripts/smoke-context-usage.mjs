import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
    enableContextPack,
    initializeContextPack,
    installContextPack,
    lockContextPack,
    searchVisibleContext,
} from "../dist/context-pack.js";

import {
    appendContextUsageReceipt,
    doctorWorkEvidence,
    getWorkEvidenceStorePath,
    linkActiveContextUsageReceipt,
    readWorkEvidence,
    startWorkEvidence,
} from "../dist/work-evidence-store.js";

const root = mkdtempSync(join(tmpdir(), "cairn-context-usage-"));
const project = join(root, "project");
mkdirSync(project);

function git(args) {
    return execFileSync("git", ["-C", project, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

git(["init", "--quiet"]);
git(["config", "user.email", "fixture@example.invalid"]);
git(["config", "user.name", "Fixture"]);
writeFileSync(join(project, "tracked.txt"), "start\n");
git(["add", "tracked.txt"]);
git(["commit", "--quiet", "-m", "start"]);

const priorEnv = { ...process.env };
process.env.CAIRN_WORK_EVIDENCE = "1";
process.env.CAIRN_PACK_BASE_DIR = join(root, "packs");

const evidenceStartedAt = new Date(Date.now() - 120_000);
const firstReceiptAt = new Date(evidenceStartedAt.getTime() + 60_000);
const replayReceiptAt = new Date(firstReceiptAt.getTime() + 60_000);

try {
    const packSource = join(root, "pack-source");
    mkdirSync(packSource);
    writeFileSync(join(packSource, "guide.md"), "# Receipt guide\n\nRecord only stable result references.\n");
    await initializeContextPack(packSource, {
        id: "receipt-guide",
        version: "1.0.0",
        title: "Receipt guide",
        description: "Context usage fixture",
        license: "Apache-2.0",
    });
    await lockContextPack(packSource);
    const installedPack = await installContextPack(packSource);
    await enableContextPack(installedPack.pack.digest, { projectRoot: project });

    const defaultSearch = await searchVisibleContext("stable result", { projectRoot: project });
    assert.equal("result_digest" in defaultSearch, false, "default search response stays unchanged");
    assert.equal("chunk_digest" in defaultSearch.results[0], false, "default result shape stays unchanged");

    const referencedSearch = await searchVisibleContext("stable result", { projectRoot: project, includeRefs: true });
    const replayedSearch = await searchVisibleContext("stable result", { projectRoot: project, includeRefs: true });
    assert.match(referencedSearch.result_digest, /^[a-f0-9]{64}$/);
    assert.match(referencedSearch.results[0].chunk_digest, /^[a-f0-9]{64}$/);
    assert.equal(replayedSearch.result_digest, referencedSearch.result_digest, "result references are deterministic");
    assert.equal(replayedSearch.results[0].chunk_digest, referencedSearch.results[0].chunk_digest, "chunk references are deterministic");

    const evidence = startWorkEvidence(project, "codex", evidenceStartedAt);
    const taskDigest = "1".repeat(64);
    const resultDigest = "2".repeat(64);
    const first = await appendContextUsageReceipt(project, evidence.evidence_id, {
        task_digest: taskDigest,
        result_digest: resultDigest,
        outcome: "used",
    }, firstReceiptAt);

    assert.ok(first);
    assert.equal(first.kind, "context_usage");
    assert.match(first.receipt_id, /^[a-f0-9]{64}$/);
    assert.equal(first.link_id, first.receipt_id);
    assert.equal(first.task_digest, taskDigest);
    assert.equal(first.result_digest, resultDigest);
    assert.equal(first.outcome, "used");

    const replay = await appendContextUsageReceipt(project, evidence.evidence_id, {
        task_digest: taskDigest,
        result_digest: resultDigest,
        outcome: "used",
    }, replayReceiptAt);
    assert.deepEqual(replay, first, "an exact replay must return the immutable stored receipt");

    await assert.rejects(
        appendContextUsageReceipt(project, evidence.evidence_id, {
            task_digest: taskDigest,
            result_digest: resultDigest,
            outcome: "unused",
        }),
        /conflicting context usage outcome/i,
    );

    await assert.rejects(
        appendContextUsageReceipt(project, "wev_00000000-0000-4000-8000-000000000000", {
            task_digest: taskDigest,
            result_digest: resultDigest,
            outcome: "unknown",
        }),
        /not found/i,
    );

    await assert.rejects(
        appendContextUsageReceipt(project, evidence.evidence_id, {
            task_digest: taskDigest,
            result_digest: "3".repeat(64),
            outcome: "unknown",
            query: "secret query that must never be persisted",
        }),
        /unrecognized key|invalid/i,
    );

    process.env.CAIRN_WORK_EVIDENCE_ID = evidence.evidence_id;
    process.env.CAIRN_WORK_EVIDENCE_ROOT = project;
    const active = await linkActiveContextUsageReceipt(root, {
        task_digest: "6".repeat(64),
        result_digest: "7".repeat(64),
        outcome: "unknown",
    });
    assert.equal(active?.kind, "context_usage");

    const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        cwd: project,
        env: {
            ...process.env,
            CAIRN_CONTEXT_PACKS: "1",
            CAIRN_CONTEXT_USAGE: "1",
            CAIRN_MCP_TOOL_PROFILE: "full",
        },
        stderr: "pipe",
    });
    const client = new Client({ name: "smoke-context-usage", version: "1" }, { capabilities: {} });
    await client.connect(transport);
    try {
        const names = (await client.listTools()).tools.map(({ name }) => name);
        assert.ok(names.includes("context_usage_record"));
        const searched = await client.callTool({
            name: "context_pack_search",
            arguments: { query: "stable result", include_refs: true },
        });
        assert.match(searched.structuredContent.result_digest, /^[a-f0-9]{64}$/);
        assert.match(searched.structuredContent.results[0].chunk_digest, /^[a-f0-9]{64}$/);
        const recorded = await client.callTool({
            name: "context_usage_record",
            arguments: {
                evidence_id: evidence.evidence_id,
                task_digest: "a".repeat(64),
                result_digest: searched.structuredContent.result_digest,
                outcome: "used",
            },
        });
        assert.equal(recorded.structuredContent.recorded, true);
        assert.equal(recorded.structuredContent.receipt.result_digest, searched.structuredContent.result_digest);
    } finally {
        await client.close();
    }

    const readOnlyTransport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        cwd: project,
        env: {
            ...process.env,
            CAIRN_CONTEXT_PACKS: "1",
            CAIRN_CONTEXT_USAGE: "1",
            CAIRN_MCP_TOOL_PROFILE: "read-only",
        },
        stderr: "pipe",
    });
    const readOnlyClient = new Client({ name: "smoke-context-usage-read-only", version: "1" }, { capabilities: {} });
    await readOnlyClient.connect(readOnlyTransport);
    try {
        const names = (await readOnlyClient.listTools()).tools.map(({ name }) => name);
        assert.ok(names.includes("context_pack_search"));
        assert.equal(names.includes("context_usage_record"), false);
    } finally {
        await readOnlyClient.close();
    }

    const customTransport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        cwd: project,
        env: {
            ...process.env,
            CAIRN_CONTEXT_USAGE: "1",
            CAIRN_MCP_TOOL_PROFILE: "custom",
            CAIRN_MCP_ALLOWED_TOOLS: "context_usage_record",
        },
        stderr: "pipe",
    });
    const customClient = new Client({ name: "smoke-context-usage-custom", version: "1" }, { capabilities: {} });
    await customClient.connect(customTransport);
    try {
        assert.deepEqual((await customClient.listTools()).tools.map(({ name }) => name), ["context_usage_record"]);
    } finally {
        await customClient.close();
    }

    const noEvidenceTransport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        cwd: project,
        env: {
            ...process.env,
            CAIRN_WORK_EVIDENCE: "0",
            CAIRN_CONTEXT_USAGE: "1",
            CAIRN_MCP_TOOL_PROFILE: "full",
        },
        stderr: "pipe",
    });
    const noEvidenceClient = new Client({ name: "smoke-context-usage-no-evidence", version: "1" }, { capabilities: {} });
    await noEvidenceClient.connect(noEvidenceTransport);
    try {
        const names = (await noEvidenceClient.listTools()).tools.map(({ name }) => name);
        assert.equal(names.includes("context_usage_record"), false, "context usage must not be advertised when work evidence is disabled");
    } finally {
        await noEvidenceClient.close();
    }

    const disabledTransport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        cwd: project,
        env: {
            ...process.env,
            CAIRN_CONTEXT_PACKS: "1",
            CAIRN_CONTEXT_USAGE: "0",
            CAIRN_MCP_TOOL_PROFILE: "full",
        },
        stderr: "pipe",
    });
    const disabledClient = new Client({ name: "smoke-context-usage-disabled", version: "1" }, { capabilities: {} });
    await disabledClient.connect(disabledTransport);
    try {
        const names = (await disabledClient.listTools()).tools.map(({ name }) => name);
        assert.equal(names.includes("context_usage_record"), false);
    } finally {
        await disabledClient.close();
    }

    delete process.env.CAIRN_WORK_EVIDENCE_ID;
    delete process.env.CAIRN_WORK_EVIDENCE_ROOT;
    assert.equal(await linkActiveContextUsageReceipt(project, {
        task_digest: "8".repeat(64),
        result_digest: "9".repeat(64),
        outcome: "unknown",
    }), null);

    const view = readWorkEvidence(evidence.evidence_id, project);
    assert.equal(view.links.length, 3);
    assert.ok(view.links.some((link) => link.link_id === first.link_id));
    assert.ok(view.links.some((link) => link.link_id === active?.link_id));
    const linkFiles = readdirSync(join(getWorkEvidenceStorePath(project), "links", evidence.evidence_id));
    assert.equal(linkFiles.length, 3);
    const persisted = readFileSync(join(getWorkEvidenceStorePath(project), "links", evidence.evidence_id, `${first.receipt_id}.json`), "utf8");
    for (const forbidden of ["query", "content", "prompt", "model_output", "secret query"]) {
        assert.equal(persisted.includes(forbidden), false, `receipt persisted forbidden field: ${forbidden}`);
    }
    assert.equal(doctorWorkEvidence(project).ok, true);

    const receiptPath = join(getWorkEvidenceStorePath(project), "links", evidence.evidence_id, `${first.receipt_id}.json`);
    const tampered = JSON.parse(readFileSync(receiptPath, "utf8"));
    tampered.receipt_id = "0".repeat(64);
    writeFileSync(receiptPath, `${JSON.stringify(tampered)}\n`);
    const diagnosis = doctorWorkEvidence(project);
    assert.equal(diagnosis.ok, false);
    assert.ok(diagnosis.issues.some((issue) => issue.includes("invalid link")));

    process.env.CAIRN_WORK_EVIDENCE = "0";
    assert.equal(await appendContextUsageReceipt(project, evidence.evidence_id, {
        task_digest: "4".repeat(64),
        result_digest: "5".repeat(64),
        outcome: "unknown",
    }), null);
} finally {
    process.env = priorEnv;
}

console.log("context usage receipt smoke test passed");
