import { chmodSync, closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve, parse, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { readStableFile, assertFileUnchanged } from './lib/stable-file.mjs';
import { selectManyPrompt, selectOnePrompt, supportsTerminalPrompts } from './terminal-prompts.mjs';
import { readStableJson } from '../mcp-memory-server/dist/stable-file.js';
import { hardenPrivatePath } from '../mcp-memory-server/dist/platform-security.js';
import { prepareTeamPrivateDirectory, TeamError } from '../mcp-memory-server/dist/team-store.js';
import { validateTeamConnection, readTeamConnection, connectionToken, connectionDoctor, TeamClientError } from '../mcp-memory-server/dist/team-client.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'cairn-team-memory';
const MAX = 1024 * 1024;
const ADAPTERS = Object.freeze({ claude: '.mcp.json', opencode: 'opencode.json', qwen: '.qwen/settings.json', codex: '.codex/config.toml' });
const HELP = `cairn team connect — opt-in, project-local team MCP (personal memory unchanged)

  cairn team connect [--project-root PATH] [--url URL --organization ID --project ID --token-file FILE --harness claude,opencode,qwen,codex] [--access read-only|full] [--apply --yes]
  cairn team disconnect [--project-root PATH] [--apply --yes]
  cairn team doctor --client [--project-root PATH]

CAIRN_TEAM=1 is required. Without --apply a complete command is a no-write plan.
Interactive connect asks for missing choices and confirms before applying.
Credentials remain in owner-only files OUTSIDE source trees. No token values are
stored in harness config. Existing team entries/unsupported syntax fail closed.
Doctor checks authenticated reader access, not production admission. Disconnect
keeps credentials/backups; restart existing harness sessions or ask the operator
to revoke a credential for immediate denial. See docs/team-onboarding.md.
`;
class ConnectionError extends Error {}
function fail(message) { throw new ConnectionError(message); }
function enabled() { if (process.env.CAIRN_TEAM !== '1') fail('Team disabled. Opt in explicitly with CAIRN_TEAM=1.'); }
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function info(path) { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function safeAncestors(path) {
  let cursor = resolve(path);
  while (true) {
    const stat = info(cursor);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink()
      || (process.platform !== 'win32' && (stat.mode & 0o022) !== 0 && !(stat.mode & 0o1000)))) fail('Team configuration has an unsafe directory ancestor.');
    if (cursor === dirname(cursor)) break;
    cursor = dirname(cursor);
  }
}
function locations(projectRoot, home = homedir()) {
  const target = realpathSync(resolve(projectRoot));
  if (target === parse(target).root || /[\x00-\x1f\x7f]/.test(target)) fail('Invalid team project root.');
  safeAncestors(target);
  const targetInfo = lstatSync(target);
  if (process.platform !== 'win32' && ((targetInfo.mode & 0o022) !== 0 || (typeof process.getuid === 'function' && targetInfo.uid !== process.getuid()))) fail('Team project directory must be owned by this user and not writable by other users.');
  const state = join(realpathSync(resolve(home)), '.cairnkeep', 'team-clients', hash(target));
  safeAncestors(state);
  return { target, state, connectionFile: join(state, 'connection.json'), receiptFile: join(state, 'receipt.json') };
}
function snapshot(path) {
  if (!info(path)) return null;
  const current = readStableFile(path, { label: 'Harness configuration', maxBytes: MAX });
  if (process.platform !== 'win32' && (current.stat.mode & 0o022)) fail('Harness configuration must not be writable by other users.');
  return current;
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
// Refuse duplicate object keys, including escaped spellings. JSON.parse alone
// would silently discard a preexisting MCP entry hidden behind a duplicate key.
function parseConfig(text) {
  let offset = 0;
  const ws = () => { while (/\s/.test(text[offset] ?? '') && offset < text.length) offset++; };
  function string() {
    const start = offset++;
    while (offset < text.length) { const ch = text[offset++]; if (ch === '\\') offset++; else if (ch === '"') return JSON.parse(text.slice(start, offset)); }
    fail('Harness configuration contains invalid JSON.');
  }
  function value(depth = 0) {
    if (depth > 100) fail('Harness configuration is nested too deeply.');
    ws();
    if (text[offset] === '"') { string(); return; }
    if (text[offset] === '{') {
      offset++; ws(); const keys = new Set(); if (text[offset] === '}') { offset++; return; }
      while (offset < text.length) {
        ws(); if (text[offset] !== '"') fail('Harness configuration requires strict JSON (not JSONC).');
        const key = string(); if (keys.has(key)) fail('Harness configuration has duplicate JSON keys.'); keys.add(key);
        ws(); if (text[offset++] !== ':') fail('Harness configuration contains invalid JSON.');
        value(depth + 1); ws(); const ch = text[offset++]; if (ch === '}') return; if (ch !== ',') break;
      }
      fail('Harness configuration contains invalid JSON.');
    }
    if (text[offset] === '[') {
      offset++; ws(); if (text[offset] === ']') { offset++; return; }
      while (offset < text.length) { value(depth + 1); ws(); const ch = text[offset++]; if (ch === ']') return; if (ch !== ',') break; }
      fail('Harness configuration contains invalid JSON.');
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(offset));
    if (!match) fail('Harness configuration contains invalid JSON.'); offset += match[0].length;
  }
  value(); ws(); if (offset !== text.length) fail('Harness configuration requires strict JSON.');
  const parsed = JSON.parse(text); if (!object(parsed)) fail('Harness configuration must be a JSON object.'); return parsed;
}
function text(bytes) { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
function entryFor(harness, connectionFile) {
  const args = [join(ROOT, 'bin', 'cairn'), 'team', 'mcp', '--connection', connectionFile];
  return harness === 'opencode'
    ? { type: 'local', command: [process.execPath, ...args], environment: { CAIRN_TEAM: '1' }, enabled: true }
    : { command: process.execPath, args, env: { CAIRN_TEAM: '1' } };
}
function jsonAdd(bytes, harness, entry) {
  const parsed = bytes ? parseConfig(text(bytes)) : {};
  const field = harness === 'opencode' ? 'mcp' : 'mcpServers';
  if (Object.hasOwn(parsed, field) && !object(parsed[field])) fail('Harness MCP configuration must be an object.');
  if (Object.hasOwn(parsed[field] ?? {}, NAME)) fail('Existing team MCP entry is not owned by this connection; preserve it and resolve manually.');
  parsed[field] = { ...parsed[field], [NAME]: entry };
  return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
}
function tomlBlock(entry, nonce) {
  return `\n# BEGIN cairnkeep team ${nonce}\n[mcp_servers.${NAME}]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\n[mcp_servers.${NAME}.env]\nCAIRN_TEAM = "1"\n# END cairnkeep team ${nonce}\n`;
}
function receiptAt(loc) {
  if (!info(loc.receiptFile)) return null;
  const receipt = readStableJson(loc.receiptFile, { label: 'Team connection receipt', maxBytes: 8 * MAX, private: true });
  if (!object(receipt) || receipt.schema_version !== 1 || receipt.project_root !== loc.target
    || typeof receipt.connection_digest !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.connection_digest)
    || !['preparing', 'connected', 'disconnecting'].includes(receipt.status) || !Array.isArray(receipt.files) || receipt.files.length < 1 || receipt.files.length > 4
    || new Set(receipt.files.map(row => row.harness)).size !== receipt.files.length) fail('Invalid team connection receipt.');
  for (const row of receipt.files) {
    if (!object(row) || !Object.hasOwn(ADAPTERS, row.harness) || row.path !== ADAPTERS[row.harness]
      || !(row.before === null || (typeof row.before === 'string' && row.before.length <= 1.4 * MAX))
      || typeof row.after !== 'string' || row.after.length > 1.4 * MAX
      || !Number.isInteger(row.mode) || row.mode < 0 || row.mode > 0o777
      || (row.harness === 'codex' ? typeof row.block !== 'string' : !object(row.entry))) fail('Invalid team connection receipt.');
  }
  return receipt;
}
export function planTeamConnection(options) {
  enabled();
  const loc = locations(options.projectRoot ?? process.cwd(), options.home);
  const connection = validateTeamConnection({ schema_version: 1, project_root: loc.target, organization: options.organization,
    project: options.project, url: options.url, token_file: resolve(options.tokenFile ?? ''), access: options.access ?? 'read-only' });
  if (!options.tokenFile) fail('A private token-file reference is required.');
  // Do not embed a credential path from this source tree into project config.
  const tokenRelative = relative(loc.target, realpathSync(connection.token_file));
  if (tokenRelative === '' || (!isAbsolute(tokenRelative) && tokenRelative.split(sep)[0] !== '..')) fail('Keep the credential file outside the project source tree.');
  connectionToken(connection);
  const harnesses = options.harnesses;
  if (!Array.isArray(harnesses) || !harnesses.length || harnesses.length > 4 || new Set(harnesses).size !== harnesses.length
    || harnesses.some(h => !Object.hasOwn(ADAPTERS, h))) fail('Unsupported or duplicate team harness; choose claude, opencode, qwen or codex.');
  const prior = receiptAt(loc);
  if (prior) {
    const currentConnection = readTeamConnection(loc.connectionFile);
    if (prior.status !== 'connected' || JSON.stringify(currentConnection) !== JSON.stringify(connection)
      || [...harnesses].sort().join() !== prior.files.map(r => r.harness).sort().join()) fail('Team connection already exists or is incomplete; doctor/disconnect before changing it.');
    for (const row of prior.files) {
      const current = snapshot(join(loc.target, row.path));
      if (!current || !current.bytes.equals(Buffer.from(row.after, 'base64'))) fail('Team harness configuration changed; resolve drift before reconnecting.');
    }
    return { ...loc, connection, files: prior.files, unchanged: true };
  }
  if (info(loc.connectionFile)) fail('Incomplete team connection; inspect private recovery state before retrying.');
  const nonce = randomUUID();
  const files = harnesses.map(harness => {
    const path = ADAPTERS[harness]; const destination = join(loc.target, path); safeAncestors(dirname(destination));
    if (harness === 'opencode' && info(join(loc.target, 'opencode.jsonc'))) fail('OpenCode JSONC exists; no automatic edits. Use a separate supported configuration.');
    const current = snapshot(destination); const bytes = current?.bytes ?? null;
    const entry = entryFor(harness, loc.connectionFile);
    let after, block;
    if (harness === 'codex') {
      // Do not attempt to reinterpret arbitrary operator TOML or equivalent
      // quoted/inline tables. A conservative collision check preserves it.
      if (bytes && text(bytes).includes(NAME)) fail('Existing team MCP TOML entry must be resolved manually.');
      if (bytes && /(?:^|\n)\s*(?:"mcp_servers"|'mcp_servers'|mcp_servers)\s*=/.test(text(bytes))) fail('Inline MCP TOML configuration is unsupported; preserve it and configure manually.');
      block = tomlBlock(entry, nonce); after = Buffer.concat([bytes ?? Buffer.alloc(0), Buffer.from(block)]);
    } else after = jsonAdd(bytes, harness, entry);
    if (after.length > MAX) fail('Harness configuration exceeds the 1 MiB limit.');
    return { harness, path, before: bytes?.toString('base64') ?? null, after: after.toString('base64'), mode: current ? current.stat.mode & 0o777 : 0o600, ...(block ? { block } : { entry }), expected: current?.stat ?? null };
  });
  return { ...loc, connection, files, unchanged: false };
}
function makeParents(target, directory) {
  const segments = directory.slice(target.length).split(/[\\/]/).filter(Boolean);
  let cursor = target;
  for (const segment of segments) { cursor = join(cursor, segment); if (!info(cursor)) { mkdirSync(cursor, { mode: 0o700 }); hardenPrivatePath(cursor); } safeAncestors(cursor); }
}
// Like the setup writer, this has a point-in-time drift check, not an OS CAS.
// The private state lock serializes Cairnkeep writers. Owner-controlled config
// directories are required; hostile same-identity processes are out of scope.
function publish(path, bytes, mode, expected = null) {
  safeAncestors(dirname(path));
  const parent = lstatSync(dirname(path));
  const temporary = join(dirname(path), `.cairn-team-${randomUUID()}.tmp`);
  let fd;
  try {
    fd = openSync(temporary, 'wx', mode); writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    hardenPrivatePath(temporary);
    if (process.platform !== 'win32') chmodSync(temporary, mode);
    assertFileUnchanged(path, expected, 'Team configuration');
    const now = lstatSync(dirname(path));
    if (parent.dev !== now.dev || parent.ino !== now.ino || now.isSymbolicLink()) fail('Team configuration parent changed.');
    if (expected) renameSync(temporary, path);
    else linkSync(temporary, path); // exclusive destination; never replace a competing new file
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (info(temporary)) unlinkSync(temporary);
  }
}
function lock(loc) {
  prepareTeamPrivateDirectory(loc.state, true);
  const path = join(loc.state, 'operation.lock');
  let fd;
  try { fd = openSync(path, 'wx', 0o600); }
  catch { fail('Team connection is locked or interrupted. Check running operations before manually clearing operation.lock; see recovery guide.'); }
  try { hardenPrivatePath(path); } catch (error) { closeSync(fd); unlinkSync(path); throw error; }
  let released = false;
  return (location = path) => { if (released) return; released = true; closeSync(fd); unlinkSync(location); };
}
export async function applyTeamConnection(plan, hooks = {}) {
  enabled();
  const loc = locations(plan.target, dirname(dirname(dirname(plan.state))));
  if (loc.state !== plan.state || loc.connectionFile !== plan.connectionFile) fail('Invalid team connection plan.');
  if (plan.unchanged) { await connectionDoctor(plan.connection); return { connected: true, unchanged: true, connection_file: loc.connectionFile }; }
  const unlock = lock(loc);
  try {
    if (receiptAt(loc) || info(loc.connectionFile)) fail('Team connection changed; inspect recovery state.');
    const connection = validateTeamConnection(plan.connection); connectionToken(connection);
    // Verify access before writing anything except our private lock directory.
    const identity = await connectionDoctor(connection);
    if (identity.credential_class !== 'workload') fail('Team harness connection requires a workload credential; keep human reviewer credentials outside agent configuration.');
    for (const row of plan.files) assertFileUnchanged(join(loc.target, row.path), row.expected, 'Harness configuration');
    const connectionBytes = Buffer.from(`${JSON.stringify(connection)}\n`);
    const receipt = { schema_version: 1, project_root: loc.target, status: 'preparing', connection_digest: hash(connectionBytes), files: plan.files.map(({ expected, ...row }) => row) };
    publish(loc.receiptFile, Buffer.from(`${JSON.stringify(receipt)}\n`), 0o600);
    publish(loc.connectionFile, connectionBytes, 0o600);
    for (const row of plan.files) {
      await hooks.beforeWrite?.(row);
      const destination = join(loc.target, row.path); makeParents(loc.target, dirname(destination));
      publish(destination, Buffer.from(row.after, 'base64'), row.mode, row.expected);
    }
    const current = snapshot(loc.receiptFile);
    publish(loc.receiptFile, Buffer.from(`${JSON.stringify({ ...receipt, status: 'connected' })}\n`), 0o600, current.stat);
    return { connected: true, unchanged: false, connection_file: loc.connectionFile, access: connection.access };
  } finally { unlock(); }
}
function removal(row, current, disconnecting = false) {
  const before = row.before === null ? null : Buffer.from(row.before, 'base64');
  if (!current) { if (before === null) return undefined; fail('Team configuration changed or is missing; resolve drift before disconnect.'); }
  if (before?.equals(current.bytes)) return undefined; // interrupted connect did not publish this file
  if (current.bytes.equals(Buffer.from(row.after, 'base64'))) return before;
  if (row.harness === 'codex') {
    const contents = text(current.bytes);
    if (disconnecting && !contents.includes(NAME)) return undefined;
    if (contents.split(row.block).length !== 2) fail('Owned team TOML block changed; resolve drift before disconnect.');
    return Buffer.from(contents.replace(row.block, ''));
  }
  const parsed = parseConfig(text(current.bytes)); const field = row.harness === 'opencode' ? 'mcp' : 'mcpServers';
  if (disconnecting && (!Object.hasOwn(parsed, field) || (object(parsed[field]) && !Object.hasOwn(parsed[field], NAME)))) return undefined;
  if (!object(parsed[field]) || JSON.stringify(parsed[field][NAME]) !== JSON.stringify(row.entry)) fail('Owned team MCP entry changed; resolve drift before disconnect.');
  delete parsed[field][NAME];
  const original = before ? parseConfig(text(before)) : {};
  if (Object.keys(parsed[field]).length === 0 && !Object.hasOwn(original, field)) delete parsed[field];
  return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
}
export async function disconnectTeamConnection(options) {
  enabled(); const loc = locations(options.projectRoot ?? process.cwd(), options.home);
  const unlock = options.dryRun ? () => {} : lock(loc);
  try {
    const receipt = receiptAt(loc); if (!receipt) fail('No managed team connection for this project.');
    // Preflight EVERY file before removing any entry. Drift never authorizes
    // wholesale backup restore over newly edited personal/unrelated MCP config.
    const changes = receipt.files.map(row => {
      const destination = join(loc.target, row.path); safeAncestors(dirname(destination));
      const current = snapshot(destination); return { row, destination, current, bytes: removal(row, current, receipt.status === 'disconnecting') };
    });
    if (options.dryRun) return { planned: true, disconnect: true, project_root: loc.target, files: receipt.files.map(row => row.path) };
    const receiptSnapshot = snapshot(loc.receiptFile);
    publish(loc.receiptFile, Buffer.from(`${JSON.stringify({ ...receipt, status: 'disconnecting' })}\n`), 0o600, receiptSnapshot.stat);
    for (const { row, destination, current, bytes } of changes) {
      if (bytes === undefined) continue;
      await options.beforeWrite?.(row);
      assertFileUnchanged(destination, current.stat, 'Harness configuration');
      if (bytes === null) unlinkSync(destination);
      else publish(destination, bytes, row.mode, current.stat);
    }
    // Keep private backups, but retire the active connection path so new
    // harness launches cannot reuse it accidentally. Existing processes need
    // restart or server-side revocation; disconnect does not revoke a token.
    const archive = `${loc.state}.disconnected-${randomUUID()}`;
    renameSync(loc.state, archive);
    unlock(join(archive, 'operation.lock'));
    return { disconnected: true, credentials_retained: true, backups_retained: true };
  } finally { unlock(); }
}
function argsFor(args) {
  const flags = {}; const values = new Set(['project-root', 'url', 'organization', 'project', 'token-file', 'harness', 'access']);
  for (let index = 1; index < args.length; index++) {
    const name = args[index].slice(2);
    if (!args[index].startsWith('--') || Object.hasOwn(flags, name)) fail('Unknown or duplicate team connection option.');
    if (['apply', 'yes', 'client'].includes(name)) flags[name] = true;
    else if (values.has(name) && args[index + 1] && !args[index + 1].startsWith('--')) flags[name] = args[++index];
    else fail('Unknown or missing team connection option.');
  }
  return flags;
}
export async function runTeamConnection(args, streams = {}) {
  const input = streams.input ?? process.stdin, output = streams.output ?? process.stdout, error = streams.error ?? process.stderr;
  let prompt;
  try {
    if (args.includes('--help') || args.includes('-h')) { output.write(HELP); return 0; }
    enabled();
    const flags = argsFor(args); const command = args[0];
    const allowed = command === 'connect' ? ['project-root', 'url', 'organization', 'project', 'token-file', 'harness', 'access', 'apply', 'yes']
      : command === 'disconnect' ? ['project-root', 'apply', 'yes'] : command === 'doctor' ? ['project-root', 'client'] : [];
    if (!allowed.length || Object.keys(flags).some(key => !allowed.includes(key))) fail('Invalid team connection command or option.');
    const options = { projectRoot: flags['project-root'] ?? process.cwd(), home: streams.home };
    if (command === 'doctor') {
      if (!flags.client) fail('Use team doctor --client for connection diagnostics.');
      const loc = locations(options.projectRoot, options.home); const receipt = receiptAt(loc);
      if (!receipt || receipt.status !== 'connected' || info(join(loc.state, 'operation.lock'))) fail('No completed, unlocked team connection; inspect recovery state.');
      for (const row of receipt.files) {
        const current = snapshot(join(loc.target, row.path));
        if (!current || removal(row, current) === undefined) fail('Managed team entry is missing; reconnect or inspect recovery state.');
      }
      const connection = readTeamConnection(loc.connectionFile);
      output.write(`${JSON.stringify(await connectionDoctor(connection), null, 2)}\n`); return 0;
    }
    const interactive = Boolean(input.isTTY && output.isTTY);
    const wizard = command === 'connect' && interactive && ['url', 'organization', 'project', 'token-file', 'harness'].some(key => !flags[key]);
    const question = async message => {
      prompt ??= createInterface({ input, output });
      return (await prompt.question(message)).trim();
    };
    const confirm = async () => {
      prompt?.close(); prompt = undefined;
      if (supportsTerminalPrompts(input, output)) return (await selectOnePrompt({ input, output, message: 'Apply team connection plan?', choices: [{ value: 'no', label: 'No, cancel' }, { value: 'yes', label: 'Yes, apply' }], initialValue: 'no' })) === 'yes';
      return ['y', 'yes'].includes((await question('Apply team connection plan? [y/N] ')).toLowerCase());
    };
    let plan;
    if (command === 'connect') {
      const get = async (name, message) => flags[name] ?? (interactive ? await question(message) : fail(`Missing --${name}; use team connect --help.`));
      Object.assign(options, { url: await get('url', 'Team URL (loopback HTTP or HTTPS): '), organization: await get('organization', 'Organization ID: '), project: await get('project', 'Team project ID: '), tokenFile: await get('token-file', 'Private credential file (outside source tree): '), access: flags.access ?? 'read-only' });
      if (flags.harness) options.harnesses = flags.harness.split(',');
      else if (supportsTerminalPrompts(input, output)) {
        prompt?.close(); prompt = undefined;
        options.harnesses = await selectManyPrompt({ input, output, message: 'Add team MCP to project harnesses', choices: Object.keys(ADAPTERS).map(value => ({ value, label: value })) });
      } else options.harnesses = (await get('harness', 'Harnesses (claude,opencode,qwen,codex): ')).split(',');
      prompt?.close(); prompt = undefined;
      plan = planTeamConnection(options);
      output.write(`${JSON.stringify({ planned: true, project_root: plan.target, project: plan.connection.project, organization: plan.connection.organization, access: plan.connection.access, files: plan.files.map(row => row.path), personal_memory: 'unchanged' }, null, 2)}\n`);
    } else output.write(`${JSON.stringify(await disconnectTeamConnection({ ...options, dryRun: true }), null, 2)}\n`);
    const apply = flags.apply || wizard;
    if (!apply) return 0;
    if (!flags.yes && !(interactive && await confirm())) fail('Team connection cancelled. No harness configuration changed.');
    const result = command === 'connect' ? await applyTeamConnection(plan) : await disconnectTeamConnection(options);
    output.write(`${JSON.stringify(result, null, 2)}\n`); return 0;
  } catch (cause) {
    const messages = { unauthorized: 'Team credential rejected (expired, revoked or unknown). Ask the operator to issue a fresh private credential file.', denied: 'Team project access denied. Check organization/project IDs and explicit reader membership with the operator.', integrity: 'Team service unavailable or response invalid. Check the tunnel/TLS, server version and operator status; no personal-memory fallback is used.', invalid: 'Team request rejected. Verify connection fields and upgrade the team API to a version supporting connection-check (2.26 or newer).' };
    const message = cause instanceof TeamError ? (messages[cause.code] ?? cause.message)
      : cause instanceof ConnectionError || cause instanceof TeamClientError ? cause.message
        : 'Team connection failed safely; no credential or configuration content is logged.';
    error.write(`${message}\nRecovery: cairn team doctor --client --project-root PATH; see docs/team-onboarding.md.\n`); return cause?.status ?? 1;
  } finally { prompt?.close(); if (typeof input.pause === 'function') input.pause(); }
}
