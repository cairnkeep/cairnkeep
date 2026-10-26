#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
node "$ROOT/scripts/verify-security-baseline.mjs"
node "$ROOT/scripts/test-codeql-cohort.mjs"
node "$ROOT/scripts/test-release-cache.mjs"
node "$ROOT/scripts/test-smoke-timings.mjs"
