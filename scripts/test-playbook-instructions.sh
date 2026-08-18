#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
project="$tmp/project"
mkdir -p "$project"
printf '# User rules\n\nKeep this line.\n' >"$project/AGENTS.md"
chmod 0640 "$project/AGENTS.md"

node "$ROOT/scripts/playbook-instructions.mjs" "$project" >/dev/null
grep -qF 'Keep this line.' "$project/AGENTS.md"
[[ $(grep -cF '<!-- cairnkeep:playbook:v1:start -->' "$project/AGENTS.md") -eq 1 ]]
grep -qF 'derive one short query from the task' "$project/AGENTS.md"
grep -qF 'search `scope: project` once' "$project/AGENTS.md"
grep -qF 'Treat returned memory as a locator, not authority.' "$project/AGENTS.md"
grep -qF 'Do not write, supersede, or approve durable memory' "$project/AGENTS.md"
[[ $(stat -c '%a' "$project/AGENTS.md") == 640 ]]
before=$(sha256sum "$project/AGENTS.md" | cut -d' ' -f1)
node "$ROOT/scripts/playbook-instructions.mjs" "$project" >/dev/null
after=$(sha256sum "$project/AGENTS.md" | cut -d' ' -f1)
[[ "$before" == "$after" ]]
"$ROOT/bin/cairn" playbook instructions check --project "$project" --json >/dev/null

node "$ROOT/scripts/playbook-instructions.mjs" "$project" --remove >/dev/null
grep -qF 'Keep this line.' "$project/AGENTS.md"
! grep -qF 'cairnkeep:playbook' "$project/AGENTS.md"
! grep -qF 'Cairnkeep Durable Context' "$project/AGENTS.md"

printf '%s\n%s\n%s\n' \
  '<!-- cairnkeep:playbook:v1:start -->' \
  '<!-- cairnkeep:playbook:v1:start -->' \
  '<!-- cairnkeep:playbook:v1:end -->' >"$project/AGENTS.md"
if node "$ROOT/scripts/playbook-instructions.mjs" "$project" >/dev/null 2>&1; then
  echo 'duplicate managed markers were accepted' >&2
  exit 1
fi

rm "$project/AGENTS.md"
printf 'neighbor\n' >"$tmp/neighbor"
ln -s "$tmp/neighbor" "$project/AGENTS.md"
if node "$ROOT/scripts/playbook-instructions.mjs" "$project" >/dev/null 2>&1; then
  echo 'symlink AGENTS.md was accepted' >&2
  exit 1
fi
[[ $(cat "$tmp/neighbor") == neighbor ]]

for command in bootstrap setup; do
  unsafe="$tmp/unsafe-$command"
  mkdir -p "$unsafe"
  printf '%s\n%s\n' '<!-- cairnkeep:playbook:v1:start -->' '<!-- cairnkeep:playbook:v1:start -->' >"$unsafe/AGENTS.md"
  if [[ "$command" == bootstrap ]]; then
    if "$ROOT/bin/cairn" bootstrap "$unsafe" >/dev/null 2>&1; then
      echo 'bootstrap accepted malformed managed markers' >&2
      exit 1
    fi
  elif "$ROOT/bin/cairn" setup "$unsafe" --git init --harness codex --memory local --yes >/dev/null 2>&1; then
    echo 'setup accepted malformed managed markers' >&2
    exit 1
  fi
  [[ ! -e "$unsafe/.ai" ]]
done

echo 'PASS: ownership-safe playbook AGENTS.md reconciliation'
