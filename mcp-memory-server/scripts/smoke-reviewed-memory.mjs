import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
function check(name, condition) {
    console.log(`${condition ? "ok" : "FAIL"}: ${name}`);
    if (!condition) failures += 1;
}

const baseDir = mkdtempSync(join(tmpdir(), "cairn-reviewed-"));
const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, CAIRN_AGENTFS_BASE_DIR: baseDir },
});
const client = new Client({ name: "smoke-reviewed-memory", version: "0" }, { capabilities: {} });
await client.connect(transport);

async function call(name, args) {
    return client.callTool({ name, arguments: args });
}

async function read(key) {
    const response = await call("memory_read", { scope: "identity", key });
    return response.structuredContent?.results ?? [];
}

try {
    await call("memory_write", { scope: "identity", key: "decisions/adapter", value: "original" });

    const first = await call("memory_apply_reviewed", {
        scope: "identity",
        review_id: "candidate-1",
        key: "decisions/adapter",
        value: "reviewed one",
    });
    check("first reviewed revision is applied", first.structuredContent?.applied === true);
    check("displaced memory is snapshotted", typeof first.structuredContent?.snapshot_key === "string");
    check("reviewed value becomes live", (await read("decisions/adapter"))[0]?.value === "reviewed one");

    const replay = await call("memory_apply_reviewed", {
        scope: "identity",
        review_id: "candidate-1",
        key: "decisions/adapter",
        value: "reviewed one",
    });
    check("identical review replay is idempotent", replay.structuredContent?.idempotent === true);

    const conflictingReplay = await call("memory_apply_reviewed", {
        scope: "identity",
        review_id: "candidate-1",
        key: "decisions/adapter",
        value: "different",
    });
    check("review id cannot be reused with different content", conflictingReplay.isError === true);

    await call("memory_apply_reviewed", {
        scope: "identity",
        review_id: "candidate-2",
        key: "decisions/adapter",
        value: "reviewed two",
    });
    const staleInvalidation = await call("memory_invalidate_reviewed", {
        scope: "identity",
        review_id: "candidate-1",
        key: "decisions/adapter",
        reason: "source became stale",
    });
    check("invalidating a superseded review does not remove the successor", staleInvalidation.structuredContent?.removed === false);
    check("successor remains live", (await read("decisions/adapter"))[0]?.value === "reviewed two");

    await call("memory_write", { scope: "identity", key: "decisions/adapter", value: "manual correction" });
    const changedInvalidation = await call("memory_invalidate_reviewed", {
        scope: "identity",
        review_id: "candidate-2",
        key: "decisions/adapter",
    });
    check("changed live value is detected", changedInvalidation.structuredContent?.current_changed === true);
    check("changed live value is not deleted", (await read("decisions/adapter"))[0]?.value === "manual correction");

    await call("memory_apply_reviewed", {
        scope: "identity",
        review_id: "candidate-3",
        key: "patterns/reviewed",
        value: "temporary reviewed memory",
    });
    const activeInvalidation = await call("memory_invalidate_reviewed", {
        scope: "identity",
        review_id: "candidate-3",
        key: "patterns/reviewed",
    });
    check("matching active reviewed memory is removed", activeInvalidation.structuredContent?.removed === true);
    check("invalidated reviewed memory is no longer live", (await read("patterns/reviewed")).length === 0);

    const invalidationReplay = await call("memory_invalidate_reviewed", {
        scope: "identity",
        review_id: "candidate-3",
        key: "patterns/reviewed",
    });
    check("invalidation replay is idempotent", invalidationReplay.structuredContent?.idempotent === true);

    const earlyInvalidation = await call("memory_invalidate_reviewed", {
        scope: "identity",
        review_id: "candidate-late",
        key: "constraints/late-apply",
    });
    check("invalidation before apply creates a tombstone", earlyInvalidation.structuredContent?.missing === true);
    const lateApply = await call("memory_apply_reviewed", {
        scope: "identity",
        review_id: "candidate-late",
        key: "constraints/late-apply",
        value: "must not resurrect",
    });
    check("a delayed apply cannot cross the tombstone", lateApply.isError === true);
    check("tombstoned memory is never made live", (await read("constraints/late-apply")).length === 0);

    const listed = await call("memory_list", { scope: "identity" });
    check(
        "provenance records stay hidden from memory listings",
        !listed.structuredContent?.keys?.some((key) => key.startsWith("__reviewed__/")),
    );
    const reservedWrite = await call("memory_write", {
        scope: "identity",
        key: "__reviewed__/forged",
        value: "forged",
    });
    check("generic writes cannot forge provenance", reservedWrite.isError === true);
    const reservedDelete = await call("memory_delete", {
        scope: "identity",
        key: "__reviewed__/candidate-3",
    });
    check("generic deletes cannot erase provenance", reservedDelete.isError === true);
} finally {
    await client.close();
    rmSync(baseDir, { recursive: true, force: true });
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nReviewed-memory checks passed");
