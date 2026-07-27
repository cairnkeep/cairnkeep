#!/usr/bin/env bash
set -euo pipefail

# Docs-vs-code parity checker (SC-02; D-10). Two one-directional checks --
# code surface must be documented; doc-only names are allowed (e.g.
# CAIRN_GIT_PROVIDER is read by the CLI/provider layer, not the server, and
# script-local vars like CAIRN_GUARD_DENYLIST/CAIRN_ROUTE_BINARY are never
# server config -- neither is a failure):
#
#   1. Env-key check: every CAIRN_[A-Z_]+/MCP_HTTP_[A-Z_]+ token read in
#      mcp-memory-server/src/*.ts (the runtime server config surface --
#      NOT scripts/ or bin/) must be named somewhere in docs/operating.md
#      or README.md. `comm -23` on two sorted lists -- code-keys-not-in-
#      docs -- not a symmetric diff.
#   2. Command check: every claude/commands/*.md basename must appear in
#      docs/operating.md.
#
# Reports both check results even when the first fails, so a single run
# surfaces the full drift set. Exits non-zero on any drift, 0 on none.

usage() {
  cat <<'EOF'
Usage: verify-docs-parity.sh
       verify-docs-parity.sh --artifact-remote-path-only
       verify-docs-parity.sh --expect-red-artifact-remote-path
       verify-docs-parity.sh -h|--help

Checks that every CAIRN_*/MCP_HTTP_* env key read by the cairn-memory MCP
server (mcp-memory-server/src/*.ts) is named in docs/operating.md or
README.md, and that every claude/commands/*.md command is named in
docs/operating.md. One-directional: doc-only names are not a failure.
Prints every missing key/command by name, then exits non-zero on any
drift, or 0 if the docs are fully in sync with the shipped code.
EOF
}

EXPECTED_RED_EXIT=86
ARTIFACT_REMOTE_PATH_RED_MARKER='PHASE17_RED:ARTIFACT_REMOTE_PATH_DOC_DRIFT'

ENV_KEY_PATTERN='(CAIRN_[A-Z_]+|MCP_HTTP_[A-Z_]+)'

# check_env_keys(): comm -23 of sorted code-keys vs sorted doc-keys --
# code-keys-not-in-docs only (one-directional, per D-10).
check_env_keys() {
  local code_keys doc_keys missing

  code_keys=$(grep -ohE "\\b${ENV_KEY_PATTERN}\\b" mcp-memory-server/src/*.ts | grep -v '^CAIRN_TEST_' | sort -u)
  doc_keys=$(grep -ohE "\\b${ENV_KEY_PATTERN}\\b" docs/operating.md README.md | sort -u)

  missing=$(comm -23 <(printf '%s\n' "$code_keys") <(printf '%s\n' "$doc_keys"))

  if [[ -n "$missing" ]]; then
    echo "FATAL: env keys read in mcp-memory-server/src but undocumented:" >&2
    while IFS= read -r key; do
      [[ -n "$key" ]] && echo "  - $key" >&2
    done <<<"$missing"
    return 1
  fi

  echo "[env-keys] OK: every mcp-memory-server/src env key is named in docs/operating.md or README.md"
  return 0
}

# check_commands(): every claude/commands/*.md basename must appear as a
# documented command reference in docs/operating.md -- either backtick-
# quoted (the "N commands" enumeration, e.g. `graphify`) or slash-prefixed
# (the workflow section, e.g. `/remember <fact>`). A bare substring match
# is too loose: "context-explore" appears in docs/operating.md today only
# inside an unrelated sync-script filename comment, not as a documented
# command -- that incidental mention must not count as "documented".
check_commands() {
  local failed=0
  local file name

  for file in claude/commands/*.md; do
    name=$(basename "$file" .md)
    if ! grep -qF "\`${name}\`" docs/operating.md && ! grep -qF "/${name}" docs/operating.md; then
      echo "FATAL: command '$name' (claude/commands/${name}.md) is not named in docs/operating.md" >&2
      failed=1
    fi
  done

  if [[ "$failed" -ne 0 ]]; then
    return 1
  fi

  echo "[commands] OK: every claude/commands/*.md command is named in docs/operating.md"
  return 0
}

check_typed_contract() {
  local failed=0 term files
  while IFS='|' read -r term files; do
    [[ -n "$term" ]] || continue
    if ! grep -qF "$term" $files; then
      echo "FATAL: typed-memory public term '$term' is missing from $files" >&2
      failed=1
    fi
  done <<'EOF'
CAIRN_TYPED_MEMORY_NODES|README.md docs/operating.md
memory_import|README.md docs/operating.md docs/privacy-and-data-flow.md
address_space|README.md docs/operating.md docs/privacy-and-data-flow.md
node_types|README.md docs/operating.md
tags_all|README.md docs/operating.md
tags_any|README.md docs/operating.md
schemas/memory-node.schema.json|docs/storage.md
cairn_node_metadata_v1|docs/storage.md
cairn_node_import_replays_v1|docs/storage.md
prepared|docs/storage.md docs/privacy-and-data-flow.md
committing|docs/storage.md docs/privacy-and-data-flow.md
committed-before-cleanup|docs/storage.md docs/privacy-and-data-flow.md
EOF
  [[ "$failed" -eq 0 ]] && echo "[typed-contract] OK: typed memory, import, and recovery terms are documented"
  return "$failed"
}

check_artifact_contract() {
  local failed=0 key value source_term

  while IFS='|' read -r key value source_term; do
    [[ -n "$key" ]] || continue
    grep -qF "$key" mcp-memory-server/src/artifact-schema.ts || {
      echo "FATAL: artifact env key '$key' is missing from source" >&2
      failed=1
    }
    grep -qF "$source_term" mcp-memory-server/src/artifact-schema.ts || {
      echo "FATAL: artifact default '$key=$value' is missing from source" >&2
      failed=1
    }
    grep -qxF "# $key=$value" templates/env.example.template || {
      echo "FATAL: artifact default '$key=$value' is missing from env.example" >&2
      failed=1
    }
    grep -qF "$key" README.md docs/operating.md || {
      echo "FATAL: artifact env key '$key' is missing from public configuration docs" >&2
      failed=1
    }
    grep -qF "$value" README.md docs/operating.md || {
      echo "FATAL: artifact default '$key=$value' is missing from public configuration docs" >&2
      failed=1
    }
  done <<'EOF'
CAIRN_ARTIFACT_MAX_BYTES|1048576|ARTIFACT_DEFAULT_MAX_BYTES = 1024 * 1024
CAIRN_ARTIFACT_SESSION_MAX_BYTES|16777216|ARTIFACT_DEFAULT_SESSION_MAX_BYTES = 16 * 1024 * 1024
CAIRN_ARTIFACT_STORE_MAX_BYTES|268435456|ARTIFACT_DEFAULT_STORE_MAX_BYTES = 256 * 1024 * 1024
CAIRN_ARTIFACT_RETENTION_DAYS|30|ARTIFACT_DEFAULT_RETENTION_DAYS = 30
CAIRN_COMPACTION_MAX_REVISIONS|8|COMPACTION_DEFAULT_MAX_REVISIONS = 8
CAIRN_ARTIFACT_GENERATED_FILE_SNAPSHOT_MAX_BYTES|262144|GENERATED_FILE_MAX_SNAPSHOT_BYTES = 256 * 1024
EOF

  for key in CAIRN_COMPACTION_CAPTURE CAIRN_ARTIFACT_STORE CAIRN_ARTIFACT_HTTP; do
    grep -qF "$key" mcp-memory-server/src/artifact-schema.ts README.md docs/operating.md docs/privacy-and-data-flow.md || {
      echo "FATAL: artifact feature flag '$key' is not source/docs complete" >&2
      failed=1
    }
  done

  for source_term in artifact_write artifact_read artifact_list artifact_delete; do
    grep -qF "\"$source_term\"" mcp-memory-server/src/index.ts || failed=1
    grep -qF "$source_term" README.md docs/operating.md docs/privacy-and-data-flow.md || failed=1
  done
  for source_term in 'list [--kind K] [--session REF] [--json]' 'show <artifact-id-or-prefix> [--json]' 'delete <artifact-id-or-prefix> [--dry-run] [--json]' 'prune [--dry-run] [--include-protected] [--json]'; do
    grep -qF "$source_term" mcp-memory-server/src/artifact-cli.ts || failed=1
  done
  grep -qF '.agentfs/artifacts.db' docs/storage.md docs/privacy-and-data-flow.md || failed=1
  grep -qF 'CAIRN_ARTIFACT_HTTP' mcp-memory-server/src/index.ts README.md docs/operating.md docs/privacy-and-data-flow.md || failed=1
  grep -qE 'redact[^.]{0,180}(before|then)[^.]{0,180}(digest|index|write)' docs/privacy-and-data-flow.md || failed=1
  grep -qE 'default uninstall retains|Default uninstall retains' docs/storage.md docs/privacy-and-data-flow.md || failed=1
  grep -qF -- '--purge-memory PROJECT' docs/storage.md || failed=1
  grep -qF 'revert.sh' docs/storage.md docs/privacy-and-data-flow.md || failed=1

  for version in 2.1.219 2.1.220; do
    grep -qF "version: \"$version\"" mcp-memory-server/src/compaction-normalize.ts || failed=1
    grep -qF "$version" README.md docs/operating.md docs/privacy-and-data-flow.md || failed=1
  done
  grep -qF 'version: "1.17.20"' mcp-memory-server/src/compaction-normalize.ts || failed=1
  grep -qF '1.17.20' README.md docs/operating.md docs/privacy-and-data-flow.md || failed=1

  [[ "$failed" -eq 0 ]] && echo "[artifact-contract] OK: artifact flags/defaults/tools/paths/privacy/uninstall/version pins match source"
  return "$failed"
}

check_artifact_remote_path_contract() {
  local failed=0
  local canonical_path='${CAIRN_AGENTFS_BASE_DIR}/<project-id>/.agentfs/artifacts.db'

  grep -qF "$canonical_path" docs/storage.md || {
    echo "FATAL: canonical remote artifact database path is missing from docs/storage.md" >&2
    failed=1
  }
  grep -qF 'resolveRemoteArtifactProjectRoot' mcp-memory-server/src/artifact-store.ts || {
    echo "FATAL: explicit remote artifact project-root helper is missing" >&2
    failed=1
  }
  grep -qF 'resolveRemoteArtifactProjectRoot' mcp-memory-server/src/index.ts || {
    echo "FATAL: explicit remote artifact project-root wiring is missing" >&2
    failed=1
  }
  grep -qF 'getArtifactDbPath(resolveRemoteArtifactProjectRoot(baseDirectory, projectId))' mcp-memory-server/src/artifact-store.ts || {
    echo "FATAL: remote artifact database resolver does not compose the canonical project-root helper" >&2
    failed=1
  }
  grep -qF 'join("project-alpha", ".agentfs", "artifacts.db")' mcp-memory-server/scripts/smoke-artifact-mcp.mjs || {
    echo "FATAL: HTTP smoke test does not assert the exact project-alpha artifact path" >&2
    failed=1
  }
  grep -qF 'join("project-beta", ".agentfs", "artifacts.db")' mcp-memory-server/scripts/smoke-artifact-mcp.mjs || {
    echo "FATAL: HTTP smoke test does not assert the exact project-beta artifact path" >&2
    failed=1
  }

  [[ "$failed" -eq 0 ]] && echo "[artifact-remote-path] OK: source, HTTP behavior, and storage docs share the canonical path"
  return "$failed"
}

check_capability_contract() {
  local failed=0 file id env tool term source_file docs_files

  for file in \
    mcp-memory-server/src/capability-schema.ts \
    mcp-memory-server/src/capability-registry.ts \
    mcp-memory-server/src/capability-config.ts \
    mcp-memory-server/src/capability-cli.ts \
    mcp-memory-server/src/capability-store.ts \
    mcp-memory-server/src/capability-adapter.ts \
    schemas/capability-callback.schema.json \
    docs/operating.md docs/storage.md docs/privacy-and-data-flow.md README.md; do
    if [[ ! -f "$file" ]]; then
      echo "FATAL: capability parity input is missing: $file" >&2
      failed=1
    fi
  done
  [[ "$failed" -eq 0 ]] || return "$failed"

  while IFS='|' read -r id env; do
    grep -qF "\"$id\"" mcp-memory-server/src/capability-schema.ts || {
      echo "FATAL: canonical capability ID is missing from source: $id" >&2
      failed=1
    }
    grep -qF "$id" README.md docs/operating.md || {
      echo "FATAL: canonical capability ID is undocumented: $id" >&2
      failed=1
    }
    grep -qF "$env" README.md docs/operating.md templates/env.example.template || {
      echo "FATAL: capability environment key is not source/docs complete: $env" >&2
      failed=1
    }
  done <<'EOF'
memory.write|CAIRN_CAPABILITY_MEMORY_WRITE
memory.search|CAIRN_CAPABILITY_MEMORY_SEARCH
notes.distill|CAIRN_CAPABILITY_NOTES_DISTILL
wiki|CAIRN_CAPABILITY_WIKI
graph|CAIRN_CAPABILITY_GRAPH
security.audit|CAIRN_CAPABILITY_SECURITY_AUDIT
route.check|CAIRN_CAPABILITY_ROUTE_CHECK
context.explore|CAIRN_CAPABILITY_CONTEXT_EXPLORE
EOF

  for term in CAIRN_CAPABILITY_CONTRACT CAIRN_CAPABILITY_LOGGING; do
    grep -qF "$term" mcp-memory-server/src/capability-config.ts README.md docs/operating.md templates/env.example.template || {
      echo "FATAL: capability master/logging flag is not source/docs complete: $term" >&2
      failed=1
    }
  done

  while IFS='|' read -r id tool; do
    grep -qF "\"$id\"" mcp-memory-server/src/index.ts || failed=1
    grep -qF "\"$tool\"" mcp-memory-server/src/index.ts || failed=1
    grep -qF "$tool" README.md docs/operating.md || {
      echo "FATAL: omitted MCP tool is undocumented: $tool" >&2
      failed=1
    }
  done <<'EOF'
memory.write|memory_write
memory.search|memory_search
route.check|route_check
context.explore|context_explore
EOF

  while IFS='|' read -r term source_file doc_term docs_files; do
    grep -qF "$term" "$source_file" || {
      echo "FATAL: capability source term is missing: $term ($source_file)" >&2
      failed=1
    }
    grep -qF "$doc_term" $docs_files || {
      echo "FATAL: capability source fact is undocumented: $doc_term ($docs_files)" >&2
      failed=1
    }
  done <<'EOF'
capability-callback/v1/record/|mcp-memory-server/src/capability-store.ts|capability-callback/v1|docs/storage.md docs/privacy-and-data-flow.md
capability-callback/v1/pending/|mcp-memory-server/src/capability-store.ts|capability-callback/v1/pending/|docs/storage.md docs/privacy-and-data-flow.md
.agentfs/trajectory.db|mcp-memory-server/src/capability-cli.ts|.agentfs/trajectory.db|docs/storage.md docs/privacy-and-data-flow.md
CAPABILITY_CALLBACK_RECORD_MAX_COUNT = 10_000|mcp-memory-server/src/capability-store.ts|10,000-record cap|docs/storage.md
getTrajectoryLimits|mcp-memory-server/src/capability-store.ts|CAIRN_TRAJECTORY_RETENTION_DAYS|docs/storage.md
transport !== "http"|mcp-memory-server/src/capability-adapter.ts|no remote/HTTP callback persistence|docs/privacy-and-data-flow.md
isTrajectoryCaptureEnabled|mcp-memory-server/src/capability-adapter.ts|CAIRN_TRAJECTORY_CAPTURE|docs/privacy-and-data-flow.md
configuration_digest|mcp-memory-server/src/capability-store.ts|configuration_digest|docs/operating.md docs/privacy-and-data-flow.md
correlation_id|mcp-memory-server/src/capability-store.ts|correlation_id|docs/privacy-and-data-flow.md
invocation_id|mcp-memory-server/src/capability-store.ts|invocation_id|docs/privacy-and-data-flow.md
duration_ms|mcp-memory-server/src/capability-store.ts|duration_ms|docs/privacy-and-data-flow.md
issueOperatingCapability|mcp-memory-server/src/capability-adapter.ts|durably issue|docs/privacy-and-data-flow.md
settleOperatingCapability|mcp-memory-server/src/capability-adapter.ts|consumed once|docs/storage.md docs/privacy-and-data-flow.md
isCapabilityContractEnabled()|mcp-memory-server/src/capability-adapter.ts|checked again at finish|docs/privacy-and-data-flow.md
const current = await resolveCapabilityStatus({ projectRoot });|mcp-memory-server/src/capability-adapter.ts|current three-consent authorization|docs/privacy-and-data-flow.md
current.logging.enabled|mcp-memory-server/src/capability-adapter.ts|managed logging|docs/privacy-and-data-flow.md
current.configuration_digest === handle.configuration_digest|mcp-memory-server/src/capability-adapter.ts|stale|docs/privacy-and-data-flow.md
EOF

  local expected_final_fields source_final_fields public_final_fields
  expected_final_fields=$(printf '%s\n' \
    capability_id configuration_digest correlation_id duration_ms error_code \
    finished_at harness invocation_id outcome schema_version source started_at \
    state_source transport | sort)
  source_final_fields=$(sed -n \
    '/export const capabilityCallbackRecordSchema/,/}).superRefine/p' \
    mcp-memory-server/src/capability-store.ts \
    | sed -n 's/^    \([a-z_]*\):.*/\1/p' \
    | sort)
  public_final_fields=$(node -e '
    const schema = require("./schemas/capability-callback.schema.json");
    process.stdout.write(Object.keys(schema.properties).sort().join("\n"));
  ')
  if [[ "$source_final_fields" != "$expected_final_fields" ]]; then
    echo "FATAL: runtime final-record fields changed from the strict allow-list" >&2
    failed=1
  fi
  if [[ "$public_final_fields" != "$expected_final_fields" ]]; then
    echo "FATAL: public final-record fields changed from the strict allow-list" >&2
    failed=1
  fi

  for term in \
    'capabilities list' 'capabilities status' 'capabilities enable' \
    'capabilities disable' 'capabilities reset' 'capabilities logging'; do
    grep -qF "$term" mcp-memory-server/src/capability-cli.ts docs/operating.md || {
      echo "FATAL: managed capability CLI operation is not source/docs complete: $term" >&2
      failed=1
    }
  done

  for term in \
    'three consents' 'payload-free' 'no start record' 'fail-open' \
    'no-payload, no-telemetry, no-network' \
    'no telemetry' 'HTTP callbacks are never persisted' \
    'Default uninstall retains' '--purge-memory PROJECT' 'revert.sh' \
    'no database migration'; do
    grep -qiF -- "$term" docs/storage.md docs/privacy-and-data-flow.md || {
      echo "FATAL: capability privacy/storage term is missing: $term" >&2
      failed=1
    }
  done

  for term in 'wiki covers ingest, query, and lint' 'graph covers its command family' \
    'audit covers its command and workflow family' 'directly invokable workflow' \
    'byte-identical legacy installed'; do
    grep -qiF "$term" docs/operating.md || {
      echo "FATAL: capability operating-guard family is undocumented: $term" >&2
      failed=1
    }
  done

  [[ "$failed" -eq 0 ]] && echo "[capability-contract] OK: IDs, env, defaults, omissions, CLI, guards, storage, consent, and uninstall facts match source"
  return "$failed"
}

main() {
  local mode="${1:-}"
  if [[ "$mode" == "--artifact-remote-path-only" ]]; then
    [[ $# -eq 1 ]] || { usage >&2; exit 2; }
    check_artifact_remote_path_contract
    return
  fi
  if [[ "$mode" == "--expect-red-artifact-remote-path" ]]; then
    [[ $# -eq 1 ]] || { usage >&2; exit 2; }
    main
    if check_artifact_remote_path_contract; then
      echo "FATAL: artifact remote path documentation unexpectedly matches source" >&2
      exit 1
    fi
    echo "$ARTIFACT_REMOTE_PATH_RED_MARKER"
    exit "$EXPECTED_RED_EXIT"
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      *)
        usage >&2
        exit 2
        ;;
    esac
  done

  local failed=0
  check_env_keys || failed=1
  check_commands || failed=1
  check_typed_contract || failed=1
  check_artifact_contract || failed=1
  check_artifact_remote_path_contract || failed=1
  check_capability_contract || failed=1

  if [[ "$failed" -ne 0 ]]; then
    echo "FATAL: docs-parity check found drift (see above) -- SC-02 not yet satisfied" >&2
    exit 1
  fi

  echo "[parity] OK: docs match shipped code -- no drift found"
}

main "$@"
