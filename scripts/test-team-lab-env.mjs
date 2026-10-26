import assert from 'node:assert/strict';
import {teamLabEnvironment} from '../mcp-memory-server/scripts/team-lab-env.mjs';
const env=teamLabEnvironment('/private/lab',{CAIRN_TEAM:'1'},{Path:'system-path',SYSTEMROOT:'windows-root',ComSpec:'system-shell',WINDIR:'windows-dir',PATHEXT:'.EXE',CAIRN_TEAM_BASE_DIR:'production',CAIRN_LLM_API_KEY:'secret',PROVIDER_API_KEY:'secret',HOME:'real-home'});
assert.equal(env.PATH,'system-path');assert.equal(env.SystemRoot,'windows-root');assert.equal(env.ComSpec,'system-shell');assert.equal(env.WINDIR,'windows-dir');assert.equal(env.PATHEXT,'.EXE');
for(const key of ['HOME','USERPROFILE','TEMP','TMP'])assert.equal(env[key],'/private/lab');
assert.equal(env.CAIRN_TEAM,'1');
for(const key of ['CAIRN_TEAM_BASE_DIR','CAIRN_LLM_API_KEY','PROVIDER_API_KEY'])assert.equal(env[key],undefined);
console.log('PASS: isolated team lab keeps Windows bootstrap variables, not production stores or provider secrets');
