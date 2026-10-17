import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const current='a129b884445482625b1e8f2a236744fb2a0f2515';
const previous='de18285d7466ea743d42199dc1d8de4a66dccbf9';
const root=resolve('current'), backend=resolve(root,'packages/backend');
const roots={ [current]:root, [previous]:resolve('previous') };
const preparedPath=resolve(process.env.RUNNER_TEMP,'staging-rollback-prepared.private.json');
const statePath=resolve(process.env.RUNNER_TEMP,'staging-backend-rollback.private.json');
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
 const {ENV_MANIFEST,missingEnv}=await import(resolve(backend,'convex/lib/env.ts'));
 const names=new Set(cli(['env','list','--names-only']).split(/\r?\n/));
 const watched=[...new Set(['SITE_URL','FOUNDATION_ONBOARDING_ENABLED','VOICE_SERVER_CONTROL_VERIFIED',...ENV_MANIFEST.filter(x=>x.tier==='fixture').map(x=>x.name)])].sort();
 const values=Object.fromEntries(watched.map(name=>[name,names.has(name)?cli(['env','get',name]):null]));
 check(new URL(values.SITE_URL).origin==='https://pikar-ai-convex-gpbrsadzc-joelferuzi-gmailcoms-projects.vercel.app');
 check([null,'0','false'].includes(values.VOICE_SERVER_CONTROL_VERIFIED));
 check(!missingEnv(name=>values[name]??undefined).fixturesActive.length);
 return values;
}
function retention(emitIdentity=false){
 const rows=query('const interviews=await ctx.db.query("foundationInterviews").take(201);if(interviews.length>200)throw Error("BOUND");const own=interviews.filter(x=>x.tenantId.startsWith("retention-qualification-"));if(own.length!==1)throw Error("UNIQUENESS");const transcripts=await ctx.db.query("foundationTranscripts").withIndex("by_tenant",q=>q.eq("tenantId",own[0].tenantId)).take(2);if(transcripts.length!==1||transcripts[0].expiresAt<=Date.now())throw Error("RETENTION_CLOCK");return {interview:own[0],transcript:transcripts[0]};');
 check(createHash('sha256').update(JSON.stringify([rows.interview._id,rows.interview.tenantId,rows.interview._creationTime])).digest('hex')==='b389a2014e514c7a35e08480dcef446aeb46b360861e2b8b72f9e67fc61f412e');
 check(new Date(rows.transcript._creationTime).toISOString()==='2026-10-17T10:18:29.493Z'&&new Date(rows.transcript.expiresAt).toISOString()==='2026-10-24T10:18:29.493Z'&&Math.abs(rows.transcript.expiresAt-rows.transcript._creationTime-604800000)<=1);
 if(emitIdentity)console.log(JSON.stringify({retentionIdentityFingerprint:createHash('sha256').update(JSON.stringify([rows.interview._id,rows.interview.tenantId,rows.interview._creationTime])).digest('hex'),originalCheckpointDatesMatched:true}));
 return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function registry(){const rows=query('const rows=await ctx.db.query("skills").take(1001);if(rows.length>1000)throw Error("BOUND");return rows;');return createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
function quiet(){
 check(query('const interviews=await ctx.db.query("foundationInterviews").take(201);const voice=await ctx.db.query("voiceSessions").take(201);const uploads=await ctx.db.query("uploadReceipts").take(201);return interviews.length<=200&&voice.length<=200&&uploads.length<=200&&interviews.every(x=>x.tenantId.startsWith("retention-qualification-")||x.state==="published")&&voice.every(x=>x.status!=="active"&&(!x.callId||typeof x.hangupConfirmedAt==="number"))&&uploads.every(x=>x.state==="complete"||(x.state==="issued"&&x.expiresAt<Date.now()));'));
 check(query('const rows=await ctx.db.query("workflows").take(1001);return rows.length<=1000&&rows.every(x=>x.runResult!==undefined);','workflow'));
 for(const component of ['workflow/workpool','vaultIngestPool']) check(query('const work=await ctx.db.query("work").take(1);const state=await ctx.db.query("internalState").take(2);return work.length===0&&state.length<=1&&state.every(x=>x.running.length===0);',component));
}
function source(sha){
 check(Object.hasOwn(roots,sha));
 check(capture('git',['rev-parse','HEAD'],roots[sha])===sha);
 check(capture('git',['status','--porcelain','--untracked-files=no'],roots[sha])==='');
 check(/COMMERCIAL_BILLING_ENABLED:\s*boolean\s*=\s*false/.test(readFileSync(resolve(roots[sha],'packages/billing/src/config.ts'),'utf8')));
}
function sourceTarget(sha){check(cliAt(sha,['dashboard','--no-open']).match(/https:\/\/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/)?.[1]==='woozy-wren-368');}
function deploy(sha){
 const label=sha===current?"current":"previous";
 phase=`validate-${label}-source`;source(sha);sourceTarget(sha);
 // Both exact sources passed default-codegen strict dry runs in prepare. Preserve their
 // checked-in generated types during apply/restore, while still requiring strict typechecking.
 phase=`apply-${label}`;
 cliAt(sha,['deploy','--codegen','disable','--typecheck','enable','--message','Controlled isolated staging rollback qualification '+sha]);
 phase=`verify-${label}-source`;source(sha);sourceTarget(sha);
}
async function prepare(){
 target();const before=await configuration();quiet();const r=retention(),skills=registry();
 for(const sha of [current,previous]){
  phase=sha===current?'dryrun-current':'dryrun-previous';
  source(sha);sourceTarget(sha);cliAt(sha,['deploy','--dry-run','--typecheck','enable']);source(sha);
 }
 check(equal(await configuration(),before));check(retention()===r);check(registry()===skills);quiet();
 writeFileSync(preparedPath,JSON.stringify({current,previous,configuration:before,retention:r,registry:skills}),{mode:0o600});
 console.log(JSON.stringify({bothExactStrictDryRunsPassed:true,separateSourcesUnchanged:true,configurationUnchanged:true,registryUnchanged:true,retentionUnchanged:true,deploymentApplyRequested:false}));
}
async function restore(){
 if(!existsSync(statePath)){console.log(JSON.stringify({cleanupNotRequired:true}));return;}
 const state=JSON.parse(readFileSync(statePath,'utf8'));target();
 // Always restore current code before re-opening the prior foundation admission value.
 phase='restore-current';deploy(current);check(registry()===state.registry);
 phase='restore-configuration';const actual=await configuration();
 for(const [name,value] of Object.entries(state.configuration)){
  if(actual[name]===value)continue;
  // Only this flag may have changed; never overwrite unrelated configuration drift.
  check(name==='FOUNDATION_ONBOARDING_ENABLED');
  cli(value===null?['env','remove',name]:['env','set',name,'--',value]);
 }
 check(equal(await configuration(),state.configuration));
 phase='retention-after';check(retention()===state.retention);
 console.log(JSON.stringify({currentBackendRestored:true,exactConfigurationRestored:true,retentionFixtureUnchanged:true,registryFingerprintUnchanged:true,registrySeedSkippedIdenticalSource:true,productionUntouched:true}));
}
try{
 if(process.argv[2]==='prepare'){await prepare();}
 else if(process.argv[2]==='recover'){check(existsSync(statePath));await restore();}
 else if(process.argv[2]==='restore')await restore();
 else{
  check(process.argv[2]==='run'&&!existsSync(statePath));
  check(existsSync(preparedPath));const prepared=JSON.parse(readFileSync(preparedPath,'utf8'));check(prepared.current===current&&prepared.previous===previous);
  source(current);source(previous);phase='source-compatibility';
  const changed=capture('git',['diff','--name-only',previous,current,'--','packages'],root).split('\n').filter(Boolean);
  check(changed.filter(x=>!x.endsWith('.test.ts')).sort().join('|')==='packages/backend/convex/foundation.ts|packages/backend/convex/voiceControl.ts');
  check(capture('git',['diff','--name-only',previous,current,'--','pnpm-lock.yaml','package.json','packages/core','packages/billing'],root)==='');
  phase='target';target();phase='configuration';const before=await configuration();check(before.FOUNDATION_ONBOARDING_ENABLED==='1');
  phase='quiet';quiet();phase='retention-before';const fingerprint=retention(true);const registryBefore=registry();
  check(equal(before,prepared.configuration)&&fingerprint===prepared.retention&&registryBefore===prepared.registry);
  // Must save recovery state atomically before the first mutation.
  atomic({configuration:before,retention:fingerprint,registry:registryBefore});
  phase='pause-foundation';cli(['env','set','FOUNDATION_ONBOARDING_ENABLED','--','0']);
  const paused={...before,FOUNDATION_ONBOARDING_ENABLED:'0'};check(equal(await configuration(),paused));quiet();
  phase='current-baseline';deploy(current);check(retention()===fingerprint);check(registry()===registryBefore);quiet();
  console.log(JSON.stringify({currentBaselineDeployed:true,schemaAndDependenciesIdentical:true,quietInventoryComplete:true,foundationAdmissionPaused:true,retentionFixtureUnchanged:true,registryFingerprintUnchanged:true}));
  phase='previous';deploy(previous);check(equal(await configuration(),paused));check(retention()===fingerprint);check(registry()===registryBefore);quiet();
  console.log(JSON.stringify({previousBackendDeployed:true,configurationPreserved:true,retentionFixtureUnchanged:true,registryFingerprintUnchanged:true,nativeBehaviorQualified:false,registrySeedSkippedIdenticalSource:true}));
 }
}catch{console.error(JSON.stringify({success:false,phase,privateDiagnosticsSuppressed:true}));process.exitCode=1;}
