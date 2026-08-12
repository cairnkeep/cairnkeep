#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
EXPECTED_RED_EXIT=86
RED_MARKER="PHASE26_RED:SETUP_OVERLAY_MISSING"

fail() { echo "FAIL: $1" >&2; exit 1; }

# The existing managed-distribution schema and package checks remain part of
# this contract and must pass before the new setup-policy seam is evaluated.
bash "$ROOT/scripts/test-overlay-schema.sh" >/dev/null || fail "existing overlay schema contract failed"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/project"
printf '%s\n' '{"schema_version":1,"defaults":{"git":"none","harnesses":["claude","pi"],"memory":"local"},"constraints":{"git":["none","existing"],"harnesses":["claude","pi"],"required_harnesses":["pi"],"memory":["local"]}}' >"$tmp/policy.json"
node -e 'const p=require(process.argv[1]);if(p.schema_version!==1||Object.keys(p).sort().join(",")!=="constraints,defaults,schema_version")process.exit(1)' "$tmp/policy.json" || fail "policy fixture is invalid"
[[ ! -e "$tmp/project/.ai" && ! -e "$tmp/project/.planning" && ! -e "$tmp/project/.agentfs" ]] || fail "policy fixture created managed paths"

if [[ ! -f "$ROOT/scripts/setup-core.mjs" || ! -f "$ROOT/schemas/cairnkeep-setup-policy.schema.json" ]]; then
  if [[ "${CAIRN_PHASE26_RED:-0}" == 1 ]]; then
    echo "$RED_MARKER"
    exit "$EXPECTED_RED_EXIT"
  fi
  echo "SKIP: setup overlay policy production surface is not complete"
  exit 0
fi

node --input-type=module - "$ROOT" "$tmp" <<'NODE'
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [root, sandbox] = process.argv.slice(2);
const core = await import(pathToFileURL(path.join(root, "scripts/setup-core.mjs")).href);
const policyPath = path.join(sandbox, "policy.json");
const target = path.join(sandbox, "project");
const policy = core.readSetupPolicy(policyPath);

assert.deepEqual(Object.keys(policy).sort(), ["constraints", "defaults", "schema_version"]);
assert.equal(policy.schema_version, 1);
assert.deepEqual(policy.defaults, { git: "none", harnesses: ["claude", "pi"], memory: "local" });

const fromDefaults = core.resolveSetupChoices({
  parsed: { target, git: null, harnesses: null, memory: null, confirmed: true },
  preflight: { targetState: "empty", gitExecutable: "available", repository: "none" },
  policy,
  interactive: null,
});
assert.equal(fromDefaults.git, "none");
assert.deepEqual(fromDefaults.harnesses, ["claude", "pi"]);
assert.equal(fromDefaults.memory, "local");

const cliWins = core.resolveSetupChoices({
  parsed: { target, git: "existing", harnesses: ["pi"], memory: "local", confirmed: true },
  preflight: { targetState: "non-empty", gitExecutable: "available", repository: "work-tree" },
  policy,
  interactive: null,
});
assert.equal(cliWins.git, "existing");
assert.deepEqual(cliWins.harnesses, ["pi"]);
assert.equal(cliWins.memory, "local");

assert.throws(
  () => core.resolveSetupChoices({
    parsed: { target, git: "existing", harnesses: ["claude"], memory: "local", confirmed: true },
    preflight: { targetState: "non-empty", gitExecutable: "available", repository: "work-tree" },
    policy,
    interactive: null,
  }),
  /constraint|required|pi/i,
);

const invalidPolicies = {
  unknown: { schema_version: 1, defaults: {}, constraints: {}, extra: true },
  version: { schema_version: 2, defaults: {}, constraints: {} },
  url: { schema_version: 1, defaults: {}, constraints: {}, endpoint: "https://example.invalid" },
  credential: { schema_version: 1, defaults: {}, constraints: {}, token: "fixture-secret" },
  executable: { schema_version: 1, defaults: { launcher: "node helper.mjs" }, constraints: {} },
};
for (const [name, value] of Object.entries(invalidPolicies)) {
  const candidate = path.join(sandbox, `${name}.json`);
  fs.writeFileSync(candidate, `${JSON.stringify(value)}\n`);
  assert.throws(() => core.readSetupPolicy(candidate), /invalid|unknown|policy|schema|allowed/i, name);
}

const oversized = path.join(sandbox, "oversized.json");
fs.writeFileSync(oversized, " ".repeat(1024 * 1024 + 1));
assert.throws(() => core.readSetupPolicy(oversized), /size|large|policy/i);

const linked = path.join(sandbox, "linked.json");
fs.symlinkSync(policyPath, linked);
assert.throws(() => core.readSetupPolicy(linked), /symbolic|symlink|unsafe|policy/i);

const executable = path.join(sandbox, "executable.json");
fs.writeFileSync(executable, '{"schema_version":1,"defaults":{},"constraints":{}}\n', { mode: 0o755 });
assert.throws(() => core.readSetupPolicy(executable), /executable|mode|unsafe|policy/i);

for (const managed of [".ai", ".planning", ".agentfs"]) {
  assert.equal(fs.existsSync(path.join(target, managed)), false, `policy validation created ${managed}`);
}

const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/cairnkeep-setup-policy.schema.json"), "utf8"));
assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.equal(schema.additionalProperties, false);
assert.deepEqual(schema.required, ["schema_version", "defaults", "constraints"]);
assert.deepEqual(Object.keys(schema.properties).sort(), ["constraints", "defaults", "schema_version"]);
NODE

echo "PASS: provider-neutral setup overlay policy and precedence contract"
