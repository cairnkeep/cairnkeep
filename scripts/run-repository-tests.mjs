#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform === "win32") {
  const result = spawnSync(process.execPath, [join(root, "scripts", "test-windows-native.mjs")], { cwd: root, stdio: "inherit" });
  process.exit(result.status ?? 1);
}
for (const test of readdirSync(join(root, "scripts")).filter((name) => /^test-.*\.sh$/.test(name)).sort()) {
  const result = spawnSync(join(root, "scripts", test), [], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const native = spawnSync(process.execPath, [join(root, "scripts", "test-windows-native.mjs")], { cwd: root, stdio: "inherit" });
process.exit(native.status ?? 1);
