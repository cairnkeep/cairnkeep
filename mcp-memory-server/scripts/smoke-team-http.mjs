import assert from 'node:assert/strict';
import { hardenPrivatePath } from '../dist/platform-security.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { openTeamStore } from '../dist/team-store.js';
import { createTeamHttpServer, teamRequest } from '../dist/team-http.js';

process.env.CAIRN_TEAM = '1';
const base = mkdtempSync(join(tmpdir(), 'cairn-team-http-'));
hardenPrivatePath(base);
const store = await openTeamStore(join(base, 'team'), { create: true, organization: 'demo-org' });
let server;
try {
  delete process.env.CAIRN_TEAM_HTTP;
  assert.throws(() => createTeamHttpServer(store), /disabled/);
  process.env.CAIRN_TEAM_HTTP = '1';
  await store.admin({ operation: 'project-create', project: 'alpha' });
  await store.admin({ operation: 'member-set', project: 'alpha', subject: 'alice', roles: ['reader'] });
  const credential = await store.issue({ subject: 'alice', credential_class: 'human', expires_at: new Date(Date.now() + 3600000).toISOString() });
  server = createTeamHttpServer(store);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ organization: 'demo-org', project: 'alpha', operation: 'list' });
  const send = (headers = {}, content = body) => new Promise((resolve, reject) => {
    const request = httpRequest(`${url}/v1/team/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential.token}`, 'Content-Length': Buffer.byteLength(content), ...headers } }, response => { response.resume(); response.on('end', () => resolve({ status: response.statusCode })); });
    request.on('error', reject); request.end(content);
  });
  assert.equal((await send({ Authorization: '' })).status, 401);
  assert.equal((await send({ Host: 'foreign.invalid' })).status, 403);
  assert.equal((await send({ Origin: 'https://foreign.invalid' })).status, 403);
  assert.equal((await send({}, 'not json')).status, 400);
  assert.equal((await send({}, 'x'.repeat(512 * 1024 + 1))).status, 413);
  const chunked = await new Promise((resolve, reject) => {
    const request = httpRequest(`${url}/v1/team/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential.token}` } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject); request.write('x'.repeat(512 * 1024)); request.end('x');
  });
  assert.equal(chunked, 413, 'chunked overflow must return a bounded error, not reset the socket');
  assert.equal((await fetch(`${url}/v1/team/execute`, { headers: { Authorization: `Bearer ${credential.token}` } })).status, 405);
  assert.deepEqual(await teamRequest(url, credential.token, JSON.parse(body)), []);
  assert.equal((await send({}, JSON.stringify({ ...JSON.parse(body), subject: 'bob' }))).status, 400);
  assert.equal((await send({}, JSON.stringify({ ...JSON.parse(body), project: 'beta' }))).status, 403);
  await assert.rejects(teamRequest('http://remote.invalid', credential.token, JSON.parse(body)), /invalid/);
  await assert.rejects(teamRequest(`http://user:password@127.0.0.1:${server.address().port}`, credential.token, JSON.parse(body)), /invalid/);
  const duringBody = await new Promise((resolve, reject) => {
    const request = httpRequest(`${url}/v1/team/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential.token}` } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject); request.flushHeaders(); request.write(body.slice(0, 10));
    // Let the server pass its initial check before revoking while the body is unfinished.
    setTimeout(async () => {
      try { await store.admin({ operation: 'credential-revoke', credential: credential.id }); request.end(body.slice(10)); }
      catch (error) { request.destroy(); reject(error); }
    }, 40);
  });
  assert.equal(duringBody, 401, 'authorization must be rechecked after receiving the body');
  assert.equal((await send()).status, 401, 'existing client has no authorization after revocation');
  console.log('ok: independent HTTP consent, auth, Host/origin, body/method/schema limits, endpoint safety and revocation');
} finally {
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await store.close(); rmSync(base, { recursive: true, force: true });
}
