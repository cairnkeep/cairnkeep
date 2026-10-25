import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setCapabilityOverride } from '../dist/capability-config.js';

const projectRoot = mkdtempSync(join(tmpdir(), 'cairn-capability-lock-'));
mkdirSync(join(projectRoot, '.ai'), { mode: 0o700 });
const originalMkdir = fs.mkdir, originalLstat = fs.lstat;
const lock = join(projectRoot, '.ai', '.capabilities.lock');
let injected = false;
try {
  fs.mkdir = async (path, options) => {
    if (path === lock && !injected) {
      injected = true;
      // Another writer held the lock when mkdir failed, then released it
      // before our caller inspected the contended directory. No sleep race.
      await originalMkdir(path, options);
      await fs.rm(path, { recursive: true });
      throw Object.assign(new Error('synthetic contention'), { code: 'EEXIST' });
    }
    return originalMkdir(path, options);
  };
  syncBuiltinESMExports();
  const changed = await setCapabilityOverride({ projectRoot, id: 'memory.search', enabled: false });
  assert.equal(changed.capabilities['memory.search'], false);
  assert.equal(injected, true, 'actual lock-contention injector must fire');
  // Only disappearance is retryable. Inspection failures remain fail-closed.
  fs.mkdir = async (path, options) => {
    if (path === lock) throw Object.assign(new Error('synthetic contention'), { code: 'EEXIST' });
    return originalMkdir(path, options);
  };
  fs.lstat = async (...args) => {
    if (args[0] === lock) throw Object.assign(new Error('synthetic access denial'), { code: 'EACCES' });
    return originalLstat(...args);
  };
  syncBuiltinESMExports();
  await assert.rejects(setCapabilityOverride({ projectRoot, id: 'memory.write', enabled: false }), error => error.code === 'EACCES');
  fs.mkdir = originalMkdir; fs.lstat = originalLstat; syncBuiltinESMExports();
  await fs.writeFile(lock, 'not a directory', { mode: 0o600 });
  await assert.rejects(setCapabilityOverride({ projectRoot, id: 'memory.write', enabled: false }), /unsafe/);
  console.log('PASS: disappeared capability lock retries; other inspection failures remain denied');
} finally {
  fs.mkdir = originalMkdir; fs.lstat = originalLstat; syncBuiltinESMExports();
  rmSync(projectRoot, { recursive: true, force: true });
}
