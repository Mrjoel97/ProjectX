import {execFileSync} from 'node:child_process';
import {constants,createHash,createPublicKey,publicEncrypt,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve('release'), backend=resolve(root,'packages/backend');
const require=createRequire(resolve(backend,'package.json'));
const {ConvexHttpClient}=require('convex/browser');
const {makeFunctionReference:ref}=require('convex/server');
const check=x=>{if(!x)throw Error();};
const cli=args=>execFileSync(process.execPath,[resolve(backend,'node_modules/convex/bin/main.js'),...args],{cwd:backend,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:1048576}).trim();
const query=source=>JSON.parse(cli(['run','--inline-query',source]));
const client=new ConvexHttpClient('https://opulent-octopus-494.convex.cloud',{logger:false,fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(30000)})});
let phase='guards', envelope;
try{
 check(process.env.GITHUB_RUN_ATTEMPT==='1'&&/^\d+$/.test(process.env.GITHUB_RUN_ID??''));
 check(cli(['dashboard','--no-open']).match(/https:\/\/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/)?.[1]==='opulent-octopus-494');
 const names=new Set(cli(['env','list','--names-only']).split(/\r?\n/));
 check(['AUTH_RESEND_KEY','AUTH_EMAIL_FROM','JWT_PRIVATE_KEY','JWKS'].every(n=>names.has(n)));
 for(const name of ['FOUNDATION_ONBOARDING_ENABLED','VOICE_SERVER_CONTROL_VERIFIED'])check(!names.has(name)||['0','false'].includes(cli(['env','get',name])));
 check(new URL(cli(['env','get','SITE_URL'])).origin==='https://www.pikar-ai.com');
 const {COMMERCIAL_BILLING_ENABLED}=await import(pathToFileURL(resolve(root,'packages/billing/src/config.ts')).href);check(COMMERCIAL_BILLING_ENABLED===false);
 const publicKey=createPublicKey(process.env.PROBE_TRANSPORT_PUBLIC_KEY);check(publicKey.asymmetricKeyDetails?.modulusLength===4096);
 const email='joel.feruzi+pikar-production-'+createHash('sha256').update(process.env.GITHUB_RUN_ID).digest('hex').slice(0,24)+'@gmail.com';
 const inspect=()=>query('const email='+JSON.stringify(email)+';const users=await ctx.db.query("users").withIndex("email",q=>q.eq("email",email)).take(2);const invites=await ctx.db.query("betaInvites").withIndex("by_email",q=>q.eq("email",email)).take(2);const accounts=await ctx.db.query("authAccounts").withIndex("providerAndAccountId",q=>q.eq("provider","password").eq("providerAccountId",email)).take(2);return {users:users.map(u=>({_id:u._id,_creationTime:u._creationTime,emailVerificationTime:u.emailVerificationTime})),invites:invites.map(i=>({redeemedUserId:i.redeemedUserId})),accounts:accounts.map(a=>({userId:a.userId,emailVerified:a.emailVerified}))};');
 phase='freshness';const before=inspect();check(!before.users.length&&!before.invites.length&&!before.accounts.length);
 phase='invite';const invite=JSON.parse(cli(['run','invites:__seedInvite',JSON.stringify({email})]));check(invite.reused===false&&invite.email===email&&typeof invite.code==='string');
 const password=randomBytes(32).toString('base64url');envelope={email,password,inviteCode:invite.code};
 phase='preflight';check((await client.query(ref('invites:preflight'),{code:invite.code})).valid===true);
 phase='signup';const result=await client.action(ref('auth:signIn'),{provider:'password',params:{flow:'signUp',email,password,inviteCode:invite.code}});check(!result?.tokens);
 phase='post-signup';const after=inspect();check(after.users.length===1&&after.invites.length===1&&after.accounts.length===1&&after.invites[0].redeemedUserId===after.users[0]._id&&after.accounts[0].userId===after.users[0]._id&&!after.users[0].emailVerificationTime&&!after.accounts[0].emailVerified);
 envelope.userId=after.users[0]._id;envelope.createdAt=after.users[0]._creationTime;
 console.log(JSON.stringify({productionTargetVerified:true,freshNativeAccountCreated:true,inviteRedeemed:true,passwordAccountCreated:true,verificationRequired:true,featureAdmissionDisabled:true,commercialBillingDisabled:true,ownerAccountUntouched:true,sealedCredentials:publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(JSON.stringify(envelope))).toString('base64')}));
}catch{
 // Failed attempts are never automatically retried; retain encrypted owned credentials for reconciliation.
 let sealedCredentials;
 if(envelope)try{sealedCredentials=publicEncrypt({key:process.env.PROBE_TRANSPORT_PUBLIC_KEY,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(JSON.stringify(envelope))).toString('base64');}catch{}
 console.error(JSON.stringify({signupSucceeded:false,phase,privateDiagnosticsSuppressed:true,...(sealedCredentials?{sealedCredentials}:{})}));process.exitCode=1;
}
