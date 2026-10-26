import assert from 'node:assert/strict';
import { npmVerificationCommands } from './verify-published-release.mjs';
const commands = npmVerificationCommands('/private/disposable/install', '1.2.3');
assert.equal(commands.length, 2);
for (const args of commands) {
  assert.equal(args[args.indexOf('--cache') + 1], '/private/disposable/install/.verification-cache');
  assert(args.includes('--prefer-online'));
  assert(args.includes('--prefer-offline=false'));
  assert(args.includes('--offline=false'));
  assert.equal(args[args.indexOf('--registry') + 1], 'https://registry.npmjs.org');
}
assert.equal(commands[0][0], 'install');
assert(commands[0].includes('@cairnkeep/cli@1.2.3'));
assert(commands[0].includes('--ignore-scripts'));
assert.deepEqual(commands[1].slice(0, 2), ['audit', 'signatures']);
console.log('PASS: disposable online npm verification retains signature audit and exact version');
