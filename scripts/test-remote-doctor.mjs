#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const sandbox=mkdtempSync(join(tmpdir(),'cairn-remote-doctor-'));
const secret='remote-doctor-secret-not-for-output';
const hidden='PRIVATE_MEMORY_SENTINEL_DO_NOT_PRINT';
let mode='ok';const requests=[];
const server=createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString()||'null');}catch{}
 requests.push({method:req.method,body,headers:req.headers});
 if(mode==='authentication'){res.writeHead(401).end(secret+hidden);return;}
 if(mode==='forbidden'){res.writeHead(403).end(hidden);return;}
 if(mode==='redirect'){res.writeHead(307,{Location:'http://127.0.0.1:1/leak/'+secret}).end();return;}
 if(mode==='initialize-stall'&&body?.method==='initialize')return;
 if(req.method==='DELETE'){res.writeHead(200).end();return;}
 if(req.method==='GET'){res.writeHead(405).end();return;}
 if(body?.id===undefined){res.writeHead(202).end();return;}
 if(mode==='oversized'){res.writeHead(200,{'Content-Type':'application/json'}).end(' '.repeat(1024*1024+1)+hidden);return;}
 if(mode==='malformed'){res.writeHead(200,{'Content-Type':'application/json'}).end('not JSON '+secret);return;}
 if(mode==='discovery-stall'&&body.method==='tools/list')return;
 if(mode==='read-stall'&&body.method==='tools/call'&&body.params.name==='memory_read')return;
 if(mode==='read-body-stall'&&body.method==='tools/call'&&body.params.name==='memory_read'){res.writeHead(200,{'Content-Type':'application/json'});res.write('{"jsonrpc":');return;}
 if(mode==='search-stall'&&body.method==='tools/call'&&body.params.name==='memory_search')return;
 if(mode==='declared-oversize'){res.writeHead(200,{'Content-Type':'application/json','Content-Length':String(1024*1024+1)}).end('{}');return;}
 let result;
 if(body.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:mode==='wrong-server'?'another-service':'cairn-memory',version:'fixture'}};
 else if(body.method==='tools/list')result={tools:(mode==='no-observation'?['memory_write']:['memory_read','memory_search']).map(name=>({name,inputSchema:{type:'object'},annotations:{readOnlyHint:mode!=='unsafe-annotations',destructiveHint:mode==='unsafe-annotations'}}))};
 else if(body.method==='tools/call')result=mode==='tool-error'?{isError:true,content:[{type:'text',text:hidden+secret}]}:{content:[{type:'text',text:hidden}],structuredContent:{results:[]}};
 else{res.writeHead(400).end();return;}
 if(mode==='sse'){
  res.writeHead(200,{'Content-Type':'text/event-stream','mcp-session-id':'doctor-fixture'});
  res.end('event: message\ndata: '+JSON.stringify({jsonrpc:'2.0',id:body.id,result})+'\n\n');
 }else{
  res.writeHead(200,{'Content-Type':'application/json','mcp-session-id':'doctor-fixture'});
  res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
 }
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const url='http://127.0.0.1:'+server.address().port+'/mcp';
async function run(args=[],extraEnv={}){
 const env={...process.env,HOME:sandbox,USERPROFILE:sandbox};
 for(const key of Object.keys(env))if(/^(CAIRN_|AGENT_MEMORY_|MCP_|ANYTHINGLLM_)/.test(key))delete env[key];
 Object.assign(env,{CAIRN_MEMORY_REMOTE_URL:url,CAIRN_MEMORY_HTTP_TOKEN:secret},extraEnv);
 const started=Date.now();
 return new Promise((resolve,reject)=>{
  const deadlineArgs=args.includes('--timeout-ms')?[]:['--timeout-ms','300'];
  const child=spawn(process.execPath,[join(root,'bin/cairn'),'doctor','--remote','--json',...deadlineArgs,...args],{env,cwd:sandbox,stdio:['ignore','pipe','pipe']});
  let out='',err='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Remote doctor exceeded independent test deadline'));},5000);
  child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);
  child.on('exit',status=>{clearTimeout(timer);assert.ok(!out.includes(secret)&&!err.includes(secret),'credential leaked');assert.ok(!out.includes(hidden)&&!err.includes(hidden),'remote body leaked');assert.ok(!out.includes(url)&&!err.includes(url),'endpoint leaked');let report;try{report=JSON.parse(out);}catch{reject(Error('Remote doctor must return one JSON report: '+out+err));return;}resolve({status,report,ms:Date.now()-started});});
 });
}
try{
 let start=requests.length;let r=await run();assert.equal(r.status,0,JSON.stringify(r.report));assert.equal(r.report.ok,true);
 assert.deepEqual(r.report.checks.map(c=>c.stage),['initialize','discovery','read']);
 const calls=requests.slice(start).filter(q=>q.body?.method==='tools/call');assert.deepEqual(calls.map(q=>q.body.params.name),['memory_read']);assert.equal(calls[0].body.params.arguments.scope,'identity');
 assert.match(calls[0].body.params.arguments.key,/^diagnostics\/remote-probe-/);
 assert.ok(requests.slice(start).some(q=>q.method==='DELETE'),'own session was not terminated');
 start=requests.length;r=await run(['--search','--scope','project','--project-id','trial-project']);assert.equal(r.status,0);assert.equal(r.report.checks.at(-1).stage,'search');
 assert.deepEqual(requests.slice(start).filter(q=>q.body?.method==='tools/call').map(q=>q.body.params.name),['memory_read','memory_search']);
 assert.ok(requests.slice(start).every(q=>q.headers['x-cairn-project']==='trial-project'&&q.headers['x-cairn-scopes']==='project'));
 mode='sse';r=await run();assert.equal(r.status,0,'SSE RPC responses must work');
 for(const [value,code,stage] of [['authentication','authentication_rejected','initialize'],['forbidden','access_rejected','initialize'],['redirect','redirect_refused','initialize'],['oversized','response_too_large','initialize'],['declared-oversize','response_too_large','initialize'],['malformed','protocol_error','initialize'],['wrong-server','protocol_error','initialize'],['initialize-stall','stage_timeout','initialize'],['discovery-stall','stage_timeout','discovery'],['read-stall','stage_timeout','read'],['read-body-stall','stage_timeout','read'],['search-stall','stage_timeout','search'],['no-observation','observation_unavailable','discovery'],['unsafe-annotations','observation_unavailable','discovery'],['tool-error','tool_error','read']]){
  mode=value;r=await run(value==='search-stall'?['--search']:[]);assert.equal(r.status,1,value);assert.equal(r.report.ok,false,value);assert.equal(r.report.failure.code,code,value);assert.equal(r.report.failure.stage,stage,value);assert.ok(r.ms<2500,value+' not bounded');
 }
 mode='ok';
 for(const [args,env] of [[[],{CAIRN_MEMORY_HTTP_TOKEN:''}],[[],{CAIRN_MEMORY_REMOTE_URL:''}],[[],{CAIRN_MEMORY_REMOTE_URL:'http://user:password@127.0.0.1/mcp'}],[[],{CAIRN_MEMORY_REMOTE_URL:url+'?token=hidden'}],[[],{CAIRN_MEMORY_REMOTE_URL:url+'#fragment'}],[[],{CAIRN_MEMORY_HTTP_TOKEN:'unsafe\ntoken'}],[['--scope','project'],{}],[['--scope','all'],{}],[['--repair'],{}],[['--timeout-ms','999999'],{}],[['--unknown'],{}]]){
  start=requests.length;r=await run(args,env);assert.equal(r.status,2);assert.equal(r.report.failure.code,'configuration_error');assert.equal(requests.length,start,'invalid configuration made a request');
 }
 const file=join(sandbox,'private.token');writeFileSync(file,secret+'\n',{mode:0o600});
 if(process.platform!=='win32'){
  r=await run([],{CAIRN_MEMORY_HTTP_TOKEN:'',CAIRN_MEMORY_HTTP_TOKEN_FILE:file});assert.equal(r.status,0);
  start=requests.length;r=await run([],{CAIRN_MEMORY_HTTP_TOKEN_FILE:file});assert.equal(r.status,2);assert.equal(requests.length,start);
  chmodSync(file,0o644);r=await run([],{CAIRN_MEMORY_HTTP_TOKEN:'',CAIRN_MEMORY_HTTP_TOKEN_FILE:file});assert.equal(r.status,2);chmodSync(file,0o600);
  const alias=join(sandbox,'alias.token');symlinkSync(file,alias);r=await run([],{CAIRN_MEMORY_HTTP_TOKEN:'',CAIRN_MEMORY_HTTP_TOKEN_FILE:alias});assert.equal(r.status,2);
 }
 assert.ok(requests.filter(q=>q.body?.method==='tools/call').every(q=>['memory_read','memory_search'].includes(q.body.params.name)),'mutation RPC attempted');
 console.log('PASS: bounded authenticated remote doctor, protocol stages, privacy, read-only policy and native CLI');
}finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));}
