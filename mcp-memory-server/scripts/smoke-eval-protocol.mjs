import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { auditMemoryProtocol, readProtocolTrajectory } from "../dist/eval-protocol.js";
import { normalizeClaudeTranscript, normalizeOpenCodeSession, normalizePiSession } from "../dist/trajectory-normalize.js";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "cairn-eval-protocol-")));
const cli = new URL("../dist/eval-cli.js", import.meta.url);
const event = (kind, payload) => ({ kind, payload });
const call = (id, tool, input) => event("tool_invocation", { call_id: id, tool_name: tool, input });
const result = (id, output, is_error = false) => event("tool_result", { call_id: id, output, is_error });
const searchOutput = { mode: "substring", count: 0, results: [] };
const success = [call("a", "memory_search", { scope: "project", query: "secret-query-sentinel" }), result("a", JSON.stringify(searchOutput))];
function session(events = success, options = {}) {
    return {
        schema_version: 1, session_id: "private-session-sentinel", harness: "pi",
        project_root: "private-root-sentinel", started_at: "2026-10-07T00:00:00.000Z", ended_at: "2026-10-07T00:01:00.000Z",
        events: events.map((e, sequence) => ({ ...e, sequence })),
        capture: { captured_at: "2026-10-07T00:01:00.000Z", omitted_reasoning_blocks: 0, omitted_unknown_records: 0, truncated: false },
        ...options,
    };
}
const audit = (s, approved = false) => auditMemoryProtocol(s, "0".repeat(64), approved);
function check(s, name) { return audit(s).checks.find(c => c.id === name); }
function run(args, enabled = true) {
    const env = { ...process.env, CAIRN_EVAL: enabled ? "1" : "0" };
    return spawnSync(process.execPath, [fileURLToPath(cli), "protocol", ...args], { env, encoding: "utf8", cwd: scratch });
}

try {
    const nativeClaude = join(scratch, "claude.jsonl");
    writeFileSync(nativeClaude, [
        { type: "assistant", sessionId: "native", message: { role: "assistant", content: [{ type: "tool_use", id: "a", name: "mcp__cairn-memory__memory_search", input: { scope: "project", query: "task" } }] } },
        { type: "user", sessionId: "native", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: JSON.stringify(searchOutput), is_error: false }] } },
    ].map(value => JSON.stringify(value)).join("\n"));
    const nativeOpenCode = { session: { id: "native" }, messages: [{ info: { role: "assistant" }, parts: [{ type: "tool", callID: "a", tool: "cairn-memory_memory_search", state: { status: "completed", input: { scope: "project", query: "task" }, output: JSON.stringify(searchOutput) } }] }] };
    const nativePi = { session: { id: "native", entries: [
        { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "a", name: "memory_search", arguments: { scope: "project", query: "task" } }] } },
        { type: "message", message: { role: "toolResult", toolCallId: "a", isError: false, content: [{ type: "text", text: JSON.stringify(searchOutput) }] } },
    ] } };
    for (const normalized of [await normalizeClaudeTranscript(nativeClaude, scratch), normalizeOpenCodeSession(nativeOpenCode, scratch), normalizePiSession(nativePi, scratch)]) {
        assert.equal(audit(normalized).status, "pass", `native normalization: ${normalized.harness}`);
    }
    for (const [harness, tool] of [["pi", "memory_search"], ["opencode", "cairn-memory_memory_search"], ["claude-code", "mcp__cairn-memory__memory_search"]]) {
        const s = session([call("a", tool, { scope: "project", query: "task" }), result("a", JSON.stringify(searchOutput))], { harness });
        assert.equal(audit(s).status, "pass", harness);
    }
    const narrated = session([event("model_output", { text: JSON.stringify(success) })]);
    assert.equal(audit(narrated).status, "fail", "narrated tool calls must fail");
    assert.equal(check(session([call("a", "bash", { command: "pwd" }), result("a", "secret-output-sentinel"), ...success.map(e => ({ ...e, payload: { ...e.payload, call_id: "b" } }))]), "memory_first").status, "fail");
    assert.equal(check(session([call("a", "memory_search", { scope: "all", query: "task" }), result("a", JSON.stringify(searchOutput))]), "memory_first").status, "fail");
    assert.equal(check(session([success[0], result("a", "failed", true)]), "retrieval_result").status, "inconclusive");
    assert.equal(check(session([success[0]]), "retrieval_result").status, "inconclusive");
    for (const output of ["I searched memory", { isError: true, content: [] }, { ok: false }, { count: 2, mode: "substring", results: [] }, { count: 0, mode: { toString: null }, results: [] }]) {
        assert.equal(check(session([success[0], result("a", output)]), "retrieval_result").status, "inconclusive");
    }
    const wrapped = { content: [{ type: "text", text: JSON.stringify(searchOutput) }] };
    assert.equal(audit(session([success[0], result("a", wrapped)])).status, "pass");
    let nested = searchOutput; for (let i = 0; i < 100; i++) nested = { structuredContent: nested };
    assert.equal(check(session([success[0], result("a", nested)]), "retrieval_result").status, "inconclusive");
    assert.equal(check(session([call("a", "untrusted_memory_search", { scope: "project" }), success[1]]), "memory_first").status, "fail");
    const incomplete = session(success, { capture: { ...session().capture, truncated: true } });
    assert.equal(audit(incomplete).status, "inconclusive");
    assert.equal(audit(session(success, { capture: { ...session().capture, omitted_unknown_records: 1 } })).status, "inconclusive");
    assert.equal(audit(session(success, { capture: { ...session().capture, omitted_reasoning_blocks: 5 } })).status, "pass");
    for (const tool of ["memory_write", "memory_supersede", "memory_delete", "memory_apply_reviewed", "memory_invalidate_reviewed", "memory_import"]) {
        const written = session([...success, call("w", tool, { scope: "project", key: "private-key-sentinel" }), result("w", "done")]);
        assert.equal(audit(written).status, "fail", tool);
        assert.equal(audit(written, true).status, "pass", tool);
        assert.notEqual(audit(written).policy_digest, audit(written, true).policy_digest);
    }
    assert.equal(audit(session([...success, call("w", "memory_write", {}), result("w", "denied", true)])).status, "fail", "attempted writes count even when denied");
    assert.equal(audit(session([...success, call("w", "bash", { command: "cairn memory write" }), result("w", "done")])).status, "inconclusive", "shell-mediated writes cannot be certified");
    for (const events of [[...success, success[0]], [result("a", "orphan")], [success[1], success[0]], [...success, success[1]]]) {
        assert.throws(() => audit(session(events)), /protocol_invalid_events/);
    }
    const reordered = session(); reordered.events[1].sequence = 0;
    assert.throws(() => audit(reordered), /protocol_invalid_events/);
    const file = join(scratch, "trajectory.json");
    writeFileSync(file, JSON.stringify(session()), { mode: 0o600 });
    const loaded = readProtocolTrajectory(file);
    assert.equal(loaded.digest.length, 64);
    assert.equal(auditMemoryProtocol(loaded.session, loaded.digest).status, "pass");
    const bytes = readFileSync(file);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error("unexpected network request"); };
    try { assert.equal(auditMemoryProtocol(readProtocolTrajectory(file).session, loaded.digest).status, "pass"); }
    finally { globalThis.fetch = originalFetch; }
    const output = run(["--trajectory", file, "--json"]);
    assert.equal(output.status, 0, output.stderr);
    assert.doesNotMatch(output.stdout + output.stderr, /secret-query|secret-output|private-root|private-session|private-key/);
    assert.deepEqual(readFileSync(file), bytes, "audit changed the input");
    assert.deepEqual(JSON.parse(output.stdout), auditMemoryProtocol(loaded.session, loaded.digest));
    const disabled = run(["--trajectory", "unreadable-sentinel", "--json"], false);
    assert.equal(disabled.status, 0);
    assert.equal(JSON.parse(disabled.stdout).enabled, false);
    writeFileSync(file, JSON.stringify(narrated)); assert.equal(run(["--trajectory", file, "--json"]).status, 1);
    writeFileSync(file, JSON.stringify(incomplete)); assert.equal(run(["--trajectory", file, "--json"]).status, 3);
    writeFileSync(file, "secret-malformed-sentinel");
    const invalid = run(["--trajectory", file, "--json"]);
    assert.equal(invalid.status, 2); assert.doesNotMatch(invalid.stderr, /secret-malformed|trajectory.json/);
    writeFileSync(file, Buffer.from([0xff, 0xfe])); assert.throws(() => readProtocolTrajectory(file), /protocol_input/);
    writeFileSync(file, Buffer.alloc(16 * 1024 * 1024 + 1)); assert.throws(() => readProtocolTrajectory(file), /protocol_input/);
    mkdirSync(join(scratch, "directory")); assert.throws(() => readProtocolTrajectory(join(scratch, "directory")), /protocol_input/);
    if (process.platform !== "win32") {
        symlinkSync(file, join(scratch, "link")); assert.throws(() => readProtocolTrajectory(join(scratch, "link")), /protocol_input/);
        symlinkSync(scratch, join(scratch, "parent-link")); assert.throws(() => readProtocolTrajectory(join(scratch, "parent-link", "trajectory.json")), /protocol_input/);
    }
    assert.equal(run(["--trajectory", file, "--capture-authorized", "--capture-authorized"]).status, 2);
    console.log("PASS: offline memory protocol audit, negative controls, privacy, and gated CLI");
} finally {
    rmSync(scratch, { recursive: true, force: true });
}
