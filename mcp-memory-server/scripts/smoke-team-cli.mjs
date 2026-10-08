import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hardenPrivatePath, privatePathIsSafe } from '../dist/platform-security.js';
import { openTeamStore } from '../dist/team-store.js';
import { assertUninstallRetainsTeam } from '../../scripts/lib/team-retention.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = mkdtempSync(join(tmpdir(), 'cairn-team-cli-'));
hardenPrivatePath(base);
const data = join(base, 'store');
// Keep a strict process-exit bound while allowing native Windows ACL subprocesses.
const timeout = process.platform === 'win32' ? 120000 : 10000;
const run = (args, env = {}) => spawnSync(process.execPath, [join(root, 'bin/cairn'), 'team', ...args], {
  env: { ...process.env, CAIRN_TEAM: '1', CAIRN_TEAM_BASE_DIR: data, ...env }, timeout, encoding: 'utf8',
});
process.env.CAIRN_TEAM = '1';
let liveStore;
try {
  assert.equal(run(['--help'], { CAIRN_TEAM: '' }).status, 0);
  assert.equal(run(['init', '--organization', 'demo-org'], { CAIRN_TEAM: '' }).status, 1);
  assert.equal(existsSync(data), false, 'disabled CLI creates no store');
  assert.equal(run(['init', '--organization', 'demo-org', '--confirm', 'irrelevant']).status, 1);
  assert.equal(existsSync(data), false, 'irrelevant flags fail before store access');
  assert.equal(run(['init', '--organization', 'demo-org']).status, 0, 'administrative CLI must return to the shell');
  assert.equal(run(['project', 'create', 'alpha']).status, 0);
  const tokenPath = join(base, 'alice.token');
  const issue = run(['credential', 'issue', 'alice', '--class', 'human', '--expires-at', new Date(Date.now() + 3600000).toISOString(), '--output', tokenPath]);
  assert.equal(issue.status, 0); assert.equal(privatePathIsSafe(tokenPath), true);
  const token = readFileSync(tokenPath, 'utf8').trim();
  assert.equal(`${issue.stdout}${issue.stderr}`.includes(token), false);
  assert.equal(run(['credential', 'issue', 'alice', '--class', 'human', '--expires-at', new Date(Date.now() + 3600000).toISOString(), '--output', tokenPath]).status, 1);
  assert.equal(readFileSync(tokenPath, 'utf8').trim(), token, 'exclusive credentials preserve existing output');
  assert.equal(run(['project', 'create', 'beta']).status, 0);
  for (const project of ['alpha', 'beta']) assert.equal(run(['member', 'set', 'alice', '--project', project, '--roles', 'reader']).status, 0);
  liveStore = await openTeamStore(data);
  const list = project => liveStore.execute(token, { organization: 'demo-org', project, operation: 'list' });
  assert.deepEqual(await list('alpha'), []);
  assert.equal(run(['member', 'remove', 'alice', '--project', 'alpha']).status, 0, 'explicit project membership removal must return to the shell');
  await assert.rejects(list('alpha'), /denied/, 'removal applies to an already-open store/client credential');
  assert.deepEqual(await list('beta'), [], 'removal does not revoke credentials or membership in other projects');
  assert.match(run(['--help']).stdout, /member remove SUBJECT --project ID/);
  assert.equal(run(['member', 'remove', 'alice', '--project', 'alpha', '--roles', 'reader']).status, 1, 'remove cannot silently accept role assignments');
  assert.equal(run(['member', 'remove', 'alice']).status, 1, 'removal requires an explicit project');
  assert.equal(run(['member', 'remove', 'alice', 'unexpected', '--project', 'alpha']).status, 1);
  assert.equal(run(['member', 'remove', 'alice', '--project', 'missing']).status, 1);
  assert.equal(run(['member', 'remove', 'alice', '--project', 'beta'], { CAIRN_TEAM: '' }).status, 1);
  assert.deepEqual(await list('beta'), [], 'disabled removal leaves membership intact');
  assert.equal(run(['member', 'set', 'alice', '--project', 'alpha', '--roles', 'reader']).status, 0);
  assert.deepEqual(await list('alpha'), [], 'explicit re-enrollment restores access without replacing the credential');
  for (const roles of [undefined, '', ',', 'unknown']) {
    const args = ['member', 'set', 'alice', '--project', 'alpha', ...(roles === undefined ? [] : ['--roles', roles])];
    assert.equal(run(args).status, 1, 'set requires an explicit nonempty list of valid roles');
    assert.deepEqual(await list('alpha'), [], 'invalid set must not accidentally clear project membership');
  }
  await liveStore.close(); liveStore = undefined;
  const output = join(base, 'snapshot.json');
  assert.equal(run(['backup', '--output', output]).status, 0);
  assert.equal(privatePathIsSafe(output), true);
  assert.equal(run(['backup', '--output', output]).status, 1);
  const snapshot = JSON.parse(readFileSync(output, 'utf8'));
  const membershipEvents = snapshot.audit.map(row => JSON.parse(row.value)).filter(event => event.operation === 'member-set' && event.project === 'alpha');
  assert.equal(membershipEvents.length, 3, 'grant, remove and re-enrollment use the existing audit/snapshot operation; malformed commands cannot mutate membership');
  assert.equal(run(['restore', '--input', output, '--confirm', snapshot.digest, '--data', join(base, 'restored')]).status, 0);
  assert.equal(run(['doctor', '--data', join(base, 'restored')]).status, 0);
  assert.equal(run(['restore', '--input', output, '--confirm', snapshot.digest, '--data', data]).status, 1);
  const home = join(base, 'home'); const team = join(home, '.cairnkeep', 'team');
  mkdirSync(team, { recursive: true });
  assert.throws(() => assertUninstallRetainsTeam([join(home, '.cairnkeep')], {}, home), /contains team data/);
  assert.throws(() => assertUninstallRetainsTeam([join(home, '.cairnkeep')], { CAIRN_TEAM_BASE_DIR: join(base, 'unrelated') }, home), /contains team data/, 'an override does not authorize deletion of a retained default store');
  assert.doesNotThrow(() => assertUninstallRetainsTeam([join(home, '.cairnkeep', 'packs')], {}, home));
  const uninstall = spawnSync(process.execPath, [join(root, 'bin/cairn'), 'uninstall', '--dry-run', '--yes', '--purge-memory'], {
    env: { ...process.env, HOME: home, USERPROFILE: home, CAIRN_TEAM_BASE_DIR: team, CAIRN_AGENTFS_BASE_DIR: join(home, '.cairnkeep') }, encoding: 'utf8', timeout,
  });
  assert.equal(uninstall.status, 1);
  assert.match(uninstall.stderr, /contains team data/);
  assert.equal(existsSync(team), true);
  console.log('ok: CLI exit, project membership removal/re-enrollment, disabled no-read/no-write, strict flags, exclusive private credentials/backups, fresh-only restore and uninstall retention');
} finally { await liveStore?.close(); rmSync(base, { recursive: true, force: true }); }
