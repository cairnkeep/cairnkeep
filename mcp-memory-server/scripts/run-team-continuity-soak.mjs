#!/usr/bin/env node
// Opt-in synthetic transport/policy endurance, never a real consent or model-quality study.
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,renameSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { hardenPrivatePath } from '../dist/platform-security.js';
import { openTeamStore,restoreTeamSnapshot,teamDigest } from '../dist/team-store.js';
import { createTeamHttpServer,teamRequest } from '../dist/team-http.js';
import { writePrivateExclusive } from '../dist/team-files.js';

const args=process.argv.slice(2);
if(args[0]==='--serve') {
  assert.equal(process.env.CAIRN_TEAM_SOAK,'1');assert.equal(args.length,3);
  const root=resolve(args[1]),port=Number(args[2]);
  assert(dirname(root).startsWith(join(tmpdir(),'cairn-team-soak-')));
  assert(Number.isInteger(port)&&port>=0&&port<=65535);
  const childStore=await openTeamStore(root),listener=createTeamHttpServer(childStore);
  await new Promise((ok,no)=>{listener.once('error',no);listener.listen(port,'127.0.0.1',ok);});
  console.log(JSON.stringify({port:listener.address().port}));
  process.once('SIGTERM',()=>{listener.close(()=>{void childStore.close().then(()=>process.exit(0));});listener.closeAllConnections();});
  await new Promise(()=>{});
}
if(args.includes('--help')) {console.log('CAIRN_TEAM_SOAK=1 node scripts/run-team-continuity-soak.mjs --out PRIVATE_FILE [--cycles 120 --duration-ms 1200000]');process.exit(0);}
assert.equal(process.env.CAIRN_TEAM_SOAK,'1','Synthetic endurance requires CAIRN_TEAM_SOAK=1');
const options={cycles:120,duration:1200000};let output;
for(let i=0;i<args.length;i+=2) {
  assert(args[i+1] && ['--cycles','--duration-ms','--out'].includes(args[i]));
  if(args[i]==='--out') {assert(!output);output=resolve(args[i+1]);}
  else {const n=Number(args[i+1]);assert(Number.isSafeInteger(n));options[args[i]==='--cycles'?'cycles':'duration']=n;}
}
assert(output && !existsSync(output));assert(options.cycles>=4 && options.cycles<=1000);assert(options.duration>=0 && options.duration<=7200000);
const base=mkdtempSync(join(tmpdir(),'cairn-team-soak-'));hardenPrivatePath(base);
process.env.CAIRN_TEAM='1';process.env.CAIRN_TEAM_HTTP='1';
const serverRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let root=join(base,'store'),store,server,port=0;
const clients=[],credentials=[],files=[],latencies=[];
const counts={cycles:0,server_restarts:0,credential_rotations:0,revocations_verified:0,restores:0,audit_archives:0,denied_controls:0};
const started=performance.now();
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
async function start() {
  server=spawn(process.execPath,[fileURLToPath(import.meta.url),'--serve',root,String(port)],{env:{PATH:process.env.PATH,HOME:base,CAIRN_TEAM:'1',CAIRN_TEAM_HTTP:'1',CAIRN_TEAM_SOAK:'1'},stdio:['ignore','pipe','pipe']});
  server.stderr.resume();
  port=await new Promise((ok,no)=>{
    let text='';const timer=setTimeout(()=>no(Error('Synthetic API startup timeout')),15000);
    server.once('error',()=>{clearTimeout(timer);no(Error('Synthetic API startup failed'));});
    server.once('exit',()=>{clearTimeout(timer);no(Error('Synthetic API exited before ready'));});
    server.stdout.on('data',chunk=>{text+=chunk.toString();if(text.length>2048){clearTimeout(timer);no(Error('Synthetic API startup bound'));}else if(text.includes('\n')){clearTimeout(timer);try{const parsed=JSON.parse(text.trim());assert(Number.isInteger(parsed.port)&&parsed.port>0&&parsed.port<=65535);ok(parsed.port);}catch{no(Error('Synthetic API readiness invalid'));}}});
  });
}
async function stop(crash=false) {
  if(server){const child=server;server=undefined;if(child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'exit');child.kill(crash?'SIGKILL':'SIGTERM');await exited;}
}
const call=(credential,operation,extra={})=>store.execute(credential.token,{organization:'soak-org',project:'alpha',operation,...extra});
const issue=subject=>store.issue({subject,credential_class:'workload',expires_at:new Date(Date.now()+86400000).toISOString()});
function tokenFile(index,token) {const temp=files[index]+'.'+randomUUID();writeFileSync(temp,token+'\n',{mode:0o600,flag:'wx'});hardenPrivatePath(temp);renameSync(temp,files[index]);}
async function read(index,key='decisions/continuity',project='alpha') {return clients[index].callTool({name:'team_memory_read',arguments:{project,key}});}
try {
  store=await openTeamStore(root,{create:true,organization:'soak-org'});
  for(const project of['alpha','beta'])await store.admin({operation:'project-create',project});
  for(const subject of['alice','bob']) {await store.admin({operation:'member-set',project:'alpha',subject,roles:['reader','contributor']});credentials.push(await issue(subject));}
  await store.admin({operation:'member-set',project:'alpha',subject:'reviewer',roles:['reviewer']});
  const reviewer=await store.issue({subject:'reviewer',credential_class:'human',expires_at:new Date(Date.now()+86400000).toISOString()});
  const value='Synthetic release corrections append a new linked entry.';
  const proposal=await call(credentials[0],'propose',{request_id:randomUUID(),key:'decisions/continuity',value,confirm:teamDigest(value),source_digest:teamDigest(value),source_scope:'selected-project',base_revision:null,expires_at:new Date(Date.now()+86400000).toISOString()});
  // Synthetic human-class credential fixture is not actual human review/consent.
  await call(reviewer,'review',{proposal_id:proposal.id,confirm:proposal.digest,decision:'approve'});
  const pending='Synthetic unapproved sentinel';
  await call(credentials[0],'propose',{request_id:randomUUID(),key:'decisions/pending',value:pending,confirm:teamDigest(pending),source_digest:teamDigest(pending),source_scope:'selected-project',base_revision:null,expires_at:new Date(Date.now()+86400000).toISOString()});
  await start();
  for(let i=0;i<2;i++) {
    const cwd=join(base,'client-'+i);mkdirSync(cwd,{mode:0o700});hardenPrivatePath(cwd);
    files.push(join(base,'reader-'+i+'.token'));tokenFile(i,credentials[i].token);
    const env={PATH:process.env.PATH,HOME:base,XDG_CONFIG_HOME:join(base,'config'),CAIRN_TEAM:'1',CAIRN_TEAM_URL:`http://127.0.0.1:${port}`,CAIRN_TEAM_ORGANIZATION:'soak-org',CAIRN_TEAM_TOKEN_FILE:files[i],CAIRN_MCP_TOOL_PROFILE:'read-only',CAIRN_TEAM_MCP_TOOL_PROFILE:'read-only'};
    const client=new Client({name:'synthetic-reader',version:'1'},{capabilities:{}});clients.push(client);
    await client.connect(new StdioClientTransport({command:process.execPath,args:[join(serverRoot,'dist/team-cli.js'),'mcp','--project-root',cwd],cwd,env,stderr:'pipe'}));
    assert(!(await client.listTools()).tools.some(tool=>/review|propose|admin/.test(tool.name)));
  }
  let revision;
  for(let cycle=0;cycle<options.cycles;cycle++) {
    for(let i=0;i<2;i++) {
      const begin=performance.now(),result=await read(i);latencies.push(performance.now()-begin);
      assert(!result.isError);const row=result.structuredContent?.result ?? JSON.parse(result.content[0].text).result;
      assert.equal(row.value,value);revision ??=row.provenance.revision_digest;assert.equal(row.provenance.revision_digest,revision);
      const unpublished=await read(i,'decisions/pending');assert(!unpublished.isError);assert.equal((unpublished.structuredContent ?? JSON.parse(unpublished.content[0].text)).result,null);counts.denied_controls++;
      assert.equal((await read(i,'decisions/continuity','beta')).isError,true);counts.denied_controls++;
    }
    if(cycle%12===3) {
      const old=credentials[0];credentials[0]=await issue('alice');tokenFile(0,credentials[0].token);await store.admin({operation:'credential-revoke',credential:old.id});
      await assert.rejects(teamRequest(`http://127.0.0.1:${port}`,old.token,{organization:'soak-org',project:'alpha',operation:'list'}),/unauthorized/);counts.credential_rotations++;counts.revocations_verified++;
    }
    if(cycle%17===2) {
      await store.admin({operation:'credential-revoke',credential:credentials[1].id});assert.equal((await read(1)).isError,true);counts.revocations_verified++;
      credentials[1]=await issue('bob');tokenFile(1,credentials[1].token);
    }
    if(cycle===Math.floor(options.cycles/2)) {
      await stop();
      const backup=await store.snapshot({audit:false}),archive=await store.exportAudit(backup);
      const backupFile=join(base,'backup.json'),archiveFile=join(base,'archive.json');
      writePrivateExclusive(backupFile,JSON.stringify(backup)+'\n');writePrivateExclusive(archiveFile,JSON.stringify(archive)+'\n');
      await store.archiveAudit(archive,backup,archive.digest,true);counts.audit_archives++;
      const snapshot=await store.snapshot({audit:false});await store.close();store=undefined;
      root=join(base,'restored');store=await restoreTeamSnapshot(root,snapshot,snapshot.digest);counts.restores++;
      for(let i=0;i<2;i++) {await assert.rejects(call(credentials[i],'list'),/unauthorized/);counts.revocations_verified++;credentials[i]=await issue(i?'bob':'alice');tokenFile(i,credentials[i].token);}
      await start();counts.server_restarts++;
    } else if(cycle%20===1) {await stop(cycle>1);await store.close();store=await openTeamStore(root);await start();counts.server_restarts++;}
    counts.cycles++;
    process.stderr.write(`SOAK_PROGRESS ${JSON.stringify(counts)}\n`);
    const target=started+(cycle+1)*options.duration/options.cycles;
    while(performance.now()<target) await pause(Math.min(5000,target-performance.now()));
  }
  assert((await store.doctor()).ok);
  latencies.sort((a,b)=>a-b);
  const report={schema_version:1,result:'PASS',elapsed_ms:Math.round(performance.now()-started),...counts,agent_identities:2,transport:'two actual stdio MCP client processes and separate loopback API process',api_process_restart_verified:true,unclean_restart_verified:options.cycles>21,native_harness_ui_verified:false,model_quality_claim:false,human_consent_claim:false,synthetic_only:true,production_configuration_changed:false,revision_digest:revision,read_p95_ms:Math.round(latencies[Math.floor(latencies.length*0.95)]),paid_model_calls:0};
  writePrivateExclusive(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {for(const client of clients)await client.close().catch(()=>{});await stop();await store?.close();rmSync(base,{recursive:true,force:true});}
