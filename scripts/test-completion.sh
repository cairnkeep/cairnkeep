#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for shell in bash zsh fish; do
  "$ROOT/bin/cairn" completion "$shell" > "$tmp/$shell"
  [[ -s $tmp/$shell ]]
  grep -q 'completion' "$tmp/$shell"
done

capability_ids='memory.write memory.search notes.distill wiki graph security.audit route.check context.explore'
eval_commands='validate run ablate report prune delete'
eval_flags='--task-set --adapter --output --repetitions --seed --json --yes --disable --experiment --older-than-days --dry-run'
skill_commands='harvest list show review propose evaluate apply rollback'
for shell in bash zsh fish; do
  grep -q 'capabilities' "$tmp/$shell"
  grep -q 'list.*status.*enable.*disable.*reset.*logging\|list status enable disable reset logging' "$tmp/$shell"
  grep -q -- '--json\|-l json' "$tmp/$shell"
  for capability_id in $capability_ids; do
    grep -qF "$capability_id" "$tmp/$shell"
  done
  if grep -Eq '(^|[[:space:]"'"'"'])guard([[:space:]"'"'"']|$)' "$tmp/$shell"; then
    echo "completion exposed a private capability operation for $shell" >&2
    exit 1
  fi
  grep -q 'eval' "$tmp/$shell"
  grep -q 'validate.*run.*ablate.*report.*prune.*delete\|validate run ablate report prune delete' "$tmp/$shell"
  for eval_flag in $eval_flags; do
    grep -q -- "$eval_flag\|-l ${eval_flag#--}" "$tmp/$shell"
  done
  for capability_id in $capability_ids; do
    grep -qF "$capability_id" "$tmp/$shell"
  done
  if grep -Eq '(^|[[:space:]"'"'"'])(doctor-diagnosis|guard)([[:space:]"'"'"']|$)' "$tmp/$shell"; then
    echo "completion exposed a private eval lifecycle operation for $shell" >&2
    exit 1
  fi
  grep -q 'skill' "$tmp/$shell"
  grep -q 'harvest.*list.*show.*review.*propose.*evaluate.*apply.*rollback\|harvest list show review propose evaluate apply rollback' "$tmp/$shell"
  for skill_flag in --candidate --exploration-task-set --confirmation-task-set --evaluation --application --confirm; do
    grep -q -- "$skill_flag\|-l ${skill_flag#--}" "$tmp/$shell"
  done
  grep -q 'mcp-tools' "$tmp/$shell"
  grep -q 'full.*read-only.*custom\|full read-only custom' "$tmp/$shell"
  grep -q 'pack' "$tmp/$shell"
  grep -q 'init.*lock.*validate.*install.*list.*show.*remove.*enable.*disable.*update.*skills.*approve-skill.*revoke-skill\|init lock validate install list show remove enable disable update skills approve-skill revoke-skill' "$tmp/$shell"
  grep -q -- '--purge-packs\|-l purge-packs' "$tmp/$shell"
  grep -q 'evidence' "$tmp/$shell"
  grep -q 'list.*show.*delete.*prune.*doctor\|list show delete prune doctor' "$tmp/$shell"
  grep -q -- '--status\|-l status' "$tmp/$shell"
  grep -q 'playbook' "$tmp/$shell"
  grep -q 'list.*status.*init.*set.*enable.*disable.*reset.*check.*record.*receipts.*instructions.*doctor\|list status init set enable disable reset check record receipts instructions doctor' "$tmp/$shell"
  for playbook_value in minimal balanced strict context.recall verify.tests review.security learning.capture; do
    grep -qF "$playbook_value" "$tmp/$shell"
  done
  for playbook_flag in --project --json --enforce --changed --complexity --familiarity --risk --public-change --completed --skipped --failed; do
    grep -q -- "$playbook_flag\|-l ${playbook_flag#--}" "$tmp/$shell"
  done
done

"$ROOT/bin/cairn" help >"$tmp/root-help"
grep -qF 'cairn eval <validate|run|ablate|report|prune|delete>' "$tmp/root-help"
node "$ROOT/mcp-memory-server/dist/eval-cli.js" --help >"$tmp/eval-help"
for command in $eval_commands; do
  grep -q "cairn eval $command" "$tmp/eval-help"
done
for eval_flag in $eval_flags; do
  grep -q -- "$eval_flag" "$tmp/eval-help"
done
if grep -q 'doctor-diagnosis' "$tmp/eval-help"; then
  echo 'eval help exposed a private lifecycle operation' >&2
  exit 1
fi
grep -qF 'cairn skill <harvest|list|show|review|propose|evaluate|apply|rollback>' "$tmp/root-help"
grep -qF 'cairn evidence <list|show|delete|prune|doctor>' "$tmp/root-help"
grep -qF 'cairn playbook <list|status|init|set|enable|disable|reset|check|record|receipts|instructions|doctor>' "$tmp/root-help"
node "$ROOT/mcp-memory-server/dist/skill-cli.js" --help >"$tmp/skill-help"
for command in $skill_commands; do
  grep -q "cairn skill $command" "$tmp/skill-help"
done

node - "$ROOT/mcp-memory-server/src/capability-registry.ts" "$tmp/bash" "$tmp/zsh" "$tmp/fish" <<'NODE'
const fs = require("fs");
const [registryPath, ...completionPaths] = process.argv.slice(2);
const registry = fs.readFileSync(registryPath, "utf8");
const ids = [...registry.matchAll(/^\s*id: "([^"]+)",$/gm)].map((match) => match[1]);
const expected = ["memory.write", "memory.search", "notes.distill", "wiki", "graph", "security.audit", "route.check", "context.explore"];
if (JSON.stringify(ids) !== JSON.stringify(expected)) process.exit(1);
for (const path of completionPaths) {
  const output = fs.readFileSync(path, "utf8");
  if (!output.includes(ids.join(" "))) process.exit(1);
}
NODE

grep -q 'complete -F _cairn_complete cairn' "$tmp/bash"
grep -q '#compdef cairn' "$tmp/zsh"
grep -q 'complete -c cairn' "$tmp/fish"
for shell in bash zsh; do
  grep -q 'sync-pi' "$tmp/$shell"
  grep -q 'codex' "$tmp/$shell"
  grep -q 'sync-kimi' "$tmp/$shell"
  grep -q -- '--live-root' "$tmp/$shell"
done
grep -q 'sync-pi' "$tmp/fish"
grep -q 'codex' "$tmp/fish"
grep -q 'sync-kimi' "$tmp/fish"
grep -q 'not __fish_seen_subcommand_from .*sync-pi sync-kimi' "$tmp/fish"
grep -q -- '-l live-root' "$tmp/fish"
for shell in bash zsh fish; do
  grep -q 'notes' "$tmp/$shell"
  grep -q 'distill.*search-error.*promote.*doctor\|distill search-error promote doctor' "$tmp/$shell"
  grep -q 'artifact' "$tmp/$shell"
  grep -q 'graph' "$tmp/$shell"
  grep -q 'build.*query.*status.*diff.*explain.*path\|build query status diff explain path' "$tmp/$shell"
  grep -q 'list.*show.*delete.*prune' "$tmp/$shell"
  grep -q -- '--json\|-l json' "$tmp/$shell"
  grep -q -- '--dry-run\|-l dry-run' "$tmp/$shell"
  grep -q -- '--include-protected\|-l include-protected' "$tmp/$shell"
done

grep -q -- '--kind' "$tmp/bash"
grep -q -- '--session' "$tmp/bash"
grep -q -- '--kind' "$tmp/zsh"
grep -q -- '--session' "$tmp/zsh"
grep -q -- '-l kind' "$tmp/fish"
grep -q -- '-l session' "$tmp/fish"

if "$ROOT/bin/cairn" completion unsupported >/dev/null 2>&1; then
  echo "completion accepted an unsupported shell" >&2
  exit 1
fi

completion_surface_complete=true
for shell in bash zsh fish; do
  if ! grep -qw 'setup' "$tmp/$shell"; then
    completion_surface_complete=false
  fi
done
"$ROOT/bin/cairn" completion powershell >"$tmp/powershell"
if ! grep -qE "['\"]setup['\"]" "$tmp/powershell"; then
  completion_surface_complete=false
fi

if [[ "$completion_surface_complete" != true ]]; then
  if [[ "${CAIRN_PHASE26_RED:-0}" == 1 ]]; then
    echo "PHASE26_RED:SETUP_COMPLETION_MISSING"
    exit 86
  fi
  echo "SKIP: guided setup completion surface is not complete"
  git -C "$ROOT" diff --check
  echo "PASS: shell completion generation"
  exit 0
fi

setup_flags='--git --harness --memory --policy --yes --json'
setup_values='init existing none claude opencode pi kimi qwen local'
for shell in bash zsh fish powershell; do
  for flag in $setup_flags; do
    grep -q -- "$flag\|${flag#--}" "$tmp/$shell" || {
      echo "setup completion omitted $flag for $shell" >&2
      exit 1
    }
  done
  for value in $setup_values; do
    grep -qF "$value" "$tmp/$shell" || {
      echo "setup completion omitted $value for $shell" >&2
      exit 1
    }
  done
done

git -C "$ROOT" diff --check
echo "PASS: shell completion generation"
