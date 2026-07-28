#!/usr/bin/env bash
# Installed-style public and private evaluation CLI contract.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MODE="${1:-baseline}"
[[ $# -gt 0 ]] && shift

usage() {
  echo 'Usage: test-eval-cli.sh [--expected-red|--doctor-diagnosis]' >&2
}
fail() { echo "FAIL: $1" >&2; exit 1; }

case "$MODE" in
  baseline|--expected-red|--doctor-diagnosis) [[ $# -eq 0 ]] || { usage; exit 2; } ;;
  *) usage; exit 2 ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cli="$ROOT/mcp-memory-server/dist/eval-cli.js"

baseline() {
  bash -n "$ROOT/scripts/test-eval-cli.sh"
  "$ROOT/bin/cairn" help >/dev/null
  [[ ! -e "$tmp/project" && ! -e "$tmp/output" && ! -e "$tmp/database" && ! -e "$tmp/network" ]] || \
    fail "baseline created a side-effect sentinel"
  # Once the compiled owner lands, default execution exercises the installed-
  # style surface while Wave 0 remains green without changing root composition.
  if [[ -f "$cli" ]]; then
    node "$cli" --help >"$tmp/help"
    for operation in validate run ablate report prune delete; do
      grep -q "$operation" "$tmp/help" || fail "help omitted $operation"
    done
    grep -q 'doctor-diagnosis' "$tmp/help" && fail "public help exposed private diagnosis"
    env -u CAIRN_EVAL node "$cli" validate --task-set "$tmp/unread-task-set" --adapter "$tmp/unread-adapter" --output "$tmp/unwritten" --json >"$tmp/disabled.json"
    node -e 'const v=require(process.argv[1]);if(v.schema_version!==1||v.enabled!==false)process.exit(1)' "$tmp/disabled.json" \
      || fail "disabled JSON is not stable"
    [[ ! -e "$tmp/unwritten" ]] || fail "disabled CLI created output"
    if node "$cli" unknown-operation >"$tmp/unknown.out" 2>"$tmp/unknown.err"; then
      fail "unknown operation succeeded"
    fi
  fi
  echo "PASS: Phase 19 eval CLI Wave 0/default contract"
}

doctor_diagnosis() {
  [[ -f "$cli" ]] || fail "compiled eval CLI is absent"

  create_report_fixture() {
    local project="$1"
    local state="$2"
    mkdir -p "$project"
    node --input-type=module - "$ROOT" "$project" "$state" <<'NODE'
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2];
const project = process.argv[3];
const state = process.argv[4];
const reportApi = await import(`${root}/mcp-memory-server/dist/eval-report.js`);
const store = await reportApi.createEvalReportStore({
  project_root: project,
  experiment_id: "fixture-experiment",
});
if (state === "unsafe") {
  const target = join(project, "unsafe-target");
  await writeFile(target, "absolute-path-sentinel\n", { mode: 0o600 });
  await symlink(target, store.report_path);
  process.exit(0);
}
if (state === "tampered") {
  await writeFile(store.report_path, '{"prompt":"prompt-sentinel"}\n', { mode: 0o600 });
  await chmod(store.report_path, 0o600);
  process.exit(0);
}
const report = {
  schema_version: 1,
  experiment_id: store.experiment_id,
  status: state === "partial" ? "partial" : "final",
  experiment_kind: "two_pass",
  task_set_digest: "0".repeat(64),
  adapter_config_digest: "1".repeat(64),
  source_revision: "2".repeat(40),
  schedule_digest: "3".repeat(64),
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:01.000Z",
  runtime: { platform: "linux", arch: "x64", node: "22.0.0", cairnkeep: "0.0.0" },
  schedule: [], observations: [], aggregates: [],
  missingness: { digest: "4".repeat(64), count: 0, reasons: [] },
  warnings: [],
  evidence: {
    schema_version: 1,
    evidence_scope: "offline-framework",
    source_commit: "2".repeat(40),
    package_version: "0.0.0",
    runtime_id: "node-22-linux-x64",
    task_set_digest: "0".repeat(64),
    report_digest: "5".repeat(64),
    schema_digests: ["6".repeat(64)],
    note_snapshot_digests: [],
    missingness_digest: "4".repeat(64),
    claim_anchors: [],
  },
};
await reportApi.checkpointEvalReport(store, report);
NODE
  }

  for state in absent ok partial tampered unsafe; do
    project="$tmp/$state"
    mkdir -p "$project"
    [[ "$state" == "absent" ]] || create_report_fixture "$project" "$state"
    env -u CAIRN_EVAL node "$cli" doctor-diagnosis --root "$project" --json >"$tmp/$state.json" 2>"$tmp/$state.err"
    node - "$tmp/$state.json" "$state" <<'NODE'
const value = require(process.argv[2]);
if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["diagnosis", "schema_version"])) process.exit(1);
if (value.schema_version !== 1 || value.diagnosis !== process.argv[3]) process.exit(1);
NODE
    [[ ! -s "$tmp/$state.err" ]] || fail "diagnosis wrote diagnostics for $state"
    [[ $(wc -c <"$tmp/$state.json") -le 64 ]] || fail "diagnosis output exceeded its fixed bound"
  done

  for malformed in \
    "doctor-diagnosis --json" \
    "doctor-diagnosis --root prompt-sentinel" \
    "doctor-diagnosis --root $tmp/absent --json --extra model-output-sentinel"; do
    # shellcheck disable=SC2086
    env -u CAIRN_EVAL node "$cli" $malformed >"$tmp/malformed.json" 2>"$tmp/malformed.err" ||
      fail "malformed diagnosis invocation did not collapse safely"
    node -e 'const v=require(process.argv[1]);if(JSON.stringify(v)!==JSON.stringify({schema_version:1,diagnosis:"unsafe"}))process.exit(1)' \
      "$tmp/malformed.json" || fail "malformed diagnosis invocation returned a non-canonical envelope"
    [[ ! -s "$tmp/malformed.err" ]] || fail "malformed diagnosis invocation exposed stderr"
  done

  help_and_completions="$tmp/public-vocabulary"
  {
    node "$cli" --help
    sed -n '1,220p' "$ROOT/scripts/completion.sh"
  } >"$help_and_completions"
  ! grep -qF 'doctor-diagnosis' "$help_and_completions" || fail "private diagnosis entered public discovery"

  for sentinel in prompt-sentinel model-output-sentinel adapter-stderr-sentinel environment-sentinel absolute-path-sentinel; do
    ! grep -F "$sentinel" "$tmp"/*.json "$tmp"/*.err >/dev/null || fail "diagnosis reflected $sentinel"
  done
  echo "PASS: Phase 19 private value-free five-state diagnosis contract"
}

case "$MODE" in
  --expected-red)
    baseline >/dev/null
    set +e
    node --input-type=module - "$cli" >"$tmp/red.out" 2>"$tmp/red.err" <<'NODE'
import { pathToFileURL } from "node:url";
await import(pathToFileURL(process.argv[2]).href);
NODE
    status=$?
    set -e
    if [[ "$status" -ne 0 ]] && grep -qF '/dist/eval-cli.js' "$tmp/red.err" && grep -qF 'ERR_MODULE_NOT_FOUND' "$tmp/red.err"; then
      echo 'PHASE19_RED:EVAL_CLI_MISSING'
      exit 0
    fi
    cat "$tmp/red.out" "$tmp/red.err" >&2
    fail "expected only the missing compiled eval CLI"
    ;;
  --doctor-diagnosis) doctor_diagnosis ;;
  baseline) baseline ;;
esac
