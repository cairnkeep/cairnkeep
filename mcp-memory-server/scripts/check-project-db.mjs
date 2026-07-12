// Ad-hoc check: open an existing project-scope AgentFS DB exactly as the server does
// (openScope("project") -> AgentFS.open -> kv.list) and report key count + sample keys.
// Usage: node check-project-db.mjs /abs/path/to/project
import { AgentFS } from "agentfs-sdk";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const projectDir = process.argv[2];
if (!projectDir) {
    console.error("usage: node check-project-db.mjs /abs/path/to/project");
    process.exit(2);
}

const dbPath = resolve(projectDir, ".agentfs", "project.db");
if (!existsSync(dbPath)) {
    console.error(`no project.db at ${dbPath}`);
    process.exit(1);
}

const agent = await AgentFS.open({ id: "project", path: dbPath });
try {
    const entries = await agent.kv.list("");
    console.log(`OK  ${dbPath}`);
    console.log(`    keys: ${entries.length}`);
    for (const { key } of entries.slice(0, 8)) {
        console.log(`      - ${key}`);
    }
    if (entries.length > 8) console.log(`      ... (+${entries.length - 8} more)`);
} finally {
    await agent.close();
}
