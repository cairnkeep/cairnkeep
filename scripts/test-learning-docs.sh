#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

version=$(node -p "require('./package.json').version")
landing=docs/learning/README.md
coverage=docs/learning/CURRICULUM-MAP.md
feature_guide=docs/learning/FEATURE-GUIDE.md

[[ -f "$landing" && -f "$coverage" && -f "$feature_guide" ]]
grep -qF 'docs/learning/README.md' README.md
grep -qF "**Baseline:** Cairnkeep $version" "$coverage"
grep -qF "**Baseline:** Cairnkeep $version" "$feature_guide"
grep -qF 'https://github.com/cairnkeep/cairnkeep-course-labs' "$landing"
for checkpoint in course-00-app course-01-bootstrap course-02-memory course-03-quality \
  course-04-operation course-05-evidence course-06-governance course-07-evaluation \
  course-08-graph course-09-skill course-10-trust-context course-11-windows; do
  grep -qF "\`$checkpoint\`" "$coverage"
done

ready=0
brief=0
for number in $(seq -w 0 25); do
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
    grep -q '^## Common failures$' "$lesson"
    grep -q '^## Privacy and trust boundary$' "$lesson"
  elif grep -q '^\*\*Status:\*\* Brief' "$lesson"; then
    brief=$((brief + 1))
    grep -q '^## Acceptance criteria$' "$lesson"
  else
    echo "lesson has an unsupported status: $lesson" >&2
    exit 1
  fi
done

graph_lesson=docs/learning/lessons/L18-local-code-graph.md
for mode in build query status diff explain path; do
  grep -qF "cairn graph $mode" "$graph_lesson"
done
grep -qF 'Do not run `graphify install`' "$graph_lesson"
grep -qF '`cairn sync-kimi --apply`' "$graph_lesson"
grep -qF '`cairn sync-pi --apply`' "$graph_lesson"
grep -qF '`graphify-out/`' "$graph_lesson"

[[ $ready -eq 11 && $brief -eq 15 ]] || {
  echo "unexpected learning status totals: ready=$ready brief=$brief" >&2
  exit 1
}

for track in quickstart practitioner evidence-and-evaluation operator; do
  file=docs/learning/tracks/$track.md
  [[ -f "$file" ]]
  grep -q '^# ' "$file"
done

while read -r command; do
  grep -qF "\`cairn $command\`" "$coverage" || {
    echo "top-level command has no curriculum owner: cairn $command" >&2
    exit 1
  }
done < <(bin/cairn help | sed -n 's/^  cairn \([a-z-]*\).*/\1/p' | sort -u)

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

l23=docs/learning/lessons/L23-guided-setup.md
quickstart=docs/learning/tracks/quickstart.md
operator=docs/learning/tracks/operator.md
phase26_learning_complete=true
[[ -f "$l23" ]] || phase26_learning_complete=false
grep -qF 'L23-guided-setup.md' "$quickstart" || phase26_learning_complete=false
grep -qF 'L23-guided-setup.md' "$operator" || phase26_learning_complete=false

if [[ "$phase26_learning_complete" != true ]]; then
  if [[ "${CAIRN_PHASE26_RED:-0}" == 1 ]]; then
    echo "PHASE26_RED:GUIDED_SETUP_LEARNING_MISSING"
    exit 86
  fi
  echo "SKIP: Ready L23 guided-setup lesson and track routing are not complete"
  echo "PASS: public learning path structure, readiness, links, and version alignment"
  exit 0
fi

grep -q '^\*\*Status:\*\* Ready' "$l23"
grep -qF "Tested with:** Cairnkeep $version" "$l23"
for heading in '## Outcome' '## Exercise' '## Recovery exercise' '## Common failures' '## Privacy and trust boundary'; do
  grep -qxF "$heading" "$l23" || {
    echo "L23 missing required heading: $heading" >&2
    exit 1
  }
done
for command in \
  'cairn setup' \
  '--git init' \
  '--git none' \
  '--harness' \
  '--memory' \
  '--yes' \
  'cairn sync-pi --apply' \
  'cairn doctor' \
  'cairn uninstall'; do
  grep -qF -- "$command" "$l23" || {
    echo "L23 missing guided setup command or mode: $command" >&2
    exit 1
  }
done
grep -Eqi 'missing|empty' "$l23"
grep -Eqi 'deterministic|non-interactive|non-TTY' "$l23"
grep -Eqi 'local.*stdio|stdio.*local' "$l23"
grep -Eqi 'limited|Git-less' "$l23"
grep -Eqi 'cancel|shutdown|child process' "$l23"
grep -Eqi '0\.84\.1' "$l23"
grep -Eqi 'credentials|secrets|private state' "$l23"

l25=docs/learning/lessons/L25-playbooks.md
video25=docs/learning/video-scripts/V25-playbooks.md
for file in "$l25" "$video25"; do
  [[ -f "$file" ]]
done
for phrase in \
  'cairn playbook check start' \
  'cairn playbook check finish' \
  '--enforce' \
  'cairn playbook record' \
  'unauthenticated' \
  'does not run'; do
  grep -qF -- "$phrase" "$l25" || {
    echo "L25 missing playbook teaching boundary: $phrase" >&2
    exit 1
  }
done
grep -qF 'course-13-playbooks' "$coverage"
grep -qF 'L25-playbooks.md' docs/learning/tracks/practitioner.md
grep -qF 'L25-playbooks.md' docs/learning/tracks/operator.md

echo "PASS: public learning path structure, readiness, links, and version alignment"
