import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { applyEvalWorkspaceOverlay } from "../dist/eval-workspace.js";

const root = fs.mkdtempSync(join(tmpdir(), "cairn-workspace-file-security-"));
const source = join(root, "source");
const target = join(source, "docs", "guide.md");
const outside = join(root, "outside.md");
fs.mkdirSync(dirname(target), { recursive: true });
fs.writeFileSync(target, "Before overlay.\n");
fs.writeFileSync(outside, "Outside sentinel.\n");
const original = {
  open: fs.openSync, asyncOpen: fs.promises.open,
  writeFile: fs.promises.writeFile,
};
function restore() {
  fs.openSync = original.open;
  fs.promises.open = original.asyncOpen;
  fs.promises.writeFile = original.writeFile;
  syncBuiltinESMExports();
}
const content = "# Validated overlay\n";
const overlay = {
  relative_path: "docs/guide.md", content,
  digest: createHash("sha256").update(content).digest("hex"),
};
const workspace = { source_path: source };
const failures = [];
async function control(name, operation) {
  try { await operation(); }
  catch (error) { failures.push(`${name}: ${error.message}`); }
}
try {
  await applyEvalWorkspaceOverlay(workspace, overlay);
  assert.equal(fs.readFileSync(target, "utf8"), content);
  if (process.platform !== "win32") assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  await assert.rejects(() => applyEvalWorkspaceOverlay(workspace, { ...overlay, digest: "0".repeat(64) }), /digest/);
  assert.equal(fs.readFileSync(target, "utf8"), content);
  await applyEvalWorkspaceOverlay(workspace, { ...overlay, relative_path: "new/nested/guide.md" });
  assert.equal(fs.readFileSync(join(source, "new", "nested", "guide.md"), "utf8"), content);

  if (process.platform !== "win32") {
    let injected = false;
    function substitute(path) {
      if (!injected && (path === target
          || (dirname(path) === dirname(target) && basename(path).startsWith(".cairn-overlay-")))) {
        injected = true;
        fs.renameSync(target, target + ".inspected");
        fs.symlinkSync(outside, target);
      }
    }
    fs.openSync = (path, ...args) => { substitute(path); return original.open(path, ...args); };
    fs.promises.open = (path, ...args) => { substitute(path); return original.asyncOpen(path, ...args); };
    fs.promises.writeFile = (path, ...args) => { substitute(path); return original.writeFile(path, ...args); };
    syncBuiltinESMExports();
    await control("overlay target substitution", async () => {
      try { await assert.rejects(() => applyEvalWorkspaceOverlay(workspace, overlay), /unsafe|changed|mismatch/i); }
      finally {
        restore();
        assert.equal(injected, true, "the real writer must encounter target substitution");
        assert.equal(fs.readFileSync(outside, "utf8"), "Outside sentinel.\n", "substitution must not overwrite the external target");
        assert.deepEqual(fs.readdirSync(dirname(target)).filter((name) => name.startsWith(".cairn-overlay-")), [], "failed publication must clean up its temporary file");
      }
    });
    fs.unlinkSync(target);
    fs.renameSync(target + ".inspected", target);
    fs.writeFileSync(outside, "Outside sentinel.\n");
    const linkedSource = join(root, "linked-source");
    fs.symlinkSync(source, linkedSource, "dir");
    await control("overlay source symlink", async () => {
      await assert.rejects(() => applyEvalWorkspaceOverlay({ source_path: linkedSource }, overlay), /unsafe/i);
    });
  }
  assert.deepEqual(failures, [], "evaluation overlays must not follow substituted targets");
} finally {
  restore();
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("PASS: evaluation overlay publication rejects substituted and symlinked targets");
