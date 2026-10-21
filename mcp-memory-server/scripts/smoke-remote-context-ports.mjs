import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// The previous mock-port formula picked blocked port 10080 for this PID.
// Keep the actual MCP routing assertions, not a mocked successful response.
const target = new URL("./smoke-remote-context.mjs", import.meta.url).href;
const result = spawnSync(process.execPath, ["--input-type=module", "-e",
    `Object.defineProperty(process, "pid", { value: 80 }); await import(${JSON.stringify(target)});`],
{ stdio: "inherit", timeout: 30000 });
assert.ifError(result.error);
assert.equal(result.status, 0, "remote routing must not depend on a PID-derived blocked provider port");
console.log("PASS: remote context mock port remains usable for the blocked-port PID regression");
