import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';


const SOURCE = '4e83cd4f77d1978b2d5caec0fed90b514597f820';
const OWNER_EMAIL = "joel.feruzi@gmail.com";
const root = resolve('current'), backend = resolve(root, 'packages/backend');
const check = value => { if (!value) throw Error('GUARD'); };
const capture = (command, args, cwd = backend) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 30000, maxBuffer: 2*1024*1024 }).trim();
const cli = args => capture(process.execPath, ['node_modules/convex/bin/main.js', ...args]);
const emit=value=>console.log(JSON.stringify(value));
const target=()=>check(cli(['dashboard','--no-open']).match(/https:\/\/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/)?.[1]==='opulent-octopus-494');
const getPilot=()=>{const names=new Set(cli(['env','list','--names-only']).split(/\r?\n/));return names.has('NATIVE_ONBOARDING_PILOT')?cli(['env','get','NATIVE_ONBOARDING_PILOT']):null;};

try {
 check(capture('git',['rev-parse','HEAD'],root)===SOURCE);target();
 const billingOff=/COMMERCIAL_BILLING_ENABLED:\s*boolean\s*=\s*false/.test(readFileSync(resolve(root,'packages/billing/src/config.ts'),'utf8'));check(billingOff);
 const names=new Set(cli(['env','list','--names-only']).split(/\r?\n/));const get=n=>names.has(n)?cli(['env','get',n]):null;
 const foundationGlobalOff=[null,'0','false'].includes(get('FOUNDATION_ONBOARDING_ENABLED')),normalControlledVoiceEnabled=get('VOICE_SERVER_CONTROL_VERIFIED')==='1';check(foundationGlobalOff&&normalControlledVoiceEnabled);
 const raw=getPilot();if(!raw){emit({ownerPilotOpen:false,pilotAbsent:true,validUnexpiredGrant:false,foundationGlobalOff,normalControlledVoiceEnabled,billingOff});}else{
 const grant=JSON.parse(raw);const {foundationPilotExpiresAt}=await import(resolve(root,'packages/core/src/foundationPilot.ts'));const expiry=foundationPilotExpiresAt(raw,grant?.tenantId);check(expiry!==undefined);
 const owner=JSON.parse(cli(['run','--inline-query',`const user=await ctx.db.get(${JSON.stringify(grant.tenantId)});if(!user||user.email!==${JSON.stringify(OWNER_EMAIL)})return false;const accounts=await ctx.db.query("authAccounts").withIndex("userIdAndProvider",q=>q.eq("userId",user._id).eq("provider","google")).take(2);const verified=accounts.length===1&&accounts[0].emailVerified===user.email&&typeof user.emailVerificationTime==="number";if(!verified)return false;const tenant=String(user._id);const all=await ctx.db.query("voiceSessions").withIndex("by_tenant",q=>q.eq("tenantId",tenant)).take(101);if(all.length>100)throw Error("BOUND");const sessions=all.filter(s=>s.startedAt>=${grant.issuedAt});const f=await ctx.db.query("foundationInterviews").withIndex("by_tenant",q=>q.eq("tenantId",tenant)).unique();const ids=f?.docIds??[];if(ids.length>6)throw Error("BOUND");const docs=await Promise.all(ids.map(id=>ctx.db.get(id)));return {ownerVerified:true,windowSessionCount:sessions.length,activeSessionCount:sessions.filter(s=>s.status==="active").length,controlledReadyCount:sessions.filter(s=>s.controlled&&s.onboarding&&s.controlReady).length,trustedResponseCount:sessions.reduce((n,s)=>n+(s.trustedResponseIds?.length??0),0),confirmedHangupCount:sessions.filter(s=>s.status!=="active"&&Number.isFinite(s.hangupConfirmedAt)&&s.hangupUnresolved!==true).length,foundationRevision:f?.revision??null,foundationPhase:f?.phase??null,publishedRevision:f?.publishedRevision??null,ownedReadyDocumentCount:docs.filter(d=>d?.tenantId===tenant&&d.status==="ready").length};`]));check(owner&&owner.ownerVerified===true);
 emit({ownerPilotOpen:true,pilotAbsent:false,validUnexpiredGrant:true,issuedAt:grant.issuedAt,expiresAt:expiry,foundationGlobalOff,normalControlledVoiceEnabled,billingOff,...owner});
 }
}catch{emit({statusVerified:false,privateDiagnosticsSuppressed:true});process.exitCode=1;}
