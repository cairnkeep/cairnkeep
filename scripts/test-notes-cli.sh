#!/usr/bin/env bash
# Public CLI contract for opt-in deterministic note distillation and lookup.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

cairn="$ROOT/bin/cairn"
fixture="$ROOT/mcp-memory-server/scripts/fixtures/notes/lifecycle-sessions.json"
project_a="$tmp/PARA/Projects/project-a"
project_b="$tmp/PARA/Projects/project-b"
project_c="$tmp/PARA/Projects/project-c"
store="$tmp/store"
mkdir -p "$project_a" "$project_b" "$project_c"

put_session() {
  local name=$1 project=$2 session_id=${3:-}
  (cd "$ROOT/mcp-memory-server" && PROJECT="$project" NAME="$name" SESSION_ID="$session_id" FIXTURE="$fixture" node --input-type=module - <<'EOF'
import { readFileSync } from "node:fs";
import { getTrajectoryLimits, trajectorySessionSchema } from "./dist/trajectory-schema.js";
import { putTrajectory } from "./dist/trajectory-store.js";
const all = JSON.parse(readFileSync(process.env.FIXTURE, "utf8"));
const raw = JSON.parse(JSON.stringify(all[process.env.NAME]).replaceAll("$PROJECT_ROOT", process.env.PROJECT));
if (process.env.SESSION_ID) raw.session_id = process.env.SESSION_ID;
await putTrajectory(process.env.PROJECT, trajectorySessionSchema.parse(raw), getTrajectoryLimits());
EOF
  )
}

"$cairn" help | grep -q "cairn notes" || fail "help missing notes"

# Disabled means no notes root, lock, manifest, or trajectory mutation.
put_session failure "$project_a"
before=$(sha256sum "$project_a/.agentfs/trajectory.db" | cut -d' ' -f1)
CAIRN_AGENTFS_BASE_DIR="$store" env -u CAIRN_NOTE_DISTILLATION \
  "$cairn" notes distill --project "$project_a" --json >"$tmp/disabled.json"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(j.enabled!==false)process.exit(1)' "$tmp/disabled.json" \
  || fail "disabled result is not explicit"
[[ ! -e "$store/notes" ]] || fail "disabled command created notes data"
after=$(sha256sum "$project_a/.agentfs/trajectory.db" | cut -d' ' -f1)
[[ "$before" == "$after" ]] || fail "disabled command changed trajectory bytes"

export CAIRN_AGENTFS_BASE_DIR="$store"
export CAIRN_NOTE_DISTILLATION=1
unset CAIRN_NOTE_ENRICHMENT CAIRN_LLM_API_KEY CAIRN_LLM_API_URL CAIRN_NOTE_ENRICHMENT_MODEL

"$cairn" notes distill --project "$project_a" --session note-failure-001 --json >"$tmp/created.json"
note_a=$(node -e 'const j=require(process.argv[1]);if(j.created.length!==1||j.created[0].status!=="unresolved")process.exit(1);process.stdout.write(j.created[0].id)' "$tmp/created.json") \
  || fail "exact-session distillation did not create one unresolved note"
path_a=$(node -e 'process.stdout.write(require(process.argv[1]).created[0].path)' "$tmp/created.json")
printf '\n## Maintainer notes\n\nPreserve this operator sentence.\n' >>"$path_a"

put_session fix "$project_a"
"$cairn" notes distill --project "$project_a" --json >"$tmp/fixed.json"
node -e 'const j=require(process.argv[1]);if(!j.updated.some(x=>x.status==="resolved"))process.exit(1)' "$tmp/fixed.json" \
  || fail "incremental current-project run did not resolve the note"
grep -q 'Preserve this operator sentence.' "$path_a" || fail "managed update removed manual content"

printf '%s\n' "TypeError: Cannot read properties of undefined (reading 'name')" \
  "    at loadUser (/another/root/src/user.ts:999:1)" \
  | "$cairn" notes search-error --project "$project_a" --json >"$tmp/search.json"
node -e 'const j=require(process.argv[1]);if(j.results[0]?.id!==process.argv[2]||j.results[0]?.status!=="resolved")process.exit(1)' "$tmp/search.json" "$note_a" \
  || fail "fresh public search did not return resolved note first"

"$cairn" notes distill --project "$project_a" --session note-fix-001 --json >"$tmp/repeat.json"
node -e 'const j=require(process.argv[1]);if(j.already_processed.length!==1)process.exit(1)' "$tmp/repeat.json" \
  || fail "exact reprocessing is not idempotent"

put_session failure "$project_b" note-failure-project-b
"$cairn" notes distill --all-projects --para-root "$tmp/PARA" --json >"$tmp/all.json"
node -e 'const j=require(process.argv[1]);if(j.projects_scanned<2)process.exit(1)' "$tmp/all.json" \
  || fail "all-project mode did not scan both trajectory projects"
note_b=$(node -e 'const j=require(process.argv[1]);const c=j.results.flatMap(x=>x.created||[]).find(x=>x.project_id!==process.argv[2]);if(!c)process.exit(1);process.stdout.write(c.id)' "$tmp/all.json" "$(basename "$(dirname "$(dirname "$path_a")")")") \
  || fail "all-project mode did not create the corroborating note"

if "$cairn" notes promote "$note_a" --with "$note_b" --json >"$tmp/unconfirmed.out" 2>&1; then
  fail "promotion succeeded without --confirm"
fi
if "$cairn" notes promote "$note_a" --with "$note_a" --confirm --json >"$tmp/same.out" 2>&1; then
  fail "promotion accepted one-project evidence"
fi
"$cairn" notes promote "$note_a" --with "$note_b" --confirm --json >"$tmp/promoted.json"
node -e 'const j=require(process.argv[1]);if(j.status!=="promoted"||!j.shared_path)process.exit(1)' "$tmp/promoted.json" \
  || fail "confirmed cross-project promotion failed"
[[ $(find "$store/notes/shared" -type f -name '*.md' | wc -l | tr -d ' ') == 1 ]] \
  || fail "promotion did not leave exactly one shared canonical note"
grep -q 'node_type: provenance' "$path_a" || fail "project note did not become provenance"

# A live lock and an unmanaged replacement both fail without changing bytes.
put_session failure "$project_c" note-failure-project-c
"$cairn" notes distill --project "$project_c" --json >"$tmp/project-c.json"
path_c=$(node -e 'process.stdout.write(require(process.argv[1]).created[0].path)' "$tmp/project-c.json")
project_id_c=$(basename "$(dirname "$(dirname "$path_c")")")
mkdir -p "$store/notes/.cairnkeep/locks/$project_id_c.lock"
if "$cairn" notes distill --project "$project_c" --json >"$tmp/locked.out" 2>&1; then
  fail "distillation ignored a live project lock"
fi
rm -rf "$store/notes/.cairnkeep/locks/$project_id_c.lock"
printf 'manual unmanaged bytes\n' >"$path_c"
collision_before=$(sha256sum "$path_c" | cut -d' ' -f1)
put_session recurrence "$project_c" note-recurrence-project-c
if "$cairn" notes distill --project "$project_c" --json >"$tmp/collision.out" 2>&1; then
  fail "distillation overwrote an unmanaged collision"
fi
collision_after=$(sha256sum "$path_c" | cut -d' ' -f1)
[[ "$collision_before" == "$collision_after" ]] || fail "collision changed unmanaged bytes"

"$cairn" notes doctor --json >"$tmp/doctor.json"
node -e 'const j=require(process.argv[1]);if(j.schema_version!==1||j.ok!==true)process.exit(1)' "$tmp/doctor.json" \
  || fail "notes doctor did not validate the generated tree"

echo "PASS: cairn notes CLI, disabled path, promotion, lock and collision contracts"
