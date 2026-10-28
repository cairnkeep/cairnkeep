#!/usr/bin/env bash
# cairn memory <path|export|import> — relocate global-scope memory between
# machines or backends. Project-scope memory lives in <project>/.agentfs/ and
# is intentionally outside this command's base directory.
#
# The global store is one SQLite .db per named scope under
# CAIRN_AGENTFS_BASE_DIR (default ~/.cairnkeep). `export` takes a WAL-safe
# snapshot of every global-scope db into a portable archive; `import` restores
# them on another machine; `path` prints the global store location.
set -euo pipefail

base="${CAIRN_AGENTFS_BASE_DIR:-$HOME/.cairnkeep}"
base="${base/#\~/$HOME}"

usage() {
  cat <<'EOF'
Usage: cairn memory <path|export|import>
  path                 Print the global-scope memory base directory.
  export <file.tgz>    WAL-safe snapshot of every global-scope .db.
  import <file.tgz>    Restore global-scope .db files (backs up existing).
EOF
}

sub="${1:-help}"
[[ $# -gt 0 ]] && shift

case "$sub" in
  path)
    echo "$base"
    ;;
  export)
    out="${1:?usage: cairn memory export <file.tgz>}"
    [[ -d "$base" ]] || { echo "no memory store directory at $base" >&2; exit 1; }
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
    n=0
    for db in "$base"/*.db; do
      [[ -e "$db" ]] || continue
      # .backup yields a consistent copy even while the store is in WAL mode.
      script_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
      scope_name=$(basename "$db" .db)
      node "$script_root/memory-snapshot.mjs" "$db" "$tmp/$(basename "$db")" "$scope_name"
      n=$((n + 1))
    done
    [[ $n -gt 0 ]] || { echo "no scope .db files under $base — nothing to export" >&2; exit 1; }
    tar -C "$tmp" -czf "$out" .
    echo "exported $n scope db file(s) from $base -> $out"
    ;;
  import)
    in="${1:?usage: cairn memory import <file.tgz>}"
    script_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
    exec node "$script_root/memory-import.mjs" "$base" "$in"
    ;;
  help | -h | --help)
    usage
    ;;
  *)
    echo "Unknown: cairn memory $sub" >&2
    usage >&2
    exit 1
    ;;
esac
