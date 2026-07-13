#!/usr/bin/env bash
# Regression guard for the 744-perms packaging bug. A root-owned `sudo npm i -g`
# makes root the file owner, so a non-root user can only run cairn if "other"
# has the execute bit. A publisher umask can strip it at pack time; the
# `fix:perms` script re-applies git's tracked executable bit. This verifies it
# heals a umask-mangled entrypoint back to 755 (world-executable).
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
fail() { echo "FAIL: $1" >&2; exit 1; }

fix_perms=$(node -e 'process.stdout.write(require("./package.json").scripts["fix:perms"]||"")')
[[ -n "$fix_perms" ]] || fail "package.json has no fix:perms script"

entry=bin/cairn
trap 'chmod 755 "$entry" 2>/dev/null || true' EXIT
chmod 744 "$entry"                                              # simulate a stripping umask
sh -c "$fix_perms"                                             # run the real packaging command
mode=$(stat -c '%a' "$entry" 2>/dev/null || stat -f '%Lp' "$entry")  # GNU || BSD/macOS
[[ "$mode" == "755" ]] || fail "fix:perms did not restore $entry to 755 (got $mode) -- 744 packaging bug"
echo "OK: fix:perms restores shipped executables to 755"
