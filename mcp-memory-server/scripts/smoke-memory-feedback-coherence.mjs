import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createContinuityLab, serverEntry } from './memory-continuity-lab.mjs';
import * as ordinary from '../dist/ordinary-memory-store.js';
import { inspectMemoryCandidate } from '../dist/memory-context-store.js';
import { hardenPrivatePath } from '../dist/platform-security.js';
import { inspectMemoryDatabaseMetadata } from '../dist/memory-store-format.js';

process.umask(0o077);
const lab = createContinuityLab();
const flags = { CAIRN_MEMORY_CONTEXT: '1', CAIRN_TYPED_MEMORY_NODES: '1' };
const hash = text => createHash('sha256').update(text).digest('hex');
try {
  for (const [project, tracked] of [['alpha', true], ['beta', false]]) {
    const target = { path: join(lab.projects[project], '.agentfs', 'project.db'), scope: 'project' };
    if (tracked) {
      mkdirSync(join(target.path, '..'), { recursive: true, mode: 0o700 });
      const plan = await ordinary.planContextStoreInit(target); await ordinary.applyContextStoreInit({ ...target, confirm: plan.digest });
    }
    const writer = await lab.connect(project, flags);
    for (const [key, value] of [['facts/a', 'Office tunnel path alpha.'], ['facts/b', 'Office tunnel path bravo.']]) {
      await writer.call('memory_write', { scope: 'project', key, value, node_type: 'memory', tags: ['oldtag'] });
    }
    // The legacy SDK holds an exclusive process lock. Exercise concurrent MCP
    // requests in one process there, rather than bypassing its lock boundary.
    if (!tracked) {
      await writer.close(); hardenPrivatePath(target.path); inspectMemoryDatabaseMetadata(target.path, true);
    }
    const ready = join(lab.root, `${project}-ready`), release = join(lab.root, `${project}-release`);
    // A positive, bounded barrier at the real reranking seam. No socket or
    // provider is used; inherit the lab's network trap even in observer children.
    const guard = `import {writeFileSync,existsSync} from 'node:fs';
      await import(${JSON.stringify(pathToFileURL(join(lab.root, 'deny-network.mjs')).href)});
      globalThis.fetch=async(input,init)=>{
        if(String(input)!=='http://127.0.0.1:1/v1/rerank')throw Error('UNEXPECTED_FIXTURE_FETCH');
        const body=JSON.parse(init.body);writeFileSync(${JSON.stringify(ready)},String(body.documents.length),{mode:0o600});
        const deadline=Date.now()+180000;
        while(!existsSync(${JSON.stringify(release)})){if(Date.now()>deadline)throw Error('BARRIER_TIMEOUT');await new Promise(r=>setTimeout(r,10));}
        return new Response(JSON.stringify({results:body.documents.map((_,index)=>({index,relevance_score:2-index}))}),{headers:{'Content-Type':'application/json'}});
      };`;
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ['--import', `data:text/javascript,${encodeURIComponent(guard)}`, serverEntry],
      cwd: lab.projects[project], env: { ...lab.env, ...flags, CAIRN_MEMORY_RERANK: '1',
        CAIRN_MEMORY_RERANK_URL: 'http://127.0.0.1:1/v1', CAIRN_MEMORY_RERANK_MODEL: 'fixture-only' }, stderr: 'pipe' });
    transport.stderr?.resume(); const client = new Client({ name: 'metadata-coherence', version: '1' });
    let pending;
    try {
      await client.connect(transport);
      const activeWriter = tracked ? writer : { async call(name, input) {
        const result = await client.callTool({ name, arguments: input });
        assert.notEqual(result.isError, true, JSON.stringify(result)); return result.structuredContent;
      } };
      for (const [name, node_type, tags] of [['tags-only', 'memory', ['newtag']], ['type-only', 'knowledge', ['oldtag']], ['both', 'knowledge', ['newtag']]]) {
        await activeWriter.call('memory_supersede', { scope: 'project', key: 'facts/a', value: 'Office tunnel path alpha.',
          node_type: 'memory', tags: ['oldtag'], reason: 'reset synthetic metadata' });
        const previous = (await inspectMemoryCandidate({ ...target, key: 'facts/a' })).source;
        const task_digest = hash(`${project}:${name}`), input = { scope: 'project', query: 'office tunnel', top_k: 2,
          node_types: ['memory'], tags_all: ['oldtag'], task_digest };
        pending = client.callTool({ name: 'memory_context_search', arguments: input }); let early;
        pending.then(value => { early = value; }, error => { early = { error: error.message }; });
        const deadline = Date.now() + (process.platform === 'win32' ? 120000 : 30000);
        while (!existsSync(ready) && !early && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        assert.ok(existsSync(ready), `${project}/${name}: actual search must reach fake reranker: ${JSON.stringify(early)}`);
        assert.equal(readFileSync(ready, 'utf8'), '2', 'both old-filter candidates reached reranking before mutation');
        await activeWriter.call('memory_supersede', { scope: 'project', key: 'facts/a', value: 'Office tunnel path alpha.', node_type, tags,
          reason: 'concurrent metadata-only change' });
        const current = (await inspectMemoryCandidate({ ...target, key: 'facts/a' })).source;
        if (tracked) assert.ok(current.generation > previous.generation);
        writeFileSync(release, 'go', { mode: 0o600 });
        const response = await pending; pending = undefined; assert.notEqual(response.isError, true, JSON.stringify(response));
        const result = response.structuredContent;
        assert.deepEqual(result.results.map(row => row.key), ['facts/b'], 'COHERENCE_RED: changed typed fields must not gain current provenance or a receipt');
        assert.equal(result.truncated, true);
        const untouched = result.results[0]; assert.deepEqual(untouched.tags, ['oldtag']); assert.equal(untouched.node_type, 'memory');
        assert.equal(Boolean(untouched.receipt), tracked, 'unchanged tracked result still has a working receipt');
        if (tracked) assert.equal((await client.callTool({ name: 'memory_feedback_record', arguments: {
          receipt: untouched.receipt, task_digest, outcome: 'useful' } })).structuredContent.recorded, true);
        const fresh = await activeWriter.call('memory_context_search', { ...input, task_digest: undefined });
        assert.equal(fresh.results.some(row => row.key === 'facts/a'), false);
        const changed = await activeWriter.call('memory_context_search', { scope: 'project', query: 'facts/a', node_types: [node_type], tags_all: tags, task_digest });
        assert.equal(changed.results.length, 1); assert.equal(changed.results[0].node_type, node_type); assert.deepEqual(changed.results[0].tags, tags);
        if (tracked) assert.deepEqual(changed.results[0].source, current);
        rmSync(ready); rmSync(release);
      }
    } finally {
      writeFileSync(release, 'go', { mode: 0o600 });
      await client.close(); await transport.close(); if (tracked) await writer.close();
    }
  }
  lab.assertOffline();
  console.log('PASS: tracked and isolated legacy context search reject same-value tag/type races, preserve unchanged results and bind only coherent receipts');
} finally { await lab.close(); }
