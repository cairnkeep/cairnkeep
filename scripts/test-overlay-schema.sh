#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

node --input-type=module - "$ROOT" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/cairnkeep-overlay.schema.json"), "utf8"));
const example = JSON.parse(fs.readFileSync(path.join(root, "examples/overlay-distribution/cairnkeep.overlay.json"), "utf8"));

if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") throw new Error("unexpected schema draft");
if (schema.properties.schemaVersion.const !== 1) throw new Error("unexpected schema version");
for (const field of schema.required) {
  if (!(field in example)) throw new Error(`example missing required field: ${field}`);
}
if (example.core.package !== "@cairnkeep/cli") throw new Error("example must consume the public core");
if (example.policy.memory.storage !== "local") throw new Error("example must remain local-first");
if (example.policy.memory.transport !== "stdio") throw new Error("example must remain local-first");
NODE

pack_manifest=$(mktemp)
trap 'rm -f "$pack_manifest"' EXIT
npm --prefix "$ROOT" pack --dry-run --json --ignore-scripts > "$pack_manifest"
node --input-type=module - "$pack_manifest" <<'NODE'
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const files = new Set(manifest[0].files.map((item) => item.path));
for (const required of [
  "schemas/cairnkeep-overlay.schema.json",
  "examples/overlay-distribution/cairnkeep.overlay.json",
  "docs/overlay-distributions.md",
]) {
  if (!files.has(required)) throw new Error(`npm package missing ${required}`);
}
NODE

echo "overlay schema checks passed"
