import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const policy = join(root, "scripts/verify-dependency-security.mjs");
const paths = ["package.json", "package-lock.json", "mcp-memory-server/package.json", "mcp-memory-server/package-lock.json"];
const baseline = Object.fromEntries(paths.map(path => [path, JSON.parse(readFileSync(join(root, path), "utf8"))]));
const scratch = mkdtempSync(join(tmpdir(), "cairn-dependency-policy-"));
function check(label, mutate, expected) {
  const values = structuredClone(baseline);
  mutate(values);
  for (const path of paths) {
    const target = join(scratch, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(values[path]));
  }
  const result = spawnSync(process.execPath, [policy], { cwd: scratch, encoding: "utf8", timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, expected ? 1 : 0, `${label}: ${result.stderr}`);
  if (expected) assert.match(result.stderr, expected, label);
}
try {
  check("valid dependency graph", () => {}, null);
  check("root manifest/lock mismatch", x => { x["package.json"].dependencies.zod = "^4.0.0"; }, /manifest and lock root Zod ranges differ/);
  check("server manifest/lock mismatch", x => { x["mcp-memory-server/package-lock.json"].packages[""].dependencies.zod = "^4.0.0"; }, /manifest and lock root Zod ranges differ/);
  check("matched server range differs from packaged CLI", x => {
    x["mcp-memory-server/package.json"].dependencies.zod = "^4.0.0";
    x["mcp-memory-server/package-lock.json"].packages[""].dependencies.zod = "^4.0.0";
  }, /root and server Zod ranges differ/);
  check("different resolved schema version", x => { x["mcp-memory-server/package-lock.json"].packages["node_modules/zod"].version = "4.0.0"; }, /root and server resolved Zod versions differ/);
  check("missing direct schema", x => { delete x["package-lock.json"].packages["node_modules/zod"]; }, /direct Zod: version must be a string/);
  check("existing SDK advisory check retained", x => { x["package-lock.json"].packages["node_modules/@modelcontextprotocol/sdk"].version = "1.0.0"; }, /resolved @modelcontextprotocol\/sdk: requires/);
  console.log("PASS: dependency policy positive control, schema parity mutations and SDK advisory rejection");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
