#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

project="$tmp/project"
fake_bin="$tmp/bin"
mkdir -p "$project/.ai" "$fake_bin"
cp "$ROOT/templates/start-codex.sh.template" "$project/.ai/start-codex.sh"
chmod +x "$project/.ai/start-codex.sh"
cat > "$project/.ai/.env" <<'EOF'
CAIRN_PRECEDENCE_TEST=file
CAIRN_FILE_ONLY=file-only
EOF
chmod 600 "$project/.ai/.env"
cat > "$fake_bin/codex" <<'EOF'
#!/usr/bin/env bash
printf '%s|%s\n' "$CAIRN_PRECEDENCE_TEST" "$CAIRN_FILE_ONLY"
EOF
chmod +x "$fake_bin/codex"

output=$(PATH="$fake_bin:$PATH" CAIRN_PRECEDENCE_TEST=ambient "$project/.ai/start-codex.sh")
[[ "$output" == "ambient|file-only" ]] || {
  echo "FAIL: launcher environment precedence drifted: $output" >&2
  exit 1
}

echo "PASS: POSIX launcher keeps ambient overrides and adds project-only values"
