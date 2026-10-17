import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const expectedSha = 'aa4b5fb82a88907f42d1a71721a1e72db073e116';
const root = resolve('release');
const backend = resolve(root, 'packages/backend');
const capture = (file, args, cwd = backend) => execFileSync(file, args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 1048576,
}).trim();
const check = value => { if (!value) throw Error(); };
const cli = args => capture(process.execPath, ['node_modules/convex/bin/main.js', ...args]);
try {
  check(/^[a-f0-9]{40}$/.test(expectedSha));
  check(capture('git', ['rev-parse', 'HEAD'], root) === expectedSha);
  check(cli(['dashboard', '--no-open']).match(/https:\/\/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/)?.[1] === 'opulent-octopus-494');
  const { ENV_MANIFEST, missingEnv } = await import(pathToFileURL(resolve(backend, 'convex/lib/env.ts')).href);
  const { COMMERCIAL_BILLING_ENABLED } = await import(pathToFileURL(resolve(root, 'packages/billing/src/config.ts')).href);
  check(COMMERCIAL_BILLING_ENABLED === false);
  const names = new Set(cli(['env', 'list', '--names-only']).split(/\r?\n/).map(x => x.trim()).filter(Boolean));
  const allowed = new Set(['SITE_URL', 'FOUNDATION_ONBOARDING_ENABLED', 'VOICE_SERVER_CONTROL_VERIFIED', ...ENV_MANIFEST.filter(x => x.tier === 'fixture' && !['CONVEX_CLOUD_URL', 'NEXT_PUBLIC_CONVEX_URL'].includes(x.name)).map(x => x.name)]);
  const values = new Map();
  for (const name of allowed) values.set(name, names.has(name) ? cli(['env', 'get', name]) : null);
  const origin = new URL(values.get('SITE_URL'));
  check(origin.origin === 'https://www.pikar-ai.com' && !origin.username && !origin.password);
  const disabled = name => [null, '0', 'false'].includes(values.get(name));
  const evidence = {
    exactProductionTargetVerified: true,
    immutableSourceVerified: true,
    productionOriginVerified: true,
    foundationAdmissionDisabled: disabled('FOUNDATION_ONBOARDING_ENABLED'),
    controlledVoiceDisabled: disabled('VOICE_SERVER_CONTROL_VERIFIED'),
    fixtureSwitchesInactive: missingEnv(name => values.get(name) ?? undefined).fixturesActive.length === 0,
    commercialBillingDisabled: COMMERCIAL_BILLING_ENABLED === false,
    authSenderKeyNamePresent: names.has('AUTH_RESEND_KEY'),
    authSenderAddressNamePresent: names.has('AUTH_EMAIL_FROM'),
    secretValuesRead: false,
    databaseQueriesRequested: false,
    providerCallsRequested: false,
    configurationWritesRequested: false,
  };
  console.log(JSON.stringify(evidence));
  check(evidence.foundationAdmissionDisabled && evidence.controlledVoiceDisabled && evidence.fixtureSwitchesInactive && evidence.authSenderKeyNamePresent && evidence.authSenderAddressNamePresent);
} catch {
  console.error(JSON.stringify({ productionPostflightPassed: false, privateDiagnosticsSuppressed: true }));
  process.exitCode = 1;
}
