#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

node --input-type=module - "$ROOT" "$tmp" <<'NODE'
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const [root, sandbox] = process.argv.slice(2);
const registry = await import(pathToFileURL(join(root, "scripts", "harness-registry.mjs")).href);
assert.deepEqual(registry.HARNESS_IDS, ["claude", "opencode", "pi", "kimi", "qwen", "codex"]);
assert.equal(new Set(registry.HARNESS_IDS).size, registry.HARNESS_IDS.length);
for (const id of registry.HARNESS_IDS) {
  const definition = registry.harnessDefinition(id);
  assert.equal(definition.id, id);
  assert.ok(definition.title);
  assert.match(definition.launcher.path, new RegExp(`^\\.ai/start-${id}\\.sh$`));
}
assert.deepEqual(registry.harnessProjectAssets("codex", "local").map(({ path }) => path), [
  ".ai/start-codex.sh",
  ".codex/config.toml",
]);
assert.deepEqual(registry.requiredHarnessAssetPaths(["codex"], "local"), [".ai/start-codex.sh"]);
assert.deepEqual(registry.requiredHarnessAssetPaths(["codex"], "none"), [".ai/start-codex.sh"]);
assert.equal(registry.machineSyncCommand(["codex"]), null);

const schema = JSON.parse(readFileSync(join(root, "schemas", "cairnkeep-setup.schema.json"), "utf8"));
assert.deepEqual(schema.properties.harnesses.items.enum, registry.HARNESS_IDS, "setup schema drifted from harness registry");
const policySchema = JSON.parse(readFileSync(join(root, "schemas", "cairnkeep-setup-policy.schema.json"), "utf8"));
assert.deepEqual(policySchema.properties.defaults.properties.harnesses.items.enum, registry.HARNESS_IDS);
assert.deepEqual(policySchema.properties.constraints.properties.harnesses.items.enum, registry.HARNESS_IDS);
assert.deepEqual(policySchema.properties.constraints.properties.required_harnesses.items.enum, registry.HARNESS_IDS);

const target = join(sandbox, "codex-project");
const setup = spawnSync(join(root, "bin", "cairn"), [
  "setup", target, "--git", "init", "--harness", "codex", "--memory", "local", "--yes", "--json",
], { encoding: "utf8", shell: false });
assert.equal(setup.status, 0, setup.stderr);
const result = JSON.parse(setup.stdout);
assert.deepEqual(result.harnesses, ["codex"]);
assert.equal(result.machine_sync.command, null);
assert.deepEqual(result.launch_commands, [".ai/start-codex.sh"]);
assert.match(readFileSync(join(target, ".codex", "config.toml"), "utf8"), /\[mcp_servers\.cairn-memory\][\s\S]*command = "cairn"[\s\S]*args = \["memory-server"\]/);

const fakeBin = join(sandbox, "bin");
mkdirSync(fakeBin);
const fakeCodex = join(fakeBin, "codex");
writeFileSync(fakeCodex, "#!/bin/sh\nprintf '%s\\n' \"$PWD\" \"${CAIRN_REGISTRY_TEST:-}\" \"$*\"\n");
chmodSync(fakeCodex, 0o755);
writeFileSync(join(target, ".ai", ".env"), "CAIRN_REGISTRY_TEST=loaded\n", { mode: 0o600 });
const launch = spawnSync(join(target, ".ai", "start-codex.sh"), ["--fixture"], {
  encoding: "utf8",
  shell: false,
  env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
});
assert.equal(launch.status, 0, launch.stderr);
assert.deepEqual(launch.stdout.trim().split("\n"), [target, "loaded", "--fixture"]);

const noMemory = join(sandbox, "codex-no-memory");
const noMemorySetup = spawnSync(join(root, "bin", "cairn"), [
  "setup", noMemory, "--git", "init", "--harness", "codex", "--memory", "none", "--yes",
], { encoding: "utf8", shell: false });
assert.equal(noMemorySetup.status, 0, noMemorySetup.stderr);
assert.throws(() => readFileSync(join(noMemory, ".codex", "config.toml")), /ENOENT/);

const collision = join(sandbox, "codex-existing-config");
mkdirSync(join(collision, ".codex"), { recursive: true });
writeFileSync(join(collision, ".codex", "config.toml"), "[features]\nfixture = true\n");
const collisionSetup = spawnSync(join(root, "bin", "cairn"), [
  "setup", collision, "--git", "init", "--harness", "codex", "--memory", "local", "--yes", "--json",
], { encoding: "utf8", shell: false });
assert.equal(collisionSetup.status, 0, collisionSetup.stderr);
assert.equal(JSON.parse(collisionSetup.stdout).counts.skipped, 1);
assert.equal(readFileSync(join(collision, ".codex", "config.toml"), "utf8"), "[features]\nfixture = true\n");
const setupModule = await import(pathToFileURL(join(root, "scripts", "setup.mjs")).href);
assert.equal(setupModule.diagnoseSetup(collision).status, "incomplete");
writeFileSync(join(collision, ".codex", "config.toml"), [
  "[features]", "fixture = true", "", "[mcp_servers.cairn-memory]", 'command = "cairn"', 'args = ["memory-server"]', "",
].join("\n"));
assert.equal(setupModule.diagnoseSetup(collision).status, "complete");
const uninstall = spawnSync(join(root, "bin", "cairn"), ["uninstall", "--yes", collision], {
  encoding: "utf8", shell: false, env: { ...process.env, HOME: join(sandbox, "home") },
});
assert.equal(uninstall.status, 0, uninstall.stderr);
assert.match(readFileSync(join(collision, ".codex", "config.toml"), "utf8"), /fixture = true/);
NODE

echo "PASS: declarative harness registry and first-class Codex setup contract"
