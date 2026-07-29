import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../dist/trajectory-cli.js");
const baseFixture = JSON.parse(readFileSync(join(here, "fixtures", "trajectory-opencode.json"), "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "cairn-trajectory-retention-"));
const repo = join(scratch, "project");

function run(args, options = {}) {
    return spawnSync(process.execPath, [cli, ...args], {
        cwd: repo,
        encoding: "utf8",
        input: options.input,
        env: { ...process.env, ...options.env },
    });
}

function fixture(id, endedMs, payload = "ok") {
    const value = structuredClone(baseFixture);
    value.session.id = id;
    value.session.time.created = endedMs - 4000;
    value.session.time.updated = endedMs;
    for (const message of value.messages) message.info.sessionID = id;
    value.messages.at(-1).info.time.completed = endedMs;
    value.messages.at(-1).parts[0].text = payload;
    return JSON.stringify(value);
}

try {
    mkdirSync(join(repo, ".agentfs"), { recursive: true });
    const now = Date.now();
    const commonEnv = {
        CAIRN_TRAJECTORY_SESSION_MAX_BYTES: "4096",
        CAIRN_TRAJECTORY_STORE_MAX_BYTES: "12288",
        CAIRN_TRAJECTORY_RETENTION_DAYS: "30",
    };

    const huge = `prefix-${"🙂".repeat(6000)}-suffix`;
    let result = run(["capture-opencode", repo], { input: fixture("bounded", now, huge), env: commonEnv });
    assert.equal(result.status, 0, result.stderr);
    result = run(["show", "bounded", "--json"], { env: commonEnv });
    assert.equal(result.status, 0, result.stderr);
    const bounded = JSON.parse(result.stdout);
    assert.equal(bounded.capture.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(bounded), "utf8") <= 4096);
    assert.doesNotMatch(JSON.stringify(bounded), /�/, "must not split a UTF-8 sequence");

    for (let index = 0; index < 5; index += 1) {
        result = run(["capture-opencode", repo], {
            input: fixture(`recent-${index}`, now + index * 1000, `payload-${"x".repeat(1800)}-${index}`),
            env: commonEnv,
        });
        assert.equal(result.status, 0, result.stderr);
    }
    const afterBudget = JSON.parse(run(["list", "--json"], { env: commonEnv }).stdout);
    assert.ok(afterBudget.sessions.length < 6, "store budget should prune oldest sessions");
    assert.ok(afterBudget.logical_bytes <= 12288);

    result = run(["capture-opencode", repo], {
        input: fixture("expired", now - 45 * 86400000, "expired"),
        env: { ...commonEnv, CAIRN_TRAJECTORY_RETENTION_DAYS: "365" },
    });
    assert.equal(result.status, 0, result.stderr);
    const dryRun = run(["prune", "--dry-run", "--json"], { env: commonEnv });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.ok(JSON.parse(dryRun.stdout).removed.some((entry) => entry.session_id === "expired"));
    assert.equal(run(["show", "expired", "--json"], { env: commonEnv }).status, 0, "dry-run must preserve data");
    const prune = run(["prune", "--json"], { env: commonEnv });
    assert.equal(prune.status, 0, prune.stderr);
    assert.notEqual(run(["show", "expired", "--json"], { env: commonEnv }).status, 0);

    result = run(["capture-opencode", repo], { input: fixture("idempotent", now, "first"), env: commonEnv });
    assert.equal(result.status, 0, result.stderr);
    result = run(["capture-opencode", repo], { input: fixture("idempotent", now + 1, "second"), env: commonEnv });
    assert.equal(result.status, 0, result.stderr);
    const list = JSON.parse(run(["list", "--json"], { env: commonEnv }).stdout);
    assert.equal(list.sessions.filter((entry) => entry.session_id === "idempotent").length, 1);
    console.log("PASS: trajectory caps, retention, dry-run and idempotency");
} finally {
    rmSync(scratch, { recursive: true, force: true });
}
