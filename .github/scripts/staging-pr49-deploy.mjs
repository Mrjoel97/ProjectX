import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const current='b2dfecaa512b5b2bdf34189dcc3a09b9ff4cc41c';
const root=resolve('current'), backend=resolve(root,'packages/backend');
const roots={ [current]:root };
const statePath=resolve(process.env.RUNNER_TEMP,'staging-pr49-preserved.private.json');
const check=x=>{if(!x)throw Error('GUARD_FAILED');};
const capture=(file,args,cwd=backend)=>execFileSync(file,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:600000,maxBuffer:8*1024*1024}).trim();
const cliAt=(sha,args)=>{check(Object.hasOwn(roots,sha));return capture(process.execPath,['node_modules/convex/bin/main.js',...args],resolve(roots[sha],'packages/backend'));};
const cli=args=>cliAt(current,args);
const query=(source,component)=>JSON.parse(cli(['run','--inline-query',source,...(component?['--component',component]:[])]));
const target=()=>check(cli(['dashboard','--no-open']).match(/https:\/\/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/)?.[1]==='woozy-wren-368');
const atomic=value=>{writeFileSync(statePath+'.tmp',JSON.stringify(value),{mode:0o600});renameSync(statePath+'.tmp',statePath);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
let phase='initialize';
async function configuration(){
 const {ENV_MANIFEST,ORIGIN_ENV,missingEnv}=await import(resolve(backend,'convex/lib/env.ts'));
 const names=new Set(cli(['env','list','--names-only']).split(/\r?\n/));
 const watched=[...new Set([...ORIGIN_ENV,'FOUNDATION_ONBOARDING_ENABLED','VOICE_SERVER_CONTROL_VERIFIED',...ENV_MANIFEST.filter(x=>x.tier==='fixture'||/_(ENABLED|VERIFIED)$/.test(x.name)).map(x=>x.name),...Array.from(names).filter(x=>/ORIGIN|CORS/.test(x))])].sort();
 const values=Object.fromEntries(watched.map(name=>[name,names.has(name)?cli(['env','get',name]):null]));
 check(new URL(values.SITE_URL).origin==='https://pikar-ai-convex-gpbrsadzc-joelferuzi-gmailcoms-projects.vercel.app');
 check([null,'0','false'].includes(values.VOICE_SERVER_CONTROL_VERIFIED));
 check(!missingEnv(name=>values[name]??undefined).fixturesActive.length);
 return values;
}
function retention(){
 const rows=query('const interviews=await ctx.db.query("foundationInterviews").take(201);if(interviews.length>200)throw Error("BOUND");const own=interviews.filter(x=>x.tenantId.startsWith("retention-qualification-"));if(own.length!==1)throw Error("UNIQUENESS");const transcripts=await ctx.db.query("foundationTranscripts").withIndex("by_tenant",q=>q.eq("tenantId",own[0].tenantId)).take(2);if(transcripts.length!==1||transcripts[0].expiresAt<=Date.now())throw Error("RETENTION_CLOCK");return {interview:own[0],transcript:transcripts[0]};');
 check(createHash('sha256').update(JSON.stringify([rows.interview._id,rows.interview.tenantId,rows.interview._creationTime])).digest('hex')==='b389a2014e514c7a35e08480dcef446aeb46b360861e2b8b72f9e67fc61f412e');
 check(new Date(rows.transcript._creationTime).toISOString()==='2026-10-17T10:18:29.493Z'&&new Date(rows.transcript.expiresAt).toISOString()==='2026-10-24T10:18:29.493Z'&&Math.abs(rows.transcript.expiresAt-rows.transcript._creationTime-604800000)<=1);
 
 return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function registry(){const rows=query('const rows=await ctx.db.query("skills").take(1001);if(rows.length>1000)throw Error("BOUND");return rows;');return createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
function quiet(){
 check(query('const interviews=await ctx.db.query("foundationInterviews").take(201);const voice=await ctx.db.query("voiceSessions").take(201);const uploads=await ctx.db.query("uploadReceipts").take(201);return interviews.length<=200&&voice.length<=200&&uploads.length<=200&&interviews.every(x=>x.tenantId.startsWith("retention-qualification-")||x.state==="published")&&voice.every(x=>x.status!=="active"&&(!x.callId||typeof x.hangupConfirmedAt==="number"))&&uploads.every(x=>x.state==="complete"||(x.state==="issued"&&x.expiresAt<Date.now()));'));
 check(query('const rows=await ctx.db.query("workflows").take(1001);return rows.length<=1000&&rows.every(x=>x.runResult!==undefined);','workflow'));
 for(const component of ['workflow/workpool','vaultIngestPool']) check(query('const work=await ctx.db.query("work").take(1);const state=await ctx.db.query("internalState").take(2);return work.length===0&&state.length<=1&&state.every(x=>x.running.length===0);',component));
}

function source(){
 check(/^[a-f0-9]{40}$/.test(current));
 check(capture('git',['rev-parse','HEAD'],root)===current);
 check(capture('git',['status','--porcelain','--untracked-files=no'],root)==='');
 check(/COMMERCIAL_BILLING_ENABLED:\s*boolean\s*=\s*false/.test(readFileSync(resolve(root,'packages/billing/src/config.ts'),'utf8')));
}
async function verify(){
 check(existsSync(statePath));const state=JSON.parse(readFileSync(statePath,'utf8'));
 phase='verify-source';source();phase='verify-target';target();
 phase='verify-configuration';check(equal(await configuration(),state.configuration));
 phase='verify-retention';check(retention()===state.retention);
 phase='verify-registry';check(registry()===state.registry);
 console.log(JSON.stringify({preservedStateVerified:true,originalConfigurationUnchanged:true,registryUnchanged:true,retentionUnchanged:true,productionUntouched:true}));
}

async function repair(){
 check(existsSync(statePath+'.deployed'));await verify();quiet();
 phase='repair-select';
 const selected=query('const rows=await ctx.db.query("namespaces").take(201);if(rows.length>200)throw Error("BOUND");const matches=[];for(const row of rows){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([row._id,row.namespace,row._creationTime])));const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");if(hash==="2cf1c82dbf88aa6b1ca667cc5e4cbbdfaa387047481652294da5dfc6e386d2cc")matches.push(row);}if(matches.length!==1)throw Error("EXACT_SELECTION_REQUIRED");const selected=matches[0];if(rows.filter(row=>row.namespace===selected.namespace).length!==1)throw Error("SCOPE_NOT_EMPTY_SINGLE_VERSION");return {id:selected._id,tenantId:selected.namespace,dimension:selected.dimension};','rag');
 check(typeof selected.tenantId==='string'&&typeof selected.id==='string');
 check([128,256,512,768,1024,1408,1536,2048,3072,4096].includes(selected.dimension));
 const tenant=JSON.stringify(selected.tenantId),id=JSON.stringify(selected.id);
 const fenceQuery='const tenant='+tenant+';const userId=ctx.db.normalizeId("users",tenant);if(!userId||await ctx.db.get(userId))throw Error("NATIVE_ERASURE_REQUIRED");const fence=await ctx.db.query("authRevocations").withIndex("by_userId",q=>q.eq("userId",tenant)).unique();if(!fence||fence.state!=="deleted")throw Error("ERASED_FENCE_REQUIRED");return {complete:fence.ragCleanup?.state==="complete",stalled:fence.ragCleanup?.state==="stalled"};';
 phase='repair-erasure-authority';query(fenceQuery);
 const emptyQuery='const id='+id+';const tenant='+tenant+';const namespaces=await ctx.db.query("namespaces").take(201);if(namespaces.length>200)throw Error("BOUND");const entries=await ctx.db.query("entries").withIndex("namespaceId_status_key_version",q=>q.eq("namespaceId",id)).take(1);const chunks=await ctx.db.query("chunks").take(1001);const vectors=await ctx.db.query("vectors_'+selected.dimension+'").take(1001);if(chunks.length>1000||vectors.length>1000)throw Error("BOUND");if(entries.length||chunks.some(x=>x.namespaceId===id)||vectors.some(x=>x.namespaceId===id))throw Error("NOT_EMPTY");return {namespaceAbsent:!await ctx.db.get(id),allVersionsAbsent:!namespaces.some(x=>x.namespace===tenant)};';
 phase='repair-empty-proof';const before=query(emptyQuery,'rag');check(!before.namespaceAbsent&&!before.allVersionsAbsent);
 phase='repair-start';cli(['run','ragErasure:start',JSON.stringify({tenantId:selected.tenantId})]);
 for(let poll=0;poll<60;poll++){
  phase='repair-observe';const fence=query(fenceQuery);check(!fence.stalled);const physical=query(emptyQuery,'rag');
  if(fence.complete&&physical.namespaceAbsent&&physical.allVersionsAbsent){
   await verify();console.log(JSON.stringify({historicalEmptyNamespaceRepaired:true,erasedIdentityFenceVerified:true,allExactNamespaceVersionsAbsent:true,emptyEntriesChunksVectorsVerified:true,paidCallsRequested:false}));return;
  }
  if(poll<59)await new Promise(resolve=>setTimeout(resolve,5000));
 }
 throw Error('REPAIR_OBSERVATION_INCOMPLETE');
}
try {
 if(process.argv[2]==='prepare'){
  phase='source';source();phase='target';target();phase='configuration';const before=await configuration();check(before.FOUNDATION_ONBOARDING_ENABLED==='1');
  phase='quiet';quiet();phase='capture';check(!existsSync(statePath));atomic({configuration:before,registry:registry(),retention:retention()});
  phase='strict-dry-run';cli(['deploy','--dry-run','--typecheck','enable']);
  await verify();quiet();
  writeFileSync(statePath+'.prepared','1',{mode:0o600});
  console.log(JSON.stringify({strictDryRunPassed:true,immutableSourceVerified:true,deploymentApplyRequested:false}));
 }else if(process.argv[2]==='deploy'){
  check(existsSync(statePath+'.prepared'));await verify();quiet();
  phase='deploy-current';cli(['deploy','--codegen','disable','--typecheck','enable','--message','Reviewed PR49 staging backend '+current]);
  await verify();
  writeFileSync(statePath+'.deployed','1',{mode:0o600});
  console.log(JSON.stringify({reviewedBackendDeployed:true,oldBackendRollbackAttempted:false}));
 }else if(process.argv[2]==='repair'){
  await repair();
 }else if(process.argv[2]==='verify'){
  if(existsSync(statePath)) await verify();
  else console.log(JSON.stringify({preservedStateUnavailable:true,deploymentNotStarted:true}));
 }else throw Error();
}catch(error){
 const raw=String(error?.stderr??'')+String(error?.stdout??'');
 const category=/TypeScript|typecheck|error TS\d+/.test(raw)?'typecheck':/bundl|esbuild/.test(raw)?'bundle':error?.code==='ETIMEDOUT'?'timeout':typeof error?.status==='number'?'cli_failure':'guard';
 console.error(JSON.stringify({success:false,phase,category,exitCode:typeof error?.status==='number'?error.status:null,privateDiagnosticsSuppressed:true}));process.exitCode=1;
}
