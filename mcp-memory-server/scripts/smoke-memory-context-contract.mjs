#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { AgentFS } from 'agentfs-sdk';
import { createContinuityLab } from './memory-continuity-lab.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mode = process.argv.slice(2);
assert.ok(mode.length <= 1 && [undefined, '--baseline', '--snapshot', '--expect-red'].includes(mode[0]), 'Unknown continuity contract mode');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/memory-continuity-v2.json', import.meta.url)));
const snapshotPath = new URL('./fixtures/memory-continuity-v227.json', import.meta.url);
const configurations = {
  default: {}, typed: { CAIRN_TYPED_MEMORY_NODES: '1' },
  packs: { CAIRN_CONTEXT_PACKS: '1' },
  all_gates: { CAIRN_TYPED_MEMORY_NODES: '1', CAIRN_ARTIFACT_STORE: '1', CAIRN_CONTEXT_PACKS: '1', CAIRN_CONTEXT_USAGE: '1', CAIRN_WORK_EVIDENCE: '1' },
  read_only: { CAIRN_MCP_TOOL_PROFILE: 'read-only' },
  custom: { CAIRN_MCP_TOOL_PROFILE: 'custom', CAIRN_MCP_ALLOWED_TOOLS: 'memory_read,memory_search' },
  search_disabled: { CAIRN_CAPABILITY_CONTRACT: '1', CAIRN_CAPABILITY_MEMORY_SEARCH: '0' },
};
const lab = createContinuityLab();
try {
  if (mode[0] === '--expect-red') {
    const connection = await lab.connect('alpha', { CAIRN_MEMORY_CONTEXT: '1' });
    const names = (await connection.client.listTools()).tools.map(tool => tool.name);
    const missing = fixture.future_tools.filter(name => !names.includes(name));
    assert.ok(missing.length, 'No missing future tool: retire this RED probe and run the owning feature tests');
    lab.assertOffline();
    process.stderr.write(`PHASE50_RED:MEMORY_CONTEXT_TOOLS_MISSING:${missing.join(',')}\n`);
    process.exitCode = 86;
  } else {
    const observed = { schema_version: 1, source_version: '2.27.0', source_commit: '62e4acf67432d719bbef174e231f50994480aa84', configurations: {} };
    for (const [name, extra] of Object.entries(configurations)) {
      const connection = await lab.connect('alpha', extra);
      const tools = (await connection.client.listTools()).tools;
      assert.equal(tools.some(tool => fixture.future_tools.includes(tool.name)), false);
      observed.configurations[name] = { discovery_digest: hash(tools), names: tools.map(tool => tool.name) };
      await connection.close();
      const explicitOff = await lab.connect('alpha', { ...extra, CAIRN_MEMORY_CONTEXT: '0', CAIRN_MEMORY_CONTEXT_HTTP: '0', CAIRN_MEMORY_FEEDBACK_RANKING: '0' });
      assert.equal(hash((await explicitOff.client.listTools()).tools), observed.configurations[name].discovery_digest, 'explicit off changes complete discovery');
      await explicitOff.close();
    }
    const connection = await lab.connect();
    observed.responses = {};
    for (const [name, input] of [
      ['memory_read', { scope: 'project', key: 'decisions/fixture' }],
      ['memory_list', { scope: 'project' }],
      ['memory_search', { scope: 'project', query: 'fixture' }],
      ['memory_write', { scope: 'project', key: 'decisions/fixture', value: 'A synthetic stable fixture.' }],
      ['memory_read', { scope: 'project', key: 'decisions/fixture' }],
      ['memory_list', { scope: 'project' }],
      ['memory_search', { scope: 'project', query: 'synthetic' }],
    ]) {
      const key = `${name}-${Object.keys(observed.responses).length}`;
      const result = await connection.client.callTool({ name, arguments: input });
      assert.notEqual(result.isError, true);
      observed.responses[key] = result;
    }
    await connection.close();
    // Existing server reads/writes must not implicitly initialize future metadata.
    const agent = await AgentFS.open({ path: `${lab.projects.alpha}/.agentfs/project.db` });
    try {
      const objects = await agent.getDatabase().prepare("SELECT name FROM sqlite_master WHERE name LIKE 'cairn_memory_context_%' OR name LIKE 'cairn_memory_feedback_%'").all();
      assert.deepEqual(objects, []);
    } finally { await agent.close(); }
    assert.equal(existsSync(`${lab.root}/packs`), false, 'discovery must not open pack storage');
    assert.equal(readdirSync(lab.projects.neutral).includes('.agentfs'), false);
    lab.assertOffline();
    if (mode[0] === '--snapshot') console.log(JSON.stringify(observed, null, 2));
    else {
      assert.deepEqual(observed, JSON.parse(readFileSync(snapshotPath)), 'v2.27 feature-off discovery/response contract changed');
      console.log('PASS: frozen v2.27 complete discovery, response, profile/capability and offline contracts');
    }
  }
} finally { await lab.close(); }
