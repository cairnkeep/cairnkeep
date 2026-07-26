import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const cli = join(serverRoot, "dist", "trajectory-cli.js");
const fixtures = join(here, "fixtures");
const scratch = mkdtempSync(join(tmpdir(), "cairn-trajectory-roundtrip-"));

function run(args, options = {}) {
    const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: options.cwd ?? scratch,
        encoding: "utf8",
        input: options.input,
        env: { ...process.env, ...options.env },
    });
    assert.equal(result.status, 0, `${args.join(" ")} failed:\n${result.stderr}`);
    return result.stdout.trim();
}

function semanticProjection(session) {
    return session.events
        .filter((event) => event.kind === "tool_invocation" || event.kind === "tool_result")
        .map((event) => ({
        kind: event.kind,
        tool_name: event.payload?.tool_name,
        call_id: event.payload?.call_id,
        is_error: event.payload?.is_error,
        }));
}

try {
    const claudeRepo = join(scratch, "claude-project");
    const opencodeRepo = join(scratch, "opencode-project");
    const piRepo = join(scratch, "pi-project");
    mkdirSync(join(claudeRepo, ".agentfs"), { recursive: true });
    mkdirSync(join(opencodeRepo, ".agentfs"), { recursive: true });
    mkdirSync(join(piRepo, ".agentfs"), { recursive: true });

    run(["capture-claude", join(fixtures, "trajectory-claude.jsonl"), claudeRepo]);
    run(["capture-opencode", opencodeRepo], {
        input: readFileSync(join(fixtures, "trajectory-opencode.json"), "utf8"),
    });
    run(["capture-pi", piRepo], {
        input: readFileSync(join(fixtures, "trajectory-pi.json"), "utf8"),
    });

    const claude = JSON.parse(run(["show", "claude-session-001", "--json"], { cwd: claudeRepo }));
    const opencode = JSON.parse(run(["show", "opencode-session-001", "--json"], { cwd: opencodeRepo }));
    const pi = JSON.parse(run(["show", "pi-session-001", "--json"], { cwd: piRepo }));

    for (const [harness, session] of [["claude-code", claude], ["opencode", opencode], ["pi", pi]]) {
        assert.equal(session.schema_version, 1);
        assert.equal(session.harness, harness);
        assert.ok(session.started_at);
        assert.ok(session.ended_at);
        assert.ok(Array.isArray(session.events) && session.events.length >= 6);
        assert.deepEqual(session.events.map((event) => event.sequence), session.events.map((_, index) => index));
        assert.ok(session.events.some((event) => event.kind === "tool_invocation" && event.payload.call_id === "tool-1"));
        assert.ok(session.events.some((event) => event.kind === "tool_result" && event.payload.call_id === "tool-1"));
        assert.ok(session.usage?.input_tokens >= 160);
        assert.ok(session.usage?.output_tokens >= 42);
        assert.ok(session.capture?.omitted_reasoning_blocks >= 1);
        assert.ok(session.capture?.omitted_unknown_records >= 1);
        assert.doesNotMatch(JSON.stringify(session), /private hidden reasoning/);
        assert.doesNotMatch(JSON.stringify(session), /raw unknown payload/);
    }

    assert.deepEqual(semanticProjection(claude), semanticProjection(opencode));
    assert.deepEqual(semanticProjection(claude), semanticProjection(pi));
    assert.ok(pi.events.some((event) => event.kind === "system_event" && event.payload.event === "model_change"));
    assert.ok(pi.events.some((event) => event.kind === "system_event"
        && event.payload.event === "model_error"
        && event.payload.message === "Connection error with [REDACTED:API_KEY]"));
    assert.doesNotMatch(JSON.stringify(pi), /sk-live-pi-141414/);
    assert.doesNotMatch(JSON.stringify(pi), /sk-live-pi-error-141414/);
    assert.doesNotMatch(JSON.stringify(pi), /private pi reasoning/);

    const listed = JSON.parse(run(["list", "--json"], { cwd: claudeRepo }));
    assert.equal(listed.sessions.length, 1);
    assert.equal(listed.sessions[0].session_id, "claude-session-001");
    console.log("PASS: trajectory cross-harness structured round-trip");
} finally {
    rmSync(scratch, { recursive: true, force: true });
}
