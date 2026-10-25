import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, chmodSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { hardenPrivatePath } from '../dist/platform-security.js';
import { openTeamStore, teamDigest } from '../dist/team-store.js';
import { createTeamHttpServer } from '../dist/team-http.js';
import { connectionDoctor, readTeamConnection } from '../dist/team-client.js';
import { planTeamConnection, applyTeamConnection, disconnectTeamConnection, runTeamConnection } from '../../scripts/team-connect.mjs';
import { randomUUID } from 'node:crypto';
import { assertUninstallRetainsTeam } from '../../scripts/lib/team-retention.mjs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { sep } from 'node:path';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-team-onboarding-')));
hardenPrivatePath(base);
const home = join(base, 'home'); mkdirSync(home, { mode: 0o700 }); hardenPrivatePath(home);
const projectRoot = join(base, 'project with spaces'); mkdirSync(projectRoot, { mode: 0o700 });
const data = join(base, 'store');
process.env.CAIRN_TEAM = '1'; process.env.CAIRN_TEAM_HTTP = '1';
let store, server;
const clients = [];
const output = { write() {} };
try {
  store = await openTeamStore(data, { create: true, organization: 'trial-org' });
  await store.admin({ operation: 'project-create', project: 'trial-project' });
  for (const subject of ['author', 'reader']) await store.admin({ operation: 'member-set', subject, project: 'trial-project', roles: ['reader', ...(subject === 'author' ? ['contributor'] : [])] });
  await store.admin({ operation: 'member-set', subject: 'fixture-reviewer', project: 'trial-project', roles: ['reviewer'] });
  await store.admin({ operation: 'member-set', subject: 'human-reader', project: 'trial-project', roles: ['reader'] });
  const author = await store.issue({ subject: 'author', credential_class: 'workload', expires_at: new Date(Date.now() + 3600000).toISOString() });
  const reader = await store.issue({ subject: 'reader', credential_class: 'workload', expires_at: new Date(Date.now() + 3600000).toISOString() });
  const tokenFile = join(base, 'author.token'); writeFileSync(tokenFile, `${author.token}\n`, { mode: 0o600 }); hardenPrivatePath(tokenFile);
  server = createTeamHttpServer(store); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const personal = { command: 'personal-memory', args: ['unchanged'] };
  const unrelated = { command: 'unrelated-tool' };
  const original = `${JSON.stringify({ mcpServers: { 'cairn-memory': personal, other: unrelated }, permissions: { keep: true } }, null, 4)}\n`;
  writeFileSync(join(projectRoot, '.mcp.json'), original, { mode: 0o600 });
  const options = { projectRoot, organization: 'trial-org', project: 'trial-project', url, tokenFile, harnesses: ['claude', 'opencode', 'codex', 'qwen'], access: 'full', home };
  const plan = planTeamConnection(options);
  assert.equal(existsSync(join(home, '.cairnkeep')), false, 'planning makes no writes');
  assert.equal(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'), original);
  const result = await applyTeamConnection(plan);
  assert.equal(result.connected, true);
  const connection = readTeamConnection(result.connection_file);
  const savedConnection = readFileSync(result.connection_file);
  try {
    writeFileSync(result.connection_file, Buffer.concat([savedConnection, Buffer.from(' ')]));
    assert.throws(() => readTeamConnection(result.connection_file), /activation|changed|integrity/, 'activation must bind exact connection bytes');
  } finally { writeFileSync(result.connection_file, savedConnection); }
  assert.equal(JSON.stringify(connection).includes(author.token), false);
  assert.equal((await connectionDoctor(connection)).ok, true);
  await assert.rejects(connectionDoctor({ ...connection, project: 'other' }), /denied/);
  await assert.rejects(connectionDoctor({ ...connection, organization: 'other' }), /denied/);
  const merged = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
  assert.deepEqual(merged.mcpServers['cairn-memory'], personal);
  assert.deepEqual(merged.mcpServers.other, unrelated);
  assert.deepEqual(merged.permissions, { keep: true });
  assert.equal(JSON.stringify(merged).includes(author.token), false);
  assert.equal((await applyTeamConnection(planTeamConnection(options))).unchanged, true);

  async function connect(entry, cwd) {
    const transport = new StdioClientTransport({ command: entry.command, args: entry.args, env: { ...process.env, ...entry.env }, cwd });
    const client = new Client({ name: 'synthetic-adapter-client', version: '1' }, { capabilities: {} });
    clients.push({ client, transport }); await client.connect(transport); return client;
  }
  const a = await connect(merged.mcpServers['cairn-team-memory'], base);
  const value = 'Synthetic handoff: changes require explicit review; personal memory stays private.';
  const proposal = await a.callTool({ name: 'team_memory_propose', arguments: { project: 'trial-project', request_id: randomUUID(), key: 'decisions/handoff', value, source_scope: 'selected-local', source_digest: teamDigest('selected fixture'), base_revision: null, expires_at: new Date(Date.now() + 3600000).toISOString(), confirm: teamDigest(value) } });
  assert.equal(proposal.isError, undefined);
  assert.equal((await a.callTool({ name: 'team_memory_list', arguments: { project: 'trial-project' } })).structuredContent.result.length, 0, 'agent proposal never publishes itself');
  assert.equal((await a.callTool({ name: 'team_memory_list', arguments: { project: 'other' } })).isError, true, 'saved connection is project-pinned');
  assert.equal((await a.listTools()).tools.some(t => /review|credential|member/.test(t.name)), false);
  // A second workload identity resumes through a different adapter and folder.
  const secondRoot = join(base, 'second project'); mkdirSync(secondRoot, { mode: 0o700 });
  const readerFile = join(base, 'reader.token'); writeFileSync(readerFile, reader.token, { mode: 0o600 }); hardenPrivatePath(readerFile);
  await applyTeamConnection(planTeamConnection({ ...options, projectRoot: secondRoot, tokenFile: readerFile, harnesses: ['opencode'], access: 'read-only' }));
  const open = JSON.parse(readFileSync(join(secondRoot, 'opencode.json'), 'utf8')).mcp['cairn-team-memory'];
  const b = await connect({ command: open.command[0], args: open.command.slice(1), env: open.environment }, home);
  assert.equal((await b.listTools()).tools.some(t => t.name === 'team_memory_propose'), false);
  assert.deepEqual((await b.callTool({ name: 'team_memory_list', arguments: { project: 'trial-project' } })).structuredContent.result, [], 'unreviewed text invisible across identities');
  const proposalId = proposal.structuredContent.result.id;
  const pending = await store.execute(author.token, { organization: 'trial-org', project: 'trial-project', operation: 'proposal-show', proposal_id: proposalId });
  assert.equal(pending.input.value, value);
  await assert.rejects(store.execute(author.token, { organization: 'trial-org', project: 'trial-project', operation: 'review', proposal_id: proposalId, confirm: pending.digest, decision: 'approve' }), /denied/);
  // Automated policy fixture ONLY, not a human-consent claim or live pilot.
  const fixtureReviewer = await store.issue({ subject: 'fixture-reviewer', credential_class: 'human', expires_at: new Date(Date.now() + 3600000).toISOString() });
  await store.execute(fixtureReviewer.token, { organization: 'trial-org', project: 'trial-project', operation: 'review', proposal_id: proposalId, confirm: pending.digest, decision: 'approve' });
  const aRead = (await a.callTool({ name: 'team_memory_read', arguments: { project: 'trial-project', key: 'decisions/handoff' } })).structuredContent.result;
  const bRead = (await b.callTool({ name: 'team_memory_read', arguments: { project: 'trial-project', key: 'decisions/handoff' } })).structuredContent.result;
  assert.equal(aRead.value, value); assert.deepEqual(aRead, bRead, 'different identities/adapters/folders see identical reviewed revision and provenance');
  const diagnostic = await connectionDoctor(connection);
  assert.equal(diagnostic.subject, 'author'); assert.equal(diagnostic.credential_id, author.id);
  assert.equal(JSON.stringify(diagnostic).includes(value), false, 'diagnostics return no shared text');
  const realNow = Date.now;
  try { Date.now = () => realNow() + 7200000; await assert.rejects(connectionDoctor(connection), /unauthorized/); }
  finally { Date.now = realNow; }
  await store.admin({ operation: 'credential-revoke', credential: reader.id });
  assert.equal((await b.callTool({ name: 'team_memory_list', arguments: { project: 'trial-project' } })).isError, true);
  await assert.rejects(connectionDoctor({ ...connection, token_file: readerFile }), /unauthorized/);
  if (process.platform !== 'win32') {
    chmodSync(tokenFile, 0o644);
    await assert.rejects(connectionDoctor(connection), /credential/i);
    chmodSync(tokenFile, 0o600);
  }

  // Unrelated edits survive disconnect; an edited owned entry does not get removed.
  merged.permissions.new = 'keep too';
  writeFileSync(join(projectRoot, '.mcp.json'), JSON.stringify(merged));
  const originalOpen = fs.openSync, originalClose = fs.closeSync, originalRename = fs.renameSync;
  const descriptors = new Map();
  let archived = false;
  fs.openSync = (...args) => { const fd = originalOpen(...args); descriptors.set(fd, resolve(String(args[0]))); return fd; };
  fs.closeSync = fd => { descriptors.delete(fd); return originalClose(fd); };
  fs.renameSync = (source, destination) => {
    if (String(destination).includes('.disconnected-')) {
      archived = true;
      // Reproduce native Windows' refusal to rename a directory while a child
      // file remains open. The operation lock must stay outside the moved tree.
      if ([...descriptors.values()].some(path => path.startsWith(`${resolve(source)}${sep}`))) {
        throw Object.assign(new Error('synthetic Windows open-child rename denial'), { code: 'EPERM' });
      }
      assert.ok([...descriptors.values()].includes(`${resolve(source)}.operation.lock`), 'sibling lock stays held throughout directory archive');
    }
    return originalRename(source, destination);
  };
  syncBuiltinESMExports();
  try { await disconnectTeamConnection({ projectRoot, home }); }
  finally {
    fs.openSync = originalOpen; fs.closeSync = originalClose; fs.renameSync = originalRename;
    syncBuiltinESMExports();
  }
  assert.equal(archived, true, 'actual directory archive path must be exercised');
  const disconnected = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
  assert.deepEqual(disconnected.mcpServers, { 'cairn-memory': personal, other: unrelated });
  assert.equal(disconnected.permissions.new, 'keep too');
  assert.equal(readFileSync(tokenFile, 'utf8').trim(), author.token);
  assert.throws(() => readTeamConnection(result.connection_file), /unsafe|unreadable|incomplete/);
  assert.equal(existsSync(join(projectRoot, '.codex/config.toml')), false);
  assert.equal(existsSync(data), true);

  function fresh(name) {
    const root = join(base, name); mkdirSync(root, { mode: 0o700 });
    return { ...options, projectRoot: root, harnesses: ['claude', 'opencode'], access: 'read-only' };
  }
  const interrupted = fresh('interrupted');
  const interruptedPlan = planTeamConnection(interrupted);
  await assert.rejects(applyTeamConnection(interruptedPlan, { beforeWrite(row) {
    assert.throws(() => readTeamConnection(interruptedPlan.connectionFile), /incomplete/);
    if (row.harness === 'opencode') throw new Error('injected interruption');
  } }), /injected interruption/);
  assert.equal(existsSync(join(interrupted.projectRoot, '.mcp.json')), true);
  assert.throws(() => readTeamConnection(interruptedPlan.connectionFile), /incomplete/, 'failed multi-file connect never activates a partial bridge');
  await disconnectTeamConnection({ projectRoot: interrupted.projectRoot, home });
  assert.equal(existsSync(join(interrupted.projectRoot, '.mcp.json')), false);

  const concurrent = fresh('concurrent'); const competingPlan = planTeamConnection(concurrent);
  const competitors = await Promise.allSettled([applyTeamConnection(competingPlan), applyTeamConnection(competingPlan)]);
  assert.equal(competitors.filter(r => r.status === 'fulfilled').length, 1, 'one connection writer wins');
  await disconnectTeamConnection({ projectRoot: concurrent.projectRoot, home });

  const large = { ...fresh('large-configurations'), harnesses: ['claude', 'opencode', 'qwen', 'codex'] };
  const largeBytes = `${JSON.stringify({ note: 'x'.repeat(900 * 1024) })}\n`;
  mkdirSync(join(large.projectRoot, '.qwen'), { mode: 0o700 });
  mkdirSync(join(large.projectRoot, '.codex'), { mode: 0o700 });
  for (const name of ['.mcp.json', 'opencode.json', '.qwen/settings.json']) writeFileSync(join(large.projectRoot, name), largeBytes, { mode: 0o600 });
  const largeToml = `# ${'x'.repeat(900 * 1024)}\n`;
  writeFileSync(join(large.projectRoot, '.codex/config.toml'), largeToml, { mode: 0o600 });
  const largeConnection = await applyTeamConnection(planTeamConnection(large));
  assert.equal(readTeamConnection(largeConnection.connection_file).project, 'trial-project', 'all four near-limit configs fit the bounded recovery receipt');
  await disconnectTeamConnection({ projectRoot: large.projectRoot, home });
  assert.equal(readFileSync(join(large.projectRoot, '.mcp.json'), 'utf8'), largeBytes);
  assert.equal(readFileSync(join(large.projectRoot, '.codex/config.toml'), 'utf8'), largeToml);

  const recover = fresh('disconnect-recovery');
  await applyTeamConnection(planTeamConnection(recover));
  const recoverFile = join(recover.projectRoot, '.mcp.json');
  const recoverConfig = JSON.parse(readFileSync(recoverFile, 'utf8')); recoverConfig.operator = 'preserve';
  writeFileSync(recoverFile, JSON.stringify(recoverConfig));
  await assert.rejects(disconnectTeamConnection({ projectRoot: recover.projectRoot, home, beforeWrite(row) { if (row.harness === 'opencode') throw new Error('injected disconnect'); } }), /injected disconnect/);
  await disconnectTeamConnection({ projectRoot: recover.projectRoot, home });
  assert.equal(JSON.parse(readFileSync(recoverFile, 'utf8')).operator, 'preserve', 'interrupted disconnect resumes without replacing unrelated edits');

  const malformed = fresh('malformed'); const malformedFile = join(malformed.projectRoot, '.mcp.json');
  for (const bytes of ['{"mcpServers":{},"mcpServers":{"other":{}}}', '{"mcpServers":{"x":{},"\\u0078":{}}}', '{"mcpServers":[]}', '{ invalid synthetic-private-payload }']) {
    writeFileSync(malformedFile, bytes, { mode: 0o600 });
    assert.throws(() => planTeamConnection(malformed), /JSON|object/);
    assert.equal(readFileSync(malformedFile, 'utf8'), bytes);
  }
  const logs = [];
  const sink = { write(value) { logs.push(value); } };
  const flags = ['connect', '--project-root', malformed.projectRoot, '--url', url, '--organization', 'trial-org', '--project', 'trial-project', '--token-file', tokenFile, '--harness', 'claude'];
  assert.equal(await runTeamConnection(flags, { input: { isTTY: false }, output: sink, error: sink, home }), 1);
  assert.equal(logs.join('').includes('synthetic-private-payload'), false);
  assert.equal(logs.join('').includes(author.token), false);
  const dry = fresh('dry-run');
  const dryFlags = [...flags]; dryFlags[dryFlags.indexOf('--project-root') + 1] = dry.projectRoot;
  assert.equal(await runTeamConnection(dryFlags, { input: { isTTY: false }, output, error: output, home }), 0);
  assert.equal(existsSync(join(dry.projectRoot, '.mcp.json')), false);
  assert.equal(await runTeamConnection([...dryFlags, '--apply'], { input: { isTTY: false }, output, error: output, home }), 1);
  assert.equal(existsSync(planTeamConnection(dry).state), false, 'no-apply and missing-confirmation paths write nothing');
  const human = await store.issue({ subject: 'human-reader', credential_class: 'human', expires_at: new Date(Date.now() + 3600000).toISOString() });
  const humanFile = join(base, 'human-reader.token'); writeFileSync(humanFile, human.token, { mode: 0o600 }); hardenPrivatePath(humanFile);
  const humanOptions = { ...fresh('human-credential-denied'), tokenFile: humanFile };
  await assert.rejects(applyTeamConnection(planTeamConnection(humanOptions)), /workload credential/);
  assert.equal(existsSync(join(humanOptions.projectRoot, '.mcp.json')), false, 'human token is never installed into an agent harness');
  if (process.platform !== 'win32') {
    const linked = fresh('symlink'); symlinkSync(join(projectRoot, '.mcp.json'), join(linked.projectRoot, '.mcp.json'));
    assert.throws(() => planTeamConnection(linked), /symlink|unsafe/);
  }
  assert.throws(() => assertUninstallRetainsTeam([join(home, '.cairnkeep')], {}, home), /team data/);

  await applyTeamConnection(planTeamConnection(options));
  const drift = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
  drift.mcpServers['cairn-team-memory'].command = 'operator-change';
  const driftBytes = JSON.stringify(drift); writeFileSync(join(projectRoot, '.mcp.json'), driftBytes);
  await assert.rejects(disconnectTeamConnection({ projectRoot, home }), /changed|drift/i);
  assert.equal(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'), driftBytes);
  assert.throws(() => planTeamConnection({ ...options, url: 'https://user:secret@example.invalid' }), /URL/i);
  assert.throws(() => planTeamConnection({ ...options, harnesses: ['pi'] }), /harness/i);
  const saved = process.env.CAIRN_TEAM; delete process.env.CAIRN_TEAM;
  assert.throws(() => planTeamConnection(options), /disabled/);
  assert.equal(await runTeamConnection(['connect'], { input: { isTTY: false }, output, error: output, home }), 1);
  process.env.CAIRN_TEAM = saved;
  console.log('ok: opt-in additive connection, private token references, client doctor, two-identity/cwd/adapter continuity, no self-publication, revocation, drift-safe disconnect');
} finally {
  for (const { client, transport } of clients) { await client.close().catch(() => {}); await transport.close().catch(() => {}); }
  if (server) await new Promise(r => { server.close(r); server.closeAllConnections(); });
  await store?.close(); rmSync(base, { recursive: true, force: true });
}
