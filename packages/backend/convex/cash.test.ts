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

describe("cash.saveInput", () => {
  test("an unauthenticated caller cannot write a number", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.cash.saveInput, { field: "cashOnHand", value: 1000 }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("a finance-ops field lands in financeInputs with its own statedAt", async () => {
    const t = convexTest(schema, modules);
    await asTenant(t, "tenant-a").mutation(api.cash.saveInput, {
      field: "cashOnHand",
      value: 12_000,
    });
    const rows = await t.run((ctx) => ctx.db.query("financeInputs").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe("tenant-a");
    expect(rows[0]?.valueUsd).toBe(12_000);
    expect(rows[0]?.statedAt).toBeGreaterThan(0);
  });

  test("saving the same field twice updates the row rather than adding a second", async () => {
    const t = convexTest(schema, modules);
    const as = asTenant(t, "tenant-a");
    await as.mutation(api.cash.saveInput, { field: "cashOnHand", value: 100 });
    await as.mutation(api.cash.saveInput, { field: "cashOnHand", value: 200 });
    const rows = await t.run((ctx) => ctx.db.query("financeInputs").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.valueUsd).toBe(200);
  });

  test("a Hormozi field lands on the SCORECARD — CAC is never duplicated into a second table", async () => {
    const t = convexTest(schema, modules);
    await asTenant(t, "tenant-a").mutation(api.cash.saveInput, { field: "cac", value: 1400 });
    const financeRows = await t.run((ctx) => ctx.db.query("financeInputs").collect());
    expect(financeRows).toHaveLength(0);
    const evaluation = await t.run((ctx) => ctx.db.query("evaluations").first());
    expect(evaluation?.scorecard.financials.cac).toBe(1400);
    expect(evaluation?.userProvided).toContain("financials.cac");
  });

  test("an invalid value is refused at the boundary and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await expect(
      asTenant(t, "tenant-a").mutation(api.cash.saveInput, {
        field: "purchasesPerLifetime",
        value: 0.5,
      }),
    ).rejects.toThrow(/INVALID_INPUT/);
    const evaluations = await t.run((ctx) => ctx.db.query("evaluations").collect());
    expect(evaluations).toHaveLength(0);
  });
});

describe("cash.inputs", () => {
  test("one tenant cannot read another tenant's numbers", async () => {
    const t = convexTest(schema, modules);
    await asTenant(t, "tenant-a").mutation(api.cash.saveInput, {
      field: "cashOnHand",
      value: 99_000,
    });
    const result = await asTenant(t, "tenant-b").query(api.cash.inputs, {});
    const cash = result.inputs.find((i) => i.field === "cashOnHand");
    expect(cash?.value).toBeNull();
  });

  test("an input stated more than 90 days ago is stale", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("financeInputs", {
        tenantId: "tenant-a",
        field: "cashOnHand",
        valueUsd: 5_000,
        statedAt: Date.now() - 91 * 24 * 60 * 60 * 1000,
      });
    });
    const result = await asTenant(t, "tenant-a").query(api.cash.inputs, {});
    expect(result.inputs.find((i) => i.field === "cashOnHand")?.stale).toBe(true);
  });

  test("a fresh input is not stale", async () => {
    const t = convexTest(schema, modules);
    await asTenant(t, "tenant-a").mutation(api.cash.saveInput, { field: "cashOnHand", value: 1 });
    const result = await asTenant(t, "tenant-a").query(api.cash.inputs, {});
    expect(result.inputs.find((i) => i.field === "cashOnHand")?.stale).toBe(false);
  });
});
