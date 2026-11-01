import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const MAX_RESPONSE_BYTES=1024*1024;
const MAX_TOTAL_BYTES=2*MAX_RESPONSE_BYTES;
export const REMOTE_DOCTOR_USAGE='Usage: cairn doctor --remote [--search] [--scope SCOPE] [--project-id ID] [--timeout-ms 250..30000] [--json]';
const messages={
 configuration_error:'Invalid remote configuration or options; set CAIRN_MEMORY_REMOTE_URL and exactly one private HTTP token source.',
 authentication_rejected:'Remote authentication was rejected (HTTP 401).',
 access_rejected:'Remote access was rejected (HTTP 403); inspect authentication and Host/origin policy.',
 endpoint_or_session_missing:'Remote endpoint or session was not found (HTTP 404).',
 remote_http_error:'Remote endpoint returned an unsuccessful HTTP response.',
 redirect_refused:'Remote endpoint redirected; no redirect or credential forwarding was allowed.',
 connection_failed:'Remote connection failed; check network, endpoint and TLS configuration.',
 protocol_error:'Remote endpoint did not complete the expected Cairn memory MCP protocol.',
 response_too_large:'Remote response exceeded the diagnostic byte limit.',
 observation_unavailable:'The MCP profile does not expose the required read-only observation.',
 tool_error:'Remote memory observation returned an error; no server-controlled detail is printed.',
 stage_timeout:'Remote stage exceeded its deadline; no server-wide outage is inferred.',
};
class ProbeFailure extends Error {
 constructor(code){super(messages[code]);this.code=code;}
}
function fail(code){throw new ProbeFailure(code);}

async function configuration(args,env){
 const options={scope:'identity',timeoutMs:5000,search:false,json:args.includes('--json')};
 const seen=new Set();
 for(let i=0;i<args.length;i++){
  const flag=args[i];if(seen.has(flag))fail('configuration_error');seen.add(flag);
  if(flag==='--remote'||flag==='--json')continue;
  if(flag==='--search'){options.search=true;continue;}
  if(!['--scope','--project-id','--timeout-ms'].includes(flag))fail('configuration_error');
  const value=args[++i];if(!value||value.startsWith('--'))fail('configuration_error');
  if(flag==='--scope')options.scope=value;
  if(flag==='--project-id')options.projectId=value;
  if(flag==='--timeout-ms'){
   if(!/^[1-9][0-9]*$/.test(value))fail('configuration_error');
   options.timeoutMs=Number(value);
   if(options.timeoutMs<250||options.timeoutMs>30000)fail('configuration_error');
  }
 }
 if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.scope)||options.scope==='all')fail('configuration_error');
 if(options.projectId&&!/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.projectId))fail('configuration_error');
 if(options.scope==='project'&&!options.projectId)fail('configuration_error');
 const raw=env.CAIRN_MEMORY_REMOTE_URL;
 if(!raw||raw.length>4096||raw.trim()!==raw||/[\x00-\x20\x7f]/.test(raw))fail('configuration_error');
 let url;try{url=new URL(raw);}catch{fail('configuration_error');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)fail('configuration_error');
 let token;
 try{
  const {resolveHttpToken}=await import('../mcp-memory-server/dist/http-security.js');
  token=resolveHttpToken(env,{baseDirectory:process.cwd()});
 }catch{fail('configuration_error');}
 if(!token?.ok)fail('configuration_error');
 return {...options,url,token:token.token};
}

async function probe(config,report){
 const controller=new AbortController();
 const totalMs=Math.min(30000,config.timeoutMs*(config.search?5:4));
 const expires=Date.now()+totalMs;
 const overall=setTimeout(()=>controller.abort(),totalMs);
 let stage='initialize',requestIssue,totalBytes=0;
 const budget=()=>Math.max(1,Math.min(config.timeoutMs,expires-Date.now()));
 const recordIssue=(code,method)=>{if(method!=='GET')requestIssue=code;return new ProbeFailure(code);};
 // Keep the SDK's JSON/SSE parser, but bound the network/body input before it.
 // The configured endpoint is the only permitted destination, including redirects.
 const boundedFetch=async(input,init={})=>{
  const method=init.method??'GET';
  if(new URL(typeof input==='string'?input:input.url??input).href!==config.url.href)throw recordIssue('redirect_refused',method);
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(budget()),...(init.signal?[init.signal]:[])]);
  let response;
  try{response=await fetch(input,{...init,redirect:'manual',signal});}
  catch{throw recordIssue(signal.aborted?'stage_timeout':'connection_failed',method);}
  let code;
  if(response.status>=300&&response.status<400)code='redirect_refused';
  else if(response.status===401)code='authentication_rejected';
  else if(response.status===403)code='access_rejected';
  else if(response.status===404)code='endpoint_or_session_missing';
  else if(!response.ok&&!(method==='GET'&&response.status===405))code='remote_http_error';
  if(code){await response.body?.cancel();throw recordIssue(code,method);}
  const length=response.headers.get('content-length');
  if(length&&(!/^[0-9]+$/.test(length)||Number(length)>MAX_RESPONSE_BYTES)){
   await response.body?.cancel();throw recordIssue('response_too_large',method);
  }
  if(!response.body)return response;
  const reader=response.body.getReader();let bytes=0;
  const body=new ReadableStream({
   async pull(stream){
    try{
     const next=await reader.read();
     if(next.done){stream.close();return;}
     bytes+=next.value.byteLength;totalBytes+=next.value.byteLength;
     if(bytes>MAX_RESPONSE_BYTES||totalBytes>MAX_TOTAL_BYTES){
      await reader.cancel();stream.error(recordIssue('response_too_large',method));return;
     }
     stream.enqueue(next.value);
    }catch{stream.error(recordIssue(signal.aborted?'stage_timeout':'protocol_error',method));}
   },
   cancel(){return reader.cancel();},
  });
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
 const headers={Authorization:'Bearer '+config.token,'X-Cairn-Scopes':config.scope};
 if(config.projectId)headers['X-Cairn-Project']=config.projectId;
 const transport=new StreamableHTTPClientTransport(config.url,{requestInit:{headers},fetch:boundedFetch,reconnectionOptions:{maxRetries:0}});
 const client=new Client({name:'cairn-remote-doctor',version:'1'},{capabilities:{}});
 client.onerror=()=>{};
 async function check(name,operation){
  stage=name;requestIssue=undefined;const start=Date.now();let timer;
  try{
   const result=await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new ProbeFailure('stage_timeout')),budget());})]);
   report.checks.push({stage:name,status:'pass',elapsedMs:Date.now()-start});return result;
  }catch(error){
   const code=error instanceof ProbeFailure?error.code:requestIssue??(controller.signal.aborted||error?.code===ErrorCode.RequestTimeout?'stage_timeout':'protocol_error');
   report.failure={stage:name,code,message:messages[code]};report.checks.push({stage:name,status:'fail',elapsedMs:Date.now()-start});
   controller.abort();throw new ProbeFailure(code);
  }finally{clearTimeout(timer);}
 }
 try{
  await check('initialize',async()=>{
   await client.connect(transport,{timeout:budget()});
   if(client.getServerVersion()?.name!=='cairn-memory')fail('protocol_error');
  });
  await check('discovery',async()=>{
   const tools=[];let cursor;const cursors=new Set();
   for(let page=0;page<4;page++){
    const response=await client.listTools(cursor?{cursor}:{},{timeout:budget()});tools.push(...response.tools);
    if(tools.length>256)fail('response_too_large');
    cursor=response.nextCursor;if(!cursor)break;
    if(cursor.length>2048||cursors.has(cursor)||page===3)fail('protocol_error');cursors.add(cursor);
   }
   if(new Set(tools.map(t=>t.name)).size!==tools.length)fail('protocol_error');
   for(const name of ['memory_read',...(config.search?['memory_search']:[])]){
    const tool=tools.find(t=>t.name===name);
    if(tool?.annotations?.readOnlyHint!==true||tool.annotations.destructiveHint!==false)fail('observation_unavailable');
   }
  });
  await check('read',async()=>{
   const result=await client.callTool({name:'memory_read',arguments:{scope:config.scope,key:'diagnostics/remote-probe-'+randomUUID()}},undefined,{timeout:budget()});
   if(result.isError)fail('tool_error');
  });
  if(config.search)await check('search',async()=>{
   const result=await client.callTool({name:'memory_search',arguments:{scope:config.scope,query:'cairnkeep synthetic connectivity diagnostic',top_k:1}},undefined,{timeout:budget()});
   if(result.isError)fail('tool_error');
  });
  report.ok=true;
 }catch(error){
  if(!report.failure)report.failure={stage,code:'protocol_error',message:messages.protocol_error};
 }finally{
  // Terminate only this diagnostic's ephemeral MCP session, never the service.
  controller.abort();clearTimeout(overall);
  try{await client.close();}catch{}
  try{
   if(transport.sessionId&&transport.sessionId.length<=4096){
    const response=await fetch(config.url,{method:'DELETE',headers:{...headers,'mcp-session-id':transport.sessionId},redirect:'manual',signal:AbortSignal.timeout(500)});
    await response.body?.cancel();
   }
  }catch{}
 }
}

export async function runRemoteDoctor(args,{env=process.env,stdout=process.stdout}={}){
 if(args.includes('--help')||args.includes('-h')){stdout.write(REMOTE_DOCTOR_USAGE+'\n');return 0;}
 const report={schemaVersion:1,mode:'remote',ok:false,checks:[]};let config;
 try{config=await configuration(args,env);}catch{
  report.failure={stage:'configuration',code:'configuration_error',message:messages.configuration_error};
 }
 if(config)await probe(config,report);
 report.notes=[
  'This is a fresh independent session, not an inspection or repair of another harness connection.',
  'No memory mutation tool is called. Only this diagnostic session is closed. Credentials, endpoint, memory content and server-controlled errors are not printed.',
  ...(config?.search?['Search may use the existing server-side providers and caches; success does not prove embeddings or reranking rather than fallback.']:[]),
 ];
 if(args.includes('--json'))stdout.write(JSON.stringify(report)+'\n');
 else{
  stdout.write('cairn doctor — remote memory\n');
  for(const check of report.checks)stdout.write(`  [${check.status==='pass'?'PASS':'FAIL'}] remote MCP ${check.stage} (${check.elapsedMs} ms)\n`);
  if(report.failure)stdout.write('  [FAIL] '+report.failure.message+'\n');
  else stdout.write('  [PASS] fresh remote memory session works; a separate harness connection may still need reconnection\n');
  for(const note of report.notes)stdout.write('  [NOTE] '+note+'\n');
 }
 return report.ok?0:report.failure.stage==='configuration'?2:1;
}
