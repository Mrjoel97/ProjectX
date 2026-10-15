import { AUTH_REVOCATION_RETENTION_MS } from "@pikar/core/authLifetime";
import { deletableTables } from "@pikar/core/tenantData";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import agentSchema from "../node_modules/@convex-dev/agent/src/component/schema.js";
import { api, components, internal } from "./_generated/api";
import { revokeErasedIdentity } from "./authRevocations";
import { lifecycleActionContext, lifecycleDatabase } from "./lib/tenantLifecycle";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const agentModules = import.meta.glob(
  "../node_modules/@convex-dev/agent/src/component/**/!(*.test).ts",
);

test("application write builders cannot bypass lifecycle enforcement", () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const violations: string[] = [];
  for (const entry of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const path = entry.replaceAll("\\", "/");
    if (
      !path.endsWith(".ts") ||
      path.endsWith(".test.ts") ||
      path.startsWith("_generated/") ||
      path === "lib/tenantLifecycle.ts"
    )
      continue;
    const source = readFileSync(join(root, path), "utf8");
    for (const match of source.matchAll(
      /import\s*\{([^}]+)\}\s*from\s*["'][^"']*_generated\/server["']/g,
    )) {
      if (/\binternal(?:Mutation|Action)\b/.test(match[1]!)) violations.push(path);
    }
  }
  expect(violations).toEqual([]);
});

test("an already-running action cannot commit component writes after the erasure boundary", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("agent", agentSchema, agentModules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  await t.action(async (ctx) => {
    const guarded = lifecycleActionContext(ctx, String(userId));
    await guarded.runMutation(components.agent.threads.createThread, {
      userId: String(userId),
      title: "allowed",
    });
    await ctx.runMutation(internal.authRevocations.beginErasure, { userId });
    await expect(
      guarded.runMutation(components.agent.threads.createThread, {
        userId: String(userId),
        title: "late",
      }),
    ).rejects.toThrow("TENANT_ERASURE_IN_PROGRESS");
  });
});

test("deletion blocks public admission and late internal writes while cleanup and retry remain available", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const session = t.withIdentity({ subject: `${userId}|existing` });
  const row = await t.run((ctx) =>
    ctx.db.insert("demoItems", { tenantId: String(userId), label: "old" }),
  );
  await t.mutation(internal.authRevocations.beginErasure, { userId });
  await expect(session.query(api.demo.listItems, {})).rejects.toThrow("UNAUTHENTICATED");
  await expect(session.mutation(api.demo.addItem, { label: "late" })).rejects.toThrow(
    "UNAUTHENTICATED",
  );
  await expect(session.action(api.cockpit.sendCockpitMessage, { text: "blocked" })).rejects.toThrow(
    "UNAUTHENTICATED",
  );
  await expect(
    t.mutation(internal.notifications.notify, {
      tenantId: String(userId),
      kind: "late",
      message: "late completion",
    }),
  ).rejects.toThrow("TENANT_ERASURE_IN_PROGRESS");
  await expect(
    t.run((ctx) => lifecycleDatabase(ctx).patch(row, { label: "late patch" })),
  ).rejects.toThrow("TENANT_ERASURE_IN_PROGRESS");
  await expect(
    t.run((ctx) =>
      lifecycleDatabase(ctx).replace(row, { tenantId: String(userId), label: "late replacement" }),
    ),
  ).rejects.toThrow("TENANT_ERASURE_IN_PROGRESS");
  await t.mutation(internal.authRevocations.beginErasure, { userId });
  expect(
    await t.query(internal.authRevocations.isRevoked, {
      userId: String(userId),
      allowDeleting: true,
    }),
  ).toBe(false);
  await t.run((ctx) => lifecycleDatabase(ctx).delete(row));
  await t.run((ctx) => revokeErasedIdentity(ctx, String(userId)));
  await expect(
    t.mutation(internal.notifications.notify, {
      tenantId: String(userId),
      kind: "late",
      message: "delayed after erasure",
    }),
  ).rejects.toThrow("TENANT_ERASURE_IN_PROGRESS");
  expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toEqual([]);
});

test("terminal erasure atomically revokes an issued identity across every public wrapper", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const session = t.withIdentity({ subject: `${userId}|unexpired` });
  await session.mutation(api.demo.addItem, { label: "before deletion" });
  await t.mutation(internal.tenantDelete.deleteTenantDataPage, {
    tenantId: String(userId),
    userId,
    cursor: { tableIndex: deletableTables().indexOf("users") },
  });
  await expect(session.query(api.demo.listItems, {})).rejects.toThrow("UNAUTHENTICATED");
  await expect(session.mutation(api.demo.addItem, { label: "resurrection" })).rejects.toThrow(
    "UNAUTHENTICATED",
  );
  await expect(session.action(api.cockpit.sendCockpitMessage, { text: "blocked" })).rejects.toThrow(
    "UNAUTHENTICATED",
  );
  const tombstones = await t.run((ctx) => ctx.db.query("authRevocations").collect());
  expect(tombstones).toHaveLength(1);
  expect(tombstones[0]?.expiresAt).toBeGreaterThan(
    Date.now() + AUTH_REVOCATION_RETENTION_MS - 10_000,
  );
  expect(await t.run((ctx) => ctx.db.get(userId))).toBeNull();
  // A different identity, including the legacy harness shape, follows the same policy.
  await expect(
    t.withIdentity({ subject: "unrevoked|s" }).query(api.demo.listItems, {}),
  ).resolves.toEqual([]);
});

test("erasure retains live voice handles until provider termination is acknowledged", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("voiceSessions", {
      tenantId: String(userId),
      callId: "provider-call",
      status: "active",
      startedAt: Date.now(),
      endsAt: Date.now() + 60000,
      inAudioTok: 0,
      outAudioTok: 0,
      textInTok: 0,
      textOutTok: 0,
      createdAt: Date.now(),
    }),
  );
  await t.mutation(internal.authRevocations.beginErasure, { userId });
  const page = {
    tenantId: String(userId),
    userId,
    cursor: { tableIndex: deletableTables().indexOf("voiceSessions") },
  };
  await expect(t.mutation(internal.tenantDelete.deleteTenantDataPage, page)).rejects.toThrow(
    "VOICE_TERMINATION_PENDING",
  );
  expect((await t.run((ctx) => ctx.db.get(sessionId)))?.callId).toBe("provider-call");
  await t.mutation(internal.voice.terminationReceipt, { sessionId, confirmed: true });
  expect((await t.run((ctx) => ctx.db.get(sessionId)))?.hangupConfirmedAt).toBeTruthy();
  await t.mutation(internal.tenantDelete.deleteTenantDataPage, page);
  expect(await t.run((ctx) => ctx.db.get(sessionId))).toBeNull();
});

test("revocation is idempotent and cleanup is bounded and preserves unexpired denials", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await revokeErasedIdentity(ctx, "active");
    await revokeErasedIdentity(ctx, "active");
    for (let i = 0; i < 260; i++)
      await ctx.db.insert("authRevocations", {
        userId: `expired_${i}`,
        expiresAt: Date.now() - 1000,
      });
  });
  expect(await t.query(internal.authRevocations.isRevoked, { userId: "active" })).toBe(true);
  expect(await t.query(internal.authRevocations.isRevoked, { userId: "expired_0" })).toBe(false);
  expect(await t.mutation(internal.authRevocations.purgeExpired, {})).toEqual({
    deleted: 256,
    moreMayRemain: true,
  });
  expect(await t.mutation(internal.authRevocations.purgeExpired, {})).toEqual({
    deleted: 4,
    moreMayRemain: false,
  });
  const rows = await t.run((ctx) => ctx.db.query("authRevocations").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]?.userId).toBe("active");
});

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
