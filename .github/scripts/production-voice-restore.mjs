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
async function preservedConfiguration(){
 const {ENV_MANIFEST,ORIGIN_ENV}=await import(resolve(backend,'convex/lib/env.ts'));
 const names=new Set(cli(['env','list','--names-only']).split(/\r?\n/));
 const watched=[...new Set([...ORIGIN_ENV,'DEPLOYMENT_BUDGET_CENTS',...ENV_MANIFEST.filter(x=>x.tier==='fixture'||/_(ENABLED|VERIFIED)$/.test(x.name)).map(x=>x.name),...[...names].filter(x=>/ORIGIN|CORS/.test(x))])].sort();
 return Object.fromEntries(watched.map(name=>[name,names.has(name)?cli(['env','get',name]):null]));
}

let phase='source';
try{
 check(capture('git',['rev-parse','HEAD'],root)===SOURCE);check(capture('git',['status','--porcelain','--untracked-files=no'],root)==='');target();
 check(/COMMERCIAL_BILLING_ENABLED:\s*boolean\s*=\s*false/.test(readFileSync(resolve(root,'packages/billing/src/config.ts'),'utf8')));
 phase='configuration';const {ENV_MANIFEST,missingEnv}=await import(resolve(backend,'convex/lib/env.ts'));const names=new Set(cli(['env','list','--names-only']).split(/\r?\n/));const get=n=>names.has(n)?cli(['env','get',n]):null;
 check(['https://www.pikar-ai.com','https://pikar-ai.com'].includes(get('SITE_URL')));check([null,'0','false'].includes(get('VOICE_SERVER_CONTROL_VERIFIED')));check([null,'0','false'].includes(get('FOUNDATION_ONBOARDING_ENABLED')));check(names.has('OPENAI_API_KEY')&&names.has('OPENROUTER_API_KEY'));
 const fixtures=new Map(ENV_MANIFEST.filter(x=>x.tier==='fixture').map(x=>[x.name,get(x.name)]));check(!missingEnv(n=>fixtures.get(n)??undefined).fixturesActive.length);const budget=get('DEPLOYMENT_BUDGET_CENTS');check(budget===null||(/^\d+$/.test(budget)&&Number(budget)>=184&&Number(budget)<=5000));
 const config=await preservedConfiguration();phase='voice-registry-and-rails';const ready=JSON.parse(cli(['run','--inline-query',`const skills=[];for(const name of ["voice-session","document-analyst"]){skills.push((await ctx.db.query("skills").withIndex("by_name_status",q=>q.eq("name",name).eq("status","active")).take(2)).length===1);}const config=await ctx.db.query("guardrailConfig").first();return {skillsReady:skills.every(Boolean),killSwitchOff:!config?.killSwitch};`]));check(ready.skillsReady&&ready.killSwitchOff);
 phase='match-known-owner-grant';const raw=getPilot();if(raw!==null&&raw!==''){const grant=JSON.parse(raw);check(Object.keys(grant).sort().join(',')==='expiresAt,issuedAt,tenantId'&&grant.issuedAt===1792258028857&&grant.expiresAt===1792258928857&&typeof grant.tenantId==='string');const owner=JSON.parse(cli(['run','--inline-query',`const u=await ctx.db.get(${JSON.stringify(grant.tenantId)});if(!u||u.email!==${JSON.stringify(OWNER_EMAIL)})return false;const a=await ctx.db.query("authAccounts").withIndex("userIdAndProvider",q=>q.eq("userId",u._id).eq("provider","google")).take(2);return a.length===1&&a[0].emailVerified===u.email&&typeof u.emailVerificationTime==="number";`]));check(owner===true);check(getPilot()===raw);cli(['env','remove','NATIVE_ONBOARDING_PILOT']);}
 phase='restore-controlled-voice';cli(['env','set','VOICE_SERVER_CONTROL_VERIFIED','1']);check(cli(['env','get','VOICE_SERVER_CONTROL_VERIFIED'])==='1');check([null,''].includes(getPilot()));const after=await preservedConfiguration();delete config.VOICE_SERVER_CONTROL_VERIFIED;delete after.VOICE_SERVER_CONTROL_VERIFIED;check(JSON.stringify(config)===JSON.stringify(after));
 emit({controlledVoiceRestored:true,knownOwnerPilotRemoved:true,foundationUnchangedOff:true,billingOff:true,fixturesOff:true,budgetConfigurationUnchanged:true,otherConfigurationUnchanged:true,providerCallsCreated:0,businessWrites:0});
}catch{emit({restorationVerified:false,phase,privateDiagnosticsSuppressed:true});process.exitCode=1;}
