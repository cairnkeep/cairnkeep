#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
for path in docs/memory-retrieval.md docs/benchmarks/memory-retrieval-v1.json docs/learning/video-scripts/V04-memory-retrieval-supplement.md; do
  [[ -f "$path" ]]
done
for path in docs/README.md docs/operating.md docs/storage.md docs/agents.md docs/learning/lessons/L04-memory-fundamentals.md; do
  grep -qF 'memory-retrieval.md' "$path"
done
for path in claude/commands/recall.md opencode/command/recall.md; do
  grep -qF 'do not automatically widen' "$path"
  grep -qF 'strategy: "hybrid"' "$path"
done
grep -qF 'same admission' docs/memory-retrieval.md
grep -qF 'HTTP 502' docs/memory-retrieval.md
grep -qF 'ranking-not-confidence' docs/memory-retrieval.md
echo 'PASS: hybrid retrieval, Markdown parity, provider limitations and learning/recording references'
