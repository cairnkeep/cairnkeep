#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

node --input-type=module - "$ROOT" <<'EOF'
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const serverPackage = JSON.parse(
  readFileSync(join(root, "mcp-memory-server", "package.json"), "utf8"),
);

const failures = [];
if (rootPackage.engines?.node !== ">=22") failures.push("root Node.js engine must be >=22");
if (serverPackage.engines?.node !== rootPackage.engines?.node) {
  failures.push("root and memory-server Node.js engines differ");
}
if (rootPackage.dependencies?.zod !== serverPackage.dependencies?.zod) {
  failures.push("root and memory-server Zod declarations differ");
}
if (!rootPackage.dependencies?.zod?.startsWith("^4.")) failures.push("Zod must use major 4");
if (!serverPackage.devDependencies?.typescript?.startsWith("^7.")) {
  failures.push("TypeScript must use major 7");
}
if (!serverPackage.devDependencies?.["@types/node"]?.startsWith("^22.")) {
  failures.push("Node.js types must match the Node.js 22 runtime floor");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
EOF

grep -q 'node: \["22", "24", "26"\]' "$ROOT/.github/workflows/ci.yml"
if grep -Eq 'node-version: "(18|20)"|node:(18|20)-slim' "$ROOT/.github/workflows/ci.yml"; then
  echo "FAIL: CI still declares an end-of-life Node.js runtime" >&2
  exit 1
fi

echo "PASS: runtime and toolchain declarations are aligned"
