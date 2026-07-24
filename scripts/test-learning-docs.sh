#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

version=$(node -p "require('./package.json').version")
landing=docs/learning/README.md
production=docs/learning/PRODUCTION-PLAN.md

[[ -f "$landing" && -f "$production" ]]
grep -qF 'docs/learning/README.md' README.md

ready=0
brief=0
for number in $(seq -w 0 12); do
  matches=(docs/learning/lessons/L"$number"-*.md)
  [[ ${#matches[@]} -eq 1 && -f ${matches[0]} ]] || {
    echo "learning path must contain exactly one L$number lesson" >&2
    exit 1
  }
  lesson=${matches[0]}
  grep -q '^## Outcome$' "$lesson"
  if grep -q '^\*\*Status:\*\* Ready' "$lesson"; then
    ready=$((ready + 1))
    grep -qF "Tested with:** Cairnkeep $version" "$lesson"
    script=$(sed -n 's|.*(\.\./video-scripts/\([^)]*\)).*|docs/learning/video-scripts/\1|p' "$lesson")
    [[ -n "$script" && -f "$script" ]] || {
      echo "ready lesson has no presenter script: $lesson" >&2
      exit 1
    }
    grep -q '^## Common failures$' "$lesson"
    grep -q '^## Privacy and trust boundary$' "$lesson"
  elif grep -q '^\*\*Status:\*\* Brief' "$lesson"; then
    brief=$((brief + 1))
    grep -q '^## Acceptance criteria$' "$lesson"
    grep -q '^## Planned video$' "$lesson"
  else
    echo "lesson has an unsupported status: $lesson" >&2
    exit 1
  fi
done

[[ $ready -eq 4 && $brief -eq 9 ]] || {
  echo "unexpected learning status totals: ready=$ready brief=$brief" >&2
  exit 1
}

for track in quickstart practitioner operator; do
  file=docs/learning/tracks/$track.md
  [[ -f "$file" ]]
  grep -q '^# ' "$file"
done

node <<'NODE'
const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

function markdownFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = `${root}/${entry.name}`;
    return entry.isDirectory() ? markdownFiles(path) : path.endsWith(".md") ? [path] : [];
  });
}

for (const file of markdownFiles("docs/learning")) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split("#", 1)[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    if (!existsSync(resolve(dirname(file), target))) {
      throw new Error(`broken learning link in ${file}: ${match[1]}`);
    }
  }
}
NODE

echo "PASS: learning path structure, readiness, scripts, and version alignment"
