// Offline, no-network end-to-end proof of context_explore cross-referencing
// (CTX-08): seeds a temp repo_root's .agentfs/project.db + .planning/wiki/
// sources with a "widget" entry/page, drives the context_explore MCP tool
// (withClient/callExplore, mirroring smoke-explore-guard.mjs) against a fake
// token_miser binary that cites one matching path and one non-matching path,
// and asserts memory_refs/wiki_refs land only on the matching citation while
// the non-matching citation and a fully unseeded repo stay byte-identical to
// the pre-phase plain rendering (D-03/D-04). Uses "widget"/"gadget" (not the
// existing fake-tokenmiser-cited.sh's "foo"/"bar") because those stems are
// only 3 chars -- below D-02's >= 4 char noise guard -- so they can never
// produce a cross-ref hit; a >= 4 char stem is required to exercise this
// feature at all. CAIRN_EXPLORE_CACHE=0 so every call spawns fresh
// (deterministic enrichment-on-every-return proof, D-12).
// Run: node scripts/smoke-explore-crossref.mjs   (after `npm run build`)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentFS } from "agentfs-sdk";

let failures = 0;
function check(name, cond) {
    console.log(`${cond ? "ok" : "FAIL"}: ${name}`);
    if (!cond) failures += 1;
}

const fixture = resolve("scripts/fixtures/fake-tokenmiser-crossref.sh");
chmodSync(fixture, 0o755);

async function withClient(env, fn) {
    const transport = new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
        env: { ...process.env, CAIRN_EXPLORE_BINARY: fixture, CAIRN_EXPLORE_CACHE: "0", ...env },
    });
    const client = new Client({ name: "smoke-explore-crossref", version: "0" }, { capabilities: {} });
    await client.connect(transport);
    try {
        return await fn(client);
    } finally {
        await client.close();
    }
}

async function callExplore(client, repoRoot) {
    const res = await client.callTool({
        name: "context_explore",
        arguments: { query: "anything", repo_root: repoRoot },
    });
    return { sc: res.structuredContent, text: res.content?.[0]?.text ?? "" };
}

function findCitation(sc, path) {
    return sc?.citations?.find((c) => c.path === path);
}

// --- Fixture repo 1: seeded with a "widget" memory entry + wiki page ---
const seededRoot = mkdtempSync(join(tmpdir(), "crossref-smoke-seeded-"));
// Seeding via a subprocess (not an in-process AgentFS.open + close) so the
// db file is guaranteed unlocked before the MCP server subprocess opens it.
execFileSync("node", ["-e", `
    const { AgentFS } = require("agentfs-sdk");
    const { mkdirSync } = require("fs");
    const { join } = require("path");
    (async () => {
        mkdirSync(join(${JSON.stringify(seededRoot)}, ".agentfs"), { recursive: true });
        const agent = await AgentFS.open({ id: "project", path: join(${JSON.stringify(seededRoot)}, ".agentfs", "project.db") });
        await agent.kv.set("patterns/widget-handling", "notes about widget module behavior");
        await agent.close();
    })();
`], { stdio: "inherit" });
mkdirSync(join(seededRoot, ".planning", "wiki", "sources"), { recursive: true });
writeFileSync(
    join(seededRoot, ".planning", "wiki", "sources", "widget-notes.md"),
    "# Widget notes\n\n- **Widget module behavior is documented here.**\n",
);

await withClient({}, async (client) => {
    const { sc, text } = await callExplore(client, seededRoot);
    const widget = findCitation(sc, "src/widget.rs");
    const gadget = findCitation(sc, "src/gadget.rs");

    check("seeded run is ok:true", sc?.ok === true);
    check(
        "matching citation (src/widget.rs) has non-empty memory_refs",
        Array.isArray(widget?.memory_refs) && widget.memory_refs.length > 0,
    );
    check(
        "matching citation (src/widget.rs) has non-empty wiki_refs",
        Array.isArray(widget?.wiki_refs) && widget.wiki_refs.length > 0,
    );
    check(
        "non-matching citation (src/gadget.rs) has no memory_refs",
        gadget?.memory_refs === undefined,
    );
    check(
        "non-matching citation (src/gadget.rs) has no wiki_refs",
        gadget?.wiki_refs === undefined,
    );
    check("rendered text has a cross-ref marker on the widget line", /src\/widget\.rs:10-42.+widget/.test(text));
    check(
        "rendered text keeps the gadget line plain",
        text.split("\n").some((line) => line === "src/gadget.rs:5-9"),
    );
});

rmSync(seededRoot, { recursive: true, force: true });

// --- Fixture repo 2: no seeded db/wiki -- fail-open, byte-identical plain output ---
const bareRoot = mkdtempSync(join(tmpdir(), "crossref-smoke-bare-"));

await withClient({}, async (client) => {
    const { sc, text } = await callExplore(client, bareRoot);
    const widget = findCitation(sc, "src/widget.rs");
    const gadget = findCitation(sc, "src/gadget.rs");

    check("bare (no-seed) run is ok:true", sc?.ok === true);
    check("bare run: no memory_refs on either citation", widget?.memory_refs === undefined && gadget?.memory_refs === undefined);
    check("bare run: no wiki_refs on either citation", widget?.wiki_refs === undefined && gadget?.wiki_refs === undefined);
    check(
        "bare run renders byte-identical to plain path:line-range listing",
        text === "src/widget.rs:10-42\nsrc/gadget.rs:5-9",
    );
});

rmSync(bareRoot, { recursive: true, force: true });

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nExplore cross-ref checks passed");
