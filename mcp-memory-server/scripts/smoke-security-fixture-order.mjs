import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

// Top-level-await sibling imports can run concurrently. These fixtures patch
// shared built-ins; observe real assignments so an overlapping fixture cannot
// silently capture or restore another fixture's hooks.
const descriptors = new Map();
const overlaps = [];
for (const [object, names] of [[fs, ["lstatSync", "openSync", "closeSync", "readSync", "readFileSync"]],
    [fs.promises, ["lstat", "open", "readFile", "writeFile", "copyFile"]]]) {
    for (const name of names) {
        const descriptor = Object.getOwnPropertyDescriptor(object, name);
        descriptors.set([object, name], descriptor);
        let current = descriptor.value;
        let owner;
        Object.defineProperty(object, name, {
            configurable: true, enumerable: descriptor.enumerable,
            get: () => current,
            set(value) {
                const caller = new Error().stack?.match(/smoke-(?!security-fixture-order)[a-z-]+\.mjs/)?.[0];
                if (owner && caller && owner !== caller) {
                    overlaps.push(`${name}: ${owner} overlaps ${caller}`);
                }
                owner = value === descriptor.value ? undefined : caller;
                current = value;
            },
        });
    }
}
try {
    await import("./smoke-security-assurance.mjs");
    assert.deepEqual(overlaps, [], "security fixtures must not overlap process-global filesystem hooks");
    for (const [[object, name], descriptor] of descriptors) {
        assert.equal(object[name], descriptor.value, `${name} must be restored after the fixture`);
    }
} catch (error) {
    console.error("Filesystem hook overlaps:", JSON.stringify(overlaps));
    throw error;
} finally {
    for (const [[object, name], descriptor] of descriptors) Object.defineProperty(object, name, descriptor);
    syncBuiltinESMExports();
}
console.log("PASS: aggregate security fixtures serialize and restore global filesystem hooks");
