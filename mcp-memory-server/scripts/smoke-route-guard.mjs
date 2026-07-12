// Offline, fail-closed guard for the `route_check` tool (RT-01).
// Anchors on tool registration (RED until Task 2 lands it, GREEN after), then
// exercises the unset-env / malformed-URL precondition throws plus the
// unreachable / non-2xx / malformed-JSON / success execution-tier outcomes
// against ephemeral `node:http` fixtures — no live token_miser binary, no
// hardcoded proxy endpoint anywhere here. Also pins the seam (D-10): the
// fetch path is exactly `/health` and the only env key read is
// CAIRN_ROUTE_ENDPOINT.
// Run: node scripts/smoke-route-guard.mjs   (after `npm run build`)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "node:http";

let failures = 0;
function check(name, cond) {
    console.log(`${cond ? "ok" : "FAIL"}: ${name}`);
    if (!cond) failures += 1;
}

// Opens a fresh client/server pair with the given env, runs `fn(client)`,
// always closes the client afterward.
async function withClient(env, fn) {
    const transport = new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
        env: { ...process.env, ...env },
    });
    const client = new Client({ name: "smoke-route-guard", version: "0" }, { capabilities: {} });
    await client.connect(transport);
    try {
        return await fn(client);
    } finally {
        await client.close();
    }
}

async function callRoute(client, args = {}) {
    try {
        const res = await client.callTool({ name: "route_check", arguments: args });
        return { isError: Boolean(res.isError), res };
    } catch {
        return { isError: true, res: null };
    }
}

// Starts an ephemeral node:http server, returns { url, close(), requestedPaths }.
async function ephemeralServer(handler) {
    const requestedPaths = [];
    const server = createServer((req, res) => {
        requestedPaths.push(req.url);
        handler(req, res);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    return {
        url: `http://127.0.0.1:${port}`,
        requestedPaths,
        close: () => new Promise((r) => server.close(r)),
    };
}

// 1. Registration anchor — RED before Task 2, GREEN after.
await withClient({}, async (client) => {
    const { tools } = await client.listTools();
    check("route_check is registered", tools.some((t) => t.name === "route_check"));
});

// 2. Unset CAIRN_ROUTE_ENDPOINT fails closed (precondition throw).
await withClient({}, async (client) => {
    const { isError } = await callRoute(client);
    check("unset CAIRN_ROUTE_ENDPOINT fails closed", isError);
});

// 3. Malformed URL fails closed (precondition throw).
await withClient({ CAIRN_ROUTE_ENDPOINT: "not-a-url" }, async (client) => {
    const { isError } = await callRoute(client);
    check("malformed CAIRN_ROUTE_ENDPOINT fails closed", isError);
});

// 4. Unreachable endpoint (nothing listening) → ok:false, not a throw.
await withClient({ CAIRN_ROUTE_ENDPOINT: "http://127.0.0.1:1" }, async (client) => {
    const { isError, res } = await callRoute(client, { timeout_seconds: 2 });
    check(
        "unreachable endpoint returns structured ok:false (not a throw)",
        !isError && res?.structuredContent?.ok === false,
    );
});

// 5. Non-2xx status → ok:false.
{
    const nonOkServer = await ephemeralServer((_req, res) => {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "unhealthy" }));
    });
    await withClient({ CAIRN_ROUTE_ENDPOINT: nonOkServer.url }, async (client) => {
        const { res } = await callRoute(client);
        check("non-2xx status returns structured ok:false", res?.structuredContent?.ok === false);
    });
    await nonOkServer.close();
}

// 6. Malformed JSON body (200 but not parseable) → ok:false.
{
    const garbageServer = await ephemeralServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("not json");
    });
    await withClient({ CAIRN_ROUTE_ENDPOINT: garbageServer.url }, async (client) => {
        const { res } = await callRoute(client);
        check("malformed JSON body returns structured ok:false", res?.structuredContent?.ok === false);
    });
    await garbageServer.close();
}

// 7. Success + D-10 pinning: exact `/health` path, single env key.
{
    const okServer = await ephemeralServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", cluster_healthy: null }));
    });
    await withClient({ CAIRN_ROUTE_ENDPOINT: okServer.url }, async (client) => {
        const { res } = await callRoute(client);
        const sc = res?.structuredContent;
        check(
            "ok-server success returns ok:true with status and cluster_healthy",
            sc?.ok === true && sc?.status === "ok" && sc?.cluster_healthy === null,
        );
    });
    check(
        "D-10: exactly one request was made, to /health (no other path)",
        okServer.requestedPaths.length === 1 && okServer.requestedPaths[0] === "/health",
    );
    await okServer.close();
}

// 8. D-10: only CAIRN_ROUTE_ENDPOINT is required in env — no second
// CAIRN_ROUTE_* key needed for a successful call.
{
    const okServer2 = await ephemeralServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", cluster_healthy: true }));
    });
    await withClient({ CAIRN_ROUTE_ENDPOINT: okServer2.url }, async (client) => {
        const { res } = await callRoute(client);
        check(
            "D-10: single env key CAIRN_ROUTE_ENDPOINT is sufficient for success",
            res?.structuredContent?.ok === true,
        );
    });
    await okServer2.close();
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nRoute guard checks passed");
