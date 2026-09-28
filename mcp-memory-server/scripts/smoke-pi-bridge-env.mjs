#!/usr/bin/env node

import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { childEnvironment } = await import(pathToFileURL(join(resolve(here, ".."), "dist", "pi-mcp-bridge.js")).href);

const cleaned = childEnvironment({
    PATH: [
        "/tmp/bun-node-744846f84",
        "/home/user/project/node_modules/.bin",
        "/tmp/bun-node-abc/node",
        "/home/user/.local/bin",
        "/usr/bin",
    ].join(":"),
    MCP_HTTP_PORT: "8788",
    CAIRN_MEMORY_HTTP_TOKEN: "test-only-token",
    HOME: "/home/user",
    UNSET_VAR: undefined,
});

assert.equal(
    cleaned.PATH,
    "/home/user/project/node_modules/.bin:/tmp/bun-node-abc/node:/home/user/.local/bin:/usr/bin",
    "only bare /tmp/bun-node-* shim dirs are stripped; nested paths and other entries survive",
);
assert.equal(cleaned.MCP_HTTP_PORT, undefined, "MCP_HTTP_PORT must not leak into a stdio child");
assert.equal(cleaned.UNSET_VAR, undefined, "undefined values are dropped");
assert.equal(cleaned.CAIRN_MEMORY_HTTP_TOKEN, "test-only-token", "unrelated env passes through");
assert.equal(cleaned.HOME, "/home/user", "unrelated env passes through");

assert.equal(
    childEnvironment({ PATH: "/usr/bin" }).PATH,
    "/usr/bin",
    "PATH without shims is untouched",
);
assert.ok(
    "PATH" in childEnvironment({}) === false,
    "absent PATH stays absent",
);

console.log("PASS: pi-mcp-bridge child env strips Bun node shims and MCP_HTTP_PORT");
