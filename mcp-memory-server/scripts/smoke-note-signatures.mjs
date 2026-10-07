import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFailureSignature } from "../dist/failure-signature.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures", "notes", "signature-cases.json"), "utf8"));

assert.ok(fixture.equivalent.length >= 8, "expected at least eight equivalence scenarios");
assert.ok(fixture.distinct.length >= fixture.equivalent.length, "negative pairs must be at least as numerous as positive pairs");

const legacySignatures = [...fixture.equivalent, ...fixture.distinct]
    .flatMap((entry) => [entry.left, entry.right].map((input) => buildFailureSignature(input.text, input)));
assert.equal(createHash("sha256").update(JSON.stringify(legacySignatures)).digest("hex"),
    "b567e75be528e1464a78809f3d5edd126a65a0aa165a47b2e2bfef838f33ea53",
    "all existing v1 fixture signatures must remain byte-equivalent");

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

// Isolate adversarial parsing so a regression cannot wedge the smoke runner.
const adversarial = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { buildFailureSignature } from ${JSON.stringify(new URL("../dist/failure-signature.js", import.meta.url).href)};
    for (const count of [32, 128, 4096]) {
        for (const prefix of ["/", ", ", "Error: failed\\n0: app::run\\n/"]) {
            const input = prefix + "!/".repeat(count);
            const signature = buildFailureSignature(input);
            assert.equal(signature.component, "");
            assert.equal(signature.signature_version, 1);
        }
    }
    // Reproducible generated inputs, not a coverage-guided fuzzing claim.
    let seed = 0xCA17;
    const alphabet = ["!/", ",", ":", "src/", "tests/", " ", "\\n", "1", "!"];
    for (let sample = 0; sample < 256; sample++) {
        let input = "Error: generated ";
        for (let index = 0; index < 64; index++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            input += alphabet[seed % alphabet.length];
        }
        assert.deepEqual(buildFailureSignature(input), buildFailureSignature(input));
    }
`], { encoding: "utf8", timeout: 5000 });
assert.equal(adversarial.error, undefined, `adversarial parsing must terminate: ${adversarial.error?.code}`);
assert.equal(adversarial.status, 0, adversarial.stderr);

console.log("PASS: deterministic hindsight signature precision and normalization");
