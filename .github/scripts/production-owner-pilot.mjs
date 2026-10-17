import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';


const SOURCE = '4e83cd4f77d1978b2d5caec0fed90b514597f820';
const OWNER_EMAIL = "joel.feruzi@gmail.com";
const root = resolve('current'), backend = resolve(root, 'packages/backend');
const check = value => { if (!value) throw Error('GUARD'); };
const capture = (command, args, cwd = backend) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 30000, maxBuffer: 2*1024*1024 }).trim();
const cli = args => capture(process.execPath, ['node_modules/convex/bin/main.js', ...args]);
const statePath=resolve(process.env.RUNNER_TEMP??'.','production-owner-pilot.private.json');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const emit=value=>console.log(JSON.stringify(value));
const target=()=>check(cli(['dashboard','--no-open']).match(/https:\/\/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/)?.[1]==='opulent-octopus-494');
const getPilot=()=>{const names=new Set(cli(['env','list','--names-only']).split(/\r?\n/));return names.has('NATIVE_ONBOARDING_PILOT')?cli(['env','get','NATIVE_ONBOARDING_PILOT']):null;};
const save=state=>{writeFileSync(statePath+'.tmp',JSON.stringify(state),{mode:0o600});renameSync(statePath+'.tmp',statePath);};
async function preservedConfiguration(){
 const {ENV_MANIFEST,ORIGIN_ENV}=await import(resolve(backend,'convex/lib/env.ts'));
 const names=new Set(cli(['env','list','--names-only']).split(/\r?\n/));
 const watched=[...new Set([...ORIGIN_ENV,'DEPLOYMENT_BUDGET_CENTS',...ENV_MANIFEST.filter(x=>x.tier==='fixture'||/_(ENABLED|VERIFIED)$/.test(x.name)).map(x=>x.name),...[...names].filter(x=>/ORIGIN|CORS/.test(x))])].sort();
 return Object.fromEntries(watched.map(name=>[name,names.has(name)?cli(['env','get',name]):null]));
}
let phase = 'source';
async function preflight() {
  check(/^[a-f0-9]{40}$/.test(SOURCE));
  check(capture('git', ['rev-parse', 'HEAD'], root) === SOURCE);
  check(capture('git', ['status','--porcelain','--untracked-files=no'],root) === '');
  check(/COMMERCIAL_BILLING_ENABLED:\s*boolean\s*=\s*false/.test(readFileSync(resolve(root,'packages/billing/src/config.ts'),'utf8')));
  phase = 'target';
  check(cli(['dashboard','--no-open']).match(/https:\/\/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/)?.[1] === 'opulent-octopus-494');
  phase = 'configuration';
  const {ENV_MANIFEST,missingEnv} = await import(resolve(backend,'convex/lib/env.ts'));
  const names = new Set(cli(['env','list','--names-only']).split(/\r?\n/));
  check(names.has('OPENAI_API_KEY') && names.has('OPENROUTER_API_KEY'));
  const value = name => names.has(name) ? cli(['env','get',name]) : null;
  check(['https://pikar-ai.com','https://www.pikar-ai.com'].includes(value('SITE_URL')));
  check([null,'0','false'].includes(value('FOUNDATION_ONBOARDING_ENABLED')));
  check([null,'0','false'].includes(value('VOICE_SERVER_CONTROL_VERIFIED')));
  check([null,''].includes(value('NATIVE_ONBOARDING_PILOT')));
  const fixtures = new Map(ENV_MANIFEST.filter(x=>x.tier==='fixture').map(x=>[x.name,value(x.name)]));
  check(!missingEnv(name=>fixtures.get(name)??undefined).fixturesActive.length);
  const budget = value('DEPLOYMENT_BUDGET_CENTS');
  check(budget===null || (/^\d+$/.test(budget) && Number(budget)>=184 && Number(budget)<=5000));
  phase = 'native-owner';
  const selected = JSON.parse(cli(['run','--inline-query',`const found=await ctx.db.query("users").withIndex("email",q=>q.eq("email",${JSON.stringify(OWNER_EMAIL)})).take(11);if(found.length>10)return {exactOwnerMatchCount:found.length,ownerInventoryComplete:false,eligibleGoogleCandidateCount:0};const eligible=[];let googleLinkedCandidateCount=0,googleEmailVerifiedCandidateCount=0,userVerificationTimestampCandidateCount=0,activeNativeSessionCandidateCount=0;for(const candidate of found){const ga=await ctx.db.query("authAccounts").withIndex("userIdAndProvider",q=>q.eq("userId",candidate._id).eq("provider","google")).take(2);const ss=await ctx.db.query("authSessions").withIndex("userId",q=>q.eq("userId",candidate._id)).take(101);if(ga.length===1){googleLinkedCandidateCount++;if(ga[0].emailVerified===candidate.email)googleEmailVerifiedCandidateCount++;if(typeof candidate.emailVerificationTime==="number")userVerificationTimestampCandidateCount++;if(ss.length<=100&&ss.some(s=>s.expirationTime>Date.now()))activeNativeSessionCandidateCount++;}if(ga.length===1&&ga[0].emailVerified===candidate.email&&typeof candidate.emailVerificationTime==="number"&&ss.length<=100&&ss.some(s=>s.expirationTime>Date.now()))eligible.push(candidate);}if(eligible.length!==1)return {exactOwnerMatchCount:found.length,ownerInventoryComplete:true,googleLinkedCandidateCount,googleEmailVerifiedCandidateCount,userVerificationTimestampCandidateCount,activeNativeSessionCandidateCount,eligibleGoogleCandidateCount:eligible.length};const user=eligible[0],tenantId=String(user._id);const accounts=await ctx.db.query("authAccounts").withIndex("userIdAndProvider",q=>q.eq("userId",user._id).eq("provider","google")).take(2);const authSessions=await ctx.db.query("authSessions").withIndex("userId",q=>q.eq("userId",user._id)).take(101);const fence=await ctx.db.query("authRevocations").withIndex("by_userId",q=>q.eq("userId",tenantId)).unique();const voices=await ctx.db.query("voiceSessions").withIndex("by_tenant",q=>q.eq("tenantId",tenantId)).take(101);const skills=[];for(const name of ["foundation-voice","business-profile","onboarding-agent"]){skills.push((await ctx.db.query("skills").withIndex("by_name_status",q=>q.eq("name",name).eq("status","active")).take(2)).length===1);}const config=await ctx.db.query("guardrailConfig").first();return {tenantId,ownerInventoryComplete:true,googleLinkedCandidateCount,googleEmailVerifiedCandidateCount,userVerificationTimestampCandidateCount,activeNativeSessionCandidateCount,eligibleGoogleCandidateCount:eligible.length,exactOwnerMatchCount:found.length,nativeGoogleLinked:accounts.length===1,userVerificationMetadata:typeof user.emailVerificationTime==="number",accountEmailVerified:accounts.length===1&&accounts[0].emailVerified===user.email,nativeVerified:accounts.length===1&&accounts[0].emailVerified===user.email&&typeof user.emailVerificationTime==="number",nativeSessionPresent:authSessions.length<=100&&authSessions.some(s=>s.expirationTime>Date.now()),erasureAbsent:!fence?.state,voiceInventoryComplete:voices.length<=100,voiceRowCount:voices.length,activeUnexpiredCount:voices.filter(s=>s.status==="active"&&s.endsAt>Date.now()).length,activeExpiredCount:voices.filter(s=>s.status==="active"&&s.endsAt<=Date.now()).length,endedUnconfirmedCount:voices.filter(s=>s.status!=="active"&&s.callId&&!Number.isFinite(s.hangupConfirmedAt)).length,callHandleCount:voices.filter(s=>s.callId).length,unresolvedCount:voices.filter(s=>s.hangupUnresolved===true).length,minDeadline:voices.length?Math.min(...voices.map(s=>s.endsAt)):null,maxDeadline:voices.length?Math.max(...voices.map(s=>s.endsAt)):null,voiceQuiet:voices.length<=100&&voices.every(s=>s.status!=="active"&&(!s.callId||Number.isFinite(s.hangupConfirmedAt))),skillsReady:skills.every(Boolean),killSwitchOff:!config?.killSwitch};`]));
  emit({ownerDiagnostics:true,exactOwnerMatchCount:selected.exactOwnerMatchCount,ownerInventoryComplete:selected.ownerInventoryComplete===true,googleLinkedCandidateCount:selected.googleLinkedCandidateCount??0,googleEmailVerifiedCandidateCount:selected.googleEmailVerifiedCandidateCount??0,userVerificationTimestampCandidateCount:selected.userVerificationTimestampCandidateCount??0,activeNativeSessionCandidateCount:selected.activeNativeSessionCandidateCount??0,eligibleGoogleCandidateCount:selected.eligibleGoogleCandidateCount??0,nativeGoogleLinked:selected.nativeGoogleLinked===true,userVerificationMetadata:selected.userVerificationMetadata===true,accountEmailVerified:selected.accountEmailVerified===true,nativeSessionPresent:selected.nativeSessionPresent===true,erasureAbsent:selected.erasureAbsent===true,voiceInventoryComplete:selected.voiceInventoryComplete===true,voiceRowCount:selected.voiceRowCount??0,activeUnexpiredCount:selected.activeUnexpiredCount??0,activeExpiredCount:selected.activeExpiredCount??0,endedUnconfirmedCount:selected.endedUnconfirmedCount??0,callHandleCount:selected.callHandleCount??0,unresolvedCount:selected.unresolvedCount??0,minDeadline:selected.minDeadline??null,maxDeadline:selected.maxDeadline??null,voiceQuiet:selected.voiceQuiet===true,skillsReady:selected.skillsReady===true,killSwitchOff:selected.killSwitchOff===true});
  check(selected.ownerInventoryComplete && selected.eligibleGoogleCandidateCount===1 && selected.nativeVerified && selected.nativeSessionPresent && selected.erasureAbsent && selected.voiceQuiet && selected.skillsReady && selected.killSwitchOff);
  phase = 'budget';
  const remaining = JSON.parse(cli(['run','guardrails:remainingDailyCents',JSON.stringify({tenantId:selected.tenantId})]));
  check(Number.isFinite(remaining) && remaining>=184 && remaining<=500);
  const configuration=await preservedConfiguration();
  console.log(JSON.stringify({readOnlyPreflightPassed:true,exactNativeOwner:true,nativeVerified:true,nativeSessionPresent:true,operatorBusinessWrites:false,ownerErasure:false,globalFlagsOff:true,pilotAbsent:true,billingOff:true,fixturesOff:true,skillsReady:true,budgetSufficient:true,activationAttempted:false}));
  return {tenantId:selected.tenantId,configuration,priorPilot:value('NATIVE_ONBOARDING_PILOT')};
}

async function restore(){
 if(!existsSync(statePath)){emit({activationAttempted:false});return;}
 const state=JSON.parse(readFileSync(statePath,'utf8'));target();
 const current=getPilot();check(current===state.grant||current===state.priorPilot);
 if(current!==state.priorPilot)cli(state.priorPilot===null?['env','remove','NATIVE_ONBOARDING_PILOT']:['env','set','NATIVE_ONBOARDING_PILOT',state.priorPilot]);
 check(getPilot()===state.priorPilot);
 check(JSON.stringify(await preservedConfiguration())===JSON.stringify(state.configuration));
 emit({pilotRestored:true,globalFlagsAndOriginalConfigurationUnchanged:true});
}
function observeProof(state){
 const {issuedAt,expiresAt}=state;
 const proof=JSON.parse(cli(['run','--inline-query',`const tenant=${JSON.stringify(state.tenantId)};const all=await ctx.db.query("voiceSessions").withIndex("by_tenant",q=>q.eq("tenantId",tenant)).take(101);if(all.length>100)throw Error("BOUND");const sessions=all.filter(s=>s.startedAt>=${issuedAt});const spend=await ctx.db.query("spendEvents").withIndex("by_tenant_createdAt",q=>q.eq("tenantId",tenant).gte("createdAt",${issuedAt})).take(301);if(sessions.length>20||spend.length>300)throw Error("BOUND");const realtime=spend.filter(r=>r.kind==="paid_call"&&r.model==="gpt-realtime-2.1"),held=realtime.filter(r=>r.phase==="reserved"),actual=realtime.filter(r=>r.phase==="actual"),initialIds=new Set(sessions.map(s=>s.spendReservationId));const responses=held.filter(r=>!initialIds.has(r._id));const unresolved=responses.filter(r=>!realtime.some(x=>x.correlationId===r.correlationId&&(x.phase==="actual"||(x.phase==="refunded"&&x.evalActualUsd===0))));const interview=await ctx.db.query("foundationInterviews").withIndex("by_tenant",q=>q.eq("tenantId",tenant)).unique();const ids=interview?.docIds??[];if(ids.length>6)throw Error("DOC_BOUND");const docs=await Promise.all(ids.map(id=>ctx.db.get(id)));return {sessionCount:sessions.length,singleControlledOnboarding:sessions.length===1&&sessions.every(s=>s.controlled&&s.onboarding&&s.controlReady),providerTerminationConfirmed:sessions.length===1&&sessions.every(s=>s.status!=="active"&&Number.isFinite(s.hangupConfirmedAt)&&s.hangupUnresolved!==true),deadlineCapped:sessions.every(s=>s.endsAt<=${expiresAt}&&s.endsAt-s.startedAt<=300000),trustedResponseCount:sessions.reduce((n,s)=>n+(s.trustedResponseIds?.length??0),0),initialHoldRetained:held.filter(r=>initialIds.has(r._id)&&r.amountCents===100&&realtime.every(x=>x.correlationId!==r.correlationId||x.phase==="reserved")).length===1,responseReservations:responses.length,unresolvedResponses:unresolved.length,actualCents:actual.reduce((n,r)=>n+r.amountCents,0),foundationRevision:interview?.revision??null,publishedRevision:interview?.publishedRevision??null,sixOwnedReadyDocuments:docs.length===6&&docs.every(d=>d?.tenantId===tenant&&d.status==="ready")};`]));
 check(Object.values(proof).every(x=>typeof x==='boolean'||typeof x==='number'||x===null));
 return proof;
}
async function window(){
 check(process.env.PILOT_GO==='1'&&process.env.OWNER_READY==='1');check(!existsSync(statePath));
 const before=await preflight(),issuedAt=Date.now(),expiresAt=issuedAt+900000;
 const state={...before,issuedAt,expiresAt,grant:JSON.stringify({tenantId:before.tenantId,issuedAt,expiresAt})};save(state);
 try{
  phase='open-pilot';cli(['env','set','NATIVE_ONBOARDING_PILOT',state.grant]);check(getPilot()===state.grant);
  emit({pilotOpen:true,issuedAt,expiresAt,globalFlagsOff:true,billingOff:true,singleTenant:true});
  phase='observe-window';
  while(Date.now()<expiresAt){const current=getPilot();if(current===state.priorPilot)break;check(current===state.grant);const observed=observeProof(state);if(observed.sessionCount>0)state.lastProof=observed;save(state);await sleep(Math.min(10000,Math.max(1,expiresAt-Date.now())));}
 }finally{await restore();}
 phase='server-corroboration';
 const observed=observeProof(state);const proof=observed;
 emit({...proof,tenantWindowLedger:true,serverCorroborationOnly:true,microphoneAcceptance:false,browserAcceptance:false});
 check(proof.singleControlledOnboarding&&proof.providerTerminationConfirmed&&proof.deadlineCapped&&proof.trustedResponseCount>0&&proof.initialHoldRetained&&proof.unresolvedResponses===0);
}
try{
 if(process.argv[2]==='preflight')await preflight();
 else if(process.argv[2]==='window')await window();
 else if(process.argv[2]==='restore')await restore();
 else throw Error('MODE');
}catch{emit({operationPassed:false,phase,privateDiagnosticsSuppressed:true});process.exitCode=1;}
