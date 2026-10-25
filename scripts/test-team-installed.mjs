import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The caller passes the ACTUAL installed package, never a source-relative dist.
const root = resolve(process.argv[2]);
const { openTeamStore } = await import(pathToFileURL(join(root, 'mcp-memory-server/dist/team-store.js')));
const { createTeamHttpServer } = await import(pathToFileURL(join(root, 'mcp-memory-server/dist/team-http.js')));
const { hardenPrivatePath } = await import(pathToFileURL(join(root, 'mcp-memory-server/dist/platform-security.js')));
const exec = promisify(execFile);
const base = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-installed-team-'))); hardenPrivatePath(base);
const project = join(base, 'project with spaces'); mkdirSync(project, { mode: 0o700 }); hardenPrivatePath(project);
const home = join(base, 'home'); mkdirSync(home, { mode: 0o700 }); hardenPrivatePath(home);
const data = join(base, 'store');
process.env.CAIRN_TEAM = '1'; process.env.CAIRN_TEAM_HTTP = '1';
let store, server;
try {
  store = await openTeamStore(data, { create: true, organization: 'trial-org' });
  await store.admin({ operation: 'project-create', project: 'trial-project' });
  await store.admin({ operation: 'member-set', subject: 'reader', project: 'trial-project', roles: ['reader'] });
  const credential = await store.issue({ subject: 'reader', credential_class: 'workload', expires_at: new Date(Date.now() + 3600000).toISOString() });
  const tokenFile = join(base, 'reader.token'); writeFileSync(tokenFile, credential.token, { mode: 0o600 }); hardenPrivatePath(tokenFile);
  const original = '{"mcpServers":{"cairn-memory":{"command":"personal-unchanged"},"other":{"command":"other-unchanged"}}}\n';
  const config = join(project, '.mcp.json'); writeFileSync(config, original, { mode: 0o600 });
  server = createTeamHttpServer(store); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CAIRN_')));
  Object.assign(env, { HOME: home, USERPROFILE: home, CAIRN_TEAM: '1' });
  const run = args => exec(process.execPath, [join(root, 'bin/cairn'), 'team', ...args], { env, cwd: base, timeout: process.platform === 'win32' ? 120000 : 30000, maxBuffer: 32768 });
  const args = ['connect', '--project-root', project, '--organization', 'trial-org', '--project', 'trial-project', '--url', `http://127.0.0.1:${server.address().port}`, '--token-file', tokenFile, '--harness', 'claude'];
  assert.match((await run(['connect', '--help'])).stdout, /no-write plan/);
  const plan = await run(args); assert.equal(JSON.parse(plan.stdout).planned, true);
  assert.equal(readFileSync(config, 'utf8'), original, 'installed no-apply preserves exact bytes');
  await run([...args, '--apply', '--yes']);
  const doctor = await run(['doctor', '--client', '--project-root', project]);
  assert.equal(JSON.parse(doctor.stdout).ok, true);
  assert.equal(doctor.stdout.includes(credential.token), false);
  assert.equal(existsSync(join(home, '.cairnkeep/team')), false, 'client diagnostics open no administrator store');
  await run(['disconnect', '--project-root', project]);
  assert.ok(JSON.parse(readFileSync(config, 'utf8')).mcpServers['cairn-team-memory'], 'disconnect plan is read-only');
  await run(['disconnect', '--project-root', project, '--apply', '--yes']);
  assert.equal(readFileSync(config, 'utf8'), original, 'installed disconnect restores exact untouched original');
  assert.equal(readFileSync(tokenFile, 'utf8'), credential.token);
  console.log('PASS: actual installed team plan/connect/client doctor/disconnect, preserved MCPs and no admin store');
} finally {
  if (server) await new Promise(r => { server.close(r); server.closeAllConnections(); });
  await store?.close(); rmSync(base, { recursive: true, force: true });
}
