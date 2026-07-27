import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RED_MARKER = "PHASE18_RED:CAPABILITY_CONTRACT_MISSING";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(scriptDirectory, "fixtures", "capabilities", "contract-cases.json");
const packagePath = join(scriptDirectory, "..", "package.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const modes = new Set([undefined, "--baseline", "--expect-red", "--schema-registry-only"]);
const mode = process.argv[2];

assert.equal(process.argv.length <= 3 && modes.has(mode), true, "Usage: smoke-capability-contract.mjs [--baseline|--expect-red|--schema-registry-only]");

function canonicalDigest(status) {
    const input = {
        schema_version: 1,
        contract_enabled: status.contract_enabled,
        capabilities: status.capabilities.map(({ id, enabled }) => ({ id, enabled })),
        logging: { callbacks: status.logging.enabled },
    };
    return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

function fixtureChecks() {
    assert.equal(fixture.schema_version, 1);
    assert.deepEqual(fixture.registry.map(({ id }) => id), [
        "memory.write",
        "memory.search",
        "notes.distill",
        "wiki",
        "graph",
        "security.audit",
        "route.check",
        "context.explore",
    ]);
    assert.deepEqual([...new Set(fixture.registry.map(({ kind }) => kind))].sort(), ["mcp-tool", "offline-job", "operating-workflow"]);
    assert.deepEqual(fixture.empty_config, { schema_version: 1, capabilities: {}, logging: { callbacks: false } });
    assert.equal(typeof fixture.cases.malformed.malformed_bytes, "string");
    assert.equal(fixture.cases.malformed.config, undefined, "malformed bytes must not be represented as parsed JSON");
    assert.equal(Object.keys(fixture.cases).length, 5);
    assert.equal(fixture.canonical_status.capabilities.length, 8);
    assert.equal(fixture.canonical_status.configuration_digest, "$computed");
    for (const row of fixture.registry) {
        assert.equal(row.environment, `CAIRN_CAPABILITY_${row.id.toUpperCase().replaceAll(".", "_")}`);
        assert.equal(["final-callback"].includes(row.logging_policy), true);
        assert.equal(row.restart_required, row.kind === "mcp-tool");
    }

    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    assert.equal(packageJson.scripts["check:capability-contract"], "node scripts/smoke-capability-contract.mjs");
    assert.equal(packageJson.scripts["check:capability-logging"], "node scripts/smoke-capability-logging.mjs");
    assert.equal(packageJson.scripts["check:capability-mcp"], "node scripts/smoke-capability-mcp.mjs");
    for (const name of ["check:capability-contract", "check:capability-logging", "check:capability-mcp"]) {
        assert.equal(packageJson.scripts["test:smoke"].includes(name), true, `${name} is missing from the default suite after its owner became GREEN`);
    }
}

async function loadContractModules() {
    const schema = await import("../dist/capability-schema.js");
    const registry = await import("../dist/capability-registry.js");
    return { schema, registry };
}

async function schemaRegistryChecks() {
    const { schema, registry } = await loadContractModules();
    assert.equal(schema.CAPABILITY_SCHEMA_VERSION, 1);
    assert.deepEqual([...schema.CAPABILITY_IDS], fixture.registry.map(({ id }) => id));
    assert.deepEqual([...schema.CAPABILITY_KINDS].sort(), ["mcp-tool", "offline-job", "operating-workflow"]);
    assert.deepEqual(registry.CAPABILITY_REGISTRY.map((row) => ({
        id: row.id,
        kind: row.kind,
        owner: row.owner,
        environment: row.environment,
        compatibility_default: row.compatibility_default,
        restart_required: row.restart_required,
        logging_policy: row.logging_policy,
    })), fixture.registry);

    assert.deepEqual(schema.capabilityManagedConfigSchema.parse(fixture.empty_config), fixture.empty_config);
    assert.equal(schema.capabilityManagedConfigSchema.safeParse({ ...fixture.empty_config, extra: true }).success, false);
    const expectedStatus = structuredClone(fixture.canonical_status);
    expectedStatus.configuration_digest = canonicalDigest(expectedStatus);
    assert.deepEqual(schema.capabilityStatusSchema.parse(expectedStatus), expectedStatus);
    assert.equal(schema.capabilityStatusSchema.safeParse({ ...expectedStatus, payload: "forbidden" }).success, false);
}

function writeConfig(projectRoot, value) {
    const path = join(projectRoot, ".ai", "capabilities.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
    return path;
}

function issueProjection(status) {
    return status.issues.map(({ code, capability_id, setting }) => ({ code, capability_id, setting }));
}

async function configChecks() {
    const config = await import("../dist/capability-config.js");
    const projectRoot = mkdtempSync(join(tmpdir(), "cairn-capability-contract-"));
    try {
        assert.equal(config.isCapabilityContractEnabled(undefined), false);
        assert.equal(config.isCapabilityContractEnabled("0"), false);
        assert.equal(config.isCapabilityContractEnabled("true"), true);
        assert.equal(readFileSync(fixturePath, "utf8").includes(RED_MARKER), false, "fixture must not classify failures");

        let status = await config.resolveCapabilityStatus({ projectRoot, env: { CAIRN_CAPABILITY_CONTRACT: "1" }, graphifyEnabled: false });
        const expected = structuredClone(fixture.canonical_status);
        expected.configuration_digest = canonicalDigest(expected);
        assert.deepEqual(status, expected);

        const malformedPath = writeConfig(projectRoot, fixture.cases.malformed.malformed_bytes);
        const before = readFileSync(malformedPath);
        assert.equal(config.isCapabilityContractEnabled(undefined), false, "master predicate consulted project configuration");
        assert.deepEqual(readFileSync(malformedPath), before, "master-off predicate performed configuration I/O");
        status = await config.resolveCapabilityStatus({ projectRoot, env: { CAIRN_CAPABILITY_CONTRACT: "1" }, graphifyEnabled: false });
        assert.equal(issueProjection(status).some(({ code }) => code === fixture.cases.malformed.issue_code), true);
        assert.equal(JSON.stringify(status).includes(fixture.cases.malformed.malformed_bytes), false);

        writeConfig(projectRoot, fixture.cases.unknown_id.config);
        status = await config.resolveCapabilityStatus({ projectRoot, env: { CAIRN_CAPABILITY_CONTRACT: "1" }, graphifyEnabled: false });
        assert.equal(issueProjection(status).some(({ code }) => code === fixture.cases.unknown_id.issue_code), true);
        assert.equal(status.capabilities.find(({ id }) => id === "memory.write").enabled, false);
        assert.equal(status.capabilities.filter(({ enabled }) => enabled).length, 5);

        writeConfig(projectRoot, fixture.cases.invalid_row.config);
        status = await config.resolveCapabilityStatus({
            projectRoot,
            env: { CAIRN_CAPABILITY_CONTRACT: "1", CAIRN_CAPABILITY_MEMORY_WRITE: "invalid-environment", CAIRN_NOTE_DISTILLATION: "1" },
            graphifyEnabled: false,
        });
        const memoryWrite = status.capabilities.find(({ id }) => id === "memory.write");
        const memorySearch = status.capabilities.find(({ id }) => id === "memory.search");
        const notes = status.capabilities.find(({ id }) => id === "notes.distill");
        assert.deepEqual({ enabled: memoryWrite.enabled, source: memoryWrite.source }, { enabled: true, source: "compatibility" });
        assert.deepEqual({ enabled: memorySearch.enabled, source: memorySearch.source }, { enabled: false, source: "project" });
        assert.deepEqual({ enabled: notes.enabled, source: notes.source }, { enabled: true, source: "compatibility" });
        assert.equal(JSON.stringify(status).includes("sentinel-raw-value"), false);
        assert.equal(JSON.stringify(status).includes("invalid-environment"), false);

        writeConfig(projectRoot, fixture.cases.reordered.left);
        const left = await config.resolveCapabilityStatus({ projectRoot, env: { CAIRN_CAPABILITY_CONTRACT: "1" }, graphifyEnabled: false });
        writeConfig(projectRoot, fixture.cases.reordered.right);
        const right = await config.resolveCapabilityStatus({ projectRoot, env: { CAIRN_CAPABILITY_CONTRACT: "1" }, graphifyEnabled: false });
        assert.equal(left.configuration_digest, right.configuration_digest, "equivalent effective configuration changed digest");
        assert.equal(left.configuration_digest, canonicalDigest(left));

        await config.resetCapabilityOverride({ projectRoot, id: "all" });
        await config.resetCapabilityLogging({ projectRoot });
        await Promise.all([
            config.setCapabilityOverride({ projectRoot, ...fixture.cases.concurrent_write.first }),
            config.setCapabilityOverride({ projectRoot, ...fixture.cases.concurrent_write.second }),
        ]);
        const persisted = JSON.parse(readFileSync(join(projectRoot, ".ai", "capabilities.json"), "utf8"));
        assert.equal(persisted.capabilities[fixture.cases.concurrent_write.first.id], false);
        assert.equal(persisted.capabilities[fixture.cases.concurrent_write.second.id], false);
        assert.equal(statSync(join(projectRoot, ".ai", "capabilities.json")).mode & 0o777, 0o600);
        assert.equal(readFileSync(join(projectRoot, ".ai", "capabilities.json"), "utf8").endsWith("\n"), true);

        await config.resetCapabilityOverride({ projectRoot, id: fixture.cases.concurrent_write.first.id });
        status = await config.resolveCapabilityStatus({ projectRoot, env: { CAIRN_CAPABILITY_CONTRACT: "1" }, graphifyEnabled: false });
        assert.deepEqual({
            first: status.capabilities.find(({ id }) => id === fixture.cases.concurrent_write.first.id).source,
            second: status.capabilities.find(({ id }) => id === fixture.cases.concurrent_write.second.id).source,
        }, { first: "compatibility", second: "project" });

        await config.setCapabilityLogging({ projectRoot, enabled: true });
        status = await config.resolveCapabilityStatus({ projectRoot, env: { CAIRN_CAPABILITY_CONTRACT: "1" }, graphifyEnabled: false });
        assert.deepEqual(status.logging, { enabled: true, source: "project" });
        const projectDigest = status.configuration_digest;
        status = await config.resolveCapabilityStatus({ projectRoot, env: { CAIRN_CAPABILITY_CONTRACT: "1", CAIRN_CAPABILITY_LOGGING: "false" }, graphifyEnabled: false });
        assert.deepEqual(status.logging, { enabled: false, source: "environment" });
        assert.notEqual(status.configuration_digest, projectDigest);

        await assert.rejects(() => config.setCapabilityOverride({ projectRoot, id: "unknown.owner", enabled: true }));
        await assert.rejects(() => config.setCapabilityLogging({ projectRoot, enabled: "sentinel-raw-value" }));
        assert.equal(readFileSync(join(projectRoot, ".ai", "capabilities.json"), "utf8").includes("sentinel-raw-value"), false);
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
}

async function run() {
    fixtureChecks();
    if (mode === "--baseline") return;
    await schemaRegistryChecks();
    if (mode !== "--schema-registry-only") await configChecks();
}

if (mode === "--expect-red") {
    fixtureChecks();
    try {
        await schemaRegistryChecks();
    } catch (error) {
        const missingContractModule = error?.code === "ERR_MODULE_NOT_FOUND"
            && /\/dist\/capability-(?:schema|registry)\.js(?:'|$)/.test(String(error.message));
        if (missingContractModule) {
            console.error(RED_MARKER);
            process.exit(86);
        }
        throw error;
    }
    throw new Error("Expected the Phase 18 capability contract to be absent, but schema/registry checks passed.");
} else {
    await run();
    if (mode === "--baseline") console.log("Phase 18 capability contract baseline passed");
    else console.log("Phase 18 capability contract checks passed");
}
