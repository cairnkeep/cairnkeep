#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [mode, rawUrl, token] = process.argv.slice(2);
if (!["write", "read"].includes(mode) || !rawUrl || !token) {
    console.error("usage: probe-container-memory.mjs <write|read> URL TOKEN");
    process.exit(2);
}

const client = new Client({ name: "cairnkeep-container-probe", version: "1" });
const transport = new StreamableHTTPClientTransport(new URL(rawUrl), {
    requestInit: {
        headers: {
            Authorization: `Bearer ${token}`,
            "X-Cairn-Project": "container-smoke",
            "X-Cairn-Scopes": "identity,project",
        },
    },
});

try {
    await client.connect(transport);
    if (mode === "write") {
        const response = await client.callTool({
            name: "memory_write",
            arguments: {
                scope: "identity",
                key: "patterns/container-persistence",
                value: "survives container replacement",
            },
        });
        if (response.isError) throw new Error("memory_write returned an error");
        console.log("container memory write: ok");
    } else {
        const response = await client.callTool({
            name: "memory_read",
            arguments: {
                scope: "identity",
                key: "patterns/container-persistence",
            },
        });
        const value = response.structuredContent?.results?.[0]?.value;
        if (value !== "survives container replacement") {
            throw new Error("persisted memory was not recovered");
        }
        console.log("container memory persistence: ok");
    }
} finally {
    await client.close();
}
