import { execFileSync } from "node:child_process";
import { constants, createPublicKey, publicEncrypt, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET = "https://woozy-wren-368.convex.cloud";
const DASHBOARD = "https://dashboard.convex.dev/d/woozy-wren-368";
const PREFIX = "+pikar-native-signup-";
const backend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = (ok) => {
  if (!ok) throw new Error("NATIVE_SIGNUP_PROBE_REFUSED");
};

// Public output is a fixed projection, never CLI bodies, account identifiers or exceptions.
export async function probeSignup({ cli, client, publicKey, random = randomBytes }) {
  const evidence = {
    phase: "target",
    targetVerified: false,
    configurationPresent: false,
    sourceFixtureUnique: false,
    freshAccount: false,
    freshInvite: false,
    preflightValid: false,
    signupReturned: false,
    unverifiedSessionRefused: false,
    stateInspected: false,
    userExists: false,
    emailVerified: false,
    passwordAccountExists: false,
    inviteExists: false,
    inviteRedeemed: false,
    nativeAuthenticated: false,
    accountRetained: false,
  };
  let email;
  let transportKey;
  let sealedCredentials;
  let owned = false;
  const query = (source) => JSON.parse(cli(["run", "--inline-query", source]));
  const inspect = () =>
    query(`
    const email=${JSON.stringify(email)};
    const users=await ctx.db.query("users").withIndex("email",q=>q.eq("email",email)).take(2);
    const invites=await ctx.db.query("betaInvites").withIndex("by_email",q=>q.eq("email",email)).take(2);
    const accounts=await ctx.db.query("authAccounts").withIndex("providerAndAccountId",q=>q.eq("provider","password").eq("providerAccountId",email)).take(2);
    if(users.length>1||invites.length>1||accounts.length>1)throw Error("AMBIGUOUS_FIXTURE");
    return {userExists:users.length===1,emailVerified:!!users[0]?.emailVerificationTime,
      passwordAccountExists:accounts.length===1,inviteExists:invites.length===1,inviteRedeemed:!!invites[0]?.redeemedAt};
  `);
  try {
    if (publicKey !== undefined) {
      evidence.phase = "transport_key";
      transportKey = createPublicKey(publicKey);
      check(
        transportKey.asymmetricKeyType === "rsa" &&
          transportKey.asymmetricKeyDetails?.modulusLength === 4096,
      );
    }
    evidence.phase = "target";
    check(cli(["dashboard", "--no-open"]).trim() === DASHBOARD);
    evidence.targetVerified = true;
    evidence.phase = "configuration";
    const names = new Set(cli(["env", "list", "--names-only"]).trim().split(/\r?\n/));
    check(
      ["AUTH_RESEND_KEY", "AUTH_EMAIL_FROM", "JWT_PRIVATE_KEY", "JWKS", "SITE_URL"].every((n) =>
        names.has(n),
      ),
    );
    evidence.configurationPresent = true;
    evidence.phase = "fresh_fixture";
    const original = query(`
      const rows=await ctx.db.query("betaInvites").order("desc").take(100);
      if(rows.some(row=>row.email.includes(${JSON.stringify(PREFIX)})))throw Error("PROBE_ALREADY_EXISTS");
      const candidates=rows.filter(row=>row.email.includes("+pikar-foundation-"));
      if(candidates.length!==1)throw Error("AMBIGUOUS_SOURCE");
      return candidates[0].email;
    `);
    check(
      typeof original === "string" &&
        /^[^@\s]+\+pikar-foundation-[^@\s]+@gmail\.com$/.test(original),
    );
    evidence.sourceFixtureUnique = true;
    email = `${original.split("+")[0]}${PREFIX}${random(12).toString("hex")}@gmail.com`;
    const before = inspect();
    check(
      !before.userExists &&
        !before.passwordAccountExists &&
        !before.inviteExists &&
        !before.inviteRedeemed,
    );
    evidence.freshAccount = true;
    evidence.phase = "invite";
    const invite = JSON.parse(cli(["run", "invites:__seedInvite", JSON.stringify({ email })]));
    check(invite.reused === false && invite.email === email && typeof invite.code === "string");
    owned = true;
    evidence.freshInvite = true;
    const password = random(32).toString("base64url");
    if (transportKey) {
      evidence.phase = "seal_credentials";
      sealedCredentials = publicEncrypt(
        {
          key: transportKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        Buffer.from(JSON.stringify({ email, password, inviteCode: invite.code }), "utf8"),
      ).toString("base64");
    }
    evidence.phase = "preflight";
    const preflight = await client.query("invites:preflight", { code: invite.code });
    check(preflight.valid === true);
    evidence.preflightValid = true;
    evidence.phase = "signup";
    const result = await client.action("auth:signIn", {
      provider: "password",
      params: {
        flow: "signUp",
        email,
        inviteCode: invite.code,
        password,
      },
    });
    evidence.signupReturned = true;
    check(!result?.tokens);
    evidence.unverifiedSessionRefused = true;
    evidence.phase = "post_signup";
  } catch {
    // Preserve the fixed phase only. Public auth errors intentionally hide underlying details.
  }
  if (owned) {
    try {
      const state = inspect();
      check(
        Object.keys(state).length === 5 &&
          Object.values(state).every((v) => typeof v === "boolean"),
      );
      Object.assign(evidence, state);
      evidence.stateInspected = true;
      evidence.accountRetained = state.userExists;
    } catch {
      evidence.stateInspected = false;
    }
  }
  evidence.success =
    evidence.signupReturned &&
    evidence.unverifiedSessionRefused &&
    evidence.stateInspected &&
    evidence.userExists &&
    evidence.passwordAccountExists &&
    evidence.inviteRedeemed &&
    !evidence.emailVerified;
  return sealedCredentials ? { ...evidence, sealedCredentials } : evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  const { ConvexHttpClient } = require("convex/browser");
  const { makeFunctionReference } = require("convex/server");
  const client = new ConvexHttpClient(TARGET, {
    logger: false,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }),
  });
  const cli = (args) =>
    execFileSync(process.execPath, [resolve(backend, "node_modules/convex/bin/main.js"), ...args], {
      cwd: backend,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
  const result = await probeSignup({
    cli,
    publicKey: process.env.NATIVE_SIGNUP_TRANSPORT_PUBLIC_KEY,
    client: {
      query: (name, args) => client.query(makeFunctionReference(name), args),
      action: (name, args) => client.action(makeFunctionReference(name), args),
    },
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.success) process.exitCode = 1;
}
