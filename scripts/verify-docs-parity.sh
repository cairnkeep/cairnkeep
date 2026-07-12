#!/usr/bin/env bash
set -euo pipefail

# Docs-vs-code parity checker (SC-02; D-10). Two one-directional checks --
# code surface must be documented; doc-only names are allowed (e.g.
# CAIRN_GIT_PROVIDER is read by the CLI/provider layer, not the server, and
# script-local vars like CAIRN_GUARD_DENYLIST/CAIRN_ROUTE_BINARY are never
# server config -- neither is a failure):
#
#   1. Env-key check: every CAIRN_[A-Z_]+/MCP_HTTP_[A-Z_]+ token read in
#      mcp-memory-server/src/*.ts (the runtime server config surface --
#      NOT scripts/ or bin/) must be named somewhere in docs/operating.md
#      or README.md. `comm -23` on two sorted lists -- code-keys-not-in-
#      docs -- not a symmetric diff.
#   2. Command check: every claude/commands/*.md basename must appear in
#      docs/operating.md.
#
# Reports both check results even when the first fails, so a single run
# surfaces the full drift set. Exits non-zero on any drift, 0 on none.

usage() {
  cat <<'EOF'
Usage: verify-docs-parity.sh
       verify-docs-parity.sh -h|--help

Checks that every CAIRN_*/MCP_HTTP_* env key read by the cairn-memory MCP
server (mcp-memory-server/src/*.ts) is named in docs/operating.md or
README.md, and that every claude/commands/*.md command is named in
docs/operating.md. One-directional: doc-only names are not a failure.
Prints every missing key/command by name, then exits non-zero on any
drift, or 0 if the docs are fully in sync with the shipped code.
EOF
}

ENV_KEY_PATTERN='(CAIRN_[A-Z_]+|MCP_HTTP_[A-Z_]+)'

# check_env_keys(): comm -23 of sorted code-keys vs sorted doc-keys --
# code-keys-not-in-docs only (one-directional, per D-10).
check_env_keys() {
  local code_keys doc_keys missing

  code_keys=$(grep -ohE "\\b${ENV_KEY_PATTERN}\\b" mcp-memory-server/src/*.ts | sort -u)
  doc_keys=$(grep -ohE "\\b${ENV_KEY_PATTERN}\\b" docs/operating.md README.md | sort -u)

  missing=$(comm -23 <(printf '%s\n' "$code_keys") <(printf '%s\n' "$doc_keys"))

  if [[ -n "$missing" ]]; then
    echo "FATAL: env keys read in mcp-memory-server/src but undocumented:" >&2
    while IFS= read -r key; do
      [[ -n "$key" ]] && echo "  - $key" >&2
    done <<<"$missing"
    return 1
  fi

  echo "[env-keys] OK: every mcp-memory-server/src env key is named in docs/operating.md or README.md"
  return 0
}

# check_commands(): every claude/commands/*.md basename must appear as a
# documented command reference in docs/operating.md -- either backtick-
# quoted (the "N commands" enumeration, e.g. `graphify`) or slash-prefixed
# (the workflow section, e.g. `/remember <fact>`). A bare substring match
# is too loose: "context-explore" appears in docs/operating.md today only
# inside an unrelated sync-script filename comment, not as a documented
# command -- that incidental mention must not count as "documented".
check_commands() {
  local failed=0
  local file name

  for file in claude/commands/*.md; do
    name=$(basename "$file" .md)
    if ! grep -qF "\`${name}\`" docs/operating.md && ! grep -qF "/${name}" docs/operating.md; then
      echo "FATAL: command '$name' (claude/commands/${name}.md) is not named in docs/operating.md" >&2
      failed=1
    fi
  done

  if [[ "$failed" -ne 0 ]]; then
    return 1
  fi

  echo "[commands] OK: every claude/commands/*.md command is named in docs/operating.md"
  return 0
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      *)
        usage >&2
        exit 2
        ;;
    esac
  done

  local failed=0
  check_env_keys || failed=1
  check_commands || failed=1

  if [[ "$failed" -ne 0 ]]; then
    echo "FATAL: docs-parity check found drift (see above) -- SC-02 not yet satisfied" >&2
    exit 1
  fi

  echo "[parity] OK: docs match shipped code -- no drift found"
}

main "$@"
