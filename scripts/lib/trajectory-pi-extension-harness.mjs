import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [extensionPath, repoPath, fixturePath] = process.argv.slice(2);
assert.ok(extensionPath && repoPath && fixturePath, "usage: harness <extension.ts> <repo> <fixture.json>");

const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const module = await import(`${pathToFileURL(extensionPath).href}?test=${Date.now()}`);
assert.equal(typeof module.default, "function");

let shutdownHandler;
const pi = {
    on(event, handler) {
        if (event === "session_shutdown") shutdownHandler = handler;
    },
};
await module.default(pi);
assert.equal(typeof shutdownHandler, "function");

let sessionReads = 0;
const sessionManager = {
    getSessionId() {
        sessionReads += 1;
        return fixture.session.id;
    },
    getBranch() {
        sessionReads += 1;
        return fixture.session.entries;
    },
};

await shutdownHandler(
    { type: "session_shutdown", reason: "quit" },
    { cwd: repoPath, sessionManager },
);

if (/^(?:1|true|yes|on)$/i.test(process.env.CAIRN_TRAJECTORY_CAPTURE ?? "")) {
    assert.equal(sessionReads, 2, "enabled adapter must read the session ID and active branch exactly once");
} else {
    assert.equal(sessionReads, 0, "disabled adapter must not touch the SessionManager");
}
