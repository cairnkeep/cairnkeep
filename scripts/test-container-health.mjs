import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hardenPrivatePath } from "../mcp-memory-server/dist/platform-security.js";

const source = readFileSync(new URL("../containers/healthcheck.mjs", import.meta.url), "utf8");
const containerfile = readFileSync(new URL("../Containerfile", import.meta.url), "utf8");
const quadlet = readFileSync(new URL("../containers/quadlet/cairnkeep.container", import.meta.url), "utf8");
assert.match(quadlet, /^Secret=cairnkeep-http-token,type=mount,target=http-token,uid=10001,gid=10001,mode=0400$/m,
  "the managed container secret must satisfy the probe's private-file contract");
assert.match(containerfile, /COPY --chmod=644 containers\/healthcheck\.mjs \/opt\/cairnkeep\/containers\/healthcheck\.mjs/, "probe imports must resolve within the packaged server");
assert.match(containerfile, /ln -s \/opt\/cairnkeep\/containers\/healthcheck\.mjs \/usr\/local\/lib\/cairnkeep\/container-healthcheck\.mjs/, "keep the established container probe path");
assert.match(source, /parseHttpPort/, "health destination must use the server's numeric port parser");
assert.match(source, /resolveHttpToken/, "health tokens must use the server's bounded resolver");
const { containerHealthcheck } = await import("../containers/healthcheck.mjs");
const root = mkdtempSync(join(tmpdir(), "cairn-health-security-"));
const originalFetch = globalThis.fetch;
const token = "synthetic-health-token-0123456789";
const requests = [];
try {
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json({ result: {} });
  };
  assert.equal(await containerHealthcheck({}), 0);
  for (const port of ["7801@external.example.test", "1/path", "-1", "65536", " 7801 "]) {
    assert.equal(await containerHealthcheck({ MCP_HTTP_PORT: port, CAIRN_MEMORY_HTTP_TOKEN: token }), 1);
  }
  assert.equal(requests.length, 0, "disabled or invalid configuration must not fetch");
  assert.equal(await containerHealthcheck({ MCP_HTTP_PORT: "7801", CAIRN_MEMORY_HTTP_TOKEN: token }), 0);
  assert.equal(requests[0].url, "http://127.0.0.1:7801/mcp");
  assert.equal(requests[0].options.redirect, "manual");
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${token}`);
  assert.equal(JSON.parse(requests[0].options.body).method, "initialize");
  const tokenFile = join(root, "token");
  writeFileSync(tokenFile, token + "\n", { mode: 0o600 });
  hardenPrivatePath(tokenFile);
  assert.equal(await containerHealthcheck({ MCP_HTTP_PORT: "7801", CAIRN_MEMORY_HTTP_TOKEN_FILE: tokenFile }), 0);
  if (process.platform !== "win32") {
    chmodSync(tokenFile, 0o644);
    assert.equal(await containerHealthcheck({ MCP_HTTP_PORT: "7801", CAIRN_MEMORY_HTTP_TOKEN_FILE: tokenFile }), 1);
    chmodSync(tokenFile, 0o600);
    const link = join(root, "linked-token");
    symlinkSync(tokenFile, link);
    assert.equal(await containerHealthcheck({ MCP_HTTP_PORT: "7801", CAIRN_MEMORY_HTTP_TOKEN_FILE: link }), 1);
  }
  writeFileSync(tokenFile, "x".repeat(64 * 1024 + 1));
  assert.equal(await containerHealthcheck({ MCP_HTTP_PORT: "7801", CAIRN_MEMORY_HTTP_TOKEN_FILE: tokenFile }), 1);
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: "https://external.example.test" } });
  assert.equal(await containerHealthcheck({ MCP_HTTP_PORT: "7801", CAIRN_MEMORY_HTTP_TOKEN: token }), 1);
} finally {
  globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true, force: true });
}
console.log("PASS: container health checks remain loopback-only with bounded, safe credentials and no redirects");
