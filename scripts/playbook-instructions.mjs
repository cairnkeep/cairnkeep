#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(ROOT, "templates", "playbook-agent-instructions.md.template");
const START = "<!-- cairnkeep:playbook:v1:start -->";
const END = "<!-- cairnkeep:playbook:v1:end -->";
const MAX_BYTES = 1024 * 1024;

function safeRead(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) throw new Error("AGENTS.md is not a safe bounded regular file.");
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size > MAX_BYTES) throw new Error("AGENTS.md changed during validation.");
    return { text: readFileSync(descriptor, "utf8"), mode: info.mode & 0o777 };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function count(text, marker) {
  return text.split(marker).length - 1;
}

function render(current, block) {
  const starts = count(current, START);
  const ends = count(current, END);
  if (starts === 0 && ends === 0) return `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block.trim()}\n`;
  if (starts !== 1 || ends !== 1) throw new Error("AGENTS.md contains malformed or duplicate Cairnkeep playbook markers.");
  const start = current.indexOf(START);
  const end = current.indexOf(END, start);
  if (end < start) throw new Error("AGENTS.md contains reversed Cairnkeep playbook markers.");
  return `${current.slice(0, start)}${block.trim()}${current.slice(end + END.length)}`.replace(/\s*$/, "\n");
}

function removeBlock(current) {
  const starts = count(current, START);
  const ends = count(current, END);
  if (starts === 0 && ends === 0) return current;
  if (starts !== 1 || ends !== 1) throw new Error("AGENTS.md contains malformed or duplicate Cairnkeep playbook markers.");
  const start = current.indexOf(START);
  const end = current.indexOf(END, start);
  if (end < start) throw new Error("AGENTS.md contains reversed Cairnkeep playbook markers.");
  return `${current.slice(0, start)}${current.slice(end + END.length)}`.replace(/\n{3,}/g, "\n\n").trimEnd();
}

function atomicWrite(path, text, mode) {
  const temporary = join(dirname(path), `.AGENTS.md.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(temporary, text, { encoding: "utf8", mode, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function reconcilePlaybookInstructions(projectRoot = process.cwd(), options = {}) {
  const root = resolve(projectRoot);
  const path = join(root, "AGENTS.md");
  if (dirname(path) !== root) throw new Error("AGENTS.md path escapes the project root.");
  const block = readFileSync(TEMPLATE, "utf8");
  const existing = existsSync(path) ? safeRead(path) : { text: "", mode: 0o644 };
  const desired = render(existing.text, block);
  const status = !existsSync(path) ? "created" : desired === existing.text ? "unchanged" : "updated";
  if (!options.check && status !== "unchanged") atomicWrite(path, desired, existing.mode || 0o644);
  return Object.freeze({ schema_version: 1, path, status: options.check && status !== "unchanged" ? `would-${status}` : status });
}

export function removePlaybookInstructions(projectRoot = process.cwd(), options = {}) {
  const root = resolve(projectRoot);
  const path = join(root, "AGENTS.md");
  if (!existsSync(path)) return Object.freeze({ schema_version: 1, path, status: "unchanged" });
  const existing = safeRead(path);
  const desired = removeBlock(existing.text);
  const status = desired === existing.text ? "unchanged" : "removed";
  if (!options.check && status === "removed") {
    if (desired.trim()) atomicWrite(path, `${desired}\n`, existing.mode || 0o644);
    else rmSync(path);
  }
  return Object.freeze({ schema_version: 1, path, status: options.check && status === "removed" ? "would-remove" : status });
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const remove = args.includes("--remove");
  const json = args.includes("--json");
  const values = args.filter((arg) => !["--check", "--remove", "--json"].includes(arg));
  if (values.length > 1) throw new Error("Usage: playbook-instructions.mjs [PROJECT] [--check] [--json]");
  const value = remove
    ? removePlaybookInstructions(values[0] ?? process.cwd(), { check })
    : reconcilePlaybookInstructions(values[0] ?? process.cwd(), { check });
  process.stdout.write(`${json ? JSON.stringify(value) : `${value.status}: ${value.path}`}\n`);
  if (check && value.status !== "unchanged") process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`cairn playbook instructions: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
