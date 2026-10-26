import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync,writeFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import { hardenPrivatePath } from '../dist/platform-security.js';
import { openTeamStore, restoreTeamSnapshot, teamDigest, verifyTeamSnapshot } from '../dist/team-store.js';
import {writePrivateExclusive} from '../dist/team-files.js';
import {teamLabEnvironment} from './team-lab-env.mjs';

const base = mkdtempSync(join(tmpdir(), 'cairn-team-operations-'));
hardenPrivatePath(base); process.env.CAIRN_TEAM = '1';
let store, restored;
try {
  const originalSync=fs.fsyncSync,flushes=[];
  try {
    fs.fsyncSync=fd=>{flushes.push(fs.fstatSync(fd).isDirectory()?'directory':'file');return originalSync(fd);};syncBuiltinESMExports();
    writePrivateExclusive(join(base,'durable.txt'),'Synthetic private fixture');
    assert.deepEqual(flushes,process.platform==='win32'?['file']:['file','directory']);
    assert.throws(()=>writePrivateExclusive(join(base,'durable.txt'),'replacement'),/EEXIST/);
  } finally {fs.fsyncSync=originalSync;syncBuiltinESMExports();}
  store = await openTeamStore(join(base, 'store'), { create: true, organization: 'test-org' });
  for (const project of ['alpha', 'beta']) await store.admin({ operation: 'project-create', project });
  for (const [subject, roles] of [['alice',['reader','contributor','auditor']],['bob',['reader','reviewer']],['other',['reader']]])
    await store.admin({ operation: 'member-set', project:'alpha',subject,roles });
  const issue = (subject, credential_class='workload') => store.issue({subject,credential_class,expires_at:new Date(Date.now()+86400000).toISOString()});
  const alice = await issue('alice'), other = await issue('other'), bob = await issue('bob','human');
  const call = (credential,operation,extra={}) => store.execute(credential.token,{organization:'test-org',project:'alpha',operation,...extra});
  for(let n=0;n<5;n++) {
    const value='Synthetic continuity decision '+n;
    const proposal=await call(alice,'propose',{request_id:randomUUID(),key:'decisions/item-'+n,value,source_scope:'selected-project',source_digest:teamDigest(value),base_revision:null,expires_at:new Date(Date.now()+3600000).toISOString(),confirm:teamDigest(value)});
    // Synthetic human-class policy fixture, never actual human consent.
    await call(bob,'review',{proposal_id:proposal.id,confirm:proposal.digest,decision:'approve'});
  }
  assert.equal((await call(alice,'list')).length,5,'legacy array retained');
  const first=await call(alice,'list',{page:{size:2}});
  assert.equal(first.items.length,2); assert(first.next_cursor);
  const second=await call(alice,'list',{page:{size:2,cursor:first.next_cursor}});
  const third=await call(alice,'list',{page:{size:2,cursor:second.next_cursor}});
  assert.equal(third.next_cursor,null);
  assert.equal(new Set([...first.items,...second.items,...third.items].map(r=>r.key)).size,5);
  await assert.rejects(call(other,'list',{page:{size:2,cursor:first.next_cursor}}),/invalid/);
  await assert.rejects(call(alice,'search',{query:'Synthetic',page:{size:2,cursor:first.next_cursor}}),/invalid/);
  await assert.rejects(call(alice,'list',{page:{size:2,cursor:first.next_cursor+'x'}}),/invalid/);
  await assert.rejects(call(alice,'list',{page:{size:0}}),/invalid/);
  await store.admin({operation:'member-set',project:'beta',subject:'alice',roles:['reader']});
  await assert.rejects(store.execute(alice.token,{organization:'test-org',project:'beta',operation:'list',page:{size:2,cursor:first.next_cursor}}),/invalid/,'a credential with access to both projects cannot reuse a cursor across them');
  await store.admin({operation:'member-set',project:'alpha',subject:'other',roles:['reader','contributor']});
  await assert.rejects(call(alice,'list',{page:{size:2,cursor:first.next_cursor}}),/invalid/,'policy changes invalidate old cursor scopes');
  const stable=await call(alice,'list',{page:{size:2}});
  const prior=await call(alice,'read',{key:'decisions/item-0'}),value='Synthetic revised continuity decision';
  const updated=await call(alice,'propose',{request_id:randomUUID(),key:prior.key,value,source_scope:'selected-project',source_digest:teamDigest(value),base_revision:prior.provenance.revision_digest,expires_at:new Date(Date.now()+3600000).toISOString(),confirm:teamDigest(value)});
  await call(bob,'review',{proposal_id:updated.id,confirm:updated.digest,decision:'approve'});
  await assert.rejects(call(alice,'list',{page:{size:2,cursor:stable.next_cursor}}),/conflict/,'publication invalidates the old result view rather than skipping records');
  const audit=await call(alice,'audit',{page:{size:2}});
  assert(audit.next_cursor);
  assert.equal((await call(alice,'audit',{page:{size:2,cursor:audit.next_cursor}})).items.length,2,'own read audit must not invalidate audit cursor');
  const before=await store.snapshot({audit:false}); assert.equal(before.schema_version,1);
  const capacity=await store.doctor(); assert.equal(capacity.capacity.records.limit,32768);
  const archive=await store.exportAudit(before);
  assert.equal(archive.backup_digest,before.digest);
  assert.equal(JSON.stringify(archive).includes('Synthetic continuity decision'),false);
  const plan=await store.archiveAudit(archive,before,archive.digest,false);
  assert.equal(plan.applied,false); assert.equal((await store.snapshot({audit:false})).digest,before.digest);
  await assert.rejects(store.archiveAudit(archive,before,'0'.repeat(64),true),/conflict/);
  const broken=structuredClone(archive);broken.entries[0].digest='0'.repeat(64);
  await assert.rejects(store.archiveAudit(broken,before,archive.digest,true),/integrity/);
  const db=store.agent.getDatabase();
  db.exec("CREATE TRIGGER fail_archive BEFORE INSERT ON team_audit WHEN json_extract(NEW.value,'$.operation')='audit-archive' BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END");
  await assert.rejects(store.archiveAudit(archive,before,archive.digest,true));
  assert.equal((await store.snapshot({audit:false})).digest,before.digest,'failed checkpoint publication rolls back deletion and schema version');
  db.exec('DROP TRIGGER fail_archive');
  const applied=await store.archiveAudit(archive,before,archive.digest,true);
  assert.equal(applied.applied,true);
  const after=await store.snapshot({audit:false}); assert.equal(after.schema_version,2);
  assert.equal(after.audit_checkpoint.archive_digest,archive.digest);
  assert.equal(after.audit.length,1); assert(after.audit[0].sequence>archive.entries.at(-1).sequence);
  assert.deepEqual(after.records,before.records);
  assert.equal(verifyTeamSnapshot(after).digest,after.digest);
  const lostCheckpoint=structuredClone(after);delete lostCheckpoint.audit_checkpoint;
  await assert.rejects(async()=>verifyTeamSnapshot(lostCheckpoint),/integrity/);
  const replacedCheckpoint=structuredClone(after);replacedCheckpoint.audit_checkpoint.digest='0'.repeat(64);
  const {digest:ignored,...replacedBody}=replacedCheckpoint;replacedCheckpoint.digest=teamDigest(JSON.stringify(replacedBody));
  await assert.rejects(async()=>verifyTeamSnapshot(replacedCheckpoint),/integrity/,'rehashed envelope cannot break the retained audit chain');
  await assert.rejects(store.archiveAudit(archive,before,archive.digest,true),/conflict/);
  restored=await restoreTeamSnapshot(join(base,'restored'),after,after.digest);
  await assert.rejects(restored.execute(alice.token,{organization:'test-org',project:'alpha',operation:'list'}),/unauthorized/);
  assert.equal((await restored.doctor()).ok,true);
  const staleBackup=await store.snapshot({audit:false}), staleArchive=await store.exportAudit(staleBackup);
  await call(alice,'read',{key:'decisions/item-0'});
  await assert.rejects(store.archiveAudit(staleArchive,staleBackup,staleArchive.digest,true),/conflict/);
  await store.admin({operation:'credential-revoke',credential:alice.id});
  await assert.rejects(call(alice,'list',{page:{size:2,cursor:first.next_cursor}}),/unauthorized/);
  // Exercise the real record counter/ceiling without tens of thousands of ACL subprocesses.
  const count=Number(db.prepare('SELECT count(*) AS n FROM team_records').get().n);
  const insert=db.prepare('INSERT INTO team_records(organization,project,kind,id,value) VALUES(?,?,?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try {for(let n=count;n<32768;n++) {const subject='capacity-'+n;insert.run('test-org','alpha','member',subject,JSON.stringify({subject,roles:[]}));}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  const full=await store.doctor();assert.equal(full.capacity.records.status,'exhausted');
  const fullBackup=await store.snapshot({audit:false});
  await assert.rejects(issue('alice'),/conflict/);
  assert.equal((await store.snapshot({audit:false})).digest,fullBackup.digest,'full record store denies issuance atomically');
  const backupFile=join(base,'backup.json'), archiveFile=join(base,'archive.json');
  const childEnv=teamLabEnvironment(base,{CAIRN_TEAM:'1',CAIRN_TEAM_BASE_DIR:join(base,'never-open')});
  const childTimeout=process.platform==='win32'?120000:30000;
  const cli=(args,status=0)=>{
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../dist/team-cli.js',import.meta.url)),...args,...(args[0]==='audit-verify' ? [] : ['--data',join(base,'restored')])],{encoding:'utf8',timeout:childTimeout,env:childEnv});
    assert.equal(result.status,status,result.stderr);
    for(const token of[alice.token,bob.token,other.token])assert.equal((result.stdout+result.stderr).includes(token),false);
    return result.stdout ? JSON.parse(result.stdout) : null;
  };
  cli(['backup','--output',backupFile,'--read-only']);
  const exported=cli(['audit-export','--backup',backupFile,'--output',archiveFile]);
  assert(exported.archive_digest);
  const previous=join(base,'previous.json');writeFileSync(previous,JSON.stringify(archive),{mode:0o600});hardenPrivatePath(previous);
  assert.equal(cli(['audit-verify','--input',archiveFile,'--previous',previous]).previous_link_verified,true);
  cli(['audit-verify','--input',archiveFile,'--previous',archiveFile],1);
  assert.equal(existsSync(join(base,'never-open')),false,'verification opens no admin store');
  const saved=readFileSync(archiveFile);
  const args=['audit-archive','--input',archiveFile,'--backup',backupFile,'--confirm',exported.archive_digest];
  assert.equal(cli(args).applied,false);
  const concurrent=()=>new Promise((ok,no)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('../dist/team-cli.js',import.meta.url)),...args,'--apply','--data',join(base,'restored')],{env:childEnv,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    const timer=setTimeout(()=>child.kill(),childTimeout);
    child.once('error',no);child.once('exit',status=>{clearTimeout(timer);ok({status,stdout,stderr});});
  });
  const racers=await Promise.all([concurrent(),concurrent()]);
  assert.deepEqual(racers.map(r=>r.status).sort(),[0,1],'two independent processes cannot apply the same archive twice');
  assert.equal(JSON.parse(racers.find(r=>r.status===0).stdout).applied,true);
  assert.match(racers.find(r=>r.status===1).stderr,/conflict/);
  cli([...args,'--apply'],1);
  assert.deepEqual(readFileSync(archiveFile),saved,'archival retains exported evidence');
  assert.equal(cli(['doctor']).capacity.checkpoint.archive_digest,exported.archive_digest);
  // A valid, hash-chained near-full audit exercises ordinary refusal and the
  // read-only backup/export recovery path without thousands of ACL subprocesses.
  let last=db.prepare('SELECT sequence,value,digest FROM team_audit ORDER BY sequence DESC LIMIT 1').get();
  let used=Number(db.prepare('SELECT sum(length(CAST(value AS BLOB))) AS n FROM team_audit').get().n);
  const append=db.prepare('INSERT INTO team_audit(sequence,organization,project,value,digest) VALUES(?,?,?,?,?)');
  const fill=limit=>{
    db.exec('BEGIN IMMEDIATE');
    try {while(true){const entry={...JSON.parse(last.value),sequence:last.sequence+1,project:'alpha',subject:'bob',credential_class:'human',operation:'list',result:'accepted',object_digest:null,previous_digest:last.digest};const value=JSON.stringify(entry),bytes=Buffer.byteLength(value);if(used+bytes>limit)break;last={sequence:entry.sequence,value,digest:teamDigest(value)};append.run(last.sequence,'test-org','alpha',value,last.digest);used+=bytes;}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  };
  fill(16*1024*1024);
  await assert.rejects(call(bob,'list'),/conflict/,'ordinary requests fail closed when the next audit event cannot fit');
  fill(16*1024*1024+256*1024);
  await assert.rejects(store.snapshot(),/conflict/,'ordinary audited backup cannot bypass the hard local reserve');
  const rescue=await store.snapshot({audit:false}),rescueArchive=await store.exportAudit(rescue);
  await store.archiveAudit(rescueArchive,rescue,rescueArchive.digest,true);
  assert.equal((await store.doctor()).audit_events,1);
  assert.equal((await call(bob,'list')).length,5,'explicit archival restores audit admission without changing approved memories');
  console.log('PASS: legacy/paged isolation, audit continuity, backup-bound explicit archive and revoked restore');
} finally { await restored?.close(); await store?.close(); rmSync(base,{recursive:true,force:true}); }
