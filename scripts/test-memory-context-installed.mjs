import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Import only the actual installed package; never substitute checkout modules.
const installed = realpathSync.native(resolve(process.argv[2]));
assert.notEqual(installed, realpathSync.native(resolve(dirname(fileURLToPath(import.meta.url)), '..')));
assert.equal(JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).name, '@cairnkeep/cli');
assert.ok(existsSync(join(installed, 'mcp-memory-server/dist/memory-sqlite-worker.js')));
const load = name => import(pathToFileURL(join(installed, `mcp-memory-server/dist/${name}.js`)).href);
const { hardenPrivatePath } = await load('platform-security');
const store = await load('ordinary-memory-store');
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
  const plan = cli('init'); cli('init', '--apply', '--confirm', plan.digest);
  const path = join(project, '.agentfs/project.db'), snapshot = join(base, 'snapshot.db');
  const previous = cli('status').marker;
  agent = await store.openOrdinaryMemoryStore(path, 'project');
  await agent.kv.set('facts/installed', 'fixture'); await agent.close(); agent = undefined;
  cli('backup', '--output', snapshot);
  // Only disposable fixture names, after every CLI/store connection has closed.
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path + suffix, { force: true });
  const recovery = cli('restore', '--input', snapshot);
  const restored = cli('restore', '--input', snapshot, '--apply', '--confirm', recovery.digest);
  assert.equal(restored.marker.store_uuid, previous.store_uuid);
  assert.notEqual(restored.marker.restore_epoch, previous.restore_epoch);
  view = await store.openOrdinaryMemoryView(path, 'project');
  assert.equal(await view.kv.get('facts/installed'), 'fixture');
  console.log('PASS: installed package loads its own SQLite worker and completes fresh recovery');
} finally { await view?.close(); await agent?.close(); rmSync(base, { recursive: true, force: true }); }
