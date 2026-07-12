// Offline, fail-closed guard for the `context_explore` tool (CTX-01/CTX-02).
// Anchors on tool registration (RED until Plan 02 lands it, GREEN after), then
// exercises the not-configured / binary-missing / repo-root-unresolvable
// precondition throws plus the non-zero-exit / malformed-stdout / empty /
// populated post-spawn outcomes against fake-binary fixtures — no live
// `token_miser` binary, no network, no FastContext endpoint anywhere here.
// Run: node scripts/smoke-explore-guard.mjs   (after `npm run build`)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chmodSync } from "node:fs";
import { resolve } from "node:path";

let failures = 0;
function check(name, cond) {
    console.log(`${cond ? "ok" : "FAIL"}: ${name}`);
    if (!cond) failures += 1;
}

const fixture = (name) => resolve("scripts/fixtures", name);
for (const name of [
    "fake-tokenmiser-exit1.sh",
    "fake-tokenmiser-garbage.sh",
    "fake-tokenmiser-empty.sh",
    "fake-tokenmiser-cited.sh",
]) {
    chmodSync(fixture(name), 0o755);
}

// Opens a fresh client/server pair with the given env, runs `fn(client)`,
// always closes the client afterward.
async function withClient(env, fn) {
    const transport = new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
        env: { ...process.env, ...env },
    });
    const client = new Client({ name: "smoke-explore-guard", version: "0" }, { capabilities: {} });
    await client.connect(transport);
    try {
        return await fn(client);
    } finally {
        await client.close();
    }
}

async function callExplore(client, args) {
    try {
        const res = await client.callTool({ name: "context_explore", arguments: args });
        return { isError: Boolean(res.isError), res };
    } catch {
        return { isError: true, res: null };
    }
}

// 1. Registration anchor — RED before Plan 02, GREEN after.
await withClient({}, async (client) => {
    const { tools } = await client.listTools();
    check("context_explore is registered", tools.some((t) => t.name === "context_explore"));
});

// 2. Not configured: CAIRN_EXPLORE_BINARY set to empty string.
await withClient({ CAIRN_EXPLORE_BINARY: "" }, async (client) => {
    const { isError } = await callExplore(client, { query: "anything", repo_root: "/tmp" });
    check("not configured (empty CAIRN_EXPLORE_BINARY) fails closed", isError);
});

// 3. Binary missing: CAIRN_EXPLORE_BINARY points at a nonexistent path.
await withClient({ CAIRN_EXPLORE_BINARY: "/nonexistent/path/to/token_miser" }, async (client) => {
    const { isError } = await callExplore(client, { query: "anything", repo_root: "/tmp" });
    check("binary missing fails closed", isError);
});

// 4. Repo-root unresolvable: no repo_root arg, no CAIRN_EXPLORE_REPO_ROOT env.
await withClient({ CAIRN_EXPLORE_BINARY: fixture("fake-tokenmiser-empty.sh") }, async (client) => {
    const { isError } = await callExplore(client, { query: "anything" });
    check("repo_root unresolvable fails closed", isError);
});

// 5. Non-zero exit: execution-tier failure, never a silent empty-success.
await withClient({ CAIRN_EXPLORE_BINARY: fixture("fake-tokenmiser-exit1.sh") }, async (client) => {
    const { isError, res } = await callExplore(client, { query: "anything", repo_root: "/tmp" });
    check(
        "non-zero exit returns structured ok:false (not a throw)",
        !isError && res?.structuredContent?.ok === false,
    );
});

// 6. Malformed stdout: JSON.parse failure surfaces as ok:false.
await withClient({ CAIRN_EXPLORE_BINARY: fixture("fake-tokenmiser-garbage.sh") }, async (client) => {
    const { res } = await callExplore(client, { query: "anything", repo_root: "/tmp" });
    check("malformed stdout returns structured ok:false", res?.structuredContent?.ok === false);
});

// 7. Empty success: an empty citation list is a first-class success, not an error.
await withClient({ CAIRN_EXPLORE_BINARY: fixture("fake-tokenmiser-empty.sh") }, async (client) => {
    const { res } = await callExplore(client, { query: "anything", repo_root: "/tmp" });
    const sc = res?.structuredContent;
    const text = res?.content?.[0]?.text ?? "";
    check(
        "empty success is ok:true with zero citations",
        sc?.ok === true && sc?.citations?.length === 0,
    );
    check(
        "empty success text mentions turns/tool_calls",
        /turns/.test(text) && /tool_calls/.test(text),
    );
});

// 8. Populated citations: compact path:line-range rendering (CTX-01/D-02).
await withClient({ CAIRN_EXPLORE_BINARY: fixture("fake-tokenmiser-cited.sh") }, async (client) => {
    const { res } = await callExplore(client, { query: "anything", repo_root: "/tmp" });
    const sc = res?.structuredContent;
    const text = res?.content?.[0]?.text ?? "";
    check(
        "populated success is ok:true with two citations",
        sc?.ok === true && sc?.citations?.length === 2,
    );
    check("populated text contains a compact path:line-range line", /.+:\d+-\d+/.test(text));
});

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nExplore guard checks passed");
