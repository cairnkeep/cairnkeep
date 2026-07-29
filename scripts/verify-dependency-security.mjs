#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const MINIMUM_SDK = [1, 30, 0];
const MINIMUM_NODE_SERVER = [2, 0, 5];
const DIRECT_HONO_PACKAGES = new Set(["hono", "@hono/node-server"]);
const PACKAGE_ROOTS = [
  { label: "root", directory: "." },
  { label: "mcp-memory-server", directory: "mcp-memory-server" },
];

function readJson(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
}

function parseVersion(value, label) {
  assert.equal(typeof value, "string", `${label}: version must be a string`);
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  assert.ok(match, `${label}: expected a stable numeric semver triplet, found ${JSON.stringify(value)}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function minimumAdmittedVersion(range, label) {
  assert.equal(typeof range, "string", `${label}: SDK range must be a string`);
  const match = /^(?:\^|~|>=)?\s*(\d+)\.(\d+)\.(\d+)$/.exec(range);
  assert.ok(
    match,
    `${label}: SDK range must have one explicit numeric lower bound, found ${JSON.stringify(range)}`,
  );
  return match.slice(1).map(Number);
}

function assertMinimum(version, minimum, label) {
  assert.ok(
    compareVersions(version, minimum) >= 0,
    `${label}: requires >=${minimum.join(".")}, found ${version.join(".")}`,
  );
}

function dependencySections(packageValue) {
  return Object.entries(packageValue).filter(([key, value]) => (
    /dependencies$/i.test(key) && (Array.isArray(value) || (value !== null && typeof value === "object"))
  ));
}

function assertNoDirectHono(packageValue, label) {
  for (const [section, dependencies] of dependencySections(packageValue)) {
    const names = Array.isArray(dependencies) ? dependencies : Object.keys(dependencies);
    for (const name of names) {
      assert.equal(
        DIRECT_HONO_PACKAGES.has(name),
        false,
        `${label}: ${section} must not directly declare ${name}`,
      );
    }
  }
}

function resolvedPackages(lock, packageName) {
  const suffix = `node_modules/${packageName}`;
  return Object.entries(lock.packages ?? {}).filter(([key]) => key === suffix || key.endsWith(`/${suffix}`));
}

function verifyPackageRoot({ label, directory }) {
  const manifest = readJson(`${directory}/package.json`);
  const lock = readJson(`${directory}/package-lock.json`);
  const lockRoot = lock.packages?.[""];
  assert.ok(lockRoot, `${label}: package-lock root record is missing`);

  assertNoDirectHono(manifest, `${label} manifest`);
  assertNoDirectHono(lockRoot, `${label} lock root`);
  assert.equal(
    Object.prototype.hasOwnProperty.call(manifest, "overrides"),
    false,
    `${label} manifest: npm overrides are forbidden`,
  );

  const manifestRange = manifest.dependencies?.["@modelcontextprotocol/sdk"];
  const lockRange = lockRoot.dependencies?.["@modelcontextprotocol/sdk"];
  assertMinimum(minimumAdmittedVersion(manifestRange, `${label} manifest`), MINIMUM_SDK, `${label} manifest SDK range`);
  assertMinimum(minimumAdmittedVersion(lockRange, `${label} lock root`), MINIMUM_SDK, `${label} lock SDK range`);
  assert.equal(lockRange, manifestRange, `${label}: manifest and lock root SDK ranges differ`);

  const sdkPackages = resolvedPackages(lock, "@modelcontextprotocol/sdk");
  assert.ok(sdkPackages.length > 0, `${label}: resolved @modelcontextprotocol/sdk is missing`);
  for (const [path, packageValue] of sdkPackages) {
    assertMinimum(
      parseVersion(packageValue.version, `${label} ${path}`),
      MINIMUM_SDK,
      `${label} resolved @modelcontextprotocol/sdk`,
    );
  }

  const nodeServers = resolvedPackages(lock, "@hono/node-server");
  assert.ok(nodeServers.length > 0, `${label}: resolved @hono/node-server is missing`);
  for (const [path, packageValue] of nodeServers) {
    assertMinimum(
      parseVersion(packageValue.version, `${label} ${path}`),
      MINIMUM_NODE_SERVER,
      `${label} resolved @hono/node-server`,
    );
  }
}

try {
  PACKAGE_ROOTS.forEach(verifyPackageRoot);
  process.stdout.write("PASS: dependency manifests and lock graphs use the patched MCP Hono transport\n");
} catch (error) {
  process.stderr.write(`FAIL: dependency security policy: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
