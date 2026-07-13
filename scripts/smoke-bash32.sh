#!/usr/bin/env bash
# smoke-bash32.sh — run the sync scripts under macOS's default bash 3.2, in a
# container, to prove they *execute* there (the static test-portable-sh.sh only
# greps the source). This is the check that reproduces the real macOS failure:
# bash 3.2 misparsing `declare -A` / missing `mapfile`.
#
# Uses docker or podman; SKIPS (exit 0) when neither exists, so it is safe to
# run anywhere. Deliberately NOT named test-*.sh — `npm test` stays container-
# free; run this by hand or via the CI shell-portability job.
set -uo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

RUNTIME=""
for r in docker podman; do
  command -v "$r" >/dev/null 2>&1 && { RUNTIME="$r"; break; }
done
if [[ -z "$RUNTIME" ]]; then
  echo "smoke-bash32: SKIP (no docker/podman available)"
  exit 0
fi

IMG="docker.io/library/bash:3.2"
echo "smoke-bash32: $RUNTIME + $IMG"

# --check exercises the failing code paths: the hook block in the claude script
# (the declare -A site) and report_extra_live_assets in the opencode scripts
# (the mapfile site), the latter only when the live root exists — so create it.
SCRIPTS=(
  scripts/sync-claude-assets.sh
  scripts/sync-opencode-explore-assets.sh
  scripts/sync-opencode-wiki-assets.sh
)

fails=0
for s in "${SCRIPTS[@]}"; do
  out=$("$RUNTIME" run --rm -v "$ROOT_DIR":/w:ro -w /w "$IMG" \
    bash -c 'mkdir -p /tmp/live && exec bash "$0" --check --live-root /tmp/live' "$s" 2>&1) || true
  # Exit status is ignored on purpose: --check returns non-zero for DRIFT
  # (expected against an empty live root). We fail only on a bash-3.2 execution
  # failure — an unbound-variable abort (declare -A misparse), a missing builtin
  # (mapfile/readarray), or a syntax error — the exact 4-ism classes.
  if grep -qiE 'unbound variable|command not found|mapfile:|readarray:|syntax error' <<<"$out"; then
    echo "  [FAIL] $s"
    tail -5 <<<"$out" | sed 's/^/      /'
    fails=$((fails + 1))
  else
    echo "  [PASS] $s runs on bash 3.2"
  fi
done

if [[ $fails -eq 0 ]]; then
  echo "smoke-bash32: OK"
  exit 0
fi
echo "smoke-bash32: $fails script(s) fail on bash 3.2"
exit 1
