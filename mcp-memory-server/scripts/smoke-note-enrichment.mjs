import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { distillProject } from "../dist/note-distiller.js";
import { enrichNoteEvidence } from "../dist/note-enrichment.js";
import { getTrajectoryLimits, trajectorySessionSchema } from "../dist/trajectory-schema.js";
import { putTrajectory } from "../dist/trajectory-store.js";

const here = dirname(fileURLToPath(import.meta.url));

const original = { ...process.env };
let requests = [];
let mode = "valid";

const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
        requests.push({ url: request.url, body: Buffer.concat(chunks).toString("utf8") });
        if (mode === "delayed") {
            setTimeout(() => {
                response.writeHead(200, { "content-type": "application/json" });
                response.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
            }, 500);
            return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        const content = mode === "malformed"
            ? "not json"
            : JSON.stringify({
                summary: "A validation run exposed a stable undefined-user failure.",
                lessons: ["Validate the user value before reading its name."],
                caveats: ["The evidence does not establish why the value was absent."],
            });
        response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
});

await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const address = server.address();
assert.ok(address && typeof address === "object");
const endpoint = `http://127.0.0.1:${address.port}/v1`;

const evidence = {
    id: "fixture-note",
    normalized_error: "typeerror: cannot read properties of undefined (reading 'name')",
    component: "src/user.ts",
    status: "resolved",
    attempts: ["npm test failed with [REDACTED:API_KEY]", "npm test passed"],
};

function clearConfig() {
    delete process.env.CAIRN_NOTE_DISTILLATION;
    delete process.env.CAIRN_NOTE_ENRICHMENT;
    delete process.env.CAIRN_LLM_API_KEY;
    delete process.env.CAIRN_LLM_API_URL;
    delete process.env.CAIRN_NOTE_ENRICHMENT_MODEL;
    delete process.env.CAIRN_NOTE_ENRICHMENT_TIMEOUT_MS;
}

try {
    clearConfig();
    process.env.CAIRN_LLM_API_KEY = "sk-test-note-secret-never-sent";
    let result = await enrichNoteEvidence(evidence);
    assert.equal(result.status, "enrichment_skipped");
    assert.equal(requests.length, 0, "API key alone triggered enrichment");

    process.env.CAIRN_NOTE_DISTILLATION = "1";
    process.env.CAIRN_NOTE_ENRICHMENT = "1";
    result = await enrichNoteEvidence(evidence);
    assert.equal(result.status, "enrichment_skipped");
    assert.equal(requests.length, 0, "incomplete provider config triggered enrichment");

    process.env.CAIRN_LLM_API_URL = endpoint;
    process.env.CAIRN_NOTE_ENRICHMENT_MODEL = "fixture-note-model";
    result = await enrichNoteEvidence(evidence);
    assert.equal(result.status, "enriched");
    assert.match(result.enrichment.summary, /stable undefined-user failure/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/v1/chat/completions");
    const requestBody = JSON.parse(requests[0].body);
    assert.equal(requestBody.model, "fixture-note-model");
    assert.equal(requestBody.temperature, 0);
    assert.ok(requestBody.max_tokens <= 1200);
    assert.doesNotMatch(requests[0].body, /sk-test-note-secret-never-sent/);
    assert.doesNotMatch(requests[0].body, /private hidden reasoning/i);
    assert.match(requests[0].body, /\[REDACTED:API_KEY\]/);

    const scratch = mkdtempSync(join(tmpdir(), "cairn-notes-enrichment-"));
    const projectRoot = join(scratch, "project");
    mkdirSync(projectRoot, { recursive: true });
    process.env.CAIRN_AGENTFS_BASE_DIR = join(scratch, "store");
    const fixtures = JSON.parse(readFileSync(join(here, "fixtures", "notes", "lifecycle-sessions.json"), "utf8"));
    const session = trajectorySessionSchema.parse(JSON.parse(JSON.stringify(fixtures.failure).replaceAll("$PROJECT_ROOT", projectRoot)));
    await putTrajectory(projectRoot, session, getTrajectoryLimits());
    const integrated = await distillProject({ projectRoot, sessionId: session.session_id });
    assert.equal(integrated.created.length, 1);
    assert.equal(integrated.enrichment_skipped.length, 0);
    assert.equal(integrated.enrichment_failed.length, 0);
    const markdown = readFileSync(integrated.created[0].path, "utf8");
    assert.match(markdown, /Optional generated context/);
    assert.match(markdown, /non-authoritative/);
    assert.match(markdown, /stable undefined-user failure/);
    assert.match(markdown, /status: unresolved/);
    rmSync(scratch, { recursive: true, force: true });

    mode = "malformed";
    const beforeMalformed = requests.length;
    result = await enrichNoteEvidence(evidence);
    assert.equal(result.status, "enrichment_failed");
    assert.ok(requests.length <= beforeMalformed + 2, "enrichment retried more than once");

    mode = "delayed";
    process.env.CAIRN_NOTE_ENRICHMENT_TIMEOUT_MS = "100";
    result = await enrichNoteEvidence(evidence);
    assert.equal(result.status, "enrichment_failed");

    console.log("PASS: optional note enrichment consent, privacy and fail-open behavior");
} finally {
    server.closeAllConnections?.();
    await new Promise((resolvePromise) => server.close(resolvePromise));
    for (const key of Object.keys(process.env)) {
        if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
}
