#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for shell in bash zsh fish; do
  "$ROOT/bin/cairn" completion "$shell" > "$tmp/$shell"
  [[ -s $tmp/$shell ]]
  grep -q 'completion' "$tmp/$shell"
done

grep -q 'complete -F _cairn_complete cairn' "$tmp/bash"
grep -q '#compdef cairn' "$tmp/zsh"
grep -q 'complete -c cairn' "$tmp/fish"
for shell in bash zsh; do
  grep -q 'sync-pi' "$tmp/$shell"
  grep -q -- '--live-root' "$tmp/$shell"
done
grep -q 'sync-pi' "$tmp/fish"
grep -q -- '-l live-root' "$tmp/fish"

if "$ROOT/bin/cairn" completion unsupported >/dev/null 2>&1; then
  echo "completion accepted an unsupported shell" >&2
  exit 1
fi

git -C "$ROOT" diff --check
echo "PASS: shell completion generation"
