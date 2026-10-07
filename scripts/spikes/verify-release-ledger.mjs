import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Independent artifact grader for the bounded release-ledger task. Importing
// an explicitly selected module executes it: run only in an isolated lab.
export async function verifyReleaseLedger(path) {
  const checks = [];
  const check = async (id, fn) => {
    try { await fn(); checks.push({ id, pass: true }); }
    catch { checks.push({ id, pass: false }); }
  };
  let mod, ledger, first, final;
  const input = { package: "sample", version: "1.0.0", notes: ["First", "Second"] };
  const errorCode = (fn, code) => assert.throws(fn, error => error?.code === code);
  await check("export", async () => {
    mod = await import(pathToFileURL(resolve(path)).href);
    assert.equal(typeof mod.createLedger, "function");
    ledger = mod.createLedger();
  });
  await check("methods", () => { for (const method of ["append", "get", "list", "finalize"]) assert.equal(typeof ledger[method], "function"); });
  await check("append", () => { first = ledger.append(input); assert.equal(first.state, "draft"); assert.equal(first.sequence, 1); assert.deepEqual(first.notes, input.notes); });
  await check("shape", () => assert.deepEqual(Object.keys(first).sort(), ["package", "version", "notes", "sequence", "state"].sort()));
  await check("invalid-package", () => errorCode(() => ledger.append({ ...input, package: "Bad_Name" }), "INVALID_PACKAGE"));
  await check("invalid-version", () => errorCode(() => ledger.append({ ...input, version: "v1.0" }), "INVALID_VERSION"));
  await check("invalid-notes", () => errorCode(() => ledger.append({ ...input, notes: [] }), "INVALID_NOTES"));
  await check("duplicate", () => errorCode(() => ledger.append(input), "DUPLICATE_RELEASE"));
  await check("sequence", () => assert.equal(ledger.append({ ...input, package: "other" }).sequence, 2));
  await check("not-found", () => errorCode(() => ledger.get("missing", "1.0.0"), "NOT_FOUND"));
  await check("finalize", () => { final = ledger.finalize("sample", "1.0.0"); assert.equal(final.state, "final"); });
  await check("checksum", () => assert.equal(final.checksum, createHash("sha256").update(JSON.stringify({ ...input, sequence: 1 })).digest("hex")));
  await check("idempotent", () => assert.deepEqual(ledger.finalize("sample", "1.0.0"), final));
  await check("detached-get", () => { const copy = ledger.get("sample", "1.0.0"); copy.notes.push("tamper"); copy.state = "draft"; const fresh = ledger.get("sample", "1.0.0"); assert.deepEqual(fresh.notes, ["First", "Second"]); assert.equal(fresh.state, "final"); });
  await check("ordered-detached-list", () => { const copies = ledger.list(); assert.deepEqual(copies.map(entry => entry.sequence), [1, 2]); copies[0].notes[0] = "tamper"; assert.equal(ledger.list()[0].notes[0], "First"); });
  return { checks, passed: checks.filter(check => check.pass).length, total: checks.length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) { process.stderr.write("Usage: verify-release-ledger.mjs MODULE_PATH\n"); process.exitCode = 2; }
  else {
    const value = await verifyReleaseLedger(process.argv[2]);
    process.stdout.write(`${JSON.stringify(value)}\n`);
    process.exitCode = value.passed === value.total ? 0 : 1;
  }
}
