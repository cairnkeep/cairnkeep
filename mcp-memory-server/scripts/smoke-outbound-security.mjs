import assert from "node:assert/strict";
import { queryDomainKnowledge } from "../dist/domain-retrieval-provider.js";

const originalFetch = globalThis.fetch;
const failures = [];
const env = { ANYTHINGLLM_BASE_URL: "https://knowledge.example.test", ANYTHINGLLM_API_KEY: "synthetic-fixture-token" };
const query = { workspace: "project alpha", query: "What changed?", env };
const requests = [];
async function control(name, operation) {
  try { await operation(); }
  catch (error) { failures.push(`${name}: ${error.message}`); }
}
try {
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json({ textResponse: "unchanged answer" });
  };
  assert.equal(await queryDomainKnowledge(query), "unchanged answer");
  assert.equal(requests[0].url, "https://knowledge.example.test/api/v1/workspace/project%20alpha/chat");
  assert.equal(requests[0].options.headers.Authorization, "Bearer synthetic-fixture-token");
  assert.equal(requests[0].options.body, JSON.stringify({ message: "What changed?", mode: "query" }));
  await control("provider redirects", () => { assert.equal(requests[0].options.redirect, "manual"); });
  for (const field of ["response", "message", "text"]) {
    globalThis.fetch = async () => Response.json({ [field]: "unchanged answer" });
    assert.equal(await queryDomainKnowledge(query), "unchanged answer");
  }
  globalThis.fetch = async () => Response.json({ sources: ["fixture"] });
  assert.equal(await queryDomainKnowledge(query), JSON.stringify({ sources: ["fixture"] }, null, 2));
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json({ textResponse: "unchanged answer" });
  };
  await queryDomainKnowledge({ ...query, env: { ANYTHINGLLM_API_KEY: env.ANYTHINGLLM_API_KEY } });
  assert.equal(requests.at(-1).url, "http://localhost:3001/api/v1/workspace/project%20alpha/chat");
  for (const workspace of [".", ".."]) {
    await control("provider workspace dot-segment denial", async () => {
      const before = requests.length;
      await assert.rejects(() => queryDomainKnowledge({ ...query, workspace }), /workspace/);
      assert.equal(requests.length, before);
    });
  }

  for (const unsafe of ["https://user:password@knowledge.example.test", "file:///private/data", "https://knowledge.example.test/?token=private"]) {
    await control("provider endpoint validation", async () => {
      const before = requests.length;
      await assert.rejects(() => queryDomainKnowledge({ ...query, env: { ...env, ANYTHINGLLM_BASE_URL: unsafe } }), /HTTP|credential|query|fragment/i);
      assert.equal(requests.length, before, "invalid endpoint must not issue a request");
    });
  }
  globalThis.fetch = async () => new Response("private-provider-error-sentinel", { status: 503 });
  await control("provider error non-disclosure", async () => {
    await assert.rejects(() => queryDomainKnowledge(query), (error) => {
      assert.match(error.message, /503/);
      assert.equal(error.message.includes("private-provider-error-sentinel"), false);
      return true;
    });
  });
  globalThis.fetch = async () => { throw new Error("private-network-error-sentinel"); };
  await control("network error non-disclosure", async () => {
    await assert.rejects(() => queryDomainKnowledge(query), (error) => {
      assert.equal(error.message.includes("private-network-error-sentinel"), false);
      return true;
    });
  });
  globalThis.fetch = async () => Response.json({ textResponse: "small payload" }, { headers: { "content-length": String(8 * 1024 * 1024 + 1) } });
  await control("advertised provider response bound", async () => {
    await assert.rejects(() => queryDomainKnowledge(query), /large|limit/i);
  });
  let chunks = 0;
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) {
      if (chunks++ === 0) controller.enqueue(new TextEncoder().encode('{"textResponse":"'));
      else if (chunks <= 10) controller.enqueue(new Uint8Array(1024 * 1024).fill(120));
      else { controller.enqueue(new TextEncoder().encode('"}')); controller.close(); }
    },
    cancel() { cancelled = true; },
  }));
  await control("streamed provider response bound", async () => {
    await assert.rejects(() => queryDomainKnowledge(query), /large|limit/i);
    assert.equal(cancelled, true, "oversized response must cancel the reader");
  });
  globalThis.fetch = async () => new Response("private-json-error-sentinel");
  await control("invalid provider JSON non-disclosure", async () => {
    await assert.rejects(() => queryDomainKnowledge(query), (error) => {
      assert.match(error.message, /JSON/);
      assert.equal(error.message.includes("private-json-error-sentinel"), false);
      return true;
    });
  });
  for (const status of [200, 503]) {
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) { if (status === 200) controller.error(new Error("private-stream-error-sentinel")); },
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        controller.enqueue(new TextEncoder().encode("private-error-body-sentinel"));
        controller.close();
      },
      cancel() { throw new Error("private-cancel-error-sentinel"); },
    }), { status });
    await control("response stream non-disclosure", async () => {
      await assert.rejects(() => queryDomainKnowledge(query), (error) => {
        assert.equal(/private-(stream|cancel)-error-sentinel/.test(error.message), false);
        return true;
      });
    });
  }
  const openVikingQuery = { ...query, env: {
    CAIRN_DOMAIN_RETRIEVAL_PROVIDER: "openviking", CAIRN_OPENVIKING: "1",
    CAIRN_OPENVIKING_BASE_URL: "https://knowledge.example.test",
  } };
  const resources = { resources: [{ uri: "viking://resources/project-alpha/runbook.md", abstract: "Rollback safely." }], total: 1 };
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json({ status: "ok", result: resources });
  };
  assert.deepEqual(JSON.parse(await queryDomainKnowledge(openVikingQuery)), resources);
  assert.equal(requests.at(-1).url, "https://knowledge.example.test/api/v1/search/find");
  assert.equal(requests.at(-1).options.redirect, "manual");
  assert.equal(JSON.parse(requests.at(-1).options.body).target_uri, "viking://resources/project%20alpha");
  for (const workspace of ["..", "../outside", "viking://resources/%2e%2e/outside"]) {
    await control("OpenViking workspace traversal denial", async () => {
      const before = requests.length;
      await assert.rejects(() => queryDomainKnowledge({ ...openVikingQuery, workspace }), /traversal|workspace/);
      assert.equal(requests.length, before);
    });
  }
  for (const queryOptions of [
    { ...openVikingQuery, env: { ...openVikingQuery.env, CAIRN_OPENVIKING: "0" } },
    { ...openVikingQuery, remote: true },
  ]) {
    const before = requests.length;
    await assert.rejects(() => queryDomainKnowledge(queryOptions), /CAIRN_OPENVIKING/);
    assert.equal(requests.length, before, "disabled or non-consented paths must not fetch");
  }
  globalThis.fetch = async () => { throw new Error("private-network-error-sentinel"); };
  await control("OpenViking network error non-disclosure", async () => {
    await assert.rejects(() => queryDomainKnowledge(openVikingQuery), (error) => {
      assert.equal(error.message.includes("private-network-error-sentinel"), false);
      return true;
    });
  });
  assert.deepEqual(failures, [], "outbound provider requests must keep bounded, explicit authority");
} finally { globalThis.fetch = originalFetch; }
console.log("PASS: explicit provider destinations, redirect denial, response bounds and payload-free failures");
