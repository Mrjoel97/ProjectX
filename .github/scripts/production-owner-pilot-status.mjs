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
 const globalFlagsOff=['FOUNDATION_ONBOARDING_ENABLED','VOICE_SERVER_CONTROL_VERIFIED'].every(n=>[null,'0','false'].includes(get(n)));check(globalFlagsOff);
 const raw=getPilot();if(!raw){emit({ownerPilotOpen:false,pilotAbsent:true,validUnexpiredGrant:false,globalFlagsOff,billingOff});}else{
 const grant=JSON.parse(raw);const {foundationPilotExpiresAt}=await import(resolve(root,'packages/core/src/foundationPilot.ts'));const expiry=foundationPilotExpiresAt(raw,grant?.tenantId);check(expiry!==undefined);
 const owner=JSON.parse(cli(['run','--inline-query',`const user=await ctx.db.get(${JSON.stringify(grant.tenantId)});if(!user||user.email!==${JSON.stringify(OWNER_EMAIL)})return false;const accounts=await ctx.db.query("authAccounts").withIndex("userIdAndProvider",q=>q.eq("userId",user._id).eq("provider","google")).take(2);return accounts.length===1&&accounts[0].emailVerified===user.email&&typeof user.emailVerificationTime==="number";`]));check(owner===true);
 emit({ownerPilotOpen:true,pilotAbsent:false,validUnexpiredGrant:true,issuedAt:grant.issuedAt,expiresAt:expiry,globalFlagsOff,billingOff});
 }
}catch{emit({statusVerified:false,privateDiagnosticsSuppressed:true});process.exitCode=1;}
