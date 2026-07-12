// Recovery attempt for an orphaned WAL (project.db-wal present, project.db missing).
// Opens AgentFS at the given project dir (which creates the main db and runs SQLite WAL
// recovery), then lists keys. Run only after backing up .agentfs.
// Usage: node recover-project-db.mjs /abs/path/to/project
import { AgentFS } from "agentfs-sdk";
import { resolve } from "node:path";

const projectDir = process.argv[2];
if (!projectDir) {
    console.error("usage: node recover-project-db.mjs /abs/path/to/project");
    process.exit(2);
}

const dbPath = resolve(projectDir, ".agentfs", "project.db");
const agent = await AgentFS.open({ id: "project", path: dbPath });
try {
    const entries = await agent.kv.list("");
    console.log(`opened ${dbPath}`);
    console.log(`recovered keys: ${entries.length}`);
    for (const { key } of entries) {
        console.log(`  - ${key}`);
    }
} finally {
    await agent.close();
}
