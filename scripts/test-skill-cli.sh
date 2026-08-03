#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

node "$ROOT/mcp-memory-server/dist/skill-cli.js" --help >"$tmp/help"
for operation in harvest list show review propose evaluate apply rollback; do
  grep -q "$operation" "$tmp/help" || { echo "FAIL: skill help omitted $operation" >&2; exit 1; }
done

mkdir -p "$tmp/project"
node "$ROOT/mcp-memory-server/dist/skill-cli.js" list --project "$tmp/project" --json >"$tmp/list.json"
node -e '
const value = require(process.argv[1]);
for (const key of ["candidates", "proposals", "evaluations", "applications"]) {
  if (!Array.isArray(value[key]) || value[key].length !== 0) process.exit(1);
}
' "$tmp/list.json"

if env -u CAIRN_EVAL node "$ROOT/mcp-memory-server/dist/skill-cli.js" evaluate \
  --project "$tmp/project" --proposal missing --exploration-task-set missing \
  --confirmation-task-set missing --adapter missing --yes >"$tmp/out" 2>"$tmp/err"; then
  echo "FAIL: disabled skill evaluation succeeded" >&2
  exit 1
fi
grep -q 'disabled' "$tmp/err" || { echo "FAIL: disabled skill evaluation did not fail closed" >&2; exit 1; }

echo "PASS: installed-style skill CLI discovery and default-off gate"
