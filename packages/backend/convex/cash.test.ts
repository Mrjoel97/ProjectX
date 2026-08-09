import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// convex-test discovers Convex function modules via import.meta.glob. Exclude
// *.test.ts so the harness does not try to load the test files themselves (audit.test.ts idiom).
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const DAY = 24 * 60 * 60 * 1000;

// Match finance.test.ts's identity helper exactly — a second, subtly different one is how two
// tenant-scoping tests end up asserting different things about the same wrapper. `tenantQuery`
// resolves scope from `requireScope`, which only splits the subject string — no `ctx.db.get`, so
// (unlike the owner wrappers) no `users` row needs to exist for this identity to be valid.
const asTenant = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: `${userId}|session`, issuer: "test" });

async function seedSend(t: ReturnType<typeof convexTest>, tenantId: string, createdAt: number) {
  await t.run(async (ctx) => {
    await ctx.db.insert("requests", {
      tenantId,
      correlationId: `c-${createdAt}-${Math.random()}`,
      goal: "g",
      recipient: "someone@example.com",
      status: "sent",
      attachmentRefs: [],
      createdAt,
    });
  });
}

describe("cash.activity", () => {
  test("an unauthenticated caller is rejected before anything is read", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.cash.activity, { sinceMs: Date.now() - DAY, untilMs: Date.now() }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("counts only this tenant's delivered sends", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await seedSend(t, "tenant-a", now - 1000);
    await seedSend(t, "tenant-a", now - 2000);
    await seedSend(t, "tenant-b", now - 1000);

    const result = await asTenant(t, "tenant-a").query(api.cash.activity, {
      sinceMs: now - 3 * DAY,
      untilMs: now,
    });
    expect(result.activity.todayCount).toBe(2);
  });

  test("a non-sent request is not a reach-out", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("requests", {
        tenantId: "tenant-a",
        correlationId: "c-draft",
        goal: "g",
        recipient: "someone@example.com",
        status: "awaiting_review",
        attachmentRefs: [],
        createdAt: now - 1000,
      });
    });
    const result = await asTenant(t, "tenant-a").query(api.cash.activity, {
      sinceMs: now - 3 * DAY,
      untilMs: now,
    });
    expect(result.activity.todayCount).toBe(0);
  });
});
