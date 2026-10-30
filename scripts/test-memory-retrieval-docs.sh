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
grep -qF 'Status: available since Cairnkeep 2.23.0' docs/memory-retrieval.md
for path in docs/memory-feedback.md docs/operating.md; do
  grep -qF 'CAIRN_MEMORY_FEEDBACK_RANKING' "$path"
done
grep -qF 'no ranking gain' docs/memory-feedback.md
grep -qF 'feedback-adjacent-v1' docs/memory-feedback.md
grep -qF 'independently implemented equal-information Markdown' docs/memory-feedback.md
for path in docs/learning/FEATURE-GUIDE.md docs/learning/lessons/L04-memory-fundamentals.md docs/learning/lessons/L26-context-intelligence.md docs/learning/tracks/practitioner.md docs/learning/video-scripts/V04-memory-retrieval-supplement.md; do
  grep -qiE 'no[ -](held-out[ -])?(improvement|gain)|unchanged held-out' "$path"
done
echo 'PASS: hybrid retrieval, Markdown parity, provider limitations and learning/recording references'
