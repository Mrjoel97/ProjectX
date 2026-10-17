import { generateKeyPairSync } from "node:crypto";
import { deletableTables } from "@pikar/core/tenantData";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { lifecycleActionContext, lifecycleDatabase } from "./lib/tenantLifecycle";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("an admitted storage operation crossing erasure compensates its own blob without touching another tenant", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const otherBlob = await t.action((ctx) =>
    ctx.storage.store(new Blob(["other synthetic fixture"])),
  );
  let racedBlob: Id<"_storage"> | undefined;
  await t.action(async (ctx) => {
    const storage = new Proxy(ctx.storage, {
      get(target, key) {
        if (key === "store")
          return async (blob: Blob) => {
            const id = await target.store(blob);
            racedBlob = id;
            // Deterministic interleaving after upload succeeds but before guarded store returns.
            await ctx.runMutation(internal.authRevocations.beginErasure, { userId });
            return id;
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const guarded = lifecycleActionContext({ ...ctx, storage }, String(userId));
    await expect(guarded.storage.store(new Blob(["late synthetic fixture"]))).rejects.toThrow(
      "TENANT_ERASURE_IN_PROGRESS",
    );
  });
  if (!racedBlob) throw new Error("Expected the admitted operation to create a blob");
  const createdBlob = racedBlob;
  expect(await t.run((ctx) => ctx.db.system.get(createdBlob))).toBeNull();
  expect(await t.run((ctx) => ctx.db.system.get(otherBlob))).not.toBeNull();
});

test("a completed generated blob stays owned when erasure starts before its later attachment", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const foreignBlob = await t.action((ctx) => ctx.storage.store(new Blob(["foreign fixture"])));
  const generated = await t.action(async (ctx) => {
    const guarded = lifecycleActionContext(ctx, String(userId));
    return guarded.storage.store(new Blob(["generated fixture waiting for attachment"]));
  });
  // Storage has returned, but the caller's later attachment has not committed.
  await t.mutation(internal.authRevocations.beginErasure, { userId });
  const receipts = await t.run((ctx) =>
    ctx.db
      .query("uploadReceipts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", String(userId)))
      .collect(),
  );
  expect(receipts.map((row) => row.storageId)).toEqual([generated]);
  await t.mutation(internal.tenantDelete.deleteTenantDataPage, {
    tenantId: String(userId),
    userId,
    cursor: { tableIndex: deletableTables().indexOf("uploadReceipts") },
  });
  expect(await t.run((ctx) => ctx.db.system.get(generated))).toBeNull();
  expect(await t.run((ctx) => ctx.db.system.get(foreignBlob))).not.toBeNull();
});

test("generated attachment promotion preserves owned files while abandoned blobs expire", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const other = await t.run((ctx) => ctx.db.insert("users", {}));
  const store = () =>
    t.action((ctx) =>
      lifecycleActionContext(ctx, String(userId)).storage.store(new Blob(["fixture"])),
    );
  const attached = await store();
  const abandoned = await store();
  const fields = {
    tenantId: String(userId),
    title: "fixture",
    kind: "generated",
    category: "general",
    source: "generated",
    mimeType: "text/plain",
    size: 7,
    contentHash: "fixture",
    createdAt: Date.now(),
    status: "ready" as const,
  };
  await expect(
    t.run((ctx) =>
      lifecycleDatabase(ctx).insert("vaultDocuments", {
        ...fields,
        tenantId: String(other),
        storageId: attached,
      }),
    ),
  ).rejects.toThrow("UPLOAD_NOT_OWNED");
  const doc = await t.run((ctx) => lifecycleDatabase(ctx).insert("vaultDocuments", fields));
  await t.run((ctx) => lifecycleDatabase(ctx).patch(doc, { storageId: attached }));
  vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1);
  await t.mutation(internal.uploads.purgeExpired, {});
  expect(await t.run((ctx) => ctx.db.system.get(attached))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.system.get(abandoned))).toBeNull();
  expect(await t.run((ctx) => ctx.db.query("uploadReceipts").collect())).toMatchObject([
    { storageId: attached, expiresAt: Number.MAX_SAFE_INTEGER },
  ]);
});

test("reset session validation rejects exactly at persisted session expiry across all tenant wrappers", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const started = Date.UTC(2026, 0, 1);
  vi.setSystemTime(started);
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", { userId, expirationTime: started + 2000 }),
  );
  await t.mutation(internal.authRevocations.requireLiveSessions, { userId });
  const session = t.withIdentity({ subject: `${userId}|${sessionId}` });
  vi.setSystemTime(started + 1999);
  await expect(session.query(api.demo.listItems, {})).resolves.toEqual([]);
  vi.setSystemTime(started + 2000);
  await expect(session.query(api.demo.listItems, {})).rejects.toThrow("UNAUTHENTICATED");
  await expect(session.mutation(api.demo.addItem, { label: "must not write" })).rejects.toThrow(
    "UNAUTHENTICATED",
  );
  await expect(
    session.action(api.cockpit.sendCockpitMessage, { text: "must not spend" }),
  ).rejects.toThrow("UNAUTHENTICATED");
  expect(await t.run((ctx) => ctx.db.query("demoItems").collect())).toEqual([]);
});

test("installed password provider refuses an expired email code after clock advancement without editing stored verification data", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const started = Date.UTC(2026, 0, 1);
  vi.setSystemTime(started);
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    type: "pkcs8",
    format: "pem",
  });
  vi.stubEnv("JWT_PRIVATE_KEY", String(key));
  vi.stubEnv("SITE_URL", "https://fixture.example");
  vi.stubEnv("CONVEX_SITE_URL", "https://fixture.convex.site");
  vi.stubEnv("AUTH_RESEND_KEY", "test-only-key");
  vi.stubEnv("AUTH_EMAIL_FROM", "Fixture <auth@example.com>");
  let deliveredCode = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      deliveredCode = body.text.split("\n\n")[1];
      return new Response("{}", { status: 200 });
    }),
  );
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateModules);
  const email = "expiry-fixture@example.com";
  const invite = await t.mutation(internal.invites.__seedInvite, { email });
  await t.action(api.auth.signIn, {
    provider: "password",
    params: { flow: "signUp", email, password: "fixture-password-only", inviteCode: invite.code },
  });
  expect(deliveredCode).not.toBe("");
  vi.setSystemTime(started + 15 * 60 * 1000 + 1);
  await expect(
    t.action(api.auth.signIn, {
      provider: "password",
      params: { flow: "email-verification", email, code: deliveredCode },
    }),
  ).rejects.toThrow("AUTHENTICATION_FAILED");
  expect(await t.run((ctx) => ctx.db.query("authSessions").collect())).toEqual([]);
});
