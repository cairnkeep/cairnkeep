#!/usr/bin/env bash
# cairn memory <path|export|import> — relocate the durable memory store between
# machines or backends.
#
# The store is one SQLite .db per scope under CAIRN_AGENTFS_BASE_DIR
# (default ~/.cairnkeep). `export` takes a WAL-safe snapshot of every scope db
# into a portable archive; `import` restores them on another machine; `path`
# prints the store location so nothing has to guess where it lives.
set -euo pipefail

base="${CAIRN_AGENTFS_BASE_DIR:-$HOME/.cairnkeep}"
base="${base/#\~/$HOME}"

usage() {
  cat <<'EOF'
Usage: cairn memory <path|export|import>
  path                 Print the memory store base directory.
  export <file.tgz>    WAL-safe snapshot of every scope .db into a portable archive.
  import <file.tgz>    Restore scope .db files from an archive (backs up existing).
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
    command -v sqlite3 >/dev/null 2>&1 || { echo "sqlite3 is required for a WAL-safe export" >&2; exit 1; }
    [[ -d "$base" ]] || { echo "no memory store directory at $base" >&2; exit 1; }
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
    n=0
    for db in "$base"/*.db; do
      [[ -e "$db" ]] || continue
      # .backup yields a consistent copy even while the store is in WAL mode.
      sqlite3 "$db" ".backup '$tmp/$(basename "$db")'"
      n=$((n + 1))
    done
    [[ $n -gt 0 ]] || { echo "no scope .db files under $base — nothing to export" >&2; exit 1; }
    tar -C "$tmp" -czf "$out" .
    echo "exported $n scope db file(s) from $base -> $out"
    ;;
  import)
    in="${1:?usage: cairn memory import <file.tgz>}"
    [[ -f "$in" ]] || { echo "no such archive: $in" >&2; exit 1; }
    mkdir -p "$base"
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
    tar -C "$tmp" -xzf "$in"
    n=0
    for db in "$tmp"/*.db; do
      [[ -e "$db" ]] || continue
      dest="$base/$(basename "$db")"
      [[ -f "$dest" ]] && cp -f "$dest" "$dest.bak-pre-import"
      cp -f "$db" "$dest"
      n=$((n + 1))
    done
    [[ $n -gt 0 ]] || { echo "archive contained no scope .db files: $in" >&2; exit 1; }
    echo "imported $n scope db file(s) -> $base"
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
