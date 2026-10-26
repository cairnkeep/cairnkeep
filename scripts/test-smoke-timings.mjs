import assert from 'node:assert/strict';
import { runSmokeChecks, smokeChecks } from '../mcp-memory-server/scripts/run-smoke-suite.mjs';
const output = [], calls = [];
let tick = 0;
const result = runSmokeChecks(smokeChecks.slice(0, 3), {
  spawn: (_command, args) => { calls.push(args); return { status: calls.length === 2 ? 9 : 0 }; },
  now: () => (tick += 10), write: value => output.push(value),
});
assert.equal(result, 9);
assert.equal(calls.length, 2);
const timings = output.filter(value => value.startsWith('SMOKE_TIMING ')).map(value => JSON.parse(value.slice(13)));
assert.equal(timings.length, 2);
assert.deepEqual(timings.map(row => row.status), [0, 9]);
assert(timings.every(row => row.duration_ms === 10 && row.schema_version === 1));
assert.deepEqual(Object.keys(timings[0]).sort(), ['duration_ms','name','schema_version','status']);
const errors=[];
assert.throws(()=>runSmokeChecks(smokeChecks.slice(0,1),{spawn:()=>{throw Error('synthetic spawn failure');},write:value=>errors.push(value),now:()=>0}));
assert.equal(JSON.parse(errors.find(value=>value.startsWith('SMOKE_TIMING ')).slice(13)).status,1);
console.log('PASS: smoke timings preserve execution order, early failure, status and payload-free output');
