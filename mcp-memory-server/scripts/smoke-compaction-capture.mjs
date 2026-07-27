import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXPECTED_RED_EXIT = 86;
const RED_MARKER = "PHASE17_RED:COMPACTION_ADAPTER_MISSING";
const UNKNOWN_SENTINELS = [
    "unknown-version-secret-001",
    "sk-unknown-version-secret-002",
    "UNKNOWN_VERSION_PAYLOAD_MUST_NOT_SURVIVE",
];
const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const adapterModulePath = join(serverRoot, "dist", "compaction-normalize.js");
const fixturePath = (name) => join(here, "fixtures", name);

function strictObject(value, keys, label) {
    assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
    assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} fields drifted`);
}

function loadFixture(name) {
    return JSON.parse(readFileSync(fixturePath(name), "utf8"));
}

function validateFixtureSelfConsistency() {
    const claude = loadFixture("compaction-claude-code-2.1.219.json");
    strictObject(claude, [
        "session_id",
        "transcript_path",
        "cwd",
        "permission_mode",
        "hook_event_name",
        "trigger",
        "compact_summary",
    ], "Claude PostCompact fixture");
    assert.equal(claude.hook_event_name, "PostCompact");
    assert.equal(claude.trigger, "manual");
    assert.equal(typeof claude.compact_summary, "string");
    for (const heading of ["Task Goals", "Decisions Made", "Open TODOs", "Critical Error Traces"]) {
        assert.match(claude.compact_summary, new RegExp(`^# ${heading}$`, "m"));
    }
    assert.match(claude.compact_summary, /Decision:/);
    assert.match(claude.compact_summary, /TODO:/);
    assert.match(claude.compact_summary, /Error:/);

    const event = loadFixture("compaction-opencode-1.17.20-event.json");
    strictObject(event, ["type", "properties"], "OpenCode compacted event");
    strictObject(event.properties, ["sessionID"], "OpenCode compacted event properties");
    assert.equal(event.type, "session.compacted");

    const envelope = loadFixture("compaction-opencode-1.17.20-messages.json");
    strictObject(envelope, ["session", "messages"], "OpenCode messages fixture");
    assert.equal(envelope.session.id, event.properties.sessionID);
    assert.equal(envelope.session.version, "1.17.20");
    assert.ok(Array.isArray(envelope.messages));
    const compactionParents = new Set(envelope.messages
        .filter(({ info }) => info?.role === "user")
        .filter(({ parts }) => parts?.some((part) => part?.type === "compaction"))
        .map(({ info }) => info.id));
    assert.deepEqual([...compactionParents], ["oc-compact-user-old", "oc-compact-user-new"]);
    const valid = envelope.messages.filter(({ info }) => info?.role === "assistant"
        && info.summary === true
        && typeof info.finish === "string"
        && info.finish.length > 0
        && info.error === undefined
        && compactionParents.has(info.parentID));
    assert.deepEqual(valid.map(({ info }) => info.id), ["oc-summary-valid-old", "oc-summary-valid-new"]);
    const newest = valid.toSorted((left, right) => {
        const leftTime = left.info.time.completed ?? left.info.time.created;
        const rightTime = right.info.time.completed ?? right.info.time.created;
        return rightTime - leftTime || right.info.id.localeCompare(left.info.id);
    })[0];
    assert.equal(newest.info.id, "oc-summary-valid-new");
    const newestText = newest.parts.filter((part) => part.type === "text" && part.ignored !== true).map((part) => part.text).join("\n");
    for (const heading of ["Objective", "Important Details", "Work State", "Next Move", "Relevant Files"]) {
        assert.match(newestText, new RegExp(`^# ${heading}$`, "m"));
    }
    assert.match(newestText, /Decision:/);
    assert.match(newestText, /Error:/);
    assert.doesNotMatch(newestText, /IGNORED_SUMMARY_SECRET/);

    const unknown = loadFixture("compaction-unknown-version.json");
    assert.equal(unknown.harness_version, "99.0.0");
    for (const sentinel of UNKNOWN_SENTINELS) assert.match(JSON.stringify(unknown), new RegExp(sentinel));
    return { claude, event, envelope, unknown };
}

function assertExactProjection(projection) {
    assert.deepEqual(Object.keys(projection).sort(), [
        "completeness",
        "critical_error_traces",
        "decisions_made",
        "open_todos",
        "task_goals",
    ]);
    for (const field of ["task_goals", "decisions_made", "open_todos", "critical_error_traces"]) {
        assert.ok(Array.isArray(projection[field]), `${field} must be an array`);
        assert.ok(["complete", "partial", "missing"].includes(projection.completeness[field]), `${field} completeness is invalid`);
    }
}

function assertNoUnknownPayload(value, surface) {
    const serialized = JSON.stringify(value);
    for (const sentinel of UNKNOWN_SENTINELS) {
        assert.doesNotMatch(serialized, new RegExp(sentinel), `${surface} retained unknown payload`);
    }
}

async function loadAdapterModule() {
    return import(`${pathToFileURL(adapterModulePath).href}?smoke=${Date.now()}`);
}

function assertExports(adapter) {
    assert.deepEqual(adapter.SUPPORTED_COMPACTION_ADAPTERS, [
        { harness: "claude-code", version: "2.1.219", event: "PostCompact" },
        { harness: "opencode", version: "1.17.20", event: "session.compacted" },
    ]);
    for (const name of [
        "normalizeClaudePostCompact",
        "selectOpenCodeCompactionSummary",
        "normalizeOpenCodeCompaction",
        "projectCompactionSummary",
        "selectCompactionRecovery",
        "renderCompactionRecovery",
    ]) assert.equal(typeof adapter[name], "function", `${name} export is missing`);
}

function claudeContract(adapter, fixtures) {
    const normalized = adapter.normalizeClaudePostCompact(fixtures.claude, { harnessVersion: "2.1.219" });
    assert.equal(normalized.session_ref, "claude-code:claude-compaction-session-001");
    assert.equal(normalized.harness, "claude-code");
    assert.equal(normalized.harness_version, "2.1.219");
    assert.equal(normalized.source_event, "PostCompact");
    assert.equal(normalized.trigger, "manual");
    assert.equal(typeof normalized.raw_summary, "string");
    assert.doesNotMatch(normalized.raw_summary, /claude-compaction-secret|sk-claude-compaction-secret/);
    assertExactProjection(normalized.projection);
    assert.deepEqual(normalized.projection.task_goals, ["Preserve supported compaction state across sessions."]);
    assert.deepEqual(normalized.projection.decisions_made, ["Pin adapter behavior to the documented PostCompact family."]);
    assert.deepEqual(normalized.projection.open_todos, ["Implement the local immutable compaction adapter."]);
    assert.match(normalized.projection.critical_error_traces[0], /^TypeError: recovery pointer invalid/);
    return normalized;
}

function opencodeContract(adapter, fixtures) {
    const selected = adapter.selectOpenCodeCompactionSummary(
        fixtures.event,
        fixtures.envelope.session,
        fixtures.envelope.messages,
        { harnessVersion: "1.17.20" },
    );
    assert.equal(selected.message_id, "oc-summary-valid-new");
    assert.equal(selected.parent_id, "oc-compact-user-new");
    assert.equal(selected.completed_at, new Date(1785052808000).toISOString());
    assert.doesNotMatch(selected.raw_summary, /IGNORED_SUMMARY_SECRET/);
    const normalized = adapter.normalizeOpenCodeCompaction(
        fixtures.event,
        fixtures.envelope.session,
        fixtures.envelope.messages,
        { harnessVersion: "1.17.20" },
    );
    assert.equal(normalized.session_ref, "opencode:opencode-compaction-session-001");
    assert.equal(normalized.harness, "opencode");
    assert.equal(normalized.harness_version, "1.17.20");
    assert.equal(normalized.source_event, "session.compacted");
    assert.equal(normalized.native_id, "oc-summary-valid-new");
    assert.doesNotMatch(normalized.raw_summary, /opencode-compaction-secret|sk-opencode-compaction-secret/);
    assertExactProjection(normalized.projection);
    assert.deepEqual(normalized.projection.task_goals, ["Preserve supported compaction state across sessions."]);
    assert.deepEqual(normalized.projection.decisions_made, ["Pin adapter behavior to the documented session.compacted family."]);
    assert.deepEqual(normalized.projection.open_todos, ["Implement the local immutable compaction adapter."]);
    assert.match(normalized.projection.critical_error_traces[0], /^TypeError: recovery pointer invalid/);
    return normalized;
}

function projectionContract(adapter) {
    const partial = adapter.projectCompactionSummary("# Objective\nOnly a goal is labelled.", { template: "opencode-1.17.20" });
    assertExactProjection(partial);
    assert.deepEqual(partial.task_goals, ["Only a goal is labelled."]);
    assert.deepEqual(partial.decisions_made, []);
    assert.deepEqual(partial.open_todos, []);
    assert.deepEqual(partial.critical_error_traces, []);
    assert.equal(partial.completeness.decisions_made, "missing");
    assert.equal(partial.completeness.open_todos, "missing");
    assert.equal(partial.completeness.critical_error_traces, "missing");
    const unlabelled = adapter.projectCompactionSummary("Unclassified prose must not be fabricated.", { template: "claude-code-2.1.219" });
    assert.deepEqual(unlabelled.task_goals, []);
    assert.deepEqual(unlabelled.decisions_made, []);
    assert.deepEqual(unlabelled.open_todos, []);
    assert.deepEqual(unlabelled.critical_error_traces, []);
}

function artifact({ id, sessionRef, createdAt, revision, projection, harness = "claude-code", valid = true }) {
    return {
        schema_version: 1,
        artifact_id: id,
        kind: "compaction_summary",
        created_at: createdAt,
        session_ref: sessionRef,
        content_digest: "a".repeat(64),
        valid,
        provenance: { harness },
        content: {
            raw_summary: `raw-${id}`,
            revision,
            ...projection,
        },
    };
}

function recoveryContract(adapter, projection) {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const records = [
        artifact({ id: "art_invalid", sessionRef: "claude-code:current", createdAt: "2026-07-26T23:59:59.000Z", revision: 9, projection, valid: false }),
        artifact({ id: "art_project_new", sessionRef: "opencode:newer", createdAt: "2026-07-26T23:00:00.000Z", revision: 2, projection, harness: "opencode" }),
        artifact({ id: "art_current", sessionRef: "claude-code:current", createdAt: "2026-07-26T20:00:00.000Z", revision: 3, projection }),
        artifact({ id: "art_project_old", sessionRef: "claude-code:older", createdAt: "2026-07-20T00:00:00.000Z", revision: 1, projection }),
    ];
    const current = adapter.selectCompactionRecovery(records, {
        currentSessionRef: "claude-code:current",
        now,
        staleAfterSeconds: 3600,
        invalidArtifactIds: ["art_invalid"],
        latestPointers: { session: "art_invalid", project: "art_invalid" },
    });
    assert.equal(current.artifact_id, "art_current");
    assert.equal(current.source, "current_session");
    assert.equal(current.revision, 3);
    assert.equal(current.harness, "claude-code");
    assert.equal(current.age_seconds, 14400);
    assert.equal(current.stale, true);
    assertExactProjection(current.projection);

    const fallback = adapter.selectCompactionRecovery(records, {
        currentSessionRef: "claude-code:fresh",
        now,
        staleAfterSeconds: 86400,
        invalidArtifactIds: ["art_invalid"],
        latestPointers: { project: "art_invalid" },
    });
    assert.equal(fallback.artifact_id, "art_project_new");
    assert.equal(fallback.source, "project_fallback");
    assert.equal(fallback.revision, 2);
    assert.equal(fallback.harness, "opencode");
    assert.equal(fallback.stale, false);
    const rendered = adapter.renderCompactionRecovery(current);
    for (const label of ["Source", "Session", "Revision", "Captured", "Age", "Harness", "Completeness", "Task Goals", "Decisions Made", "Open TODOs", "Critical Error Traces"]) {
        assert.match(rendered, new RegExp(label));
    }
    assert.match(rendered, /stale/i);
    assert.match(rendered, /validate.*current repository/i);
    assert.doesNotMatch(rendered, /raw-art_|raw_summary|content_digest|content/);
    const empty = adapter.renderCompactionRecovery({
        ...current,
        projection: {
            task_goals: [], decisions_made: [], open_todos: [], critical_error_traces: [],
            completeness: { task_goals: "missing", decisions_made: "missing", open_todos: "missing", critical_error_traces: "missing" },
        },
    });
    assert.equal((empty.match(/\(none captured\)/g) ?? []).length, 4);
}

function unknownVersionContract(adapter, fixtures) {
    const diagnostics = [];
    const result = adapter.normalizeOpenCodeCompaction(
        fixtures.unknown.event,
        { id: "unknown-version-session", version: fixtures.unknown.harness_version },
        [],
        {
            harnessVersion: fixtures.unknown.harness_version,
            unknownPayload: fixtures.unknown.payload,
            recordDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        },
    );
    assert.equal(result, null);
    assert.deepEqual(diagnostics, [{ code: "unsupported_compaction_adapter", count: 1 }]);
    assertNoUnknownPayload(result, "unknown adapter result");
    assertNoUnknownPayload(diagnostics, "unknown adapter diagnostic");
}

async function runContract(mode, fixtures) {
    const adapter = await loadAdapterModule();
    assertExports(adapter);
    projectionContract(adapter);
    unknownVersionContract(adapter, fixtures);
    let normalized;
    if (mode !== "--opencode-only") normalized = claudeContract(adapter, fixtures);
    if (mode !== "--claude-only") normalized = opencodeContract(adapter, fixtures);
    recoveryContract(adapter, normalized.projection);
}

async function main() {
    const [mode, ...extra] = process.argv.slice(2);
    assert.equal(extra.length, 0, "smoke-compaction-capture accepts at most one mode");
    assert.equal([undefined, "--expect-red", "--claude-only", "--opencode-only"].includes(mode), true, `Unknown mode: ${mode}`);
    const fixtures = validateFixtureSelfConsistency();

    if (mode === "--expect-red") {
        assert.equal(existsSync(join(serverRoot, "src", "compaction-normalize.ts")), false, "pre-feature adapter source unexpectedly exists");
        try {
            await runContract(undefined, fixtures);
        } catch (error) {
            if (error?.code === "ERR_MODULE_NOT_FOUND" && String(error.message).includes("compaction-normalize.js")) {
                console.log(RED_MARKER);
                process.exitCode = EXPECTED_RED_EXIT;
                return;
            }
            throw error;
        }
        throw new Error("Compaction adapter unexpectedly exists; run the GREEN contract instead.");
    }

    await runContract(mode, fixtures);
    console.log("PASS: compaction adapter, projection and recovery contract");
}

await main();
