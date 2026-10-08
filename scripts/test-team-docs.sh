#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
lesson=docs/learning/lessons/L29-team-continuity.md
video=docs/learning/video-scripts/V29-team-continuity.md
for doc in docs/team.md "$lesson" "$video"; do
  [[ -f "$doc" ]]
  grep -qi 'preview' "$doc"
  grep -qi 'independent.*review' "$doc"
  grep -qi 'pilot' "$doc"
done
grep -q '^\*\*Status:\*\* Brief' "$lesson"
grep -q '^## Acceptance criteria$' "$lesson"
grep -q '^## Privacy and trust boundary$' "$lesson"
grep -qF 'L29-team-continuity.md' docs/learning/README.md
grep -qF 'L29-team-continuity.md' docs/learning/tracks/operator.md
grep -qF '`cairn team`' docs/learning/CURRICULUM-MAP.md
for command in init project member credential serve mcp proposals proposal-show propose review search read audit doctor backup restore memory-delete; do
  node mcp-memory-server/dist/team-cli.js --help | grep -q "cairn team $command"
done
node mcp-memory-server/dist/team-cli.js --help | grep -qF 'member remove SUBJECT --project ID'
for doc in docs/team.md "$lesson" "$video"; do
  grep -qF 'cairn team member remove' "$doc"
done
for guide in operating storage privacy-and-data-flow security-assurance harness-compatibility agents; do
  grep -qF 'team.md' "docs/$guide.md"
done
for control in team team-review team-http team-mcp team-restore team-cli; do
  grep -qF "smoke-$control.mjs" "$lesson"
  [[ -f "mcp-memory-server/scripts/smoke-$control.mjs" ]]
done
echo 'PASS: team preview reference, source controls, admission boundary, learning and video routing'
