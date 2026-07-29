import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFailureSignature } from "../dist/failure-signature.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures", "notes", "signature-cases.json"), "utf8"));

assert.ok(fixture.equivalent.length >= 8, "expected at least eight equivalence scenarios");
assert.ok(fixture.distinct.length >= fixture.equivalent.length, "negative pairs must be at least as numerous as positive pairs");

for (const entry of fixture.equivalent) {
    const left = buildFailureSignature(entry.left.text, entry.left);
    const right = buildFailureSignature(entry.right.text, entry.right);
    assert.equal(left.fingerprint, right.fingerprint, `${entry.name}: expected equal fingerprints`);
    assert.equal(left.signature_version, 1);
    assert.ok(left.lookup_keys.full.startsWith("v1:full:"));
    assert.doesNotMatch(JSON.stringify(left), new RegExp(entry.left.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

for (const entry of fixture.distinct) {
    const left = buildFailureSignature(entry.left.text, entry.left);
    const right = buildFailureSignature(entry.right.text, entry.right);
    assert.notEqual(left.fingerprint, right.fingerprint, `${entry.name}: unrelated failures collided`);
}

const stable = buildFailureSignature(
    "TypeError: Cannot read properties of undefined (reading 'name')\n    at loadUser (/repo/src/user.ts:41:9)",
    { root: "/repo" },
);
assert.equal(stable.family, "typeerror");
assert.equal(stable.component, "src/user.ts");
assert.ok(stable.stack_digest.length >= 16);
assert.match(stable.normalized_message, /reading 'name'/);

console.log("PASS: deterministic hindsight signature precision and normalization");
