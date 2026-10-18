import { generateKeyPairSync } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import { admitIdentity } from "./invites";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
  type: "pkcs8",
  format: "pem",
});
let sent: { to: string; text: string }[];

beforeEach(() => {
  vi.stubEnv("AUTH_RESEND_KEY", "test-only-key");
  vi.stubEnv("AUTH_EMAIL_FROM", "Pikar <auth@example.com>");
  vi.stubEnv("SITE_URL", "https://app.example.com");
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
  vi.stubEnv("JWT_PRIVATE_KEY", String(privateKey));
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return new Response("{}", { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateModules);
  return t;
}
async function signup(t: ReturnType<typeof harness>) {
  const invite = await t.mutation(internal.invites.__seedInvite, { email: "owner@example.com" });
  return t.action(api.auth.signIn, {
    provider: "password",
    params: {
      flow: "signUp",
      email: "owner@example.com",
      password: "original-password",
      inviteCode: invite.code,
    },
  });
}
function lastCode() {
  const code = sent.at(-1)?.text.split("\n\n")[1];
  if (!code) throw new Error("test message missing code");
  return code;
}

test("signup creates no session until matching email OTP; replay fails", async () => {
  const t = harness();
  await signup(t);
  expect(sent).toHaveLength(1);
  expect(
    await t.run(
      async (ctx) => (await ctx.db.query("users").unique())?.emailVerificationTime === undefined,
    ),
  ).toBe(true);
  expect(await t.run((ctx) => ctx.db.query("authSessions").collect())).toHaveLength(0);
  const code = lastCode();
  await expect(
    t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "email-verification",
        email: "other@example.com",
        code,
      },
    }),
  ).rejects.toThrow("AUTHENTICATION_FAILED");
  const result = await t.action(api.auth.signIn, {
    provider: "password",
    params: {
      flow: "email-verification",
      email: "owner@example.com",
      code,
    },
  });
  expect(result.tokens).toBeTruthy();
  expect(
    await t.run(async (ctx) => (await ctx.db.query("users").unique())?.emailVerificationTime),
  ).toEqual(expect.any(Number));
  await expect(
    t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "email-verification",
        email: "owner@example.com",
        code,
      },
    }),
  ).rejects.toThrow("AUTHENTICATION_FAILED");
});

test("failed delivery leaves a spent invite but direct verification resumes the same account", async () => {
  const t = harness();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(fetch).mockResolvedValueOnce(new Response("private provider body", { status: 403 }));
  try {
    await expect(signup(t)).rejects.toThrow("AUTHENTICATION_FAILED");
    const invite = await t.run((ctx) => ctx.db.query("betaInvites").unique());
    if (!invite) throw new Error("Expected the retained invitation");
    expect(invite?.redeemedAt).toEqual(expect.any(Number));
    expect((await t.query(api.invites.preflight, { code: invite.code })).valid).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("authSessions").collect())).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith("AUTH_EMAIL_DELIVERY_FAILED", {
      purpose: "verify",
      reason: "provider_rejected",
      status: 403,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/owner@example|private provider body/);
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { flow: "email-verification", email: "owner@example.com" },
    });
    expect(sent.at(-1)?.to).toBe("owner@example.com");
    const result = await t.action(api.auth.signIn, {
      provider: "password",
      params: { flow: "email-verification", email: "owner@example.com", code: lastCode() },
    });
    expect(result.tokens).toBeTruthy();
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.query("users").unique()))?.emailVerificationTime).toEqual(
      expect.any(Number),
    );
  } finally {
    warn.mockRestore();
  }
});

test("reset hides unknown accounts, rotates the password, and invalidates prior sessions", async () => {
  const t = harness();
  await signup(t);
  await t.action(api.auth.signIn, {
    provider: "password",
    params: {
      flow: "email-verification",
      email: "owner@example.com",
      code: lastCode(),
    },
  });
  const oldSessions = await t.run((ctx) => ctx.db.query("authSessions").collect());
  const missing = await t.action(api.auth.signIn, {
    provider: "password",
    params: { flow: "reset", email: "missing@example.com" },
  });
  const existing = await t.action(api.auth.signIn, {
    provider: "password",
    params: { flow: "reset", email: "owner@example.com" },
  });
  expect(missing).toEqual(existing);
  const resetCode = lastCode();
  await t.action(api.auth.signIn, {
    provider: "password",
    params: {
      flow: "reset-verification",
      email: "owner@example.com",
      code: resetCode,
      newPassword: "replacement-password",
    },
  });
  const current = await t.run((ctx) => ctx.db.query("authSessions").collect());
  expect(current.some((session) => oldSessions.some((old) => old._id === session._id))).toBe(false);
  for (const old of oldSessions) {
    const stale = t.withIdentity({ subject: `${old.userId}|${old._id}` });
    await expect(stale.query(api.demo.listItems, {})).rejects.toThrow("UNAUTHENTICATED");
    await expect(stale.mutation(api.demo.addItem, { label: "stale JWT" })).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    await expect(stale.action(api.cockpit.sendCockpitMessage, { text: "blocked" })).rejects.toThrow(
      "UNAUTHENTICATED",
    );
  }
  const live = current[0];
  expect(live).toBeTruthy();
  await expect(
    t.withIdentity({ subject: `${live!.userId}|${live!._id}` }).query(api.demo.listItems, {}),
  ).resolves.toEqual([]);
  await expect(
    t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "signIn",
        email: "owner@example.com",
        password: "original-password",
      },
    }),
  ).rejects.toThrow("AUTHENTICATION_FAILED");
  const success = await t.action(api.auth.signIn, {
    provider: "password",
    params: {
      flow: "signIn",
      email: "owner@example.com",
      password: "replacement-password",
    },
  });
  expect(success.tokens).toBeTruthy();
  await t.mutation(internal.authRevocations.beginErasure, { userId: live!.userId });
  for (const old of oldSessions) {
    expect(
      await t.query(internal.authRevocations.isRevoked, {
        userId: String(old.userId),
        sessionId: String(old._id),
        allowDeleting: true,
      }),
    ).toBe(true);
  }
  expect(
    await t.query(internal.authRevocations.isRevoked, {
      userId: String(live!.userId),
      sessionId: String(live!._id),
      allowDeleting: true,
    }),
  ).toBe(false);
});

test("missing sender fails closed before creating an account", async () => {
  vi.stubEnv("AUTH_RESEND_KEY", "");
  const t = harness();
  await expect(signup(t)).rejects.toThrow("AUTHENTICATION_FAILED");
  expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(0);
  expect(sent).toHaveLength(0);
});

test("expired codes cannot sign in and email requests are bounded", async () => {
  const t = harness();
  await signup(t);
  const code = lastCode();
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query("authVerificationCodes").collect()) {
      await ctx.db.patch(row._id, { expirationTime: Date.now() - 1 });
    }
  });
  await expect(
    t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "email-verification",
        email: "owner@example.com",
        code,
      },
    }),
  ).rejects.toThrow("AUTHENTICATION_FAILED");
  for (let i = 0; i < 8; i++)
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "reset",
        email: "owner@example.com",
      },
    });
  expect(sent.length).toBeLessThanOrEqual(3);
});

test("only trusted matching verification updates metadata, preserving privileges and prior time", async () => {
  const t = harness();
  for (const scenario of [
    { type: "credentials" as const, email: "owner@example.com", verified: true, expected: false },
    { type: "verification" as const, email: "owner@example.com", verified: false, expected: false },
    { type: "verification" as const, email: "other@example.com", verified: true, expected: false },
    { type: "verification" as const, email: " OWNER@EXAMPLE.COM ", verified: true, expected: true },
  ]) {
    await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { email: "owner@example.com", owner: false });
      await admitIdentity(ctx, {
        existingUserId: id,
        type: scenario.type,
        provider: { id: "password", type: "credentials" },
        profile: { email: scenario.email, emailVerified: scenario.verified, owner: true },
      });
      const user = await ctx.db.get(id);
      expect(user?.owner).toBe(false);
      if (scenario.expected) {
        expect(user?.emailVerificationTime).toEqual(expect.any(Number));
        await ctx.db.patch(id, { emailVerificationTime: 123 });
        await admitIdentity(ctx, {
          existingUserId: id,
          type: "verification",
          provider: { id: "password", type: "credentials" },
          profile: { email: scenario.email, emailVerified: true, owner: true },
        });
        expect((await ctx.db.get(id))?.emailVerificationTime).toBe(123);
      } else expect(user?.emailVerificationTime).toBeUndefined();
    });
  }
});
