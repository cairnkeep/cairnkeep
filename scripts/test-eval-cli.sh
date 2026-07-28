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
  for state in absent ok partial tampered unsafe; do
    root="$tmp/$state"
    mkdir -p "$root"
    printf '%s\n' "$state" >"$root/.phase19-diagnosis-fixture"
    CAIRN_EVAL_DIAGNOSIS_FIXTURE="$state" node "$cli" doctor-diagnosis --root "$root" --json >"$tmp/$state.json"
    node - "$tmp/$state.json" "$state" <<'NODE'
const value = require(process.argv[2]);
if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["diagnosis", "schema_version"])) process.exit(1);
if (value.schema_version !== 1 || value.diagnosis !== process.argv[3]) process.exit(1);
NODE
  done
  for sentinel in prompt-sentinel model-output-sentinel adapter-stderr-sentinel environment-sentinel absolute-path-sentinel; do
    ! grep -R -F "$sentinel" "$tmp" >/dev/null || fail "diagnosis reflected $sentinel"
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
