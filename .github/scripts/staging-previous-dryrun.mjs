import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const SHA='de18285d7466ea743d42199dc1d8de4a66dccbf9';
const EXPECTED_RETENTION='b389a2014e514c7a35e08480dcef446aeb46b360861e2b8b72f9e67fc61f412e';
const root=resolve('previous'),backend=resolve(root,'packages/backend');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const assert=value=>{if(!value)throw Error('GUARD_FAILED');};
function capture(file,args,{cwd=backend,timeout=30000}={}) {
 const r=spawnSync(file,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout,maxBuffer:8*1024*1024});
 if(r.error||r.status!==0)throw Error('READ_FAILED');
 return r.stdout.trim();
}
const cli=args=>capture(process.execPath,['node_modules/convex/bin/main.js',...args]);
const query=source=>JSON.parse(cli(['run','--inline-query',source]));
const target=()=>assert(cli(['dashboard','--no-open']).match(/https:\/\/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/)?.[1]==='woozy-wren-368');
function category(result){
 const text=String(result.stdout??'')+'\n'+String(result.stderr??'');
 if(result.error?.code==='ETIMEDOUT')return 'timeout';
 if(result.status===0)return 'passed';
 if(/error TS\d+|typecheck.*fail|TypeScript.*error/i.test(text))return 'typecheck';
 if(/would be overwritten by checkout|local changes.*overwritten|Please commit your changes or stash/i.test(text))return 'dirty_checkout';
 if(/schema.*(fail|invalid|incompatible)|index.*(fail|invalid)/i.test(text))return 'schema_or_index';
 if(/codegen|generated/i.test(text))return 'generated_code';
 if(/unauthorized|forbidden|invalid.*deploy.*key/i.test(text))return 'authorization';
 if(/ECONN|ENOTFOUND|fetch failed|network/i.test(text))return 'network';
 return 'unclassified';
}
async function snapshot(){
 const {ENV_MANIFEST}=await import(resolve(backend,'convex/lib/env.ts'));
 const names=cli(['env','list','--names-only']).split(/\r?\n/).sort();
 const watched=[...new Set(['SITE_URL','FOUNDATION_ONBOARDING_ENABLED','VOICE_SERVER_CONTROL_VERIFIED',...ENV_MANIFEST.filter(x=>x.tier==='fixture').map(x=>x.name)])].sort();
 const operational=Object.fromEntries(watched.map(name=>[name,names.includes(name)?cli(['env','get',name]):null]));
 const registry=query('const rows=await ctx.db.query("skills").take(1001);if(rows.length>1000)throw Error("BOUND");return rows;');
 const retention=query('const rows=await ctx.db.query("foundationInterviews").take(201);if(rows.length>200)throw Error("BOUND");const fixtures=rows.filter(x=>x.tenantId.startsWith("retention-qualification-"));if(fixtures.length!==1)throw Error("AMBIGUOUS");const transcript=await ctx.db.query("foundationTranscripts").withIndex("by_tenant",q=>q.eq("tenantId",fixtures[0].tenantId)).take(2);if(transcript.length!==1)throw Error("CHANGED");return {interview:fixtures[0],transcript:transcript[0]};');
 assert(hash([retention.interview._id,retention.interview.tenantId,retention.interview._creationTime])===EXPECTED_RETENTION);
 assert(new Date(retention.transcript._creationTime).toISOString()==='2026-10-17T10:18:29.493Z'&&new Date(retention.transcript.expiresAt).toISOString()==='2026-10-24T10:18:29.493Z');
 return {configuration:hash({names,operational}),registry:hash(registry),retention:hash(retention)};
}
async function main(){
 let before,phase='source',result;
 try {
  assert(capture('git',['rev-parse','HEAD'],{cwd:root})===SHA);
  assert(capture('git',['status','--porcelain','--untracked-files=no'],{cwd:root})==='');
  assert(process.env.CONVEX_DEPLOY_KEY);phase='target';target();
  phase='before';before=await snapshot();
  phase='strict_dry_run';
  // Intentionally no real deploy, env set/remove, seed, --preview-run or --cmd.
  result=spawnSync(process.execPath,['node_modules/convex/bin/main.js','deploy','--dry-run','--typecheck','enable'],{cwd:backend,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:600000,maxBuffer:8*1024*1024});
  // Raw diagnostic output stays private on this ephemeral runner; never upload as an artifact.
  for(const [name,value] of [['stdout',result.stdout],['stderr',result.stderr]])writeFileSync(resolve(process.env.RUNNER_TEMP,`previous-dry-run.${name}.private`),String(value??''),{mode:0o600});
  const paths=capture('git',['diff','--name-only','--','packages/backend/convex/_generated'],{cwd:root}).split('\n').filter(Boolean);
  assert(paths.every(path=>/^packages\/backend\/convex\/_generated\/[A-Za-z0-9_./-]+\.(ts|js)$/.test(path)));
  console.log(JSON.stringify({phase:'strict_dry_run',category:category(result),exitCode:Number.isInteger(result.status)?result.status:null,generatedPaths:paths,deploymentApplyRequested:false}));
  if(result.error||result.status!==0)process.exitCode=1;
 }catch{console.log(JSON.stringify({phase,category:'guard_or_observation_failed',diagnosticsPrivate:true}));process.exitCode=1;}
 finally{
  if(before)try{
   target();const after=await snapshot();
   const evidence={configurationUnchanged:before.configuration===after.configuration,registryUnchanged:before.registry===after.registry,retentionUnchanged:before.retention===after.retention,stagingTargetVerified:true,deploymentApplyRequested:false};
   console.log(JSON.stringify(evidence));if(!evidence.configurationUnchanged||!evidence.registryUnchanged||!evidence.retentionUnchanged)process.exitCode=1;
  }catch{console.log(JSON.stringify({afterObservationCompleted:false,deploymentApplyRequested:false}));process.exitCode=1;}
 }
}
if(process.argv[2]==='self-check'){
 for(const [input,want] of [[{status:0},'passed'],[{status:1,stderr:'error TS1234: private fixture'},'typecheck'],[{status:1,stderr:'Your local changes would be overwritten by checkout'},'dirty_checkout'],[{status:null,error:{code:'ETIMEDOUT'}},'timeout'],[{status:1,stderr:'private unclassified'},'unclassified']])assert(category(input)===want);
 console.log(JSON.stringify({classificationSelfCheckPassed:true}));
}else await main();

