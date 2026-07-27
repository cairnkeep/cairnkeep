#!/usr/bin/env bash
# Smoke test for `cairn doctor`: unconfigured deps SKIP (exit 0); a configured
# but unreachable endpoint FAILs (exit non-zero).
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
server_pid=""
cleanup() {
  [[ -n "$server_pid" ]] && kill "$server_pid" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

doctor="$ROOT/scripts/doctor.sh"
export HOME="$tmp/home"
mkdir -p "$HOME"
# Clean the inherited env so the test controls what is "configured".
unset CAIRN_LLM_API_URL CAIRN_MEMORY_EMBEDDING_URL CAIRN_GIT_PROVIDER CAIRN_AGENTFS_BASE_DIR

# 1. Nothing configured → only SKIP/PASS/WARN, exit 0.
proj="$tmp/clean"; mkdir -p "$proj"
( cd "$proj" && "$doctor" ) >"$tmp/out1" 2>&1 || fail "doctor exited non-zero with nothing configured:\n$(cat "$tmp/out1")"
grep -q "\[SKIP\]" "$tmp/out1" || fail "expected SKIP lines when nothing is configured"
grep -q "typed metadata and note transaction state" "$tmp/out1" || fail "expected typed/note diagnostics in the public doctor output"
grep -q "artifact store (not present" "$tmp/out1" || fail "expected absent opt-in artifact diagnostics"
grep -q "capability configuration (not present — managed overrides are unused)" "$tmp/out1" ||
  fail "expected absent capability configuration diagnostics"
grep -q "capability callback namespace (not present — callback logging is unused)" "$tmp/out1" ||
  fail "expected absent capability callback diagnostics"

# 2. An unsupported runtime is diagnosed before the server probe.
mkdir -p "$tmp/old-node"
cat > "$tmp/old-node/node" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  -p) echo 20 ;;
  --version) echo v20.19.0 ;;
  *) exit 1 ;;
esac
EOF
chmod 755 "$tmp/old-node/node"
if ( cd "$proj" && PATH="$tmp/old-node:$PATH" "$doctor" ) >"$tmp/out-old-node" 2>&1; then
  fail "doctor should exit non-zero for an unsupported Node.js runtime:\n$(cat "$tmp/out-old-node")"
fi
grep -q "Node.js v20.19.0 is unsupported" "$tmp/out-old-node" ||
  fail "expected a clear unsupported-Node.js diagnostic"

# 3. A configured but unreachable endpoint → FAIL + non-zero exit.
if command -v curl >/dev/null 2>&1; then
  proj2="$tmp/broken"; mkdir -p "$proj2/.ai"
  echo 'CAIRN_LLM_API_URL=http://127.0.0.1:1' > "$proj2/.ai/.env"
  if ( cd "$proj2" && "$doctor" ) >"$tmp/out2" 2>&1; then
    fail "doctor should exit non-zero for an unreachable configured endpoint:\n$(cat "$tmp/out2")"
  fi
  grep -q "\[FAIL\] LLM endpoint unreachable" "$tmp/out2" || fail "expected a FAIL line for the unreachable endpoint"
else
  echo "  (curl absent — skipped the unreachable-endpoint case)"
fi

# 4. The embedding check performs a real authenticated model request.
if command -v curl >/dev/null 2>&1; then
  cat > "$tmp/embedding-server.mjs" <<'EOF'
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
    const valid = request.url === "/v1/embeddings"
      && request.headers.authorization === "Bearer test-key"
      && body.model === "test-embedding";
    response.writeHead(valid ? 200 : 404, { "Content-Type": "application/json" });
    response.end(JSON.stringify(valid
      ? { data: [{ index: 0, embedding: [1, 0] }] }
      : { error: "invalid request" }));
  });
});
server.listen(0, "127.0.0.1", () => {
  writeFileSync(process.argv[2], String(server.address().port));
});
EOF
  node "$tmp/embedding-server.mjs" "$tmp/embedding-port" &
  server_pid=$!
  for _ in $(seq 1 50); do [[ -s "$tmp/embedding-port" ]] && break; sleep 0.1; done
  [[ -s "$tmp/embedding-port" ]] || fail "embedding test server did not start"
  port=$(cat "$tmp/embedding-port")

  proj3="$tmp/embedding-ok"; mkdir -p "$proj3/.ai"
  cat > "$proj3/.ai/.env" <<EOF
CAIRN_MEMORY_EMBEDDING_URL=http://127.0.0.1:$port/v1
CAIRN_MEMORY_EMBEDDING_MODEL=test-embedding
CAIRN_LLM_API_KEY=test-key
EOF
  ( cd "$proj3" && "$doctor" ) >"$tmp/out3" 2>&1 ||
    fail "doctor rejected a working embedding endpoint:\n$(cat "$tmp/out3")"
  grep -q "\[PASS\] embedding endpoint accepted model test-embedding" "$tmp/out3" ||
    fail "expected a functional embedding PASS line"

  proj4="$tmp/embedding-wrong-model"; mkdir -p "$proj4/.ai"
  cat > "$proj4/.ai/.env" <<EOF
CAIRN_MEMORY_EMBEDDING_URL=http://127.0.0.1:$port/v1
CAIRN_MEMORY_EMBEDDING_MODEL=missing-model
CAIRN_LLM_API_KEY=test-key
EOF
  if ( cd "$proj4" && "$doctor" ) >"$tmp/out4" 2>&1; then
    fail "doctor should reject a missing embedding model:\n$(cat "$tmp/out4")"
  fi
  grep -q "\[FAIL\] embedding request failed for model missing-model" "$tmp/out4" ||
    fail "expected a functional embedding FAIL line"
fi

# 5. Artifact doctor passes a valid store, repairs only derived state, and
# refuses authoritative full-record corruption without leaking stored values.
artifact_cli="$ROOT/mcp-memory-server/dist/artifact-cli.js"
artifact_fixture="$ROOT/mcp-memory-server/scripts/fixtures/compaction-claude-code-2.1.219.json"
artifact_project="$tmp/artifact-project"
mkdir -p "$artifact_project"
node "$artifact_cli" capture-claude "$artifact_project" --harness-version 2.1.219 <"$artifact_fixture" >/dev/null 2>&1 || \
  fail "could not create the artifact doctor fixture"
( cd "$artifact_project" && "$doctor" ) >"$tmp/artifact-valid.out" 2>&1 || \
  fail "doctor rejected a valid artifacts.db:\n$(cat "$tmp/artifact-valid.out")"
grep -q "\[PASS\] artifact store integrity" "$tmp/artifact-valid.out" || \
  fail "expected the valid artifact PASS line"

node --input-type=module - "$ROOT" "$artifact_project" <<'NODE'
import { join } from "node:path";
const { AgentFS } = await import(process.argv[2] + "/mcp-memory-server/node_modules/agentfs-sdk/dist/index_node.js");
const agent = await AgentFS.open({ id: "artifacts", path: join(process.argv[3], ".agentfs", "artifacts.db") });
const fullRows = await agent.kv.list("artifact/full/");
const dedupeRows = await agent.kv.list("artifact/index/dedupe/");
if (fullRows.length !== 1 || dedupeRows.length !== 1) throw new Error("missing derived doctor fixture");
const artifact = fullRows[0].value;
await agent.kv.delete(dedupeRows[0].key);
await agent.kv.set("artifact/index/dedupe/orphan-public-doctor", artifact.artifact_id);
await agent.kv.set(`compaction/sequence/${artifact.session_ref}`, 0);
await agent.close();
NODE
if ( cd "$artifact_project" && "$doctor" ) >"$tmp/artifact-derived.out" 2>&1; then
  fail "doctor should fail before derived artifact repair:\n$(cat "$tmp/artifact-derived.out")"
fi
( cd "$artifact_project" && "$doctor" --repair ) >"$tmp/artifact-repaired.out" 2>&1 || \
  fail "doctor did not repair derived artifact state:\n$(cat "$tmp/artifact-repaired.out")"
grep -q "\[PASS\] artifact store repaired" "$tmp/artifact-repaired.out" || \
  fail "expected the derived artifact repair PASS line"

node --input-type=module - "$ROOT" "$artifact_project" <<'NODE'
import { join } from "node:path";
const { AgentFS } = await import(process.argv[2] + "/mcp-memory-server/node_modules/agentfs-sdk/dist/index_node.js");
const agent = await AgentFS.open({ id: "artifacts", path: join(process.argv[3], ".agentfs", "artifacts.db") });
const fullRows = await agent.kv.list("artifact/full/");
const dedupeRows = await agent.kv.list("artifact/index/dedupe/");
if (fullRows.length !== 1 || dedupeRows.length !== 1) throw new Error("derived repair did not restore the exact maps");
const artifact = fullRows[0].value;
const sequenceKey = `compaction/sequence/${artifact.session_ref}`;
if (await agent.kv.get(sequenceKey) !== artifact.content.revision) throw new Error("derived repair did not restore the retained sequence");
await agent.kv.set(sequenceKey, artifact.content.revision + 8);
await agent.close();
NODE
( cd "$artifact_project" && "$doctor" --repair ) >"$tmp/artifact-higher-sequence.out" 2>&1 || \
  fail "doctor rejected a valid higher historical sequence:\n$(cat "$tmp/artifact-higher-sequence.out")"
node --input-type=module - "$ROOT" "$artifact_project" <<'NODE'
import { join } from "node:path";
const { AgentFS } = await import(process.argv[2] + "/mcp-memory-server/node_modules/agentfs-sdk/dist/index_node.js");
const agent = await AgentFS.open({ id: "artifacts", path: join(process.argv[3], ".agentfs", "artifacts.db") });
const [artifact] = (await agent.kv.list("artifact/full/")).map((row) => row.value);
if (await agent.kv.get(`compaction/sequence/${artifact.session_ref}`) !== artifact.content.revision + 8) {
  throw new Error("doctor lowered a valid higher historical sequence");
}
await agent.close();
NODE

node --input-type=module - "$ROOT" "$artifact_project" <<'NODE'
const { AgentFS } = await import(process.argv[2] + "/mcp-memory-server/node_modules/agentfs-sdk/dist/index_node.js");
const { putArtifact } = await import(process.argv[2] + "/mcp-memory-server/dist/artifact-store.js");
const { join } = await import("node:path");
const agent = await AgentFS.open({ id: "artifacts", path: join(process.argv[3], ".agentfs", "artifacts.db") });
const [stored] = (await agent.kv.list("artifact/full/")).map((row) => row.value);
await agent.close();
const { revision: _revision, ...content } = stored.content;
await putArtifact(process.argv[3], {
  kind: stored.kind,
  session_ref: stored.session_ref,
  media_type: stored.media_type,
  provenance: stored.provenance,
  content: {
    ...content,
    raw_summary: `${content.raw_summary}\nretention-fixture`,
    task_goals: [...content.task_goals, "retention-fixture"],
  },
}, {
  artifactMaxBytes: 4096,
  sessionMaxBytes: 65536,
  storeMaxBytes: 262144,
  retentionDays: 3650,
  compactionMaxRevisions: 8,
  generatedFileSnapshotMaxBytes: 4096,
});
NODE
node --input-type=module - "$ROOT" "$artifact_project" "$tmp/artifact-full-before.json" <<'NODE'
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const { AgentFS } = await import(process.argv[2] + "/mcp-memory-server/node_modules/agentfs-sdk/dist/index_node.js");
const agent = await AgentFS.open({ id: "artifacts", path: join(process.argv[3], ".agentfs", "artifacts.db") });
writeFileSync(process.argv[4], JSON.stringify(await agent.kv.list("artifact/full/")));
await agent.close();
NODE
if ( cd "$artifact_project" && CAIRN_COMPACTION_MAX_REVISIONS=1 "$doctor" ) >"$tmp/artifact-retention.out" 2>&1; then
  fail "doctor should fail for retained artifacts over the configured revision limit:\n$(cat "$tmp/artifact-retention.out")"
fi
if ( cd "$artifact_project" && CAIRN_COMPACTION_MAX_REVISIONS=1 "$doctor" --repair ) >"$tmp/artifact-retention-repair.out" 2>&1; then
  fail "doctor repair should leave retention violations unresolved:\n$(cat "$tmp/artifact-retention-repair.out")"
fi
grep -q "\[FAIL\] artifact store could not be repaired safely" "$tmp/artifact-retention-repair.out" || \
  fail "expected a failed non-destructive retention repair result"
node --input-type=module - "$ROOT" "$artifact_project" "$tmp/artifact-full-before.json" <<'NODE'
import { readFileSync } from "node:fs";
import { join } from "node:path";
const { AgentFS } = await import(process.argv[2] + "/mcp-memory-server/node_modules/agentfs-sdk/dist/index_node.js");
const agent = await AgentFS.open({ id: "artifacts", path: join(process.argv[3], ".agentfs", "artifacts.db") });
const after = JSON.stringify(await agent.kv.list("artifact/full/"));
await agent.close();
if (after !== readFileSync(process.argv[4], "utf8")) throw new Error("doctor repair changed authoritative rows for a retention violation");
NODE

node --input-type=module - "$ROOT" "$artifact_project" <<'NODE'
import { join } from "node:path";
const { AgentFS } = await import(process.argv[2] + "/mcp-memory-server/node_modules/agentfs-sdk/dist/index_node.js");
const agent = await AgentFS.open({ id: "artifacts", path: join(process.argv[3], ".agentfs", "artifacts.db") });
const rows = await agent.kv.list("artifact/full/");
if (rows.length === 0) throw new Error("missing authoritative record fixture");
await agent.kv.set(rows[0].key, { ...rows[0].value, content_digest: "0".repeat(64) });
await agent.close();
NODE
if ( cd "$artifact_project" && "$doctor" --repair ) >"$tmp/artifact-authoritative.out" 2>&1; then
  fail "doctor should reject authoritative artifact corruption:\n$(cat "$tmp/artifact-authoritative.out")"
fi
grep -q "\[FAIL\] artifact store could not be repaired safely" "$tmp/artifact-authoritative.out" || \
  fail "expected the authoritative artifact corruption FAIL line"
if grep -qF 'compact_summary' "$tmp/artifact-authoritative.out"; then
  fail "artifact doctor leaked a stored value"
fi

# 6. Capability diagnostics consume only the private fixed doctor envelope and
# map config/store states without exposing malformed values or callback rows.
capability_valid="$tmp/capability-valid"
mkdir -p "$capability_valid/.ai"
printf '%s\n' '{"schema_version":1,"capabilities":{},"logging":{}}' >"$capability_valid/.ai/capabilities.json"
chmod 600 "$capability_valid/.ai/capabilities.json"
( cd "$capability_valid" && "$doctor" ) >"$tmp/capability-valid.out" 2>&1 ||
  fail "doctor rejected valid capability state:\n$(cat "$tmp/capability-valid.out")"
grep -q "\[PASS\] capability configuration schema and permissions are valid" "$tmp/capability-valid.out" ||
  fail "expected valid capability configuration PASS"

capability_warn="$tmp/capability-warn"
mkdir -p "$capability_warn/.ai"
printf '%s\n' '{"schema_version":1,"capabilities":{"memory.write":"PHASE18_CONFIG_VALUE_SENTINEL","PHASE18_UNKNOWN_ID_SENTINEL":true},"logging":{"callbacks":"PHASE18_LOGGING_VALUE_SENTINEL"}}' >"$capability_warn/.ai/capabilities.json"
chmod 600 "$capability_warn/.ai/capabilities.json"
( cd "$capability_warn" && "$doctor" ) >"$tmp/capability-warn.out" 2>&1 ||
  fail "doctor treated row-local capability warnings as fatal:\n$(cat "$tmp/capability-warn.out")"
grep -q "\[WARN\] capability configuration has an invalid value for memory.write" "$tmp/capability-warn.out" ||
  fail "expected canonical capability warning"
grep -q "\[WARN\] capability configuration has an invalid value for logging.callbacks" "$tmp/capability-warn.out" ||
  fail "expected fixed callback setting warning"
grep -q "\[WARN\] capability configuration contains an unknown override ID" "$tmp/capability-warn.out" ||
  fail "expected value-free unknown-ID warning"
if grep -Eq 'PHASE18_(CONFIG_VALUE|UNKNOWN_ID|LOGGING_VALUE)_SENTINEL' "$tmp/capability-warn.out"; then
  fail "capability doctor exposed malformed configuration contents"
fi

capability_unsafe="$tmp/capability-unsafe"
mkdir -p "$capability_unsafe/.ai"
printf '%s\n' '{"schema_version":2,"capabilities":{"wiki":false},"logging":{}}' >"$capability_unsafe/.ai/capabilities.json"
chmod 644 "$capability_unsafe/.ai/capabilities.json"
if ( cd "$capability_unsafe" && "$doctor" ) >"$tmp/capability-unsafe.out" 2>&1; then
  fail "doctor accepted unsafe or unsupported capability configuration"
fi
grep -q "\[FAIL\] capability configuration is invalid or uses an unsupported schema; preserve .ai/capabilities.json before reset" "$tmp/capability-unsafe.out" ||
  fail "expected unsupported-schema backup guidance"
grep -q "\[FAIL\] capability configuration type or permissions are unsafe; preserve .ai/capabilities.json before recovery" "$tmp/capability-unsafe.out" ||
  fail "expected unsafe-permissions backup guidance"

callback_project="$tmp/capability-callbacks"
mkdir -p "$callback_project"
node --input-type=module - "$ROOT" "$callback_project" <<'NODE'
const { appendCapabilityRecord } = await import(process.argv[2] + "/mcp-memory-server/dist/capability-store.js");
const now = new Date().toISOString();
await appendCapabilityRecord(process.argv[3], {
  schema_version: 1,
  capability_id: "wiki",
  invocation_id: "cap:11111111-1111-4111-8111-111111111111",
  correlation_id: "cairn:doctor-fixture",
  harness: "other",
  source: "operating-command",
  transport: "local-process",
  started_at: now,
  finished_at: now,
  duration_ms: 0,
  outcome: "success",
  state_source: "project",
  configuration_digest: "1".repeat(64),
});
NODE
( cd "$callback_project" && "$doctor" ) >"$tmp/callback-valid.out" 2>&1 ||
  fail "doctor rejected a valid capability callback namespace:\n$(cat "$tmp/callback-valid.out")"
grep -q "\[PASS\] capability callback namespace schema and SQLite integrity are valid" "$tmp/callback-valid.out" ||
  fail "expected valid capability callback PASS"
if grep -qF 'doctor-fixture' "$tmp/callback-valid.out"; then
  fail "capability doctor exposed a callback record"
fi

node --input-type=module - "$ROOT" "$callback_project" <<'NODE'
import { join } from "node:path";
const { AgentFS } = await import(process.argv[2] + "/mcp-memory-server/node_modules/agentfs-sdk/dist/index_node.js");
const agent = await AgentFS.open({ id: "trajectory", path: join(process.argv[3], ".agentfs", "trajectory.db") });
await agent.kv.set("capability-callback/meta/schema-version", 2);
await agent.close();
NODE
cp "$callback_project/.agentfs/trajectory.db" "$tmp/callback-unsupported.before"
if ( cd "$callback_project" && "$doctor" ) >"$tmp/callback-unsupported.out" 2>&1; then
  fail "doctor accepted an unsupported callback namespace"
fi
grep -q "\[FAIL\] capability callback namespace schema is unsupported; preserve .agentfs/trajectory.db before recovery" "$tmp/callback-unsupported.out" ||
  fail "expected unsupported callback schema guidance"
if grep -qF 'doctor-fixture' "$tmp/callback-unsupported.out"; then
  fail "unsupported callback diagnostics exposed a stored record"
fi
cmp -s "$tmp/callback-unsupported.before" "$callback_project/.agentfs/trajectory.db" ||
  fail "callback diagnostics mutated an unsupported namespace"

callback_corrupt="$tmp/capability-callback-corrupt"
mkdir -p "$callback_corrupt/.agentfs"
printf '%s\n' 'PHASE18_CALLBACK_ROW_SENTINEL' >"$callback_corrupt/.agentfs/trajectory.db"
cp "$callback_corrupt/.agentfs/trajectory.db" "$tmp/callback-corrupt.before"
if ( cd "$callback_corrupt" && "$doctor" ) >"$tmp/callback-corrupt.out" 2>&1; then
  fail "doctor accepted SQLite callback-store corruption"
fi
grep -q "\[FAIL\] capability callback namespace could not be diagnosed safely; preserve .agentfs/trajectory.db before recovery" "$tmp/callback-corrupt.out" ||
  fail "expected value-free callback corruption guidance"
if grep -qF 'PHASE18_CALLBACK_ROW_SENTINEL' "$tmp/callback-corrupt.out"; then
  fail "callback corruption diagnostics exposed stored bytes"
fi
cmp -s "$tmp/callback-corrupt.before" "$callback_corrupt/.agentfs/trajectory.db" ||
  fail "callback diagnostics mutated a corrupt database"

echo "PASS: cairn doctor (existing probes plus value-free capability config/callback diagnostics)"
