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
  if ! grep -qF '2.25.0' "$doc"; then
    echo "Missing team preview release compatibility: $doc" >&2
    exit 1
  fi
  if grep -qiE 'unreleased|feature-branch preview|released Cairnkeep CLI does not include' "$doc"; then
    echo 'Released team preview guidance must not claim the feature is absent' >&2
    exit 1
  fi
done
[[ -f docs/team-pilot.md ]]
[[ -f docs/team-onboarding.md ]]
for doc in docs/team.md docs/team-pilot.md "$lesson" "$video"; do
  grep -qF 'team-onboarding.md' "$doc"
done
for heading in 'Choose the right workflow' 'Operator handoff' 'Reader quick-check' 'Contributor and reviewer' 'Deployment readiness'; do
  grep -qF "$heading" docs/team-onboarding.md
done
grep -qF 'not production admission' docs/team-onboarding.md
grep -qF 'no real-data deployment is authorized' docs/team-onboarding.md
grep -qF 'team-pilot.md' docs/team.md
grep -qF 'team-pilot.md' "$lesson"
grep -qF 'team-pilot.md' "$video"
grep -qF 'not production admission' docs/team-pilot.md
grep -qF 'reviewer.token' docs/team-pilot.md
if grep -qF 'released 2.22.5 baseline' docs/README.md || grep -qF 'Cairnkeep 2.22.5 baseline' "$lesson"; then
  echo 'Team guidance must not pin an obsolete released baseline' >&2
  exit 1
fi
grep -q '^\*\*Status:\*\* Brief' "$lesson"
grep -q '^## Acceptance criteria$' "$lesson"
grep -q '^## Privacy and trust boundary$' "$lesson"
grep -qF 'L29-team-continuity.md' docs/learning/README.md
grep -qF 'L29-team-continuity.md' docs/learning/tracks/operator.md
grep -qF '`cairn team`' docs/learning/CURRICULUM-MAP.md
for command in connect disconnect init project member credential serve mcp proposals proposal-show propose review search read audit doctor backup restore memory-delete; do
  node mcp-memory-server/dist/team-cli.js --help | grep -q "cairn team $command"
done
node mcp-memory-server/dist/team-cli.js --help | grep -qF 'member remove SUBJECT --project ID'
for doc in docs/team.md "$lesson" "$video"; do
  grep -qF 'cairn team member remove' "$doc"
done
for guide in operating storage privacy-and-data-flow security-assurance harness-compatibility agents; do
  grep -qF 'team.md' "docs/$guide.md"
done
for control in team team-review team-http team-mcp team-restore team-cli team-onboarding; do
  grep -qF "smoke-$control.mjs" "$lesson"
  [[ -f "mcp-memory-server/scripts/smoke-$control.mjs" ]]
done
node scripts/test-team-pilot.mjs
echo 'PASS: team preview reference, source controls, admission boundary, learning and video routing'
