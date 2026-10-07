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
    assert.ok(workflow.permissions && typeof workflow.permissions === "object" && !Array.isArray(workflow.permissions), `${name} must have an explicit workflow permission mapping`);
    for (const [permission, level] of Object.entries(workflow.permissions)) {
        assert.ok(["read", "none"].includes(level), `${name} has a non-read-only workflow permission: ${permission}`);
    }
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

const PUBLICATION_PERMISSIONS = {
    prepare: { actions: "read", contents: "read" },
    npm: { contents: "write", "id-token": "write" },
    containers: {
        contents: "read",
        packages: "write",
        attestations: "write",
        "id-token": "write",
        "artifact-metadata": "write",
    },
};

function validatePublicationPermissions(workflow) {
    validateWorkflow("publish.yml", workflow);
    assert.deepEqual(workflow.permissions, { contents: "read" }, "publication workflow default must be contents-read only");
    assert.deepEqual(Object.keys(workflow.jobs).sort(), Object.keys(PUBLICATION_PERMISSIONS).sort(), "publication jobs require explicit permission review");
    for (const [job, permissions] of Object.entries(PUBLICATION_PERMISSIONS)) {
        assert.deepEqual(workflow.jobs[job].permissions, permissions, `publication ${job} permissions must match its reviewed tasks`);
    }
}

const publish = sources.find(({ name }) => name === "publish.yml")?.workflow;
assert.ok(publish, "publication workflow is missing");
const permissionControl = structuredClone(publish);
permissionControl.permissions = { contents: "read" };
for (const [job, permissions] of Object.entries(PUBLICATION_PERMISSIONS)) {
    permissionControl.jobs[job].permissions = structuredClone(permissions);
}
validatePublicationPermissions(permissionControl);

let permissionFixtures = 0;
function rejectPermissionMutation(mutate, expected) {
    const fixture = structuredClone(permissionControl);
    mutate(fixture);
    assert.throws(() => validatePublicationPermissions(fixture), expected, "unsafe publication permission mutation was accepted");
    permissionFixtures += 1;
}
for (const permission of ["actions", "contents", "id-token", "packages", "attestations", "artifact-metadata"]) {
    rejectPermissionMutation((fixture) => { fixture.permissions[permission] = "write"; }, /non-read-only workflow permission/);
}
rejectPermissionMutation((fixture) => { delete fixture.permissions; }, /explicit workflow permission mapping/);
rejectPermissionMutation((fixture) => { fixture.permissions = "write-all"; }, /explicit workflow permission mapping/);
rejectPermissionMutation((fixture) => { fixture.jobs.extra = { permissions: { contents: "read" } }; }, /explicit permission review/);
for (const [job, permissions] of Object.entries(PUBLICATION_PERMISSIONS)) {
    rejectPermissionMutation((fixture) => { delete fixture.jobs[job].permissions; }, /permissions must match/);
    rejectPermissionMutation((fixture) => { fixture.jobs[job].permissions = "write-all"; }, /broad scalar permissions/);
    for (const permission of Object.keys(permissions)) {
        rejectPermissionMutation((fixture) => { delete fixture.jobs[job].permissions[permission]; }, /permissions must match/);
    }
    for (const permission of ["actions", "contents", "id-token", "packages", "attestations", "artifact-metadata"]) {
        if (permissions[permission] === "write") continue;
        rejectPermissionMutation((fixture) => { fixture.jobs[job].permissions[permission] = "write"; }, /permissions must match/);
    }
}

const maliciousFixtures = [
    ["name: bad\non: push\npermissions: write-all\njobs: {}\n", /explicit workflow permission mapping/],
    ["name: bad\non: pull_request_target\npermissions: {contents: read}\njobs: {}\n", /uses pull_request_target/],
    ["name: bad\non: push\npermissions: {contents: read}\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: >-\n          actions/checkout@v7\n", /not pinned to a full commit/],
    ["name: bad\non: push\npermissions: {contents: read}\njobs:\n  call:\n    uses: 'owner/repo/.github/workflows/reuse.yml@main'\n", /not pinned to a full commit/],
    [`name: bad\non: push\npermissions: {contents: read}\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: evil/action@${"a".repeat(40)}\n`, /not on the maintained allowlist/],
];
for (const [index, [fixture, expected]] of maliciousFixtures.entries()) {
    assert.throws(() => validateWorkflow(`malicious-${index}.yml`, parse(fixture)), expected, `malicious workflow fixture ${index} was accepted`);
}

for (const { name, workflow } of sources) validateWorkflow(name, workflow);
validatePublicationPermissions(publish);

const security = sources.find(({ name }) => name === "security.yml")?.text ?? "";
assert.match(security, /github\/codeql-action\/init@[a-f0-9]{40}/);
assert.match(security, /actions\/dependency-review-action@[a-f0-9]{40}/);
assert.match(security, /queries:\s*security-extended/);
const scorecard = sources.find(({ name }) => name === "scorecard.yml")?.text ?? "";
assert.ok(Object.hasOwn(parse(scorecard).on, "workflow_dispatch"), "Scorecard must support manual recovery without a source push");
assert.match(scorecard, /ossf\/scorecard-action@[a-f0-9]{40}/);
assert.match(scorecard, /publish_results:\s*true/);

const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.match(rootPackage.scripts["audit:runtime"] ?? "", /npm audit --omit=dev/);
assert.match(rootPackage.scripts["check:public"] ?? "", /security:baseline/);

console.log(`PASS: ${workflowFiles.length} workflows, ${maliciousFixtures.length} action/trigger fixtures and ${permissionFixtures} permission mutations enforce parsed YAML, full-SHA actions, read-only defaults and job-scoped publication authority`);
