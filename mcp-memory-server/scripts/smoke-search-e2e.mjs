// End-to-end: spawn the built MCP server and call memory_search over stdio.
// Run: node scripts/smoke-search-e2e.mjs [scope] [query]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scope = process.argv[2] ?? "identity";
const query = process.argv[3] ?? "developer workflow preferences";

const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: process.env,
});
const client = new Client({ name: "smoke-search", version: "0" }, { capabilities: {} });
await client.connect(transport);

const tools = await client.listTools();
const names = tools.tools.map((t) => t.name);
console.log("tools:", names.join(", "));
if (!names.includes("memory_search")) {
    console.error("FAIL: memory_search not registered");
    await client.close();
    process.exit(1);
}

const res = await client.callTool({
    name: "memory_search",
    arguments: { scope, query, top_k: 3 },
});
const out = res.structuredContent ?? JSON.parse(res.content?.[0]?.text ?? "{}");
console.log(`scope=${scope} query="${query}"`);
console.log(`mode=${out.mode} model=${out.model ?? "-"} count=${out.count}`);
for (const r of out.results ?? []) {
    const score = typeof r.score === "number" ? r.score.toFixed(4) : r.score;
    console.log(`  [${score}] ${r.scope}:${r.key}`);
}

await client.close();
console.log(out.mode === "semantic" ? "\nE2E ok (semantic)" : "\nE2E ok (fallback mode)");
