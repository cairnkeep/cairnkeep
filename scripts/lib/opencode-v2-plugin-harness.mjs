import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [capturePath, recallPath, wakeupPath, repo, trajectoryCli, artifactCli] = process.argv.slice(2);
assert.ok(
  capturePath && recallPath && wakeupPath && repo && trajectoryCli && artifactCli,
  "usage: harness <capture.ts> <recall.ts> <wakeup.ts> <repo> <trajectory-cli.js> <artifact-cli.js>",
);

mkdirSync(join(repo, ".planning", "wiki", "sources"), { recursive: true });
writeFileSync(join(repo, ".planning", "wiki", "index.md"), "# V2 project index\n");
writeFileSync(
  join(repo, ".planning", "wiki", "sources", "release-ledger.md"),
  "# Release ledger\n\n- **Contract:** release-ledger entries are append-only.\n",
);

async function load(file, nonce) {
  return import(`${pathToFileURL(file).href}?v2-contract=${nonce}-${Date.now()}`);
}

const [capture, recall, wakeup] = await Promise.all([
  load(capturePath, "capture"),
  load(recallPath, "recall"),
  load(wakeupPath, "wakeup"),
]);

for (const [name, module] of [
  ["capture", capture],
  ["recall", recall],
  ["wakeup", wakeup],
]) {
  assert.equal(typeof module.default, "object", `${name} must have a V2 default export`);
  assert.match(module.default.id, /^cairnkeep\.memory-/);
  assert.equal(typeof module.default.setup, "function", `${name} must expose V2 setup()`);
  assert.equal(typeof module.default.server, "function", `${name} must retain the V1 server()`);
}

let contextHook;
await wakeup.default.setup({
  location: { directory: repo },
  session: {
    hook: async (name, callback) => {
      assert.equal(name, "context");
      contextHook = callback;
    },
  },
});
assert.equal(typeof contextHook, "function");
const contextEvent = { sessionID: "v2-session", system: [] };
await contextHook(contextEvent);
assert.equal(contextEvent.system.length, 2);
assert.match(contextEvent.system[0].text, /Session-start context/);
assert.match(contextEvent.system[1].text, /V2 project index/);

let beforeHook;
await recall.default.setup({
  location: { directory: repo },
  tool: {
    hook: async (name, callback) => {
      assert.equal(name, "execute.before");
      beforeHook = callback;
    },
  },
});
assert.equal(typeof beforeHook, "function");
const editEvent = {
  tool: "edit",
  sessionID: "v2-session",
  input: { filePath: join(repo, "release-ledger.ts") },
};
await assert.rejects(() => beforeHook(editEvent), /Memory recall.*release-ledger\.md/s);
await beforeHook(editEvent);
await beforeHook({ ...editEvent, tool: "read", input: { filePath: join(repo, "other.ts") } });

const now = Date.now();
let subscribed = false;
const captureContext = {
  location: { directory: repo },
  event: {
    subscribe: async function* ({ signal }) {
      subscribed = true;
      assert.equal(signal instanceof AbortSignal, true);
      yield { type: "session.compacted", data: { sessionID: "v2-session" } };
      yield { type: "session.idle", data: { sessionID: "v2-session" } };
    },
  },
  session: {
    get: async ({ sessionID }) => ({
      id: sessionID,
      time: { created: now, updated: now + 3000 },
      location: { directory: repo },
    }),
    context: async ({ sessionID }) => [
      { type: "user", id: "v2-user", text: "Inspect the release ledger.", time: { created: now + 100 } },
      {
        type: "compaction",
        id: "v2-compaction",
        reason: "manual",
        summary: "# Objective\nKeep the v2 release ledger consistent.\n\nDecision: Use the native OpenCode v2 compaction payload.\n\n# Next Move\nVerify recovery before release.",
        recent: "The most recent transcript window.",
        time: { created: now + 150 },
      },
      {
        type: "assistant",
        id: "v2-assistant",
        finish: "stop",
        time: { created: now + 200, completed: now + 1000 },
        content: [
          { type: "text", text: "The release ledger is consistent." },
          {
            type: "tool",
            id: "v2-tool",
            name: "read_file",
            time: { created: now + 300, ran: now + 400, completed: now + 500 },
            state: { status: "completed", input: { path: "release-ledger.md" }, content: "ok" },
          },
        ],
      },
    ],
  },
};

const cleanup = await capture.default.setup(captureContext);
assert.equal(typeof cleanup, "function");
const db = join(repo, ".agentfs", "trajectory.db");
for (let attempt = 0; attempt < 100 && !existsSync(db); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
cleanup();
assert.equal(subscribed, true, "V2 capture must subscribe to the public event stream");
assert.equal(existsSync(db), true, "V2 idle event must create a trajectory record");

const { spawnSync } = await import("node:child_process");
const shown = spawnSync(process.execPath, [trajectoryCli, "show", "v2-session", "--json"], {
  cwd: repo,
  encoding: "utf8",
});
assert.equal(shown.status, 0, shown.stderr);
const trajectory = JSON.parse(shown.stdout);
assert.equal(trajectory.session_id, "v2-session");
assert.match(readFileSync(db).toString("utf8"), /SQLite format 3/);

const recovered = spawnSync(process.execPath, [artifactCli, "recover", repo, "--session-ref", "opencode:v2-session", "--json"], {
  cwd: repo,
  encoding: "utf8",
});
assert.equal(recovered.status, 0, recovered.stderr);
const compaction = JSON.parse(recovered.stdout);
assert.equal(compaction.session_ref, "opencode:v2-session");
assert.deepEqual(compaction.projection.task_goals, ["Keep the v2 release ledger consistent."]);
assert.deepEqual(compaction.projection.decisions_made, ["Use the native OpenCode v2 compaction payload."]);
assert.deepEqual(compaction.projection.open_todos, ["Verify recovery before release."]);

console.log("PASS: OpenCode V2 exports, context, recall, trajectory, compaction recovery, and V1 compatibility");
