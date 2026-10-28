// Disposable, provider-free stdio lab shared by continuity contracts and studies.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { hardenPrivatePath } from '../dist/platform-security.js';

export const serverEntry = fileURLToPath(new URL('../dist/index.js', import.meta.url));

export function createContinuityLab() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cairn-memory-continuity-')));
  hardenPrivatePath(root);
  const projects = Object.fromEntries(['alpha', 'beta', 'neutral'].map(name => {
    const path = join(root, name); mkdirSync(path, { mode: 0o700 });
    mkdirSync(join(path, '.agent'), { mode: 0o700 });
    writeFileSync(join(path, '.agent', 'memory.json'), JSON.stringify({ scopes: ['project', 'identity'] }), { mode: 0o600 });
    return [name, path];
  }));
  const home = join(root, 'home'); mkdirSync(home, { mode: 0o700 });
  const networkMarker = join(root, 'network-attempt');
  const preload = join(root, 'deny-network.mjs');
  // Record attempted networking even if production code catches the failure.
  writeFileSync(preload, `import net from 'node:net';
import tls from 'node:tls';
import { writeFileSync } from 'node:fs';
const deny = () => { writeFileSync(${JSON.stringify(networkMarker)}, 'attempt', {mode:0o600}); throw new Error('CONTINUITY_NETWORK_FORBIDDEN'); };
net.Socket.prototype.connect = deny; tls.connect = deny; globalThis.fetch = deny;
`, { mode: 0o600 });
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(CAIRN_|OPENAI_|OPENROUTER_|ANTHROPIC_|MCP_|AGENT_MEMORY_CONFIG$|NODE_OPTIONS$|NODE_PATH$|XDG_|APPDATA$|LOCALAPPDATA$)/.test(key)));
  const env = {
    ...clean, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, 'config'),
    XDG_STATE_HOME: join(home, 'state'), XDG_CACHE_HOME: join(home, 'cache'),
    APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'localappdata'),
    CAIRN_AGENTFS_BASE_DIR: join(root, 'stores'), CAIRN_PACK_BASE_DIR: join(root, 'packs'),
  };
  const active = new Set();
  return {
    root, projects, env,
    assertOffline() { assert.equal(existsSync(networkMarker), false, 'local continuity paths attempted network access'); },
    async connect(project = 'alpha', extra = {}, label = 'fixture-reader') {
      assert.ok(Object.hasOwn(projects, project), 'unknown lab project');
      const transport = new StdioClientTransport({ command: process.execPath,
        args: ['--import', pathToFileURL(preload).href, serverEntry], cwd: projects[project],
        env: { ...env, ...extra }, stderr: 'pipe' });
      transport.stderr?.resume();
      const client = new Client({ name: label, version: '1' }, { capabilities: {} });
      const entry = { client, transport }; active.add(entry);
      try { await client.connect(transport); } catch (error) { await transport.close(); active.delete(entry); throw error; }
      return {
        client,
        async call(name, input) {
          const result = await client.callTool({ name, arguments: input });
          assert.notEqual(result.isError, true, `fixture ${name} failed: ${JSON.stringify(result)}`);
          return result.structuredContent ?? JSON.parse(result.content[0].text);
        },
        async close() { await client.close(); await transport.close(); active.delete(entry); },
      };
    },
    async close() {
      try { for (const { client, transport } of active) { await client.close(); await transport.close(); } }
      finally { rmSync(root, { recursive: true, force: true }); }
    },
  };
}
