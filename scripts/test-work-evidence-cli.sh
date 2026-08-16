#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

npm --prefix "$ROOT/mcp-memory-server" run build >/dev/null

fake_bin="$tmp/bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/cairn" <<EOF
#!/usr/bin/env bash
exec node "$ROOT/bin/cairn" "\$@"
EOF
chmod +x "$fake_bin/cairn"

for harness in claude opencode pi kimi qwen codex; do
  project="$tmp/$harness"
  mkdir -p "$project/.ai" "$project/.agentfs"
  cp "$ROOT/templates/start-$harness.sh.template" "$project/.ai/start-$harness.sh"
  chmod +x "$project/.ai/start-$harness.sh"
  printf '*\n!.gitignore\n' >"$project/.agentfs/.gitignore"
  printf 'CAIRN_WORK_EVIDENCE=1\n' >"$project/.ai/.env"
  cat >"$fake_bin/$harness" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" > "$project/args.txt"
printf '%s\n' changed > "$project/session.txt"
exit 17
EOF
  chmod +x "$fake_bin/$harness"
  cat >"$project/.ai/post-exit.sh" <<EOF
printf '%s\n' "\$CAIRN_EXIT_STATUS" > "$project/post-status.txt"
EOF
  (
    cd "$project"
    git init --quiet
    git config user.email fixture@example.invalid
    git config user.name Fixture
    printf '%s\n' start > session.txt
    git add session.txt .agentfs/.gitignore
    git commit --quiet -m start
  )
  status=0
  PATH="$fake_bin:$PATH" "$project/.ai/start-$harness.sh" --fixture "value with spaces" || status=$?
  [[ $status -eq 17 ]] || fail "$harness launcher lost exit status"
  grep -q -- '--fixture value with spaces' "$project/args.txt" || fail "$harness launcher lost arguments"
  [[ $(cat "$project/post-status.txt") == 17 ]] || fail "$harness post-exit seam lost status"
  (cd "$project" && PATH="$fake_bin:$PATH" "$ROOT/bin/cairn" evidence list --json) >"$tmp/$harness.json"
  node -e '
const value=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
if(value.evidence.length!==1||value.evidence[0].status!=="complete"||value.evidence[0].harness!==process.argv[2]||value.evidence[0].exit_status!==17)process.exit(1);
if(!value.evidence[0].touched_paths.includes("session.txt"))process.exit(1);
' "$tmp/$harness.json" "$harness" || fail "$harness evidence record is incomplete"
done

disabled="$tmp/disabled"
mkdir -p "$disabled/.ai"
cp "$ROOT/templates/start-codex.sh.template" "$disabled/.ai/start-codex.sh"
chmod +x "$disabled/.ai/start-codex.sh"
cat >"$fake_bin/cairn" <<'EOF'
#!/usr/bin/env bash
exit 88
EOF
cat >"$fake_bin/codex" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$fake_bin/cairn" "$fake_bin/codex"
PATH="$fake_bin:$PATH" "$disabled/.ai/start-codex.sh" || fail "disabled launcher called the evidence wrapper"
[[ ! -e "$disabled/.agentfs/work-evidence" ]] || fail "disabled launcher created evidence storage"

cat >"$fake_bin/codex" <<EOF
#!/usr/bin/env bash
printf launched >"$tmp/old-cairn-fallback"
exit 19
EOF
chmod +x "$fake_bin/codex"
status=0
CAIRN_WORK_EVIDENCE=1 PATH="$fake_bin:$PATH" "$disabled/.ai/start-codex.sh" 2>"$tmp/old-cairn.err" || status=$?
[[ $status -eq 19 ]] || fail "old cairn fallback lost the harness exit status"
[[ -f "$tmp/old-cairn-fallback" ]] || fail "old cairn fallback did not launch the harness"
grep -q 'compatible evidence command unavailable' "$tmp/old-cairn.err" || fail "old cairn fallback did not explain capture loss"

"$ROOT/bin/cairn" help | grep -q 'cairn evidence' || fail "root help omits evidence"
node "$ROOT/mcp-memory-server/dist/work-evidence-cli.js" --help | grep -q 'cairn evidence list' || fail "evidence help omits list"

echo "PASS: work-evidence CLI and all harness launchers preserve lifecycle semantics"
