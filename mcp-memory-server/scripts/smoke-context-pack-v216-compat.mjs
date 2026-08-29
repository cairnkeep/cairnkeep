import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
    disableContextPack,
    enableContextPack,
    initializeContextPack,
    installContextPack,
    lockContextPack,
    removeContextPack,
    searchVisibleContext,
} from "../dist/context-pack.js";

const root = mkdtempSync(join(tmpdir(), "cairn-context-v216-compat-"));
const project = join(root, "project");
const alpha = join(root, "alpha");
const beta = join(root, "beta");
const previousPackBase = process.env.CAIRN_PACK_BASE_DIR;
const embeddingVariables = [
    "CAIRN_LLM_API_KEY",
    "CAIRN_MEMORY_EMBEDDING_URL",
    "CAIRN_MEMORY_EMBEDDING_MODEL",
    "CAIRN_MEMORY_EMBEDDING_TIMEOUT_MS",
];
const previousEmbedding = Object.fromEntries(embeddingVariables.map((name) => [name, process.env[name]]));
process.env.CAIRN_PACK_BASE_DIR = join(root, "store");
for (const name of embeddingVariables) delete process.env[name];
mkdirSync(project);
mkdirSync(alpha);
mkdirSync(beta);
writeFileSync(join(alpha, "guide.md"), "# Alpha guide\n\nshared immutable gamma.\n");
writeFileSync(join(alpha, "other.md"), "# Other\n\nno match.\n");
writeFileSync(join(beta, "runbook.md"), "# Beta runbook\n\nshared immutable beta.\n");

const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
            data: inputs.map((input, index) => ({
                index,
                embedding: String(input).toLocaleLowerCase("en").includes("gamma") ? [1, 0] : [0, 1],
            })),
        }));
    });
});

const listen = () => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
});
const close = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

const installed = [];
try {
    await initializeContextPack(alpha, {
        id: "compat-alpha", version: "1.0.0", title: "Compatibility alpha",
        description: "Frozen v2.16 alpha pack", license: "Apache-2.0",
    });
    await initializeContextPack(beta, {
        id: "compat-beta", version: "2.0.0", title: "Compatibility beta",
        description: "Frozen v2.16 beta pack", license: "Apache-2.0",
    });
    await lockContextPack(alpha);
    await lockContextPack(beta);
    for (const source of [alpha, beta]) {
        const result = await installContextPack(source);
        installed.push(result.pack.digest);
        await enableContextPack(result.pack.digest, { projectRoot: project });
    }

    const responses = {
        substring: await searchVisibleContext("immutable", { projectRoot: project }),
        no_match: await searchVisibleContext("absent-sentinel", { projectRoot: project }),
        multipack: await searchVisibleContext("shared", { projectRoot: project }),
    };

    await listen();
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("embedding fixture did not bind a TCP port");
    process.env.CAIRN_LLM_API_KEY = "offline-fixture-key";
    process.env.CAIRN_MEMORY_EMBEDDING_URL = `http://127.0.0.1:${address.port}`;
    process.env.CAIRN_MEMORY_EMBEDDING_MODEL = "deterministic-v216-fixture";
    process.env.CAIRN_MEMORY_EMBEDDING_TIMEOUT_MS = "1000";
    responses.embedding = await searchVisibleContext("gamma", { projectRoot: project });

    if (process.env.CAIRN_PRINT_V216_COMPAT === "1") {
        process.stdout.write(`${JSON.stringify(responses, null, 2)}\n`);
    } else {
        const fixturePath = fileURLToPath(new URL("./fixtures/context-pack-v2.16-responses.json", import.meta.url));
        const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
        assert.equal(fixture.fixture.cairnkeep_version, "2.16.0");
        assert.equal(fixture.fixture.source_commit, "e2dcc3a0493061d86c72c7f9fbaa153e5124ec3e");
        assert.deepEqual(responses, fixture.responses, "default flat context-pack responses drifted from the frozen v2.16 contract");
        console.log("PASS: frozen v2.16 context-pack response compatibility");
    }
} finally {
    if (server.listening) await close();
    for (const digest of installed) await disableContextPack(digest, { projectRoot: project });
    for (const digest of installed) await removeContextPack(digest);
    if (previousPackBase === undefined) delete process.env.CAIRN_PACK_BASE_DIR;
    else process.env.CAIRN_PACK_BASE_DIR = previousPackBase;
    for (const name of embeddingVariables) {
        const value = previousEmbedding[name];
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(root, { recursive: true, force: true });
}
