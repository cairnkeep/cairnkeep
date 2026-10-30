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
guide=docs/memory-continuity-workflow.md
[[ -f "$guide" ]] || { echo 'INTEGRATED_DOCS_RED: missing source-only continuity workflow guide' >&2; exit 1; }
for phrase in 'unreleased' 'source-only' 'node bin/cairn' 'freshness,links,maps,feedback' \
  'no ranking gain' 'not a storage-efficiency comparison' 'same-secret' 'not per-user ACLs' \
  '3.51.3' '3.50.7' '3.44.6' '30 operator plan/apply calls' 'seven tool calls'; do
  grep -qF -- "$phrase" "$guide" || { echo "integrated guide missing boundary: $phrase" >&2; exit 1; }
done
for path in docs/README.md docs/operating.md docs/storage.md docs/privacy-and-data-flow.md docs/harness-compatibility.md docs/memory-retrieval.md docs/memory-feedback.md docs/memory-maps.md; do
  grep -qF 'memory-continuity-workflow.md' "$path"
done
grep -qF 'Historical SDK feasibility gate' docs/benchmarks/memory-continuity-v2.md
grep -qF 'integrated_workflow' mcp-memory-server/scripts/run-memory-feedback-study.mjs
grep -qF 'memory-integrated-replay.mjs' mcp-memory-server/scripts/run-memory-connections-study.mjs
for fixture in memory-feedback-policy-v1.json memory-integrated-workflows-v1.json; do
  grep -qxF "mcp-memory-server/scripts/fixtures/$fixture text eol=lf" .gitattributes || {
    echo "INTEGRATED_PORTABILITY_RED: frozen digest input lacks canonical LF checkout: $fixture" >&2; exit 1;
  }
done
echo 'PASS: hybrid retrieval, Markdown parity, provider limitations and learning/recording references'
