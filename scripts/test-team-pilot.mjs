import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readStableFile } from './lib/stable-file.mjs';

if (process.platform === 'win32') {
  console.log('SKIP: isolated pilot Bash recipe is Linux/macOS; native CLI controls run separately');
  process.exit(0);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const guide = readFileSync(join(root, 'docs/team-pilot.md'), 'utf8');
const blocks = [...guide.matchAll(/<!-- team-pilot-setup:start -->\s*```sh\n([\s\S]*?)```\s*<!-- team-pilot-setup:end -->/g)];
assert.equal(blocks.length, 1, 'exactly one maintained executable setup block');
const onboarding = readFileSync(join(root, 'docs/team-onboarding.md'), 'utf8');
const readerBlocks = [...onboarding.matchAll(/<!-- team-reader-check:start -->\s*```sh\n([\s\S]*?)```\s*<!-- team-reader-check:end -->/g)];
assert.equal(readerBlocks.length, 1, 'exactly one maintained reader check');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const productionPaths = ['.codex/config.toml', '.claude.json', '.qwen/settings.json',
  '.qwen/trustedFolders.json', '.config/opencode/opencode.json'];
const fingerprint = () => productionPaths.map(name => {
  const path = join(homedir(), name);
  return existsSync(path) ? hash(readFileSync(path)) : null;
});
const before = fingerprint();
const base = mkdtempSync(join(tmpdir(), 'cairn-team-pilot-doc-'));
const pilot = join(base, 'new lab');
const environment = { PATH: process.env.PATH, LANG: 'C.UTF-8',
  TEAM_CAIRN: join(root, 'bin/cairn'), TEAM_PILOT_DIR: pilot };
try {
  const readToken = name => readStableFile(join(pilot, name), {
    label: 'Pilot credential', maxBytes: 256, privateMode: 0o600,
  }).bytes;
  const execute = () => spawnSync('bash', ['-c', blocks[0][1]], {
    cwd: base, env: environment, encoding: 'utf8', timeout: 120000,
  });
  const result = execute();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(statSync(pilot).mode & 0o777, 0o700);
  const files = ['author.token', 'reader.token', 'reviewer.token'];
  const hashes = files.map(name => {
    const bytes = readToken(name);
    const token = bytes.toString('utf8').trim();
    assert.equal(result.stdout.includes(token), false, 'credential never appears in setup output');
    assert.equal(result.stderr.includes(token), false);
    return hash(bytes);
  });
  assert.equal(new Set(hashes).size, 3, 'separate credentials, not a shared token');
  assert.equal(existsSync(join(pilot, 'author-workspace/reviewer.token')), false);
  assert.equal(existsSync(join(pilot, 'reader-workspace/reviewer.token')), false);
  const retry = execute();
  assert.notEqual(retry.status, 0, 'existing lab must not be reused or overwritten');
  assert.deepEqual(files.map(name => hash(readToken(name))), hashes);
  const previousTeam = process.env.CAIRN_TEAM;
  let store, server;
  try {
    process.env.CAIRN_TEAM = '1';
    const { openTeamStore } = await import('../mcp-memory-server/dist/team-store.js');
    const { createTeamHttpServer } = await import('../mcp-memory-server/dist/team-http.js');
    store = await openTeamStore(join(pilot, 'store'));
    const previousHttp = process.env.CAIRN_TEAM_HTTP;
    try {
      process.env.CAIRN_TEAM_HTTP = '1';
      server = createTeamHttpServer(store);
    } finally {
      if (previousHttp === undefined) delete process.env.CAIRN_TEAM_HTTP;
      else process.env.CAIRN_TEAM_HTTP = previousHttp;
    }
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const readerEnvironment = { ...environment, TEAM_PILOT_URL: `http://127.0.0.1:${server.address().port}` };
    // Asynchronous child execution lets the parent serve the real API request.
    const runReader = (extra = '', env = readerEnvironment) => promisify(execFile)('bash', ['-c', readerBlocks[0][1] + extra], {
      cwd: base, env, timeout: 30000, maxBuffer: 16384,
    });
    const reader = await runReader();
    assert.deepEqual(JSON.parse(reader.stdout), [], 'reader lists no unapproved content');
    for (const name of files) {
      const token = readToken(name).toString('utf8').trim();
      assert.equal((reader.stdout + reader.stderr).includes(token), false);
    }
    await assert.rejects(runReader('\nteam_pilot_reader proposals\n'), error => error.code === 1 && /denied/.test(error.stderr));
    const { TEAM_PILOT_URL, ...missingUrl } = readerEnvironment;
    await assert.rejects(runReader('', missingUrl), error => error.code !== 0 && /TEAM_PILOT_URL/.test(error.stderr));
    assert.deepEqual(files.map(name => hash(readToken(name))), hashes, 'reader check does not rewrite credentials');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await store?.close();
    if (previousTeam === undefined) delete process.env.CAIRN_TEAM;
    else process.env.CAIRN_TEAM = previousTeam;
  }
  assert.deepEqual(fingerprint(), before, 'production harness configurations unchanged');
  console.log('PASS: documented real reader request, server role denial, required inputs and credential preservation');
  console.log('PASS: documented pilot setup, isolated identities, private credentials, no token output and no overwrite');
} finally {
  rmSync(base, { recursive: true, force: true });
}
