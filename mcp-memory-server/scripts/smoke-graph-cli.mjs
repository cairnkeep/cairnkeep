import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const cliPath = join(scriptDirectory, "..", "dist", "graph-cli.js");
const temporaryRoot = mkdtempSync(join(tmpdir(), "cairn-graph-cli-"));

function writeProject(name, enabled = true) {
    const root = join(temporaryRoot, name);
    mkdirSync(join(root, ".planning", "graphs"), { recursive: true });
    writeFileSync(join(root, ".planning", "config.json"), `${JSON.stringify({ graphify: { enabled } })}\n`);
    writeFileSync(join(root, ".planning", "graphs", "graph.json"), "{\"nodes\":[],\"edges\":[]}\n");
    return root;
}

function run(projectRoot, args, env = {}) {
    return spawnSync(process.execPath, [cliPath, ...args], {
        cwd: projectRoot,
        encoding: "utf8",
        env: { ...process.env, ...env },
    });
}

try {
    const fakeBin = join(temporaryRoot, "bin");
    const invocationLog = join(temporaryRoot, "graphify-args.jsonl");
    mkdirSync(fakeBin, { recursive: true });
    const fakeGraphify = join(fakeBin, "graphify");
    writeFileSync(fakeGraphify, `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY) {
    process.stderr.write("provider credential leaked to Graphify\\n");
    process.exit(90);
}
if (process.argv[2] === "update") {
    for (const name of ["graph.json", "graph.html", "GRAPH_REPORT.md", ".last-build-snapshot.json"]) {
        if (existsSync(join(process.cwd(), ".planning", "graphs", name))) {
            process.stderr.write("published graph artifact would be self-indexed\\n");
            process.exit(91);
        }
    }
    if (existsSync(join(process.cwd(), ".fail-graphify"))) {
        process.stderr.write("simulated Graphify failure\\n");
        process.exit(7);
    }
    const output = join(process.cwd(), "graphify-out");
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "graph.json"), JSON.stringify({ nodes: [{ id: "new", label: "newNode" }], edges: [] }) + "\\n");
    writeFileSync(join(output, "graph.html"), "<p>local graph</p>\\n");
    writeFileSync(join(output, "GRAPH_REPORT.md"), "# Local graph\\n");
}
process.stdout.write("graphify-result\\n");
`);
    chmodSync(fakeGraphify, 0o755);
    const fakeEnvironment = {
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
        OPENAI_API_KEY: "must-not-reach-graphify",
        OPENROUTER_API_KEY: "must-not-reach-graphify",
    };

    const enabledProject = writeProject("enabled");
    let result = run(enabledProject, ["explain", "putTrajectory"], fakeEnvironment);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "graphify-result\n");
    assert.equal(result.stderr, "");

    const injectionMarker = join(temporaryRoot, "must-not-exist");
    const hostileFrom = `From Symbol; touch ${injectionMarker}`;
    result = run(enabledProject, ["path", hostileFrom, "To Symbol"], fakeEnvironment);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(injectionMarker), false, "graph arguments were interpreted by a shell");

    const graphPath = join(enabledProject, ".planning", "graphs", "graph.json");
    assert.deepEqual(readFileSync(invocationLog, "utf8").trim().split("\n").map((line) => JSON.parse(line)), [
        ["explain", "putTrajectory", "--graph", graphPath],
        ["path", hostileFrom, "To Symbol", "--graph", graphPath],
    ]);

    result = run(enabledProject, ["query", "putTrajectory"], fakeEnvironment);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "graphify-result\n");

    result = run(enabledProject, ["build"], fakeEnvironment);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Built local code graph: 1 node, 0 edges/);
    assert.deepEqual(JSON.parse(readFileSync(graphPath, "utf8")), {
        nodes: [{ id: "new", label: "newNode" }],
        edges: [],
    });
    assert.equal(readFileSync(join(enabledProject, ".planning", "graphs", "graph.html"), "utf8"), "<p>local graph</p>\n");
    assert.equal(readFileSync(join(enabledProject, ".planning", "graphs", "GRAPH_REPORT.md"), "utf8"), "# Local graph\n");

    result = run(enabledProject, ["status"], fakeEnvironment);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 node, 0 edges/);

    result = run(enabledProject, ["diff"], fakeEnvironment);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Nodes: 1 added, 0 removed, 0 changed/);

    result = run(enabledProject, ["build", "--force"], fakeEnvironment);
    assert.equal(result.status, 0, result.stderr);

    const publishedPaths = ["graph.json", "graph.html", "GRAPH_REPORT.md", ".last-build-snapshot.json"]
        .map((name) => join(enabledProject, ".planning", "graphs", name));
    const beforeFailedBuild = new Map(publishedPaths.map((path) => [path, readFileSync(path)]));
    writeFileSync(join(enabledProject, ".fail-graphify"), "fail\n");
    result = run(enabledProject, ["build"], fakeEnvironment);
    rmSync(join(enabledProject, ".fail-graphify"));
    assert.equal(result.status, 7);
    assert.match(result.stderr, /simulated Graphify failure/);
    for (const path of publishedPaths) {
        assert.deepEqual(readFileSync(path), beforeFailedBuild.get(path), `failed build did not restore ${path}`);
    }

    const invocationsAfterOperations = readFileSync(invocationLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(invocationsAfterOperations.slice(2), [
        ["query", "putTrajectory", "--graph", graphPath],
        ["update", "."],
        ["update", ".", "--force"],
        ["update", "."],
    ]);

    result = run(enabledProject, ["explain", "putTrajectory"], {
        ...fakeEnvironment,
        CAIRN_CAPABILITY_CONTRACT: "1",
        CAIRN_CAPABILITY_GRAPH: "0",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /graph capability is disabled/i);
    assert.equal(readFileSync(invocationLog, "utf8").trim().split("\n").length, 6, "disabled command invoked Graphify");

    result = run(enabledProject, ["explain", "putTrajectory"], {
        ...fakeEnvironment,
        CAIRN_CAPABILITY_GRAPH: "0",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(invocationLog, "utf8").trim().split("\n").length, 7, "master-off compatibility path did not run");

    const disabledProject = writeProject("compatibility-disabled", false);
    result = run(disabledProject, ["path", "A", "B"], fakeEnvironment);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /graph capability is disabled/i);

    const missingGraphProject = writeProject("missing-graph");
    rmSync(join(missingGraphProject, ".planning", "graphs", "graph.json"));
    result = run(missingGraphProject, ["explain", "A"], fakeEnvironment);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /run \/graphify build/i);

    const emptyBin = join(temporaryRoot, "empty-bin");
    mkdirSync(emptyBin);
    result = run(enabledProject, ["explain", "A"], { PATH: emptyBin });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /uv tool install graphifyy/);
    assert.doesNotMatch(result.stderr, /graphify install/);

    result = run(enabledProject, ["path", "only-one"], fakeEnvironment);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /cairn graph path <from> <to>/);

    result = run(enabledProject, ["--help"], { PATH: emptyBin });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /cairn graph build \[--force\]/);
    assert.match(result.stdout, /cairn graph explain <symbol>/);

    console.log("Graph CLI checks passed");
} finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
}
