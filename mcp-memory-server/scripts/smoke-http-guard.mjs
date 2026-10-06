// End-to-end guard for the HTTP transport hardening (SEC-0001 follow-up).
// Confirms: fail-closed without a token, 401 without/with a bad bearer token,
// 403 on an unexpected Host header (DNS-rebinding), 413 on an oversized body,
// and 200 when authorized.
// Run: node scripts/smoke-http-guard.mjs   (after `npm run build`)
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hardenPrivatePath } from "../dist/platform-security.js";

let failures = 0;
function check(name, cond) {
    console.log(`${cond ? "ok" : "FAIL"}: ${name}`);
    if (!cond) failures += 1;
}

const PORT = 8000 + (process.pid % 1500);
const TOKEN = "smoke-secret-token-with-at-least-32-bytes";
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
function call({ token, host, body = INIT_BODY, contentLength, method = "POST", chunked = false, port = PORT, origin, details = false, connectHost = "127.0.0.1" } = {}) {
    return new Promise((resolve, reject) => {
        let responseStarted = false;
        const headers = {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
        };
        if (!chunked) headers["Content-Length"] = contentLength ?? Buffer.byteLength(body);
        if (token) headers.Authorization = `Bearer ${token}`;
        if (host) headers.Host = host;
        if (origin) headers.Origin = origin;
        const req = httpRequest(
            { host: connectHost, port, path: "/", method, headers },
            (res) => {
                responseStarted = true;
                // Status is enough for this guard. Drain when possible and
                // tolerate the server closing an intentionally malformed body.
                res.on("error", () => {});
                res.resume();
                resolve(details ? { status: res.statusCode, rejection: res.headers["x-cairn-rejection"] } : res.statusCode);
            },
        );
        req.on("error", (error) => { if (!responseStarted) reject(error); });
        req.end(body);
    });
}

// Invalid spellings must fail identically instead of selecting a different
// runtime endpoint than `cairn security doctor` reports.
for (const [index, invalidPort] of ["1e3", "0x1e79", "+7801", "7801x", " ", "0", "65536", "07801", "7801 "].entries()) {
    const proc = spawn("node", ["dist/index.js"], { env: { ...process.env, MCP_HTTP_PORT: invalidPort } });
    const code = await waitForExit(proc);
    check(`invalid HTTP port ${JSON.stringify(invalidPort)} → runtime refuses to start`, code !== 0);
}

function waitForListen(proc) {
    return new Promise((resolve, reject) => {
        let stderr = "";
        const timer = setTimeout(() => reject(new Error("server did not start in time")), 5000);
        proc.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
            if (stderr.includes("listening on")) {
                clearTimeout(timer);
                resolve();
            }
        });
        proc.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited early: ${code}: ${stderr.trim()}`)); });
    });
}

function waitForListenOrPrivilegeBoundary(proc) {
    return new Promise((resolve, reject) => {
        let stderr = "";
        const timer = setTimeout(() => reject(new Error("server did not start in time")), 5000);
        proc.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
            if (stderr.includes("listening on")) {
                clearTimeout(timer);
                resolve(true);
            }
        });
        proc.on("exit", (code) => {
            clearTimeout(timer);
            if (/listen EACCES|permission denied/i.test(stderr) && !/invalid host:port authority/i.test(stderr)) resolve(false);
            else reject(new Error(`server exited early: ${code}: ${stderr.trim()}`));
        });
    });
}

function waitForExit(proc) {
    if (proc.exitCode !== null) return Promise.resolve(proc.exitCode);
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

for (const unsafeToken of ["🪨".repeat(8), "line-one\nline-two"]) {
    const proc = spawn("node", ["dist/index.js"], { env: { ...process.env, MCP_HTTP_PORT: String(PORT + 1), CAIRN_MEMORY_HTTP_TOKEN: unsafeToken } });
    const code = await waitForExit(proc);
    check("header-unsafe bearer token → server refuses to start", code !== 0);
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

    check("GET body is rejected", (await call({ token: TOKEN, host: `127.0.0.1:${PORT}`, method: "GET", body: "x", chunked: true })) === 400);
    check("DELETE body is rejected", (await call({ token: TOKEN, host: `127.0.0.1:${PORT}`, method: "DELETE", body: "x", chunked: true })) === 400);
    check("OPTIONS body is rejected", (await call({ host: `127.0.0.1:${PORT}`, method: "OPTIONS", body: "x", origin: "https://example.invalid" })) === 400);

    const boundaryBody = Buffer.alloc(8 * 1024 * 1024, 0x20);
    const boundaryResult = await call({
        token: TOKEN, host: `127.0.0.1:${PORT}`, body: boundaryBody, chunked: true,
        details: true,
    });
    check(`chunked body at 8 MiB does not cross Cairnkeep's limit (got ${boundaryResult.status})`, boundaryResult.rejection !== "request-body-limit");

    const oversizedBody = Buffer.alloc(8 * 1024 * 1024 + 1, 0x20);
    const oversizedResult = await call({
        token: TOKEN,
        host: `127.0.0.1:${PORT}`,
        body: oversizedBody,
        chunked: true,
        details: true,
    });
    check("oversized chunked body → Cairnkeep 413", oversizedResult.status === 413 && oversizedResult.rejection === "request-body-limit");
} finally {
    server.kill("SIGINT");
    await waitForExit(server).catch(() => {});
}

// Canonical authority handling preserves explicit default ports instead of
// allowing WHATWG URL normalization to erase them.
for (const defaultPort of [80, 443]) {
    const defaultPortServer = spawn("node", ["dist/index.js"], {
        env: { ...process.env, MCP_HTTP_PORT: String(defaultPort), CAIRN_MEMORY_HTTP_TOKEN: TOKEN, MCP_HTTP_HOST: "127.0.0.1" },
    });
    try {
        const listening = await waitForListenOrPrivilegeBoundary(defaultPortServer);
        check(`valid default port ${defaultPort} passes authority validation`, true);
        if (listening) {
            check(`default port ${defaultPort} accepts its explicit Host authority`, (await call({
                token: TOKEN, host: `127.0.0.1:${defaultPort}`, port: defaultPort,
            })) === 200);
            check(`default port ${defaultPort} accepts Host without a port`, (await call({
                token: TOKEN, host: "127.0.0.1", port: defaultPort,
            })) === 200);
        }
    } finally {
        defaultPortServer.kill("SIGINT");
        await waitForExit(defaultPortServer).catch(() => {});
    }
}

// 4. Authority normalization covers bracketed IPv6 and DNS case folding.
const ipv6Port = PORT + 3;
const ipv6Server = spawn("node", ["dist/index.js"], {
    env: { ...process.env, MCP_HTTP_PORT: String(ipv6Port), CAIRN_MEMORY_HTTP_TOKEN: TOKEN, MCP_HTTP_HOST: "::1" },
});
try {
    await waitForListen(ipv6Server);
    check("IPv6 loopback + bracketed Host authority reaches MCP", (await call({
        token: TOKEN, host: `[::1]:${ipv6Port}`, port: ipv6Port, connectHost: "::1",
    })) === 200);
} finally {
    ipv6Server.kill("SIGINT");
    await waitForExit(ipv6Server).catch(() => {});
}

const dnsPort = PORT + 4;
const dnsServer = spawn("node", ["dist/index.js"], {
    env: {
        ...process.env,
        MCP_HTTP_PORT: String(dnsPort),
        CAIRN_MEMORY_HTTP_TOKEN: TOKEN,
        MCP_HTTP_HOST: "127.0.0.1",
        CAIRN_MEMORY_HTTP_ALLOWED_HOSTS: `MEMORY.EXAMPLE.TEST:${dnsPort}`,
    },
});
try {
    await waitForListen(dnsServer);
    check("explicit DNS Host allowlist is case-insensitive", (await call({
        token: TOKEN, host: `memory.example.test:${dnsPort}`, port: dnsPort,
    })) === 200);
} finally {
    dnsServer.kill("SIGINT");
    await waitForExit(dnsServer).catch(() => {});
}

// 3. The direct runtime accepts the same private token-file contract as the
// posture check and container launcher.
const tokenRoot = mkdtempSync(join(tmpdir(), "cairn-http-token-"));
const tokenPath = join(tokenRoot, "token");
writeFileSync(tokenPath, `${TOKEN}\n`, { mode: 0o600 });
if (process.platform === "win32") {
    const plantedAce = spawnSync("icacls.exe", [tokenPath, "/grant", "*S-1-1-0:(R)"], { encoding: "utf8", windowsHide: true });
    if (plantedAce.status !== 0) throw new Error(`could not create adversarial Windows token ACL: ${plantedAce.stderr}`);
}
hardenPrivatePath(tokenPath);
const filePort = PORT + 2;
const fileServer = spawn("node", ["dist/index.js"], {
    env: (() => {
        const env = { ...process.env, MCP_HTTP_PORT: String(filePort), CAIRN_MEMORY_HTTP_TOKEN_FILE: tokenPath, MCP_HTTP_HOST: "" };
        delete env.CAIRN_MEMORY_HTTP_TOKEN;
        return env;
    })(),
});
try {
    await waitForListen(fileServer);
    check("private token file starts the direct server", (await call({ token: TOKEN, host: `127.0.0.1:${filePort}`, port: filePort })) === 200);
} finally {
    fileServer.kill("SIGINT");
    await waitForExit(fileServer).catch(() => {});
    rmSync(tokenRoot, { recursive: true, force: true });
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nHTTP guard checks passed");
