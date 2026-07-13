#!/usr/bin/env bash
# Guard: shipped shell scripts must run on macOS's default bash 3.2.
#
# macOS still ships bash 3.2 (2007) as /bin/bash, and `#!/usr/bin/env bash`
# picks it up unless the user installed a newer bash on PATH. bash-4-only
# features (associative arrays via `declare -A`, `mapfile`/`readarray`, the
# `${var^^}`/`${var,,}` case operators) blow up there — e.g. `declare -A`
# is misparsed as a numeric-index assignment and dies under `set -u` with a
# bogus "unbound variable". CI runs on bash 5, so nothing else catches this.
#
# Grep-based, so it needs no bash 3.2 to run. Ceiling: it flags the common
# 4-isms by pattern, not every one; the fresh-system smoke test should still
# exercise the install under an actual bash 3.2 (docker run bash:3.2 ...).
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# One ERE, alternated: assoc arrays | mapfile/readarray | ${v^^}/${v,,}.
BASH4_PATTERN='declare[[:space:]]+-A|(mapfile|readarray)[[:space:]]|\$\{[A-Za-z_][A-Za-z0-9_]*(\^\^|,,)'

failed=0
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  # grep -n, then drop full-line comments (`^NN:  # ...`) so the pattern
  # only trips on real usage, not prose that names the feature.
  matches=$(grep -nE "$BASH4_PATTERN" "$f" | grep -vE '^[0-9]+:[[:space:]]*#' || true)
  if [[ -n "$matches" ]]; then
    if [[ $failed -eq 0 ]]; then
      echo "FAIL: bash-4-only feature(s) in scripts that must run on macOS bash 3.2:" >&2
      failed=1
    fi
    echo "  ${f#"$ROOT_DIR"/}" >&2
    sed 's/^/    /' <<<"$matches" >&2
  fi
done < <(find "$ROOT_DIR/scripts" "$ROOT_DIR/bin" -type f \( -name '*.sh' -o -name '*.template' \) | sort)

if [[ $failed -ne 0 ]]; then
  echo "Rewrite portably (case lookup for maps, while-read for mapfile)." >&2
  exit 1
fi

echo "test-portable-sh: OK (no bash-4-only features in shipped scripts)"
