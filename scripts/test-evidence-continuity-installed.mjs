import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function runInstalledEvidenceContinuity(packageRoot) {
  const installed = realpathSync(packageRoot);
  assert.notEqual(installed, realpathSync(fileURLToPath(new URL('..', import.meta.url))));
  const load = name => import(pathToFileURL(join(installed, 'mcp-memory-server', 'dist', name + '.js')).href);
  const { hardenPrivatePath } = await load('platform-security');
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-installed-continuity-'))); hardenPrivatePath(scratch);
  const project = join(scratch, 'project with spaces'); mkdirSync(project, { mode: 0o700 }); hardenPrivatePath(project);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CAIRN_|MCP_|NODE_OPTIONS|NODE_PATH)/.test(k) && !/(API_KEY|TOKEN|SECRET)/.test(k)));
  Object.assign(env, { HOME: scratch, USERPROFILE: scratch });
  const run = (...args) => {
    const r = spawnSync(process.execPath, [join(installed, 'bin/cairn'), ...args, '--project', project, '--json'],
      { env, cwd: scratch, encoding: 'utf8', timeout: process.platform === 'win32' ? 180000 : 30000 });
    assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
  };
  const input = (name, value) => { const path = join(scratch, name); writeFileSync(path, JSON.stringify(value), { mode: 0o600 }); hardenPrivatePath(path); return path; };
  try {
    writeFileSync(join(project, 'source.md'), 'Do NOT expose port 8080.');
    writeFileSync(join(project, 'page.md'), '# Access\n');
    const manifest = input('manifest.json', { schema_version: 1, pages: [{ path: 'page.md', sources: [{ path: 'source.md', quotes: ['Do NOT expose port 8080.'] }], links: [] }] });
    const plan = run('wiki-evidence', 'plan', '--input', manifest);
    run('wiki-evidence', 'apply', '--input', input('plan.json', plan), '--confirm', plan.digest);
    assert.equal(run('wiki-evidence', 'check', plan.digest).ok, true);
    const packet = run('continuation', 'create', '--input', input('packet.json', { schema_version: 1, owner: 'operator', goal: 'Resume work',
      projects: [{ id: 'demo', root: project }], entries: [{ project: 'demo', kind: 'decision', status: 'observed', text: 'Do NOT expose port 8080.', evidence: [{ path: 'source.md', quote: 'Do NOT expose port 8080.' }] }] }));
    assert.deepEqual(run('continuation', 'show', packet.digest), run('continuation', 'show', packet.digest));
    // Seed in a separate process, as a real completed capture would. Some SDK
    // versions retain a native database lock until the seeding process exits.
    const seeded = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import {pathToFileURL} from 'node:url'; import {join} from 'node:path';
      const [installed,project]=process.argv.slice(1);
      const load=name=>import(pathToFileURL(join(installed,'mcp-memory-server','dist',name+'.js')).href);
      const {putTrajectory}=await load('trajectory-store'); const {redactTrajectory}=await load('trajectory-redaction');
      for(const session_id of ['one','two']) await putTrajectory(project,redactTrajectory({
        schema_version:1,session_id,harness:'pi',project_root:project,
        started_at:'2026-11-01T10:00:00Z',ended_at:'2026-11-01T10:01:00Z',
        events:[{sequence:0,kind:'tool_result',payload:{text:'Do NOT expose port 8080.'}}],
        capture:{captured_at:'2026-11-01T10:01:00Z',omitted_reasoning_blocks:0,omitted_unknown_records:0,truncated:false}
      },project),{sessionMaxBytes:1048576,storeMaxBytes:4194304,retentionDays:3650});
    `, installed, project], { env, encoding: 'utf8', timeout: 30000 });
    assert.equal(seeded.status, 0, seeded.stderr);
    const proposal = run('proposals', 'consolidate', '--session', 'one', '--session', 'two', '--scope', 'project', '--input', input('candidates.json', {
      schema_version: 1, candidates: [{ key: 'constraints/network', value: 'Do NOT expose port 8080.', status: 'asserted', preserve: ['Do NOT expose port 8080.'],
        evidence: [{ session_id: 'one', sequence: 0, quote: 'Do NOT expose port 8080.' }] }],
    }));
    assert.equal(proposal.schema_version, 2); assert.equal(run('proposals', 'apply', proposal.digest).applied, true);
    assert.equal(run('proposals', 'apply', proposal.digest).idempotent, true);
    console.log('PASS: actual installed evidence plan/check, non-consuming packet and source-bound consolidation/apply');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runInstalledEvidenceContinuity(process.argv[2]);
