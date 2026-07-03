// End-to-end guard: spawn the built MCP server and confirm a traversal/absolute
// `scope` cannot escape CAIRN_AGENTFS_BASE_DIR (SEC-0001 regression).
// Run: node scripts/smoke-scope-guard.mjs   (after `npm run build`)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
function check(name, cond) {
    console.log(`${cond ? "ok" : "FAIL"}: ${name}`);
    if (!cond) failures += 1;
}

const baseDir = mkdtempSync(join(tmpdir(), "cairn-base-"));
const escapeDir = mkdtempSync(join(tmpdir(), "cairn-escape-"));
const sentinel = join(escapeDir, "pwned.db");

const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, CAIRN_AGENTFS_BASE_DIR: baseDir },
});
const client = new Client({ name: "smoke-scope-guard", version: "0" }, { capabilities: {} });
await client.connect(transport);

async function writeScope(scope) {
    try {
        const res = await client.callTool({
            name: "memory_write",
            arguments: { scope, key: "x", value: "planted" },
        });
        // A rejected tool call surfaces as isError; treat that as "blocked".
        return { blocked: Boolean(res.isError), res };
    } catch {
        return { blocked: true };
    }
}

// 1. absolute-path scope must be rejected and must not create a db there
const abs = await writeScope(`${escapeDir}/pwned`);
check("absolute scope rejected", abs.blocked);
check("absolute scope created no file outside base dir", !existsSync(sentinel));

// 2. traversal scope must be rejected
const trav = await writeScope("../../../../tmp/cairn-escape-traversal");
check("traversal scope rejected", trav.blocked);
check("traversal scope created no db in /tmp", !existsSync("/tmp/cairn-escape-traversal.db"));

// 3. a legitimate kebab-case scope still works
const ok = await writeScope("domain-engineering");
check("legit kebab-case scope accepted", !ok.blocked);

await client.close();
rmSync(baseDir, { recursive: true, force: true });
rmSync(escapeDir, { recursive: true, force: true });

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nScope guard checks passed");
