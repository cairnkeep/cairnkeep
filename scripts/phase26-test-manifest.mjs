const REQUIRED_PHASE26_TEST_PATHS = Object.freeze([
  "scripts/test-setup-preflight.mjs",
  "scripts/test-setup-reconcile.mjs",
  "scripts/test-setup-compatibility.mjs",
  "scripts/test-pi-lifecycle.mjs",
  "mcp-memory-server/scripts/smoke-pi-mcp-bridge.mjs",
]);

export const PHASE26_TEST_MANIFEST = Object.freeze(REQUIRED_PHASE26_TEST_PATHS.map((path) => Object.freeze({
  path,
  state: "routine",
})));

export function validatePhase26TestManifest(entries = PHASE26_TEST_MANIFEST) {
  if (!Array.isArray(entries)) throw new Error("Phase 26 test manifest must be an array.");
  if (entries.length !== REQUIRED_PHASE26_TEST_PATHS.length) throw new Error("Phase 26 test manifest entry count drifted.");
  const paths = entries.map((entry) => entry?.path);
  if (JSON.stringify(paths) !== JSON.stringify(REQUIRED_PHASE26_TEST_PATHS)) throw new Error("Phase 26 test manifest paths or order drifted.");
  if (new Set(paths).size !== paths.length) throw new Error("Phase 26 test manifest contains duplicate paths.");
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Phase 26 test manifest entry must be an object.");
    if (Object.keys(entry).sort().join(",") !== "path,state") throw new Error(`Phase 26 test manifest fields drifted for ${entry.path ?? "unknown"}.`);
    if (entry.state !== "red-only" && entry.state !== "routine") throw new Error(`Invalid Phase 26 test state for ${entry.path}.`);
  }
  return entries;
}
