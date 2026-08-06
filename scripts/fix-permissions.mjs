#!/usr/bin/env node

import { chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (process.platform === "win32") process.exit(0);
const result = spawnSync("git", ["ls-files", "-s"], { encoding: "utf8" });
if (result.status !== 0) process.exit(result.status ?? 1);
for (const line of result.stdout.split(/\r?\n/)) {
  const match = line.match(/^100755\s+[0-9a-f]+\s+\d+\t(.+)$/);
  if (match) chmodSync(match[1], 0o755);
}
