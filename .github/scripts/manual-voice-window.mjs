import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const SOURCE = '7de2a9aa8f0f85a6417cf973d6f6b430505b897d';
const ORIGIN = 'https://pikar-ai-staging-joelferuzi.vercel.app';
const OLD_ORIGIN = 'https://pikar-ai-convex-gpbrsadzc-joelferuzi-gmailcoms-projects.vercel.app';
const OWNER_HASH = '54719000b1b59678ca73c12918e4d42dd8877ad2bb45634807bc90ae4accffbf';
const root = resolve('current'), backend = resolve(root, 'packages/backend');
const statePath = resolve(process.env.RUNNER_TEMP ?? '.', 'manual-voice-window.private.json');
const check = value => { if (!value) throw Error('GUARD'); };
const capture = (command, args, cwd = backend) => execFileSync(command, args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 2 * 1024 * 1024,
}).trim();
const cli = args => capture(process.execPath, ['node_modules/convex/bin/main.js', ...args]);
const query = source => JSON.parse(cli(['run', '--inline-query', source]));
const save = state => { writeFileSync(statePath + '.next', JSON.stringify(state), { mode: 0o600 }); renameSync(statePath + '.next', statePath); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const emit = values => console.log(JSON.stringify(values));
let phase = 'guard';
const target = () => check(cli(['dashboard', '--no-open']).match(/https:\/\/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/)?.[1] === 'woozy-wren-368');
function source() {
  check(ORIGIN !== 'NEW_STAGING_ORIGIN' && new URL(ORIGIN).origin === ORIGIN && new URL(ORIGIN).hostname.endsWith('.vercel.app'));
  check(capture('git', ['rev-parse', 'HEAD'], root) === SOURCE);
  check(capture('git', ['status', '--porcelain', '--untracked-files=no'], root) === '');
  check(/COMMERCIAL_BILLING_ENABLED:\s*boolean\s*=\s*false/.test(readFileSync(resolve(root, 'packages/billing/src/config.ts'), 'utf8')));
}
async function configuration(expectedOrigin = ORIGIN) {
  const { ENV_MANIFEST, ORIGIN_ENV, missingEnv } = await import(resolve(backend, 'convex/lib/env.ts'));
  const names = new Set(cli(['env', 'list', '--names-only']).split(/\r?\n/));
  check(names.has('OPENAI_API_KEY') && names.has('OPENROUTER_API_KEY'));
  const watched = [...new Set([...ORIGIN_ENV, 'FOUNDATION_ONBOARDING_ENABLED', 'VOICE_SERVER_CONTROL_VERIFIED', 'DEPLOYMENT_BUDGET_CENTS', ...ENV_MANIFEST.filter(x => x.tier === 'fixture' || /_(ENABLED|VERIFIED)$/.test(x.name)).map(x => x.name), ...[...names].filter(x => /ORIGIN|CORS/.test(x))])].sort();
  const values = Object.fromEntries(watched.map(name => [name, names.has(name) ? cli(['env', 'get', name]) : null]));
  check(values.SITE_URL === expectedOrigin && values.FOUNDATION_ONBOARDING_ENABLED === '1');
  check(!missingEnv(name => values[name] ?? undefined).fixturesActive.length);
  const budget = values.DEPLOYMENT_BUDGET_CENTS;
  check(budget === null || (/^\d+$/.test(budget) && Number(budget) >= 184 && Number(budget) <= 5000));
  return values;
}
function inventory() {
  // Only normalized email digests leave this bounded server-side selection; no account secrets.
  return query(`const users=await ctx.db.query("users").take(201);if(users.length>200)throw Error("BOUND");const matches=[];for(const user of users){const email=user.email?.trim().toLowerCase();if(!email)continue;const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(email));if(Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")===${JSON.stringify(OWNER_HASH)})matches.push(user);}if(matches.length!==1)throw Error("OWNER");const user=matches[0];const accounts=await ctx.db.query("authAccounts").withIndex("userIdAndProvider",q=>q.eq("userId",user._id).eq("provider","google")).take(2);if(accounts.length!==1)throw Error("GOOGLE_ACCOUNT");const authSessions=await ctx.db.query("authSessions").withIndex("userId",q=>q.eq("userId",user._id)).take(101);if(authSessions.length>100||!authSessions.some(s=>s.expirationTime>Date.now()))throw Error("NATIVE_SESSION");const accountEmailVerified=accounts[0].emailVerified?.trim().toLowerCase()===user.email.trim().toLowerCase();const userVerificationMetadata=typeof user.emailVerificationTime==="number";const fence=await ctx.db.query("authRevocations").withIndex("by_userId",q=>q.eq("userId",String(user._id))).unique();if(fence?.state)throw Error("ERASURE");const sessions=await ctx.db.query("voiceSessions").take(201);if(sessions.length>200)throw Error("BOUND");const interview=await ctx.db.query("foundationInterviews").withIndex("by_tenant",q=>q.eq("tenantId",String(user._id))).unique();const config=await ctx.db.query("guardrailConfig").first();const skill=await ctx.db.query("skills").withIndex("by_name_status",q=>q.eq("name","foundation-voice").eq("status","active")).unique();if(config?.killSwitch||!skill)throw Error("ADMISSION");return {tenantId:String(user._id),googleAccountPresent:true,activeAuthSessionPresent:true,accountEmailVerified,userVerificationMetadata,sessions:sessions.map(s=>({id:s._id,tenantId:s.tenantId,status:s.status,controlled:s.controlled,onboarding:s.onboarding,hangupConfirmed:typeof s.hangupConfirmedAt==="number",hasCall:!!s.callId})),revision:interview?.revision??null,answerCount:interview?.answers.length??0};`);
}
async function restore() {
  if (!existsSync(statePath)) { emit({ activationAttempted: false }); return; }
  const state = JSON.parse(readFileSync(statePath, 'utf8')); target();
  const names = new Set(cli(['env', 'list', '--names-only']).split(/\r?\n/));
  const current = names.has('VOICE_SERVER_CONTROL_VERIFIED') ? cli(['env', 'get', 'VOICE_SERVER_CONTROL_VERIFIED']) : null;
  // Refuse overwriting an unrelated operator change; only our temporary value or original is allowed.
  check(current === '1' || current === state.configuration.VOICE_SERVER_CONTROL_VERIFIED);
  if (current !== state.configuration.VOICE_SERVER_CONTROL_VERIFIED) {
    const prior = state.configuration.VOICE_SERVER_CONTROL_VERIFIED;
    cli(prior === null ? ['env', 'remove', 'VOICE_SERVER_CONTROL_VERIFIED'] : ['env', 'set', 'VOICE_SERVER_CONTROL_VERIFIED', prior]);
  }
  check(JSON.stringify(await configuration()) === JSON.stringify(state.configuration));
  emit({ originalFlagRestored: true, originalConfigurationUnchanged: true });
}
function retention(){
 const rows=query('const interviews=await ctx.db.query("foundationInterviews").take(201);if(interviews.length>200)throw Error("BOUND");const own=interviews.filter(x=>x.tenantId.startsWith("retention-qualification-"));if(own.length!==1)throw Error("UNIQUENESS");const transcripts=await ctx.db.query("foundationTranscripts").withIndex("by_tenant",q=>q.eq("tenantId",own[0].tenantId)).take(2);if(transcripts.length!==1||transcripts[0].expiresAt<=Date.now())throw Error("RETENTION_CLOCK");return {interview:own[0],transcript:transcripts[0]};');
 check(createHash('sha256').update(JSON.stringify([rows.interview._id,rows.interview.tenantId,rows.interview._creationTime])).digest('hex')==='b389a2014e514c7a35e08480dcef446aeb46b360861e2b8b72f9e67fc61f412e');
 check(new Date(rows.transcript._creationTime).toISOString()==='2026-10-17T10:18:29.493Z'&&new Date(rows.transcript.expiresAt).toISOString()==='2026-10-24T10:18:29.493Z'&&Math.abs(rows.transcript.expiresAt-rows.transcript._creationTime-604800000)<=1);
 
 return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function registry(){const rows=query('const rows=await ctx.db.query("skills").take(1001);if(rows.length>1000)throw Error("BOUND");return rows;');return createHash('sha256').update(JSON.stringify(rows)).digest('hex');}

async function configure() {
  phase='configure-preflight'; source(); target();
  const before=await configuration(OLD_ORIGIN);
  check([null,'0','false'].includes(before.VOICE_SERVER_CONTROL_VERIFIED));
  check(query('const rows=await ctx.db.query("voiceSessions").take(201);return rows.length<=200&&rows.every(s=>s.status!=="active"&&(!s.callId||(Number.isFinite(s.hangupConfirmedAt)&&s.hangupUnresolved!==true)));'));
  const preserved={configuration:before,retention:retention(),registry:registry()};
  const file=statePath+'.origin';check(!existsSync(file));
  writeFileSync(file,JSON.stringify(preserved),{mode:0o600});
  let attempted=false;
  try {
    phase='configure-origin';attempted=true;cli(['env','set','SITE_URL',ORIGIN]);
    check(JSON.stringify(await configuration())===JSON.stringify({...before,SITE_URL:ORIGIN}));
    check(retention()===preserved.retention&&registry()===preserved.registry);
    emit({stagingOriginConfigured:true,voiceAdmissionStillDisabled:true,foundationFlagUnchanged:true,registryUnchanged:true,retentionUnchanged:true,otherConfigurationUnchanged:true});
  } catch {
    if(attempted){
      phase='compensate-origin';const current=cli(['env','get','SITE_URL']);check(current===ORIGIN||current===OLD_ORIGIN);
      if(current!==OLD_ORIGIN)cli(['env','set','SITE_URL',OLD_ORIGIN]);
      check(JSON.stringify(await configuration(OLD_ORIGIN))===JSON.stringify(before));
      emit({originalOriginRestored:true});
    }
    throw Error('CONFIGURATION_FAILED');
  }
}

async function preflight() {
  phase = 'preflight-source'; source(); phase = 'preflight-target'; target();
  phase = 'preflight-configuration'; const config = await configuration();
  check([null, '0', 'false'].includes(config.VOICE_SERVER_CONTROL_VERIFIED));
  phase = 'preflight-owner'; const before = inventory();
  check(before.sessions.every(s => s.status !== 'active' && (!s.hasCall || s.hangupConfirmed)));
  phase = 'preflight-budget';
  const remaining = JSON.parse(cli(['run', 'guardrails:remainingDailyCents', JSON.stringify({ tenantId: before.tenantId })]));
  check(Number.isFinite(remaining) && remaining >= 184 && remaining <= 500);
  emit({ preflightPassed: true, googleAccountPresent: before.googleAccountPresent, activeAuthSessionPresent: before.activeAuthSessionPresent, accountEmailVerified: before.accountEmailVerified, userVerificationMetadata: before.userVerificationMetadata, remainingBudgetSufficient: true, activationAttempted: false });
  return { configuration: config, before };
}
function observe(state) {
  return query(`const tenant=${JSON.stringify(state.before.tenantId)},id=${JSON.stringify(state.sessionId)};const s=await ctx.db.get(id);if(!s||s.tenantId!==tenant||!s.controlled||!s.onboarding)throw Error("SESSION");const rows=await ctx.db.query("spendEvents").withIndex("by_tenant_createdAt",q=>q.eq("tenantId",tenant).gte("createdAt",${state.openedAt})).take(201);if(rows.length>200)throw Error("BOUND");const realtime=rows.filter(r=>r.kind==="paid_call"&&r.model==="gpt-realtime-2.1");const held=realtime.filter(r=>r.phase==="reserved");const initial=held.find(r=>r._id===s.spendReservationId);const responses=held.filter(r=>r._id!==s.spendReservationId);const initialHoldRetained=!!initial&&initial.amountCents===100&&realtime.every(r=>r.correlationId!==initial.correlationId||r.phase==="reserved");const settled=responses.filter(r=>realtime.some(x=>x.correlationId===r.correlationId&&(x.phase==="actual"||(x.phase==="refunded"&&x.evalActualUsd===0))));const actual=realtime.filter(r=>r.phase==="actual");const interview=await ctx.db.query("foundationInterviews").withIndex("by_tenant",q=>q.eq("tenantId",tenant)).unique();const events=(s.controlEvents??[]).map(raw=>{try{return JSON.parse(raw).type;}catch{return null;}});return {observedAt:Date.now(),sessionStartedAt:s.startedAt,sessionEndsAt:s.endsAt,hangupConfirmedAt:s.hangupConfirmedAt??null,deadlineElapsedAtObservation:Date.now()>=s.endsAt,terminationAtOrAfterDeadline:typeof s.hangupConfirmedAt==="number"&&s.hangupConfirmedAt>=s.endsAt,inputSpeechEvents:events.filter(t=>t==="input_audio_buffer.speech_started").length,outputAudioEvents:events.filter(t=>t==="output_audio_buffer.started").length,controlReady:s.controlReady===true,terminated:s.status!=="active"&&Number.isFinite(s.hangupConfirmedAt)&&s.hangupUnresolved!==true,fiveMinuteCap:s.endsAt-s.startedAt===300000,trustedResponseCount:s.trustedResponseIds?.length??0,responseReservations:responses.length,settledResponses:settled.length,unresolvedResponses:responses.length-settled.length,responseCeilingsValid:responses.every(r=>r.amountCents===84),actualWithinReservations:actual.every(a=>responses.some(r=>r.correlationId===a.correlationId&&a.amountCents>=0&&a.amountCents<=r.amountCents)),actualCents:actual.reduce((n,r)=>n+r.amountCents,0),initialHoldRetained,revisionAdvanced:(interview?.revision??-1)>${state.before.revision ?? -1},answerCountIncreased:(interview?.answers.length??0)>${state.before.answerCount}};`);
}
async function window() {
  check(process.env.MANUAL_OWNER_READY === '1');
  check(!existsSync(statePath));
  const state = { ...await preflight(), openedAt: Date.now(), activationAttempted: true, sessionId: null };
  check(state.before.accountEmailVerified || state.before.userVerificationMetadata);
  save(state); // Durable restoration information precedes the only admission write.
  try {
    phase = 'open-window'; cli(['env', 'set', 'VOICE_SERVER_CONTROL_VERIFIED', '1']);
    emit({ manualWindowOpen: true, admissionWindowSeconds: 120, humanAcceptance: false });
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const current = inventory(); check(current.tenantId === state.before.tenantId);
      const added = current.sessions.filter(s => !state.before.sessions.some(old => old.id === s.id));
      if (added.length) {
        // Close global admission even if selection is invalid or more than one call raced.
        await restore();
        check(added.length === 1 && added[0].tenantId === state.before.tenantId && added[0].controlled && added[0].onboarding);
        state.sessionId = added[0].id; save(state); break;
      }
      await sleep(1000);
    }
    await restore(); check(state.sessionId);
    emit({ exactNewNativeOnboardingSessionSelected: true, admissionClosed: true });
    phase = 'observe-session'; const until = Date.now() + 390000;
    let proof;
    while (Date.now() < until) {
      const current = inventory();
      check(current.sessions.filter(s => !state.before.sessions.some(old => old.id === s.id)).every(s => s.id === state.sessionId));
      proof = observe(state); if (proof.terminated) break; await sleep(5000);
    }
    emit({ ...proof, serverCorroborationOnly: true, tenantWindowLedger: true, humanAcceptance: false, invoiceReconciliation: false });
    check(proof?.terminated && proof.controlReady && proof.fiveMinuteCap && proof.initialHoldRetained && proof.responseCeilingsValid && proof.actualWithinReservations && proof.revisionAdvanced && proof.answerCountIncreased && proof.trustedResponseCount > 0 && proof.trustedResponseCount <= 20 && proof.settledResponses === proof.trustedResponseCount && proof.unresolvedResponses === 0);
  } finally { await restore(); }
}
try {
  if (process.argv[2] === 'preflight') await preflight();
  else if (process.argv[2] === 'configure') await configure();
  else if (process.argv[2] === 'window') await window();
  else if (process.argv[2] === 'restore') await restore();
  else throw Error('MODE');
} catch { emit({ success: false, phase, privateDiagnosticsSuppressed: true }); process.exitCode = 1; }
