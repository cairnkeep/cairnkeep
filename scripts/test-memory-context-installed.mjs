import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Import only the actual installed package; never substitute checkout modules.
const installed = realpathSync.native(resolve(process.argv[2]));
assert.notEqual(installed, realpathSync.native(resolve(dirname(fileURLToPath(import.meta.url)), '..')));
assert.equal(JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).name, '@cairnkeep/cli');
assert.ok(existsSync(join(installed, 'mcp-memory-server/dist/memory-sqlite-worker.js')));
assert.ok(existsSync(join(installed, 'mcp-memory-server/dist/memory-legacy-inspection.js')));
assert.ok(existsSync(join(installed, 'mcp-memory-server/dist/memory-connections.js')));
assert.ok(existsSync(join(installed, 'mcp-memory-server/dist/memory-map.js')));
const load = name => import(pathToFileURL(join(installed, `mcp-memory-server/dist/${name}.js`)).href);
const { hardenPrivatePath } = await load('platform-security');
const store = await load('ordinary-memory-store');
const context = await load('memory-context-store');
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'cairn-installed-memory-'))); hardenPrivatePath(base);
const project = join(base, 'tracked project – native'); mkdirSync(project, { mode: 0o700 }); hardenPrivatePath(project);
const home = join(base, 'home'); mkdirSync(home, { mode: 0o700 }); hardenPrivatePath(home);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(CAIRN_|MCP_|NODE_OPTIONS|NODE_PATH|AGENT_MEMORY_CONFIG)/.test(key) && !/(?:API_KEY|TOKEN|SECRET)/.test(key)));
Object.assign(env, { HOME: home, USERPROFILE: home, CAIRN_AGENTFS_BASE_DIR: join(base, 'stores') });
const cli = (...args) => {
  const result = spawnSync(process.execPath, [join(installed, 'bin/cairn'), 'memory-context', ...args,
    '--scope', 'project', '--project', project, '--json'], {
    encoding: 'utf8', cwd: base, env, timeout: process.platform === 'win32' ? 150000 : 30000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
let agent, view;
try {
  const emptyLegacy = join(base, 'empty-legacy.db');
  writeFileSync(emptyLegacy, '', { mode: 0o600, flag: 'wx' }); hardenPrivatePath(emptyLegacy);
  assert.equal(await context.inspectMemoryCandidate({ path: emptyLegacy, scope: 'project', key: 'facts/installed' }), null);
  assert.equal(readFileSync(emptyLegacy).length, 0, 'installed SDK-resolved readonly opener must not initialize schema');
  const legacyPath = join(base, 'legacy.db');
  const sdk = createRequire(pathToFileURL(join(installed, 'package.json'))).resolve('agentfs-sdk');
  const seeded = spawnSync(process.execPath, ['--input-type=module', '-e', `
    process.umask(0o077);
    const {AgentFS}=await import(process.argv[1]); const agent=await AgentFS.open({path:process.argv[2]});
    await agent.kv.set('facts/installed','legacy fixture'); await agent.close();
  `, pathToFileURL(sdk).href, legacyPath], { encoding: 'utf8', env, timeout: 30000 });
  assert.equal(seeded.status, 0, seeded.stderr);
  hardenPrivatePath(legacyPath);
  const legacyBefore = readFileSync(legacyPath);
  assert.equal((await context.inspectMemoryCandidate({ path: legacyPath, scope: 'project', key: 'facts/installed' })).value, 'legacy fixture');
  assert.deepEqual(readFileSync(legacyPath), legacyBefore);
  agent = await store.openOrdinaryMemoryStore(legacyPath, 'project');
  assert.equal(await agent.kv.get('facts/installed'), 'legacy fixture');
  await agent.kv.set('facts/installed', 'after inspection');
  await agent.close(); agent = undefined;
  const plan = cli('init'); cli('init', '--apply', '--confirm', plan.digest);
  const path = join(project, '.agentfs/project.db'), snapshot = join(base, 'snapshot.db');
  const previous = cli('status').marker;
  agent = await store.openOrdinaryMemoryStore(path, 'project');
  await agent.kv.set('facts/installed', 'fixture'); await agent.close(); agent = undefined;
  const entityId = 'fc3ff904-2c14-4fe4-8f57-29c842650098', entityFile = join(base, 'entity.json');
  writeFileSync(entityFile, JSON.stringify({ schema_version: 1, id: entityId, title: 'Installed fixture', aliases: ['installed'],
    anchor_key: 'facts/installed', claims: [] }), { mode: 0o600 }); hardenPrivatePath(entityFile);
  const entityPlan = cli('entity', 'set', '--input', entityFile);
  cli('entity', 'set', '--input', entityFile, '--apply', '--confirm', entityPlan.digest);
  const linkFile = join(base, 'link.json');
  writeFileSync(linkFile, JSON.stringify({ schema_version: 1, id: 'bfebd0cb-8c3a-40ab-b7a0-f21569e7d9aa',
    from: entityId, to: entityId, predicate: 'references', evidence_keys: ['facts/installed'] }), { mode: 0o600 }); hardenPrivatePath(linkFile);
  const linkPlan = cli('link', 'set', '--input', linkFile);
  cli('link', 'set', '--input', linkFile, '--apply', '--confirm', linkPlan.digest);
  assert.equal(cli('related', '--entity', 'installed').edges.length, 1);
  const navigation = cli('map', '--max-bytes', '8192');
  assert.equal(navigation.exact_reads_required, true);
  assert.ok(navigation.partitions[0].entries.some(entry => entry.id === entityId));
  assert.ok(Buffer.byteLength(JSON.stringify(navigation)) <= 8192);
  cli('backup', '--output', snapshot);
  // Only disposable fixture names, after every CLI/store connection has closed.
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path + suffix, { force: true });
  const recovery = cli('restore', '--input', snapshot);
  const restored = cli('restore', '--input', snapshot, '--apply', '--confirm', recovery.digest);
  assert.equal(restored.marker.store_uuid, previous.store_uuid);
  assert.notEqual(restored.marker.restore_epoch, previous.restore_epoch);
  assert.deepEqual(cli('related', '--entity', 'installed').nodes, [], 'installed recovery never revives pre-restore graph evidence');
  assert.equal(cli('map').partitions[0].entries.some(entry => entry.id === entityId), false);
  view = await store.openOrdinaryMemoryView(path, 'project');
  assert.equal(await view.kv.get('facts/installed'), 'fixture');
  console.log('PASS: installed package resolves its own readonly driver, worker and graph module, confirms graph curation and invalidates evidence after fresh recovery');
} finally { await view?.close(); await agent?.close(); rmSync(base, { recursive: true, force: true }); }
