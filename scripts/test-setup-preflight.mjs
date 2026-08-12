#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXPECTED_RED_EXIT = 86;
const RED_MARKER = "PHASE26_RED:SETUP_CORE_MISSING";
const here = dirname(fileURLToPath(import.meta.url));
const setupCorePath = join(here, "setup-core.mjs");
const setupPath = join(here, "setup.mjs");
const MANAGED_PATHS = [".ai", ".planning", ".agentfs"];

function assertNoManagedPaths(target, label) {
  for (const relative of MANAGED_PATHS) {
    assert.equal(existsSync(join(target, relative)), false, `${label} created ${relative}`);
  }
}

function assertUsageError(fn, field) {
  assert.throws(fn, (error) => {
    assert.equal(error?.kind, "usage");
    assert.equal(error?.status, 2);
    assert.match(String(error?.message), new RegExp(field, "i"));
    assert.match(String(error?.message), /usage|requires|invalid|missing/i);
    return true;
  });
}

function validateFixtures() {
  const sandbox = mkdtempSync(join(tmpdir(), "cairn-setup-preflight-fixture-"));
  try {
    const missing = join(sandbox, "missing");
    const empty = join(sandbox, "empty");
    const nonempty = join(sandbox, "nonempty");
    const linked = join(sandbox, "linked");
    mkdirSync(empty);
    mkdirSync(nonempty);
    writeFileSync(join(nonempty, "operator.txt"), "preserve\n");
    symlinkSync(nonempty, linked, "dir");
    assert.equal(existsSync(missing), false);
    assert.deepEqual(lstatSync(empty).isDirectory(), true);
    assert.deepEqual(lstatSync(nonempty).isDirectory(), true);
    assert.deepEqual(lstatSync(linked).isSymbolicLink(), true);
    assertNoManagedPaths(sandbox, "fixture self-validation");

    const invocations = [];
    const run = (executable, args, options) => {
      invocations.push({ executable, args: [...args], options: { ...options } });
      return { status: 0, stdout: "git version fixture\n", stderr: "" };
    };
    run("git", ["--version"], { encoding: "utf8", shell: false });
    assert.deepEqual(invocations, [{
      executable: "git",
      args: ["--version"],
      options: { encoding: "utf8", shell: false },
    }]);
    return { sandbox, missing, empty, nonempty, linked };
  } catch (error) {
    rmSync(sandbox, { recursive: true, force: true });
    throw error;
  }
}

async function loadSetupCore() {
  return import(pathToFileURL(setupCorePath).href);
}

async function loadSetup() {
  return import(pathToFileURL(setupPath).href);
}

function assertExports(core) {
  for (const name of [
    "parseSetupArgs",
    "readSetupPolicy",
    "classifySetupTarget",
    "resolveSetupChoices",
    "buildSetupPlan",
  ]) assert.equal(typeof core[name], "function", `setup-core must export ${name}`);
}

function completeArgs(target) {
  return [target, "--git", "init", "--harness", "claude,pi", "--memory", "local", "--yes"];
}

function testChoiceContract(core, fixture) {
  const { parseSetupArgs, resolveSetupChoices } = core;
  const complete = parseSetupArgs(completeArgs(fixture.missing), { isTTY: false });
  assert.equal(complete.target, fixture.missing);
  assert.equal(complete.git, "init");
  assert.deepEqual(complete.harnesses, ["claude", "pi"]);
  assert.equal(complete.memory, "local");
  assert.equal(complete.confirmed, true);

  const syntaxCases = [
    { args: [fixture.empty, "--unknown"], field: "unknown" },
    { args: [fixture.empty, "--git"], field: "git" },
    { args: [fixture.empty, "--git", "sometimes"], field: "git" },
    { args: [fixture.empty, "--harness", "claude,unknown"], field: "harness" },
    { args: [fixture.empty, "--memory", "remote"], field: "memory" },
    { args: [fixture.empty, fixture.nonempty], field: "target|path|positional" },
  ];
  for (const { args, field } of syntaxCases) {
    assertUsageError(() => parseSetupArgs(args, { isTTY: false }), field);
    assertNoManagedPaths(fixture.sandbox, `invalid syntax ${args.join(" ")}`);
  }

  const incompleteCases = [
    { args: [], field: "target" },
    { args: [fixture.empty, "--harness", "claude", "--memory", "local", "--yes"], field: "git" },
    { args: [fixture.empty, "--git", "init", "--memory", "local", "--yes"], field: "harness" },
    { args: [fixture.empty, "--git", "init", "--harness", "claude", "--yes"], field: "memory" },
    { args: [fixture.empty, "--git", "init", "--harness", "claude", "--memory", "local"], field: "confirm|yes" },
    { args: [fixture.empty, "--yes"], field: "git|harness|memory" },
  ];
  for (const { args, field } of incompleteCases) {
    assertUsageError(() => parseSetupArgs(args, { isTTY: false }), field);
    assertNoManagedPaths(fixture.sandbox, `incomplete non-TTY choices ${args.join(" ")}`);
  }

  const resolved = resolveSetupChoices({
    parsed: complete,
    preflight: { targetState: "missing", gitExecutable: "available", repository: "none" },
    policy: null,
    interactive: null,
  });
  assert.deepEqual(resolved.harnesses, ["claude", "pi"]);
  assert.equal(resolved.git, "init");
  assert.equal(resolved.memory, "local");
  assert.equal(resolved.confirmed, true);
  assert.equal(Object.isFrozen(resolved), true);
}

function scriptedGit(kind, calls) {
  return (executable, args, options) => {
    calls.push({ executable, args: [...args], options: { ...options } });
    assert.equal(executable, "git");
    assert.equal(options?.shell, false);
    if (kind === "missing") return { status: null, stdout: "", stderr: "", error: { code: "ENOENT" } };
    if (args.includes("--version")) return { status: 0, stdout: "git version fixture\n", stderr: "" };
    if (kind === "bare") return { status: 0, stdout: "false\n", stderr: "" };
    if (kind === "work-tree") return { status: 0, stdout: "true\n", stderr: "" };
    return { status: 128, stdout: "", stderr: "not a repository" };
  };
}

function testPreflightContract(core, fixture) {
  const { classifySetupTarget, buildSetupPlan } = core;
  const cases = [
    [fixture.missing, "missing", "none"],
    [fixture.empty, "empty", "none"],
    [fixture.nonempty, "non-empty", "none"],
    [fixture.empty, "empty", "work-tree"],
    [fixture.nonempty, "non-empty", "bare"],
    [fixture.nonempty, "non-empty", "missing"],
  ];
  for (const [target, targetState, gitKind] of cases) {
    const calls = [];
    const result = classifySetupTarget(target, { run: scriptedGit(gitKind, calls) });
    assert.equal(result.targetState, targetState);
    assert.equal(result.gitExecutable, gitKind === "missing" ? "missing" : "available");
    assert.equal(result.repository, gitKind === "work-tree" ? "work-tree" : gitKind === "bare" ? "bare" : gitKind === "missing" ? "unknown" : "none");
    assert.equal(Object.isFrozen(result), true);
    assert.ok(calls.every(({ options }) => options.shell === false));
    assertNoManagedPaths(fixture.sandbox, `preflight ${targetState}/${gitKind}`);
  }

  assert.throws(
    () => classifySetupTarget(fixture.linked, { run: scriptedGit("none", []) }),
    (error) => error?.kind === "unsafe-target" && error?.status !== 2,
  );
  assertNoManagedPaths(fixture.sandbox, "unsafe symlink target");

  const plan = buildSetupPlan({
    target: fixture.missing,
    preflight: { targetState: "missing", gitExecutable: "available", repository: "none" },
    choices: Object.freeze({ git: "init", harnesses: ["claude", "pi"], memory: "local", confirmed: true }),
  });
  assert.equal(plan.target, resolve(fixture.missing));
  assert.deepEqual(plan.harnesses, ["claude", "pi"]);
  assert.equal(plan.git, "init");
  assert.equal(plan.memory, "local");
  assert.ok(Array.isArray(plan.assets));
  assert.equal(Object.isFrozen(plan), true);
  assertNoManagedPaths(fixture.sandbox, "mutation planning");
}

function captureStream() {
  let output = "";
  return {
    stream: { write(value) { output += String(value); return true; } },
    read() { return output; },
  };
}

async function runInteractive(setup, args, responses) {
  const prompts = [];
  const remaining = [...responses];
  const output = captureStream();
  const error = captureStream();
  const status = await setup.runSetup(args, {
    isTTY: true,
    input: { isTTY: false },
    output: output.stream,
    error: error.stream,
    question: async (prompt) => {
      prompts.push(prompt);
      assert.ok(remaining.length > 0, `unexpected interactive prompt: ${prompt}`);
      return remaining.shift();
    },
  });
  assert.deepEqual(remaining, [], "not all scripted interactive answers were consumed");
  return { status, prompts, output: output.read(), error: error.read() };
}

async function testInteractiveGitRecommendation(setup, fixture) {
  const accepted = await runInteractive(setup, [], [fixture.missing, "init", "pi", "local", "yes"]);
  assert.equal(accepted.status, 0);
  assert.equal(accepted.error, "");
  assert.match(accepted.prompts[0], /target path/i);
  assert.match(accepted.prompts[1], /init recommended/i);
  assert.equal(existsSync(join(fixture.missing, ".git")), true);
  assert.equal(existsSync(join(fixture.missing, ".ai", "cairnkeep.json")), true);

  const refused = await runInteractive(setup, [fixture.empty], ["init", "pi", "local", "no"]);
  assert.equal(refused.status, 0);
  assert.equal(refused.error, "");
  assert.ok(refused.prompts.some((prompt) => /init recommended/i.test(prompt)));
  assert.match(refused.output, /cancelled; no files were changed/i);
  assert.equal(existsSync(join(fixture.empty, ".git")), false);
  assertNoManagedPaths(fixture.empty, "refused interactive setup");

  const existing = await runInteractive(setup, [fixture.nonempty], ["none", "pi", "local", "yes"]);
  assert.equal(existing.status, 0);
  assert.equal(existing.error, "");
  const gitPrompt = existing.prompts.find((prompt) => /Git mode/i.test(prompt));
  assert.match(gitPrompt, /init requires explicit choice/i);
  assert.doesNotMatch(gitPrompt, /init recommended/i);
  assert.equal(existsSync(join(fixture.nonempty, ".git")), false);
  assert.equal(readFileSync(join(fixture.nonempty, "operator.txt"), "utf8"), "preserve\n");
  assert.equal(existsSync(join(fixture.nonempty, ".ai", "cairnkeep.json")), true);
}

async function main() {
  const fixture = validateFixtures();
  try {
    let core;
    try {
      core = await loadSetupCore();
    } catch (error) {
      if (error?.code === "ERR_MODULE_NOT_FOUND" && String(error.message).includes("setup-core.mjs")) {
        console.log(RED_MARKER);
        process.exitCode = EXPECTED_RED_EXIT;
        return;
      }
      throw error;
    }
    assertExports(core);
    testChoiceContract(core, fixture);
    testPreflightContract(core, fixture);
    const setup = await loadSetup();
    await testInteractiveGitRecommendation(setup, fixture);
    console.log("PASS: setup target, Git, syntax, choice, and no-write preflight contract");
  } finally {
    rmSync(fixture.sandbox, { recursive: true, force: true });
  }
}

await main();
