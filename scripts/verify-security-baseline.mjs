#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workflowDirectory = join(root, ".github", "workflows");
const workflowFiles = readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/.test(name)).sort();
const sources = workflowFiles.map((name) => {
    const text = readFileSync(join(workflowDirectory, name), "utf8");
    return { name, text, workflow: parse(text) };
});
const ALLOWED_ACTIONS = [
    /^actions\//,
    /^github\/codeql-action\//,
    /^docker\//,
    /^ossf\/scorecard-action(?:\/|$)/,
];

function walk(value, visit, path = "workflow") {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
        value.forEach((entry, index) => walk(entry, visit, `${path}[${index}]`));
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        visit(key, child, `${path}.${key}`);
        walk(child, visit, `${path}.${key}`);
    }
}

function validateWorkflow(name, workflow) {
    assert.ok(workflow && typeof workflow === "object" && !Array.isArray(workflow), `${name} is not a workflow mapping`);
    const triggers = workflow.on;
    const triggerNames = typeof triggers === "string" ? [triggers] : Array.isArray(triggers) ? triggers : Object.keys(triggers ?? {});
    assert.ok(!triggerNames.includes("pull_request_target"), `${name} uses pull_request_target`);
    walk(workflow, (key, value, path) => {
        if (key === "permissions" && typeof value === "string") {
            assert.ok(!["read-all", "write-all"].includes(value), `${name} has broad scalar permissions at ${path}`);
        }
        if (key !== "uses") return;
        assert.equal(typeof value, "string", `${name} has a non-string action reference at ${path}`);
        if (value.startsWith("./")) return;
        assert.match(value, /^[^@\s]+@[a-f0-9]{40}$/, `${name} action is not pinned to a full commit at ${path}: ${value}`);
        const action = value.slice(0, value.lastIndexOf("@"));
        assert.ok(ALLOWED_ACTIONS.some((allowed) => allowed.test(action)), `${name} action is not on the maintained allowlist at ${path}: ${action}`);
    });
}

for (const { name, workflow } of sources) validateWorkflow(name, workflow);

const maliciousFixtures = [
    "name: bad\non: push\npermissions: write-all\njobs: {}\n",
    "name: bad\non: pull_request_target\njobs: {}\n",
    "name: bad\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: >-\n          actions/checkout@v7\n",
    "name: bad\non: push\njobs:\n  call:\n    uses: 'owner/repo/.github/workflows/reuse.yml@main'\n",
    `name: bad\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: evil/action@${"a".repeat(40)}\n`,
];
for (const [index, fixture] of maliciousFixtures.entries()) {
    assert.throws(() => validateWorkflow(`malicious-${index}.yml`, parse(fixture)), undefined, `malicious workflow fixture ${index} was accepted`);
}

const security = sources.find(({ name }) => name === "security.yml")?.text ?? "";
assert.match(security, /github\/codeql-action\/init@[a-f0-9]{40}/);
assert.match(security, /actions\/dependency-review-action@[a-f0-9]{40}/);
assert.match(security, /queries:\s*security-extended/);
const scorecard = sources.find(({ name }) => name === "scorecard.yml")?.text ?? "";
assert.match(scorecard, /ossf\/scorecard-action@[a-f0-9]{40}/);
assert.match(scorecard, /publish_results:\s*true/);

const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.match(rootPackage.scripts["audit:runtime"] ?? "", /npm audit --omit=dev/);
assert.match(rootPackage.scripts["check:public"] ?? "", /security:baseline/);

console.log(`PASS: ${workflowFiles.length} workflows and ${maliciousFixtures.length} adversarial fixtures enforce parsed YAML, allowlisted full-SHA actions, bounded triggers, and required security controls`);
