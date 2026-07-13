#!/usr/bin/env bash
# Regression guard for the 744-perms packaging bug: shipped executables must be
# world-executable in the published tarball. A root-owned `sudo npm i -g` makes
# root the file owner, so a non-root user can only run the tool if "other" has
# the execute bit. `prepack` re-applies git's 100755 mode; this verifies it stuck.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
fail() { echo "FAIL: $1" >&2; exit 1; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
( cd "$ROOT" && npm pack --pack-destination "$tmp" >/dev/null 2>&1 ) || fail "npm pack failed"
tarball=$(ls "$tmp"/*.tgz 2>/dev/null | head -1)
[[ -f "$tarball" ]] || fail "npm pack produced no tarball"

# tar -tvf perms column looks like -rwxr-xr-x; require owner-x (pos 4) and other-x (pos 10).
check() {
  local entry="package/$1" perms
  perms=$(tar -tvf "$tarball" 2>/dev/null | awk -v f="$entry" '$NF==f {print $1; exit}')
  [[ -n "$perms" ]] || fail "$1 missing from tarball"
  [[ "${perms:3:1}" == "x" ]] || fail "$1 not owner-executable in tarball ($perms)"
  [[ "${perms:9:1}" == "x" ]] || fail "$1 not world-executable in tarball ($perms) — 744 packaging bug"
}

check bin/cairn
check scripts/bootstrap.sh
check scripts/doctor.sh
check scripts/sync-claude-assets.sh
echo "OK: shipped executables are world-executable in tarball"
