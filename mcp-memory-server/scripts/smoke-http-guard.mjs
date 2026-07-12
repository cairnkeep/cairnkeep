// End-to-end guard for the HTTP transport hardening (SEC-0001 follow-up).
// Confirms: fail-closed without a token, 401 without/with a bad bearer token,
// 403 on an unexpected Host header (DNS-rebinding), and 200 when authorized.
// Run: node scripts/smoke-http-guard.mjs   (after `npm run build`)
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";

let failures = 0;
function check(name, cond) {
    console.log(`${cond ? "ok" : "FAIL"}: ${name}`);
    if (!cond) failures += 1;
}

const PORT = 8000 + (process.pid % 1500);
const TOKEN = "smoke-secret-token";
const INIT_BODY = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke-http-guard", version: "0" },
    },
});

// Raw request with full control over Host + Authorization headers.
function call({ token, host } = {}) {
    return new Promise((resolve, reject) => {
        const headers = {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "Content-Length": Buffer.byteLength(INIT_BODY),
        };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (host) headers.Host = host;
        const req = httpRequest(
            { host: "127.0.0.1", port: PORT, path: "/", method: "POST", headers },
            (res) => {
                res.on("data", () => {});
                res.on("end", () => resolve(res.statusCode));
            },
        );
        req.on("error", reject);
        req.write(INIT_BODY);
        req.end();
    });
}

function waitForListen(proc) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("server did not start in time")), 5000);
        proc.stderr.on("data", (chunk) => {
            if (chunk.toString().includes("listening on")) {
                clearTimeout(timer);
                resolve();
            }
        });
        proc.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited early: ${code}`)); });
    });
}

function waitForExit(proc) {
    return new Promise((resolve) => proc.on("exit", (code) => resolve(code)));
}

// 1. Fail closed: HTTP mode without a token must refuse to start.
{
    const env = { ...process.env, MCP_HTTP_PORT: String(PORT + 1) };
    delete env.CAIRN_MEMORY_HTTP_TOKEN;
    const proc = spawn("node", ["dist/index.js"], { env });
    const code = await waitForExit(proc);
    check("no token → server refuses to start (non-zero exit)", code !== 0);
}

// 2. Guarded server: start with a token and exercise the checks.
const server = spawn("node", ["dist/index.js"], {
    env: { ...process.env, MCP_HTTP_PORT: String(PORT), CAIRN_MEMORY_HTTP_TOKEN: TOKEN, MCP_HTTP_HOST: "127.0.0.1" },
});
try {
    await waitForListen(server);

    check("no bearer token → 401", (await call({ host: `127.0.0.1:${PORT}` })) === 401);
    check("wrong bearer token → 401", (await call({ token: "nope", host: `127.0.0.1:${PORT}` })) === 401);
    check("unexpected Host header → 403", (await call({ token: TOKEN, host: "evil.example.com" })) === 403);

    const okStatus = await call({ token: TOKEN, host: `127.0.0.1:${PORT}` });
    check(`valid token + expected Host → reaches MCP (got ${okStatus})`, okStatus === 200);
} finally {
    server.kill("SIGINT");
    await waitForExit(server).catch(() => {});
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nHTTP guard checks passed");
