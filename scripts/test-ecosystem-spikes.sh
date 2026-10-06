#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

for script in \
  run-memfork-evaluation.mjs \
  run-clm-pi-evaluation.mjs \
  run-ollaya-decision-evaluation.mjs
do
  node --check "$ROOT/scripts/spikes/$script"
done

node - "$ROOT/examples/eval/ecosystem-decisions.json" <<'NODE'
const fs = require("node:fs")
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
if (data.schema_version !== 1 || data.id !== "cairnkeep-policy-decisions-v1") process.exit(1)
if (JSON.stringify(data.labels) !== JSON.stringify(["observe", "approval", "deny", "none"])) process.exit(1)
if (!Array.isArray(data.cases) || data.cases.length !== 32) process.exit(1)
if (new Set(data.cases.map(({ id }) => id)).size !== data.cases.length) process.exit(1)
const counts = Object.fromEntries(data.labels.map((label) => [label, 0]))
for (const item of data.cases) {
  const { relevant_context, read_only, mutates_state, forbidden } = item.signals ?? {}
  if (![relevant_context, read_only, mutates_state, forbidden].every((value) => typeof value === "boolean")) process.exit(1)
  const expected = forbidden ? "deny" : mutates_state ? "approval" : relevant_context && read_only ? "observe" : "none"
  if (item.expected !== expected) process.exit(1)
  counts[item.expected] += 1
}
if (!Object.values(counts).every((count) => count === 8)) process.exit(1)
NODE

grep -qF 'MemFork | release `v0.3.0`' "$ROOT/docs/research/ecosystem-evidence-2026-10.md"
grep -qF '| Deterministic policy | 32/32 | 100% |' "$ROOT/docs/research/ecosystem-evidence-2026-10.md"
grep -qF '| Cairnkeep + pi-clm | 15/15 | 51,530 | $0.0543623 |' "$ROOT/docs/research/ecosystem-evidence-2026-10.md"

echo "PASS: ecosystem spike runners, frozen decision data, and evidence contract"
