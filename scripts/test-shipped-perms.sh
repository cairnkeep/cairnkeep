#!/usr/bin/env bash
# Regression guard for the 744-perms packaging bug. A root-owned `sudo npm i -g`
# makes root the file owner, so a non-root user can only run cairn if "other"
# has the execute bit. A publisher umask can strip it at pack time; the
# `prepack` script re-applies git's tracked executable bit. This verifies
# prepack heals a umask-mangled entrypoint back to 755 (world-executable).
#
# Deliberately does NOT run `npm pack`: this test runs inside `npm test`, which
# runs inside `npm publish`'s prepublishOnly, and nesting npm that deep is not
# portable. Running the prepack command directly tests the same guarantee.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
fail() { echo "FAIL: $1" >&2; exit 1; }

prepack=$(node -e 'process.stdout.write(require("./package.json").scripts.prepack||"")')
[[ -n "$prepack" ]] || fail "package.json has no prepack script (perms fix missing)"

entry=bin/cairn
trap 'chmod 755 "$entry" 2>/dev/null || true' EXIT
chmod 744 "$entry"                                              # simulate a stripping umask
sh -c "$prepack"                                               # run the real prepack command
mode=$(stat -c '%a' "$entry" 2>/dev/null || stat -f '%Lp' "$entry")  # GNU || BSD/macOS
[[ "$mode" == "755" ]] || fail "prepack did not restore $entry to 755 (got $mode) -- 744 packaging bug"
echo "OK: prepack restores shipped executables to 755"
