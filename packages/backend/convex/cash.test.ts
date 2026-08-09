import { emptyScorecard } from "@pikar/core/growth/index";
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

  // Whole-branch review B1: the tenant's newest `evaluations` row can be a `document-review` row
  // with a LITERAL `scorecard: {}` (`voiceDoc.ts`). Before the fix, `saveInput` for a scorecard-store
  // field crashed reaching for that row through `latestScorecardRow`, and the UI reported "That
  // number could not be saved." `latestScorecardRow` now skips it, so `saveInput` seeds a fresh,
  // well-formed carrier instead of touching the malformed one.
  test("saveInput succeeds when the tenant's newest evaluations row has no usable scorecard", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("evaluations", {
        tenantId: "tenant-a",
        threadId: "docreview-thread",
        framework: "document-review",
        findings: [],
        gaps: [],
        notEnoughData: [],
        scorecard: {},
        userProvided: [],
        verdict: "insufficient",
        createdAt: Date.now(),
      });
    });

    await asTenant(t, "tenant-a").mutation(api.cash.saveInput, { field: "cac", value: 1400 });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("evaluations")
        .withIndex("by_tenant", (q) => q.eq("tenantId", "tenant-a"))
        .collect(),
    );
    const withCac = rows.find((row) => row.scorecard?.financials?.cac === 1400);
    expect(withCac).toBeDefined();
    // The malformed row is untouched, not patched in place.
    expect(rows.find((row) => row.threadId === "docreview-thread")?.scorecard).toEqual({});
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

  // Bug found in Task 3 review: `runEvaluation` carries `scorecard`/`userProvided` FORWARD verbatim
  // into a NEW row stamped `createdAt: Date.now()` on every weekly re-evaluation. Reading the ROW's
  // `createdAt` as a stand-in for a FIELD's stated time reported a 91-day-old CAC as "confirmed
  // today" the moment a re-evaluation carried it into a fresh row — silently suppressing the exact
  // confirm-or-update prompt the 90-day rule exists for. `userProvidedAt` (a dot-path → epoch-ms map,
  // stamped by `applyScorecardAnswer`, carried forward unchanged by `runEvaluation`) fixes this.
  test("a scorecard field answered 91 days ago and carried into a fresh row still reports stale", async () => {
    const t = convexTest(schema, modules);
    const oldAnswer = Date.now() - 91 * DAY;
    await t.run(async (ctx) => {
      await ctx.db.insert("evaluations", {
        tenantId: "tenant-a",
        threadId: "thread-a",
        framework: "growth-os",
        findings: [],
        gaps: [],
        notEnoughData: [],
        scorecard: { ...emptyScorecard, financials: { ...emptyScorecard.financials, cac: 1200 } },
        userProvided: ["financials.cac"],
        userProvidedAt: { "financials.cac": oldAnswer },
        // The CARRIED-FORWARD row's own timestamp — fresh, on purpose. This is exactly what a
        // weekly re-evaluation produces: a new row, an old answer.
        createdAt: Date.now(),
        verdict: "insufficient",
      });
    });
    const result = await asTenant(t, "tenant-a").query(api.cash.inputs, {});
    const cac = result.inputs.find((i) => i.field === "cac");
    expect(cac?.value).toBe(1200);
    expect(cac?.statedAt).toBe(oldAnswer);
    expect(cac?.stale).toBe(true);
  });

  test("a scorecard value with no recorded stated time (a legacy row) needs confirmation, never reads as fresh", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("evaluations", {
        tenantId: "tenant-a",
        threadId: "thread-a",
        framework: "growth-os",
        findings: [],
        gaps: [],
        notEnoughData: [],
        scorecard: { ...emptyScorecard, financials: { ...emptyScorecard.financials, cac: 900 } },
        userProvided: ["financials.cac"],
        // NO userProvidedAt — the shape every scorecard-stored figure has before this fix.
        createdAt: Date.now(),
        verdict: "insufficient",
      });
    });
    const result = await asTenant(t, "tenant-a").query(api.cash.inputs, {});
    const cac = result.inputs.find((i) => i.field === "cac");
    expect(cac?.value).toBe(900);
    expect(cac?.statedAt).toBeNull(); // honest — we do not know when this was stated
    expect(cac?.stale).toBe(true); // unknown age needs confirmation, never reads as fresh
  });
});

describe("cash.unitEconomics", () => {
  test("an unauthenticated caller is rejected before anything is read", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.cash.unitEconomics, {})).rejects.toThrow(/UNAUTHENTICATED/);
  });

  // Same read path as `cash.inputs` (`inputStatesFor`), so a foreign tenant's scorecard is exactly
  // as unreachable here as it is there: `latestScorecardRow` is tenant-scoped, and `tenant-a` has
  // entered nothing, so its CFA stays `unknown` no matter what `tenant-b` has on file.
  test("a foreign tenant's scorecard is not read — CFA stays unknown", async () => {
    const t = convexTest(schema, modules);
    await asTenant(t, "tenant-b").mutation(api.cash.saveInput, { field: "cac", value: 1400 });
    await asTenant(t, "tenant-b").mutation(api.cash.saveInput, {
      field: "thirtyDayCashPerCustomer",
      value: 2000,
    });

    const result = await asTenant(t, "tenant-a").query(api.cash.unitEconomics, {});
    expect(result.cfa.state).toBe("unknown");
  });

  test("cac and 30-day cash per customer, both entered, derive a known CFA", async () => {
    const t = convexTest(schema, modules);
    const as = asTenant(t, "tenant-a");
    await as.mutation(api.cash.saveInput, { field: "cac", value: 1400 });
    await as.mutation(api.cash.saveInput, { field: "thirtyDayCashPerCustomer", value: 2000 });

    const result = await as.query(api.cash.unitEconomics, {});
    expect(result.cfa.state).toBe("known");
    expect(result.cfa.state === "known" && result.cfa.origin).toBe("derived");
  });
});

describe("cash.shape", () => {
  test("a tenant with no profile row gets a null tier, not a guessed solopreneur", async () => {
    const t = convexTest(schema, modules);
    const result = await asTenant(t, "tenant-a").query(api.cash.shape, {});
    expect(result.tier).toBeNull();
    expect(result.funding).toBeNull();
  });

  test("the tier and posture come from tenantProfiles, read-only", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("tenantProfiles", {
        tenantId: "tenant-a",
        tier: "startup",
        tierSource: "derived",
        derivedAt: Date.now(),
        funding: "funded",
        revenueStage: "early-revenue",
      });
    });
    const result = await asTenant(t, "tenant-a").query(api.cash.shape, {});
    expect(result).toMatchObject({ tier: "startup", funding: "funded" });
    // `toMatchObject` ignores extra keys, so it cannot catch a `revenueStage` leak — the exact
    // binding this test looks like it guards. An explicit key-set check does.
    expect(Object.keys(result).sort()).toEqual(["funding", "tier"]);
  });

  test("one tenant's shape is not another's", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("tenantProfiles", {
        tenantId: "tenant-a",
        tier: "sme",
        tierSource: "derived",
        derivedAt: Date.now(),
      });
    });
    expect((await asTenant(t, "tenant-b").query(api.cash.shape, {})).tier).toBeNull();
  });
});

describe("tier change", () => {
  test("inputs persist untouched when a solopreneur hires — they are facts about the business", async () => {
    const t = convexTest(schema, modules);
    const as = asTenant(t, "tenant-a");
    await as.mutation(api.cash.saveInput, { field: "cashOnHand", value: 20_000 });
    await as.mutation(api.cash.saveInput, { field: "cac", value: 300 });

    await t.run(async (ctx) => {
      await ctx.db.insert("tenantProfiles", {
        tenantId: "tenant-a",
        tier: "startup",
        tierSource: "derived",
        derivedAt: Date.now(),
        funding: "bootstrapped",
      });
    });

    const inputs = await as.query(api.cash.inputs, {});
    expect(inputs.inputs.find((i) => i.field === "cashOnHand")?.value).toBe(20_000);
    expect(inputs.inputs.find((i) => i.field === "cac")?.value).toBe(300);
    // A newly visible metric shows unknown with its prompt, never back-filled.
    expect(inputs.inputs.find((i) => i.field === "mrr")?.value).toBeNull();
  });
});
