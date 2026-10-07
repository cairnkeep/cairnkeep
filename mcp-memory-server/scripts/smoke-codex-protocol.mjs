import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeCodexExec } from "../dist/eval-codex.js";
import { auditMemoryProtocol, readCodexProtocol } from "../dist/eval-protocol.js";
import { verifyReleaseLedger } from "../../scripts/spikes/verify-release-ledger.mjs";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "cairn-codex-protocol-")));
const cli = fileURLToPath(new URL("../dist/eval-cli.js", import.meta.url));
const output = { content: [], structured_content: { mode: "substring", count: 0, results: [] } };
const item = { id: "a", type: "mcp_tool_call", server: "cairn-memory", tool: "memory_search", arguments: { scope: "project", query: "private-query-sentinel" } };
const start = i => ({ type: "item.started", item: { ...i, status: "in_progress" } });
const done = (i, result = output) => ({ type: "item.completed", item: { ...i, status: "completed", result } });
const head = [{ type: "thread.started", thread_id: "private-thread-sentinel" }, { type: "turn.started" }];
const tail = [{ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 1 } }];
const records = (body = [start(item), done(item)]) => [...head, ...body, ...tail];
const jsonl = r => r.map(v => JSON.stringify(v)).join("\n") + "\n";
const audit = r => auditMemoryProtocol(normalizeCodexExec(jsonl(r)), "0".repeat(64));
const check = (r, id) => audit(r).checks.find(c => c.id === id).status;
function run(args, enabled = true) {
    return spawnSync(process.execPath, [cli, "protocol", ...args], { cwd: scratch, encoding: "utf8", timeout: 10_000, env: { ...process.env, CAIRN_EVAL: enabled ? "1" : "0" } });
}
try {
    assert.equal(audit(records()).status, "pass");
    assert.equal(audit(records([
        { type: "item.started", item: { ...item, status: "in_progress", result: null, error: null } },
        { type: "item.completed", item: { ...item, status: "completed", result: output, error: null } },
    ])).status, "pass", "CLI 0.160.1 null result/error snapshots");
    assert.equal(audit(records([start(item), done(item, { content: [{ type: "text", text: JSON.stringify(output.structured_content) }], structured_content: null })])).status, "pass");
    assert.equal(audit(records([{ type: "item.completed", item: { id: "n", type: "agent_message", text: JSON.stringify(item) } }])).status, "fail", "narration is not invocation");
    assert.equal(audit(records([done(item)])).status, "inconclusive", "completion does not establish dispatch ordering");
    assert.equal(audit(records([start(item), { type: "future.event" }, done(item)])).status, "inconclusive");
    assert.equal(audit(records([start(item), done({ ...item, future_field: true })])).status, "inconclusive");
    assert.equal(audit(records([start(item), { type: "error", message: "private-error-sentinel" }, done(item)])).status, "inconclusive");
    assert.equal(audit([...head, start(item), done(item), { type: "turn.failed", error: { message: "failed" } }]).status, "inconclusive");
    assert.equal(audit(records().slice(0, -1)).status, "inconclusive");
    assert.equal(audit([...head, start(item)]).status, "inconclusive");
    assert.equal(check(records([start(item), { type: "item.completed", item: { ...item, status: "failed", error: { message: "private-error-sentinel" } } }]), "retrieval_result"), "inconclusive");
    assert.equal(check(records([start(item), done(item, { content: [], structured_content: { ...output.structured_content, isError: true } })]), "retrieval_result"), "inconclusive");
    const other = { ...item, id: "b", tool: "memory_read", arguments: { scope: "project", key: "private-key-sentinel" } };
    assert.equal(audit(records([start(item), start(other), done(other), done(item)])).status, "pass", "parallel results retain invocation order");
    assert.equal(audit(records([start(item), { type: "item.updated", item: { ...item, status: "in_progress" } }, done(item)])).status, "pass");
    const write = { ...other, tool: "memory_write" };
    assert.equal(audit(records([start(item), done(item), start(write), done(write)])).status, "fail");
    assert.equal(audit(records([start(item), done(item), done(write)])).status, "fail", "missing start must not hide writes");
    for (const server of ["other", "cairn-memory-evil"]) {
        const foreign = { ...item, server };
        assert.equal(audit(records([start(foreign), done(foreign)])).status, "fail");
    }
    for (const body of [[start(item), done(item), done(item)], [start(item), start(item)], [start(item), done({ ...item, tool: "memory_write" })], [start(item), done({ ...item, arguments: { scope: "all" } })]]) {
        assert.throws(() => audit(records(body)), /protocol_input/);
    }
    assert.throws(() => audit([...records(), { type: "turn.started" }, ...tail]), /protocol_input/, "multi-turn input requires task splitting");
    assert.throws(() => normalizeCodexExec(jsonl(records()) + "{bad"), /protocol_input/);
    assert.throws(() => normalizeCodexExec(jsonl(records()) + " \n"), /protocol_input/);
    assert.throws(() => normalizeCodexExec(" ".repeat(16 * 1024 * 1024 + 1)), /protocol_input/);
    assert.equal(auditMemoryProtocol(normalizeCodexExec(jsonl(records()).replaceAll("\n", "\r\n")), "0".repeat(64)).status, "pass");
    assert.throws(() => normalizeCodexExec(jsonl(Array.from({ length: 50_001 }, () => ({ type: "future.event" })))), /protocol_input/);
    const shell = { id: "shell", type: "command_execution", command: "private-command-sentinel" };
    assert.equal(check(records([start(item), done(item), start(shell), done(shell)]), "direct_write_boundary"), "inconclusive");
    assert.equal(audit(records([start(item), done(item), { type: "item.completed", item: { id: "patch", type: "file_change", changes: [], status: "completed" } }])).status, "inconclusive");
    assert.equal(audit(records([start(item), done(item), { type: "item.completed", item: { id: "reason", type: "reasoning", text: "private-reasoning-sentinel" } }])).status, "pass");
    assert.equal(audit(records([start(item), done(item), { type: "item.completed", item: { id: "future", type: "future_tool" } }])).status, "inconclusive");
    const file = join(scratch, "native.jsonl");
    writeFileSync(file, jsonl(records()), { mode: 0o600 });
    const before = readFileSync(file);
    const read = readCodexProtocol(file);
    assert.equal(read.digest.length, 64);
    assert.equal(read.session.harness, "codex");
    const result = run(["--codex-jsonl", file, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /private-|native.jsonl/);
    assert.deepEqual(readFileSync(file), before);
    assert.equal(run(["--codex-jsonl", "missing", "--json"], false).status, 0);
    assert.equal(run(["--codex-jsonl", file, "--trajectory", file]).status, 2);
    assert.equal(run([]).status, 2);
    const unsafe = join(scratch, "invalid.jsonl");
    writeFileSync(unsafe, Buffer.from([0xff]));
    assert.equal(run(["--codex-jsonl", unsafe]).status, 2);
    writeFileSync(unsafe, Buffer.alloc(16 * 1024 * 1024 + 1));
    assert.equal(run(["--codex-jsonl", unsafe]).status, 2);
    if (process.platform !== "win32") {
        symlinkSync(file, join(scratch, "link"));
        assert.equal(run(["--codex-jsonl", join(scratch, "link")]).status, 2);
        const fifo = join(scratch, "fifo");
        assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
        assert.equal(run(["--codex-jsonl", fifo]).status, 2, "native FIFO admission must not block");
    }
    // Cross the two independent dimensions: protocol success is not correctness.
    const validModule = join(scratch, "valid-ledger.mjs");
    writeFileSync(validModule, `import {createHash} from 'node:crypto';
export function createLedger(){let seq=0;const data=new Map();const clone=v=>structuredClone(v);
const fail=code=>{throw Object.assign(new Error(),{code})};
const key=(p,v)=>p+'@'+v;const get=(p,v)=>data.get(key(p,v))??fail('NOT_FOUND');
return {append(x){if(typeof x.package!=='string'||!/^[a-z][a-z0-9-]*$/.test(x.package))fail('INVALID_PACKAGE');
if(typeof x.version!=='string'||!/^\\d+\\.\\d+\\.\\d+$/.test(x.version))fail('INVALID_VERSION');
if(!Array.isArray(x.notes)||!x.notes.length||x.notes.some(n=>typeof n!=='string'||!n.trim()))fail('INVALID_NOTES');
if(data.has(key(x.package,x.version)))fail('DUPLICATE_RELEASE');
const e={package:x.package,version:x.version,notes:[...x.notes],sequence:++seq,state:'draft'};data.set(key(x.package,x.version),e);return clone(e)},
finalize(p,v){const e=get(p,v);if(e.state==='draft'){e.checksum=createHash('sha256').update(JSON.stringify({package:e.package,version:e.version,notes:e.notes,sequence:e.sequence})).digest('hex');e.state='final'}return clone(e)},
get(p,v){return clone(get(p,v))},list(){return clone([...data.values()])}}}
`);
    const invalidModule = join(scratch, "invalid-ledger.mjs");
    writeFileSync(invalidModule, "export function createLedger(){return {}}\n");
    const correct = await verifyReleaseLedger(validModule);
    const incorrect = await verifyReleaseLedger(invalidModule);
    assert.equal(correct.total, 15); assert.equal(correct.passed, 15);
    assert.ok(incorrect.passed < incorrect.total);
    assert.doesNotMatch(JSON.stringify(incorrect), /invalid-ledger|scratch|Error/);
    const narration = records([{ type: "item.completed", item: { id: "n", type: "agent_message", text: "done" } }]);
    for (const [trace, artifact, expectedProtocol, expectedCorrect] of [
        [records(), correct, "pass", true], [records(), incorrect, "pass", false],
        [narration, correct, "fail", true], [narration, incorrect, "fail", false],
    ]) {
        assert.equal(audit(trace).status, expectedProtocol);
        assert.equal(artifact.passed === artifact.total, expectedCorrect);
    }
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = () => { throw new Error("unexpected network"); };
    try { assert.equal(auditMemoryProtocol(readCodexProtocol(file).session, read.digest).status, "pass"); }
    finally { globalThis.fetch = fetchBefore; }
    console.log("PASS: native Codex JSONL lifecycle, negative controls, privacy and offline CLI");
} finally { rmSync(scratch, { recursive: true, force: true }); }
