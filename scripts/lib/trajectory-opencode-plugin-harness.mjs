import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [pluginPath, repoPath, fixturePath] = process.argv.slice(2);
assert.ok(pluginPath && repoPath && fixturePath, "usage: harness <plugin.ts> <repo> <fixture.json>");

const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const module = await import(`${pathToFileURL(pluginPath).href}?test=${Date.now()}`);
assert.equal(typeof module.MemoryCapturePlugin, "function");

const client = {
    session: {
        get: async () => ({ data: { id: fixture.session.id } }),
        messages: async () => ({ data: fixture.messages }),
    },
};
const plugin = await module.MemoryCapturePlugin({ client, directory: repoPath });
assert.equal(typeof plugin.event, "function");
await plugin.event({
    event: {
        type: "session.idle",
        properties: { sessionID: fixture.session.id },
    },
});
