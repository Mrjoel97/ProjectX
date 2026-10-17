import assert from "node:assert/strict";
import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import test from "node:test";
import { probeSignup } from "./nativeSignupProbe.mjs";

const absent = {
  userExists: false,
  emailVerified: false,
  passwordAccountExists: false,
  inviteExists: false,
  inviteRedeemed: false,
};
const admitted = {
  ...absent,
  userExists: true,
  passwordAccountExists: true,
  inviteExists: true,
  inviteRedeemed: true,
};
function fixture({
  wrongTarget = false,
  signupError = false,
  post = admitted,
  collision = false,
} = {}) {
  let inspections = 0,
    actions = 0,
    seeds = 0;
  const cli = (args) => {
    if (args[0] === "dashboard")
      return wrongTarget
        ? "https://dashboard.convex.dev/d/production"
        : "https://dashboard.convex.dev/d/woozy-wren-368";
    if (args[0] === "env")
      return "AUTH_RESEND_KEY\nAUTH_EMAIL_FROM\nJWT_PRIVATE_KEY\nJWKS\nSITE_URL";
    if (args[1] === "invites:__seedInvite") {
      seeds++;
      return JSON.stringify({ ...JSON.parse(args[2]), code: "PRIVATE_TEST_INVITE", reused: false });
    }
    const source = args[2];
    assert.ok(!source.includes("authVerificationCodes"));
    if (source.includes("PROBE_ALREADY_EXISTS")) {
      assert.ok(source.includes("take(100)"));
      if (collision) throw Error("PRIVATE_OLD_FIXTURE");
      return JSON.stringify("example+pikar-foundation-test@gmail.com");
    }
    inspections++;
    return JSON.stringify(inspections === 1 ? absent : post);
  };
  const client = {
    query: async (name, args) => {
      assert.equal(name, "invites:preflight");
      assert.equal(args.code, "PRIVATE_TEST_INVITE");
      return { valid: true };
    },
    action: async (name, args) => {
      actions++;
      assert.equal(name, "auth:signIn");
      assert.equal(args.provider, "password");
      assert.equal(args.params.flow, "signUp");
      assert.match(args.params.email, /^example\+pikar-native-signup-[a-f0-9]+@gmail.com$/);
      assert.ok(args.params.password.length >= 32);
      if (signupError) throw Error("PRIVATE_PROVIDER_BODY_TOKEN_EMAIL");
      return { started: true };
    },
  };
  return { cli, client, counts: () => ({ inspections, actions, seeds }) };
}
test("native signup uses fresh private parameters and emits only fixed evidence", async () => {
  const f = fixture();
  const e = await probeSignup(f);
  assert.equal(e.success, true);
  assert.equal(e.nativeAuthenticated, false);
  assert.equal(e.accountRetained, true);
  assert.deepEqual(f.counts(), { inspections: 2, actions: 1, seeds: 1 });
  assert.ok(!JSON.stringify(e).includes("PRIVATE"));
  assert.ok(!JSON.stringify(e).includes("example"));
  assert.ok(
    Object.entries(e).every(([key, value]) =>
      key === "phase" ? typeof value === "string" : typeof value === "boolean",
    ),
  );
});
test("wrong deployment stops before fixture reads or writes", async () => {
  const f = fixture({ wrongTarget: true });
  const e = await probeSignup(f);
  assert.equal(e.phase, "target");
  assert.equal(e.success, false);
  assert.equal(f.counts().seeds, 0);
  assert.equal(f.counts().actions, 0);
});
test("existing probe family refuses repeat mutation", async () => {
  const f = fixture({ collision: true });
  const e = await probeSignup(f);
  assert.equal(e.phase, "fresh_fixture");
  assert.equal(e.success, false);
  assert.equal(f.counts().seeds, 0);
});
test("pre-account signup refusal is distinguished from admitted verification failure", async () => {
  for (const post of [absent, admitted]) {
    const f = fixture({ signupError: true, post });
    const e = await probeSignup(f);
    assert.equal(e.phase, "signup");
    assert.equal(e.success, false);
    assert.equal(e.stateInspected, true);
    assert.equal(e.userExists, post.userExists);
    assert.equal(e.inviteRedeemed, post.inviteRedeemed);
    assert.ok(!JSON.stringify(e).includes("PRIVATE"));
  }
});

const transport = generateKeyPairSync("rsa", { modulusLength: 4096 });
const publicKey = transport.publicKey.export({ type: "spki", format: "pem" });
function unseal(value) {
  return JSON.parse(
    privateDecrypt(
      { key: transport.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      Buffer.from(value, "base64"),
    ).toString("utf8"),
  );
}
test("encrypted handoff preserves exact signup inputs without plaintext output", async () => {
  const f = fixture();
  let supplied;
  const action = f.client.action;
  f.client.action = async (name, args) => {
    supplied = args.params;
    return action(name, args);
  };
  const result = await probeSignup({ ...f, publicKey });
  assert.equal(result.success, true);
  assert.deepEqual(unseal(result.sealedCredentials), {
    email: supplied.email,
    password: supplied.password,
    inviteCode: supplied.inviteCode,
  });
  for (const secret of [supplied.email, supplied.password, supplied.inviteCode])
    assert.ok(!JSON.stringify(result).includes(secret));
});
test("encrypted handoff exists even when signup network fails", async () => {
  const f = fixture({ signupError: true, post: absent });
  const result = await probeSignup({ ...f, publicKey });
  assert.equal(result.phase, "signup");
  assert.equal(result.success, false);
  assert.equal(unseal(result.sealedCredentials).inviteCode, "PRIVATE_TEST_INVITE");
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
});
test("invalid or undersized transport key refuses before any fixture mutation", async () => {
  const weak = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({
    type: "spki",
    format: "pem",
  });
  for (const publicKey of ["invalid", weak]) {
    const f = fixture();
    const result = await probeSignup({ ...f, publicKey });
    assert.equal(result.phase, "transport_key");
    assert.equal(result.success, false);
    assert.deepEqual(f.counts(), { inspections: 0, actions: 0, seeds: 0 });
  }
});
