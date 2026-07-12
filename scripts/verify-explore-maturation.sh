#!/usr/bin/env bash
set -uo pipefail

# Phase 12 composed end-to-end proof: context_explore maturation
# (CTX-08 cross-referencing, CTX-09 pre-task hook auto-invoke,
# CTX-10 result caching).
#
# Fully offline (no network, no real token_miser) -- every stage drives the
# real `explore` CLI subcommand or the real hook script against a fake
# token_miser fixture binary, so it runs in CI. Mirrors
# verify-token-savings-ab.sh's wrapper/logging-binary technique for proving
# "the binary was NOT invoked" on a cache hit, and reuses Plan 01/02's
# smoke-test fixtures (fake-tokenmiser-logging.sh, fake-tokenmiser-crossref.sh)
# and temp-git-repo + XDG_CACHE_HOME isolation setup.
#
# Stages:
#   --crossref  CTX-08: a seeded memory/wiki entry produces memory_refs/
#               wiki_refs on the matching citation; the non-matching citation
#               and a fully unseeded repo stay plain (D-02/D-03/D-04).
#   --cache     CTX-10: a second identical call returns cached:true and the
#               binary's invocation counter does NOT increment; a repo change
#               (tracked-file edit or new untracked file) forces cached:false
#               and re-invokes the binary.
#   --hook      CTX-09: a scripted UserPromptSubmit JSON piped through
#               claude/hooks/context-explore-pretask.sh emits
#               hookSpecificOutput.additionalContext when double-opted-in
#               with citations found, and stays silent when gated off or the
#               prompt is low-signal.
#   (no stage flag) runs all three stages in sequence.
#
# Exits non-zero if any check in any run stage failed.

usage() {
  cat <<'EOF'
Usage: verify-explore-maturation.sh [--crossref|--cache|--hook] [-h|--help]

Composed, offline, re-runnable proof of Phase 12's three context_explore
maturation success criteria: citation cross-referencing (CTX-08), result
caching (CTX-10), and pre-task hook auto-invoke (CTX-09). Drives the real
`explore` CLI subcommand and the real hook script against fake token_miser
fixture binaries -- no network, no live binary required.

Options:
  --crossref   Run only the CTX-08 cross-reference stage.
  --cache      Run only the CTX-10 cache stage.
  --hook       Run only the CTX-09 hook stage.
  (default)    Run all three stages.
  -h, --help   Show this help text.

Prerequisite: mcp-memory-server must already be built
(`cd mcp-memory-server && npm install && npm run build`).
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SERVER_DIR="$ROOT_DIR/mcp-memory-server"
SERVER_ENTRY="$SERVER_DIR/dist/index.js"
HOOK_SRC="$ROOT_DIR/claude/hooks/context-explore-pretask.sh"
FIXTURES_DIR="$SERVER_DIR/scripts/fixtures"

FAILURES=0
TMP_PATHS=()

cleanup() {
  local p
  for p in "${TMP_PATHS[@]:-}"; do
    [[ -n "$p" ]] && rm -rf "$p"
  done
}
trap cleanup EXIT

mktmp() {
  local p
  p=$(mktemp -d)
  TMP_PATHS+=("$p")
  printf '%s' "$p"
}

# check(name, ok): ok is a shell "true"/"false" 0/1-style status string.
check() {
  local name="$1" status="$2"
  if [[ "$status" -eq 0 ]]; then
    echo "ok: $name"
  else
    echo "FAIL: $name" >&2
    FAILURES=$((FAILURES + 1))
  fi
}

require_build() {
  if [[ ! -f "$SERVER_ENTRY" ]]; then
    echo "FATAL: $SERVER_ENTRY not found -- build the server first:" >&2
    echo "  cd mcp-memory-server && npm install && npm run build" >&2
    exit 1
  fi
}

git_init_repo() {
  local repo="$1"
  git -C "$repo" init -q
  git -C "$repo" config user.email "verify@example.com"
  git -C "$repo" config user.name "verify"
  echo "one" > "$repo/a.txt"
  git -C "$repo" add a.txt
  git -C "$repo" commit -q -m init
}

# seed_memory_wiki(repoRoot, stem): seeds .agentfs/project.db (via a
# short-lived node subprocess, so the db is unlocked before any later
# consumer opens it) and a .planning/wiki/sources page mentioning $stem.
seed_memory_wiki() {
  local repo="$1" stem="$2"
  mkdir -p "$repo/.agentfs"
  node -e "
    const { AgentFS } = require('$SERVER_DIR/node_modules/agentfs-sdk');
    (async () => {
      const agent = await AgentFS.open({ id: 'project', path: '$repo/.agentfs/project.db' });
      await agent.kv.set('patterns/${stem}-handling', 'notes about ${stem} module behavior');
      await agent.close();
    })();
  " >/dev/null
  mkdir -p "$repo/.planning/wiki/sources"
  printf '# %s notes\n\n- **%s module behavior is documented here.**\n' "$stem" "$stem" \
    > "$repo/.planning/wiki/sources/${stem}-notes.md"
}

# --- Stage: CTX-08 cross-reference ---
stage_crossref() {
  echo "=== CTX-08: citation cross-referencing ==="
  local fixture="$FIXTURES_DIR/fake-tokenmiser-crossref.sh"
  chmod +x "$fixture"

  local seeded bare xdg out widget gadget st
  seeded=$(mktmp)
  git_init_repo "$seeded"
  seed_memory_wiki "$seeded" "widget"
  xdg=$(mktmp)

  # The CLI takes the query as argv[3]; repo_root is resolved from
  # CAIRN_EXPLORE_REPO_ROOT (no --repo-root flag on the CLI subcommand).
  out=$(XDG_CACHE_HOME="$xdg" CAIRN_EXPLORE_BINARY="$fixture" CAIRN_EXPLORE_CACHE=0 \
    CAIRN_EXPLORE_REPO_ROOT="$seeded" node "$SERVER_ENTRY" explore "anything" 2>/dev/null || true)

  [[ "$(echo "$out" | jq -r '.ok // false')" == "true" ]]; check "seeded run is ok:true" $?
  widget=$(echo "$out" | jq -c '.citations[] | select(.path == "src/widget.rs")')
  gadget=$(echo "$out" | jq -c '.citations[] | select(.path == "src/gadget.rs")')

  [[ "$(echo "$widget" | jq -r '(.memory_refs // []) | length')" -gt 0 ]]; check "matching citation (src/widget.rs) has non-empty memory_refs" $?
  [[ "$(echo "$widget" | jq -r '(.wiki_refs // []) | length')" -gt 0 ]]; check "matching citation (src/widget.rs) has non-empty wiki_refs" $?
  [[ "$(echo "$gadget" | jq -r 'has("memory_refs")')" == "false" ]]; check "non-matching citation (src/gadget.rs) has no memory_refs" $?
  [[ "$(echo "$gadget" | jq -r 'has("wiki_refs")')" == "false" ]]; check "non-matching citation (src/gadget.rs) has no wiki_refs" $?

  bare=$(mktmp)
  git_init_repo "$bare"
  out=$(XDG_CACHE_HOME="$xdg" CAIRN_EXPLORE_BINARY="$fixture" CAIRN_EXPLORE_CACHE=0 \
    CAIRN_EXPLORE_REPO_ROOT="$bare" node "$SERVER_ENTRY" explore "anything" 2>/dev/null || true)
  [[ "$(echo "$out" | jq -r '.ok // false')" == "true" ]]; check "bare (no-seed) run is ok:true" $?
  [[ "$(echo "$out" | jq -r '[.citations[] | (has("memory_refs") or has("wiki_refs"))] | any')" == "false" ]]
  check "bare run: no citation has memory_refs/wiki_refs (fail-open, byte-identical output)" $?
}

# --- Stage: CTX-10 cache ---
stage_cache() {
  echo "=== CTX-10: result cache ==="
  local fixture="$FIXTURES_DIR/fake-tokenmiser-logging.sh"
  chmod +x "$fixture"

  local repo xdg hitlog
  repo=$(mktmp)
  git_init_repo "$repo"
  xdg=$(mktmp)
  hitlog="$(mktmp)/hits.log"

  run_explore() {
    XDG_CACHE_HOME="$xdg" CAIRN_EXPLORE_BINARY="$fixture" CAIRN_EXPLORE_REPO_ROOT="$repo" \
      EXPLORE_HIT_LOG="$hitlog" node "$SERVER_ENTRY" explore "find the foo function" 2>/dev/null
  }
  invocation_count() {
    [[ -f "$hitlog" ]] && grep -c . "$hitlog" || echo 0
  }

  local first second third
  first=$(run_explore)
  [[ "$(echo "$first" | jq -r '.ok // false')" == "true" ]]; check "first call is ok:true" $?
  [[ "$(echo "$first" | jq -r '.cached')" == "false" ]]; check "first call is cached:false (cache miss)" $?
  [[ "$(invocation_count)" -eq 1 ]]; check "first call spawned the binary exactly once" $?

  second=$(run_explore)
  [[ "$(echo "$second" | jq -r '.cached')" == "true" ]]; check "second identical call is cached:true" $?
  [[ "$(invocation_count)" -eq 1 ]]; check "second identical call did NOT re-spawn the binary" $?

  echo "two" > "$repo/a.txt"
  third=$(run_explore)
  [[ "$(echo "$third" | jq -r '.cached')" == "false" ]]; check "call after a tracked-file edit is cached:false" $?
  [[ "$(invocation_count)" -eq 2 ]]; check "call after a tracked-file edit re-spawns the binary" $?

  echo "one" > "$repo/a.txt"
  echo "new" > "$repo/untracked.txt"
  local untracked_call
  untracked_call=$(run_explore)
  [[ "$(echo "$untracked_call" | jq -r '.cached')" == "false" ]]; check "call after a new untracked file is cached:false" $?
  [[ "$(invocation_count)" -eq 3 ]]; check "call after a new untracked file re-spawns the binary" $?
}

# --- Stage: CTX-09 pre-task hook ---
stage_hook() {
  echo "=== CTX-09: pre-task auto-invoke hook ==="
  local fixture="$FIXTURES_DIR/fake-tokenmiser-crossref.sh"
  chmod +x "$fixture"

  local rendered repo xdg
  rendered=$(mktmp)/hook.sh
  mkdir -p "$(dirname "$rendered")"
  sed "s|@@INFRA_ROOT@@|$ROOT_DIR|g" "$HOOK_SRC" > "$rendered"
  chmod +x "$rendered"

  repo=$(mktmp)
  git_init_repo "$repo"
  xdg=$(mktmp)

  local prompt='where is the widget module implemented in this repo'
  local stdin_json
  stdin_json=$(jq -n --arg prompt "$prompt" '{prompt: $prompt}')

  local gated_on
  gated_on=$(CAIRN_EXPLORE_BINARY="$fixture" CAIRN_EXPLORE_AUTOINVOKE=1 CAIRN_EXPLORE_CACHE=0 \
    CAIRN_EXPLORE_REPO_ROOT="$repo" XDG_CACHE_HOME="$xdg" \
    bash -c "printf '%s' '$stdin_json' | bash '$rendered'")
  [[ -n "$gated_on" ]] && echo "$gated_on" | jq -e '.hookSpecificOutput.additionalContext | length > 0' >/dev/null 2>&1
  check "gated-on high-signal prompt injects hookSpecificOutput.additionalContext" $?

  local gated_off
  gated_off=$(CAIRN_EXPLORE_BINARY="$fixture" CAIRN_EXPLORE_CACHE=0 \
    CAIRN_EXPLORE_REPO_ROOT="$repo" XDG_CACHE_HOME="$xdg" \
    bash -c "printf '%s' '$stdin_json' | bash '$rendered'")
  [[ -z "$gated_off" ]]; check "gated-off (CAIRN_EXPLORE_AUTOINVOKE unset) stays silent" $?

  local low_signal_json low_signal_out
  low_signal_json=$(jq -n '{prompt: "ok"}')
  low_signal_out=$(CAIRN_EXPLORE_BINARY="$fixture" CAIRN_EXPLORE_AUTOINVOKE=1 CAIRN_EXPLORE_CACHE=0 \
    CAIRN_EXPLORE_REPO_ROOT="$repo" XDG_CACHE_HOME="$xdg" \
    bash -c "printf '%s' '$low_signal_json' | bash '$rendered'")
  [[ -z "$low_signal_out" ]]; check "low-signal prompt (bare ack) stays silent even when gated on" $?
}

main() {
  local stage=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --crossref|--cache|--hook)
        stage="$1"
        shift
        ;;
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

  require_build

  case "$stage" in
    --crossref) stage_crossref ;;
    --cache) stage_cache ;;
    --hook) stage_hook ;;
    "")
      stage_crossref
      stage_cache
      stage_hook
      ;;
  esac

  if [[ "$FAILURES" -ne 0 ]]; then
    echo "" >&2
    echo "FATAL: $FAILURES check(s) failed" >&2
    exit 1
  fi
  echo ""
  echo "All Phase 12 context_explore maturation checks passed (CTX-08/09/10)."
}

main "$@"
