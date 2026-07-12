// Non-destructive read/write/delete probe against a project-scope AgentFS DB.
// Writes a probe key, reads it back, deletes it, and confirms the original key set
// is unchanged. Usage: node probe-rw.mjs /abs/path/to/project
import { AgentFS } from "agentfs-sdk";
import { resolve } from "node:path";

const projectDir = process.argv[2];
const dbPath = resolve(projectDir, ".agentfs", "project.db");
const PROBE = "__recovery_probe__";

const agent = await AgentFS.open({ id: "project", path: dbPath });
try {
    const before = (await agent.kv.list("")).map((e) => e.key).sort();
    await agent.kv.set(PROBE, "ok");
    const readBack = await agent.kv.get(PROBE);
    await agent.kv.delete(PROBE);
    const after = (await agent.kv.list("")).map((e) => e.key).sort();
    const same = JSON.stringify(before) === JSON.stringify(after);
    console.log(`keys before:   ${before.length} [${before.join(", ")}]`);
    console.log(`probe write:   set -> get returned ${JSON.stringify(readBack)}`);
    console.log(`keys after:    ${after.length} [${after.join(", ")}]`);
    console.log(`round-trip:    ${readBack === "ok" && same ? "PASS (writable, no residue)" : "FAIL"}`);
} finally {
    await agent.close();
}
