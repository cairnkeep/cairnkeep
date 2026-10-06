import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [pluginPath, repoPath, fixturePath] = process.argv.slice(2);
assert.ok(pluginPath && repoPath && fixturePath, "usage: harness <plugin.ts> <repo> <fixture.json>");

const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const module = await import(`${pathToFileURL(pluginPath).href}?test=${Date.now()}`);
// Dual entrypoint (2026-09-08): legacy builds exported MemoryCapturePlugin as a
// named export; the V1/V2 dual module exposes the same V1 implementation via
// `default.server`. Either way this harness drives the V1 hook map.
const factory = module.MemoryCapturePlugin ?? module.default?.server;
assert.equal(typeof factory, "function");

const client = {
    session: {
        get: async () => ({ data: { id: fixture.session.id } }),
        messages: async () => ({ data: fixture.messages }),
    },
};
const plugin = await factory({ client, directory: repoPath });
assert.equal(typeof plugin.event, "function");
await plugin.event({
    event: {
        type: "session.idle",
        properties: { sessionID: fixture.session.id },
    },
});
