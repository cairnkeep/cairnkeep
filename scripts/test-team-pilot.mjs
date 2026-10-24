import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStableFile } from './lib/stable-file.mjs';

if (process.platform === 'win32') {
  console.log('SKIP: isolated pilot Bash recipe is Linux/macOS; native CLI controls run separately');
  process.exit(0);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const guide = readFileSync(join(root, 'docs/team-pilot.md'), 'utf8');
const blocks = [...guide.matchAll(/<!-- team-pilot-setup:start -->\s*```sh\n([\s\S]*?)```\s*<!-- team-pilot-setup:end -->/g)];
assert.equal(blocks.length, 1, 'exactly one maintained executable setup block');
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
  assert.deepEqual(fingerprint(), before, 'production harness configurations unchanged');
  console.log('PASS: documented pilot setup, isolated identities, private credentials, no token output and no overwrite');
} finally {
  rmSync(base, { recursive: true, force: true });
}
