#!/usr/bin/env bash
set -euo pipefail

# Routing seam real-binary proof (RT-01/RT-02, Phase 10 D-06 verify-by-
# execution — this repo's bar, above docs-only per D-10).
#
# Starts the REAL (non-mocked) token_miser binary in the background and polls
# its GET /health endpoint until it answers, then asserts the response body
# contains "status":"ok". This proves the routing seam's TARGET is a real,
# live binary that the route_check MCP tool (Phase 10 Plan 01) can reach.
#
# It does NOT prove a tier decision: /health never calls Router::classify,
# so a 200 here is liveness proof, not evidence that routing itself worked
# (RESEARCH.md Pitfall 4). The optional --full mode attempts one real
# /v1/chat/completions round-trip as a stretch goal — it needs a live tier
# backend absent on this machine, so it is never the required minimum
# (D-06/D-07 defer live routing) and must itself fail loud with a message
# (never a silent skip) when no backend is reachable.
#
# Mirrors scripts/verify-fastcontext-reliability.sh and
# scripts/verify-token-savings-ab.sh's staged, env-driven, loopback-safe,
# fail-loud-never-silent harness discipline. Every host-specific value
# (the binary path) comes from the ambient shell at runtime and is never
# hardcoded or echoed beyond a presence indicator (DEC-no-private-references).
#
# Pitfall 1 (RESEARCH.md): never probe token_miser with --help/--version —
# the binary's only CLI dispatch is the `explore` subcommand; every other
# invocation (no args, --help, garbage) falls through to starting the full
# Axum proxy server on 0.0.0.0:8080 and blocks forever. This script starts
# the binary for real (background + trap kill) instead of probing it.

usage() {
  cat <<'EOF'
Usage: verify-routing-seam.sh
       verify-routing-seam.sh --full
       verify-routing-seam.sh -h|--help

Starts the real token_miser binary and proves it answers GET /health with
"status":"ok" (D-06 verify-by-execution). This is the required, default
mode: health-only, no chat traffic.

Options:
  (default)
      Health-only: start the real binary, poll GET /health with a bounded
      retry loop (never a fixed sleep — startup includes gh/claude
      model-discovery probes), assert "status":"ok", kill the process on
      exit. Proves the seam's target is real and reachable — not a tier
      decision (Pitfall 4).
  --full
      Health-only proof, plus an optional stretch: one real POST to
      /v1/chat/completions. Skips with an explicit message (does not fail
      the health-only proof) when no live tier backend is reachable — this
      is never the required minimum (D-06/D-07).
  -h, --help
      Show this help text.

Environment:
  CAIRN_ROUTE_BINARY   Absolute path to the token_miser binary. Defaults to
                        $HOME/PARA/Projects/token-miser/target/release/token_miser.
                        Never echoed — only a presence indicator is logged.
EOF
}

CAIRN_ROUTE_BINARY="${CAIRN_ROUTE_BINARY:-$HOME/PARA/Projects/token-miser/target/release/token_miser}"
HEALTH_URL="http://127.0.0.1:8080/health"

# Script-global (not `local` to run_health_proof): the EXIT trap fires after
# the function returns, so it must read pid from a scope that outlives it —
# a `local pid` here would be unbound under `set -u` by the time trap runs.
ROUTE_PID=""

# log_binary_presence(): logs only whether CAIRN_ROUTE_BINARY was overridden
# from the default — never the resolved path value (mirrors
# log_endpoint_presence() in verify-fastcontext-reliability.sh, T-10-06).
log_binary_presence() {
  local default="$HOME/PARA/Projects/token-miser/target/release/token_miser"
  local overridden="no"
  [[ "$CAIRN_ROUTE_BINARY" != "$default" ]] && overridden="yes"
  echo "[env] CAIRN_ROUTE_BINARY overridden from default: $overridden" >&2
}

# run_health_proof(): starts the real binary in the background, polls
# GET /health, asserts "status":"ok", and guarantees teardown via trap.
# Exits nonzero (fails loud) if the binary is absent — never a silent pass.
run_health_proof() {
  if [[ ! -x "$CAIRN_ROUTE_BINARY" ]]; then
    echo "FATAL: token_miser binary not found or not executable at the resolved CAIRN_ROUTE_BINARY path — real proof cannot run (D-06). Set CAIRN_ROUTE_BINARY or build the binary." >&2
    return 1
  fi

  "$CAIRN_ROUTE_BINARY" &
  ROUTE_PID=$!
  trap 'kill "$ROUTE_PID" 2>/dev/null || true' EXIT

  local attempt
  local reached="no"
  for attempt in $(seq 1 20); do
    if curl -sf -m 2 "$HEALTH_URL" >/dev/null 2>&1; then
      reached="yes"
      break
    fi
    sleep 0.5
  done

  if [[ "$reached" != "yes" ]]; then
    echo "FATAL: token_miser started (pid=$ROUTE_PID) but /health never became reachable within the poll budget" >&2
    return 1
  fi

  local body
  body=$(curl -sf -m 2 "$HEALTH_URL")
  if ! grep -q '"status":"ok"' <<<"$body"; then
    echo "FATAL: /health responded but body did not contain \"status\":\"ok\" (got: $body)" >&2
    return 1
  fi

  echo "[health] OK: real token_miser binary answered GET /health with status ok (D-06 liveness proof; not a tier decision — Pitfall 4)"
}

# run_full_stretch(): optional --full addendum. Attempts one real POST to
# /v1/chat/completions against the already-running proxy from
# run_health_proof(). Skips with an explicit message (exit 0, not a
# failure of the required health-only proof) when no tier backend answers.
run_full_stretch() {
  echo "[full] attempting optional /v1/chat/completions round-trip (stretch, D-06/D-07 defer live routing)..." >&2

  local response
  if ! response=$(curl -sf -m 5 -X POST "http://127.0.0.1:8080/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -d '{"messages":[{"role":"user","content":"ping"}]}' 2>&1); then
    echo "[full] SKIPPED: no live tier backend reachable for a real chat round-trip — this is an optional stretch, not the required minimum (D-06/D-07)." >&2
    return 0
  fi

  echo "[full] OK: received a response from /v1/chat/completions (not further validated — the health-only proof above is the required minimum): $response"
}

main() {
  local full=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --full)
        full=1
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

  log_binary_presence

  if ! run_health_proof; then
    exit 1
  fi

  if [[ "$full" -eq 1 ]]; then
    run_full_stretch
  fi
}

main "$@"
