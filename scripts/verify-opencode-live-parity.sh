#!/usr/bin/env bash
set -euo pipefail

# Live OpenCode parity verification harness (OCP-06).
#
# Extends the Phase-4 OCP-05 scratch-HOME acceptance pattern (04-06-SUMMARY.md)
# to register `cairn-memory` as a real local MCP server inside a fresh scratch
# OpenCode environment and confirm the registration loads before any stage
# assertion is trusted. Stage functions (wakeup/recall/capture/remember/recall,
# negative controls) are added in 05-02; this script only builds setup,
# registration, the positive-load check, and cleanup.
#
# Every value here is either read from the operator's own environment
# (CAIRN_LLM_API_KEY / CAIRN_LLM_API_URL / CAIRN_LLM_EXTRACTION_MODEL) or
# generated at runtime (canary tokens, scratch dirs via mktemp -d). No
# endpoint host, model name, or canary literal is hardcoded here
# (DEC-no-private-references).

usage() {
  cat <<'EOF'
Usage: verify-opencode-live-parity.sh --setup-only [seeded|unseeded]

Stands up a fresh scratch OpenCode HOME, registers cairn-memory as a local
stdio MCP server pointing at the real mcp-memory-server/dist/index.js,
installs the OpenCode plugin/command assets, and runs a positive-load check
confirming cairn-memory_ tools are visible in the scratch environment.

Options:
  --setup-only [seeded|unseeded]
      Run setup_scratch, seed_canary, install_assets, write_scratch_config,
      and positive_load_check end to end, then clean up. Mode defaults to
      "seeded"; pass "unseeded" for a negative-control scratch project
      (no canary written).
  -h, --help
      Show this help text.

Every run always cleans up scratch dirs and confirms the operator's real
~/.config/opencode and ~/.claude are unmodified, regardless of exit path.
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SERVER_ENTRY="$ROOT_DIR/mcp-memory-server/dist/index.js"
AGENTFS_SDK_ENTRY="$ROOT_DIR/mcp-memory-server/node_modules/agentfs-sdk/dist/index_node.js"

# Captured before any HOME reassignment so cleanup() always compares against
# the operator's real config, never a scratch path (T-05-02 mitigation).
ORIG_HOME="$HOME"
REAL_OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$ORIG_HOME/.config/opencode}"
REAL_CLAUDE_DIR="$ORIG_HOME/.claude"

SCRATCH_HOME=""
SCRATCH_PROJECT=""
CANARY_KEY=""
CANARY_VALUE=""
CLEANED_UP=0
PRE_OPENCODE_FINGERPRINT=""
PRE_CLAUDE_FINGERPRINT=""

fingerprint_dir() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    find "$dir" -type f -printf '%p %s %T@\n' 2>/dev/null | sort
  else
    echo "MISSING:$dir"
  fi
}

capture_real_config_fingerprint() {
  PRE_OPENCODE_FINGERPRINT=$(fingerprint_dir "$REAL_OPENCODE_CONFIG_DIR")
  PRE_CLAUDE_FINGERPRINT=$(fingerprint_dir "$REAL_CLAUDE_DIR")
}

cleanup() {
  if [[ "$CLEANED_UP" -eq 1 ]]; then
    return 0
  fi
  CLEANED_UP=1

  if [[ -n "$SCRATCH_HOME" && -d "$SCRATCH_HOME" ]]; then
    rm -rf "$SCRATCH_HOME"
  fi
  if [[ -n "$SCRATCH_PROJECT" && -d "$SCRATCH_PROJECT" ]]; then
    rm -rf "$SCRATCH_PROJECT"
  fi

  export HOME="$ORIG_HOME"
  unset OPENCODE_CONFIG_DIR || true

  local post_opencode post_claude tamper
  post_opencode=$(fingerprint_dir "$REAL_OPENCODE_CONFIG_DIR")
  post_claude=$(fingerprint_dir "$REAL_CLAUDE_DIR")
  tamper=0

  if [[ "$post_opencode" != "$PRE_OPENCODE_FINGERPRINT" ]]; then
    echo "FATAL: real OpenCode config changed during the run ($REAL_OPENCODE_CONFIG_DIR)" >&2
    tamper=1
  fi
  if [[ "$post_claude" != "$PRE_CLAUDE_FINGERPRINT" ]]; then
    echo "FATAL: real ~/.claude changed during the run ($REAL_CLAUDE_DIR)" >&2
    tamper=1
  fi

  if [[ "$tamper" -eq 0 ]]; then
    echo "[cleanup] real OpenCode config and ~/.claude confirmed untouched; scratch dirs removed"
  fi
}

# setup_scratch(): fresh scratch HOME + project, CAIRN_LLM_* env exported into
# this shell (reaches memory-capture.ts's/memory-wakeup.ts's direct `node
# <server>` shell-out, not only mcp.cairn-memory.environment — Pitfall 3),
# OPENCODE_CONFIG_DIR set to exactly $SCRATCH_HOME/.config/opencode (the
# default resolution path — never a custom path, avoiding the open #4399 bug).
setup_scratch() {
  SCRATCH_HOME=$(mktemp -d)
  SCRATCH_PROJECT=$(mktemp -d)

  export HOME="$SCRATCH_HOME"
  export OPENCODE_CONFIG_DIR="$SCRATCH_HOME/.config/opencode"

  export CAIRN_LLM_API_KEY="${CAIRN_LLM_API_KEY:-}"
  export CAIRN_LLM_API_URL="${CAIRN_LLM_API_URL:-}"
  export CAIRN_LLM_EXTRACTION_MODEL="${CAIRN_LLM_EXTRACTION_MODEL:-}"

  echo "[setup_scratch] SCRATCH_HOME=$SCRATCH_HOME"
  echo "[setup_scratch] SCRATCH_PROJECT=$SCRATCH_PROJECT"
  echo "[setup_scratch] OPENCODE_CONFIG_DIR=$OPENCODE_CONFIG_DIR"
  echo "[setup_scratch] CAIRN_LLM_API_KEY set: $([[ -n "$CAIRN_LLM_API_KEY" ]] && echo yes || echo no)"
  echo "[setup_scratch] CAIRN_LLM_API_URL set: $([[ -n "$CAIRN_LLM_API_URL" ]] && echo yes || echo no)"
  echo "[setup_scratch] CAIRN_LLM_EXTRACTION_MODEL set: $([[ -n "$CAIRN_LLM_EXTRACTION_MODEL" ]] && echo yes || echo no)"

  trap cleanup EXIT
}

# seed_canary(mode): mode="seeded" (default) writes a fresh, runtime-generated
# canary into the scratch project's AgentFS project scope
# ($SCRATCH_PROJECT/.agentfs/project.db, mirroring resolveScopePath("project")
# in mcp-memory-server/src/index.ts). mode="unseeded" leaves the project
# scope empty for a negative control (05-02).
seed_canary() {
  local mode="${1:-seeded}"
  local db_dir="$SCRATCH_PROJECT/.agentfs"
  local db_path="$db_dir/project.db"

  mkdir -p "$db_dir"

  if [[ "$mode" == "unseeded" ]]; then
    echo "[seed_canary] mode=unseeded — no canary written (negative-control project)"
    return 0
  fi

  CANARY_KEY="ocp-06-canary-fact"
  CANARY_VALUE="OCP-06-CANARY-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"

  SEED_DB_PATH="$db_path" \
  SEED_KEY="$CANARY_KEY" \
  SEED_VALUE="$CANARY_VALUE" \
  AGENTFS_SDK_ENTRY="$AGENTFS_SDK_ENTRY" \
    node --input-type=module -e '
import { pathToFileURL } from "node:url";
const mod = await import(pathToFileURL(process.env.AGENTFS_SDK_ENTRY).href);
const { AgentFS } = mod;
const agent = await AgentFS.open({ id: "project", path: process.env.SEED_DB_PATH });
try {
  await agent.kv.set(process.env.SEED_KEY, process.env.SEED_VALUE);
} finally {
  await agent.close();
}
'

  echo "[seed_canary] mode=seeded key=$CANARY_KEY value=$CANARY_VALUE db=$db_path"
}

# install_assets(): installs the OpenCode plugin + command assets into the
# scratch config tree via the existing idempotent sync scripts, rendering
# @@INFRA_ROOT@@ to this real repo checkout. No Claude assets are installed
# anywhere in this flow, proving the fresh-OpenCode-only install bar.
install_assets() {
  "$ROOT_DIR/scripts/sync-opencode-plugin-assets.sh" --apply --live-root "$OPENCODE_CONFIG_DIR"
  "$ROOT_DIR/scripts/sync-opencode-memory-assets.sh" --apply --live-root "$OPENCODE_CONFIG_DIR"
}

# write_scratch_config(): writes the scratch opencode.json registering
# cairn-memory as a local stdio MCP server (absolute real repo path — a
# relative path breaks once OpenCode's cwd differs from the repo root),
# a provider/model block interpolated from the exported CAIRN_LLM_* vars
# (no hardcoded host), and a permissive permission block so headless runs
# never hang on approval prompts (Pitfall 4). The config path is built
# explicitly from $SCRATCH_HOME, never from $HOME after reassignment
# (T-05-02 tampering mitigation).
write_scratch_config() {
  local config_dir="$SCRATCH_HOME/.config/opencode"
  local config_path="$config_dir/opencode.json"
  local api_key="${CAIRN_LLM_API_KEY:-}"
  local api_url="${CAIRN_LLM_API_URL:-}"
  local model_name="${CAIRN_LLM_EXTRACTION_MODEL:-}"

  mkdir -p "$config_dir"

  cat > "$config_path" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "mcp": {
    "cairn-memory": {
      "type": "local",
      "command": ["node", "$SERVER_ENTRY"],
      "enabled": true
    }
  },
  "provider": {
    "verify-local": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Verify Local",
      "options": { "apiKey": "$api_key", "baseURL": "$api_url" },
      "models": { "$model_name": { "name": "$model_name" } }
    }
  },
  "model": "verify-local/$model_name",
  "permission": {
    "exec": { "*": "allow" },
    "external_directory": { "**": "allow" },
    "read": { "**": "allow" },
    "write": { "**": "allow" }
  }
}
EOF

  echo "[write_scratch_config] wrote $config_path"
}

# positive_load_check(): a fast confirmation that the MCP registration loaded
# and no real-config tools leaked in — Pitfall 2's cheap pre-flight. Bounded
# by `timeout` so an unreachable model endpoint fails loudly instead of
# hanging the harness indefinitely.
#
# Note: the installed CLI (confirmed live: `opencode run --help`) has no
# `--auto` flag as 05-RESEARCH.md's docs-derived assumption expected; the
# real flag for "auto-approve permissions not explicitly denied" is
# --dangerously-skip-permissions. A fresh scratch opencode.json also carries
# a permissive `permission` block (write_scratch_config), so this flag is
# belt-and-suspenders against Pitfall 4, not the sole guard.
positive_load_check() {
  echo "[positive_load_check] running opencode run to list tools..."
  local out
  out=$(cd "$SCRATCH_PROJECT" && timeout 90 opencode run "list your available tools" --dir "$SCRATCH_PROJECT" --format json --dangerously-skip-permissions 2>&1) || true

  if echo "$out" | grep -q 'cairn-memory_'; then
    echo "[positive_load_check] OK: cairn-memory_ tools found in scratch env"
    return 0
  fi

  echo "[positive_load_check] FAIL: no cairn-memory_ tool names found in opencode run output" >&2
  echo "$out" | tail -n 40 >&2
  return 1
}

main() {
  case "${1:-}" in
    --setup-only)
      capture_real_config_fingerprint
      setup_scratch
      seed_canary "${2:-seeded}"
      install_assets
      write_scratch_config
      positive_load_check
      ;;
    -h|--help)
      usage
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
}

main "$@"
