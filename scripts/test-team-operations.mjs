import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const lab=mkdtempSync(join(tmpdir(),'cairn-team-endurance-contract-'));
try {
  const script=resolve('mcp-memory-server/scripts/run-team-continuity-soak.mjs');
  const out=join(lab,'report.json');
  const env={PATH:process.env.PATH,HOME:lab};
  const run=(args,enabled=false)=>spawnSync(process.execPath,[script,...args],{env:{...env,...(enabled?{CAIRN_TEAM_SOAK:'1'}:{})},encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
  assert.equal(run(['--help']).status,0);
  assert.notEqual(run(['--out',out]).status,0,'endurance must be explicitly enabled');
  assert.equal(existsSync(out),false);
  const result=run(['--cycles','24','--duration-ms','0','--out',out],true);
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(readFileSync(out,'utf8'));
  assert.equal(report.result,'PASS');assert.equal(report.cycles,24);
  assert.equal(report.agent_identities,2);assert.equal(report.api_process_restart_verified,true);
  assert.equal(report.unclean_restart_verified,true);assert.equal(report.restores,1);assert.equal(report.audit_archives,1);
  assert(report.credential_rotations>=2);assert(report.revocations_verified>=4);
  for(const name of ['human_consent_claim','model_quality_claim','native_harness_ui_verified','production_configuration_changed'])assert.equal(report[name],false);
  assert.equal(report.synthetic_only,true);assert.equal(report.paid_model_calls,0);
  const bytes=readFileSync(out);
  assert.notEqual(run(['--cycles','4','--duration-ms','0','--out',out],true).status,0,'reports are exclusive and cannot overwrite evidence');
  assert.deepEqual(readFileSync(out),bytes);
  assert.equal(existsSync(join(lab,'.cairnkeep')),false,'synthetic test must not create a real user store');
  console.log('PASS: opt-in synthetic endurance, two MCP processes, API crash/restart, rotation, archive/restore and exclusive reports');
} finally {rmSync(lab,{recursive:true,force:true});}
