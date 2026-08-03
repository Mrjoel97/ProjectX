import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// The 22.1-02 budget tests drive the REAL rate-limiter component (relative import — the package
// block deep specifiers). The dispatch.test.ts / runCockpitAgent.test.ts idiom, verbatim.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  DAILY_BUDGET_CENTS,
  DEPLOYMENT_BUDGET_CENTS,
  INGEST_DAILY_BUDGET_CENTS,
  MEDIA_DAILY_BUDGET_CENTS,
} from "./guardrails";
import schema from "./schema";

// convex-test discovers Convex modules via import.meta.glob; exclude the tests.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

/** A harness with the rate-limiter component registered, for the budget-rail tests only. */
function budgetHarness() {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  return t;
}

// The tests BELOW this line (up to the 22.1-02 block) all RETURN before guardrails.prepare
// touches the rateLimiter component (kill switch at step 2, over_budget at step 5), so they
// use the plain `convexTest` harness and need no component.
//
// 22.1-02 corrects the old caveat here: the rate-limiter component CAN be registered under
// convex-test (dispatch.test.ts:116 already did), so the spend rails are now unit-proven by
// `budgetHarness` above rather than left entirely to smoke:guardrails. smoke:guardrails still
// owns the end-to-end prepare/preCall-through-the-pipeline path.

const REQ = {
  tenantId: "tenant_a",
  correlationId: "corr_1",
  goal: "email jane about the Q3 report",
  recipient: "jane@example.com",
  status: "scanning" as const,
  attachmentRefs: [],
  createdAt: Date.now(),
};

async function seedConfig(
  t: ReturnType<typeof convexTest>,
  cfg: { killSwitch: boolean; budgetUsdPerRequest: number },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("guardrailConfig", { ...cfg, updatedAt: Date.now() });
  });
}

test("prepare: kill switch ON returns governed stop before any scan/persist", async () => {
  const t = convexTest(schema, modules);
  await seedConfig(t, { killSwitch: true, budgetUsdPerRequest: 0.05 });
  const requestId = await t.run(async (ctx) => await ctx.db.insert("requests", REQ));

  const res = await t.mutation(internal.guardrails.prepare, { requestId });

  expect(res).toEqual({ ok: false, reason: "kill_switch" });
  const row = await t.run(async (ctx) => await ctx.db.get(requestId));
  expect(row?.safeText).toBeUndefined(); // returned BEFORE scan — nothing persisted
});

test("prepare: budget ~0 fails closed with over_budget (before the spend component)", async () => {
  const t = convexTest(schema, modules);
  await seedConfig(t, { killSwitch: false, budgetUsdPerRequest: 0 });
  const requestId = await t.run(async (ctx) => await ctx.db.insert("requests", REQ));

  const res = await t.mutation(internal.guardrails.prepare, { requestId });

  expect(res).toEqual({ ok: false, reason: "over_budget" });
  const row = await t.run(async (ctx) => await ctx.db.get(requestId));
  expect(row?.safeText).toBeUndefined();
});

test("prepare: missing request id throws (a bug, not a governed stop)", async () => {
  const t = convexTest(schema, modules);
  const requestId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("requests", REQ);
    await ctx.db.delete(id); // dangling but well-typed id
    return id;
  });

  await expect(t.mutation(internal.guardrails.prepare, { requestId })).rejects.toThrow();
});

test("getSafeTextByHash: no matching row throws (fail-closed reader, GRDL-01)", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.query(internal.guardrails.getSafeTextByHash, {
      tenantId: "tenant_a",
      safeTextHash: "deadbeef",
    }),
  ).rejects.toThrow(/safeText missing/);
});

test("preCall: kill switch ON returns governed stop (component-free branch)", async () => {
  const t = convexTest(schema, modules);
  await seedConfig(t, { killSwitch: true, budgetUsdPerRequest: 0.05 });

  const res = await t.mutation(internal.guardrails.preCall, { tenantId: "tenant_a" });

  expect(res).toEqual({ ok: false, reason: "kill_switch" });
});

// ── 22.1-02: the two spend rails ───────────────────────────────────────────────────
// Until 22.1-02 `dailySpendCents` was KEYLESS — it capped the deployment, so one tenant's
// loop refused every other tenant. These drive the REAL limiter component, so they fail if
// the `{ key: tenantId }` is ever dropped again.
describe("spend rails: per-tenant window + keyless deployment ceiling", () => {
  const A = "tenant_a";
  const B = "tenant_b";
  /** Spend `cents` for one tenant through the real recordSpend path. */
  const spend = (t: ReturnType<typeof budgetHarness>, tenantId: string, cents: number) =>
    t.mutation(internal.guardrails.recordSpend, { tenantId, costUsd: cents / 100 });

  test("THE POINT: tenant A exhausting its day does not refuse tenant B", async () => {
    const t = budgetHarness();
    await seedConfig(t, { killSwitch: false, budgetUsdPerRequest: 0.05 });

    // A burns its entire personal allowance — but stays well under the deployment ceiling,
    // so anything B sees must come from the KEY, not from the shared rail.
    await spend(t, A, DAILY_BUDGET_CENTS);
    expect(DAILY_BUDGET_CENTS).toBeLessThan(DEPLOYMENT_BUDGET_CENTS); // the test is not vacuous

    expect(await t.mutation(internal.guardrails.preCall, { tenantId: A })).toEqual({
      ok: false,
      reason: "daily_budget_exhausted",
    });
    // Mutation check: drop `key: tenantId` from dailySpendCents and this line goes RED.
    expect(await t.mutation(internal.guardrails.preCall, { tenantId: B })).toEqual({ ok: true });
  });

  test("the deployment ceiling still binds, with its own distinct reason", async () => {
    const t = budgetHarness();
    await seedConfig(t, { killSwitch: false, budgetUsdPerRequest: 0.05 });

    // Many tenants, each individually modest, together exceeding the ceiling. No single
    // tenant is over its own allowance, so only the global rail can refuse here.
    const perTenant = DAILY_BUDGET_CENTS - 1;
    const needed = Math.ceil(DEPLOYMENT_BUDGET_CENTS / perTenant);
    for (let i = 0; i < needed; i++) await spend(t, `crowd_${i}`, perTenant);

    // A fresh tenant has its FULL personal budget and is still refused — and is told the
    // truth about why, rather than being blamed for spending a day it never touched.
    expect(await t.mutation(internal.guardrails.preCall, { tenantId: "newcomer" })).toEqual({
      ok: false,
      reason: "deployment_budget_exhausted",
    });
  });

  test("recordSpend moves BOTH rails, and remainingDailyCents reports the tighter one", async () => {
    const t = budgetHarness();
    const before = await t.query(internal.guardrails.remainingDailyCents, { tenantId: A });
    expect(before).toBe(DAILY_BUDGET_CENTS); // tenant rail is tighter than the ceiling

    await spend(t, A, 100);
    expect(await t.query(internal.guardrails.remainingDailyCents, { tenantId: A })).toBe(
      DAILY_BUDGET_CENTS - 100,
    );
    // B never spent, so its own rail is untouched — proof the tenant window is keyed...
    expect(await t.query(internal.guardrails.remainingDailyCents, { tenantId: B })).toBe(
      DAILY_BUDGET_CENTS,
    );
    // ...while the deployment rail DID absorb A's spend (keyless, shared by construction).
    const drained = DEPLOYMENT_BUDGET_CENTS - 100;
    await spend(t, B, drained - DAILY_BUDGET_CENTS + 1); // push the ceiling below B's own rail
    const remaining = await t.query(internal.guardrails.remainingDailyCents, { tenantId: "fresh" });
    expect(remaining).toBeLessThan(DAILY_BUDGET_CENTS); // the min() picked the ceiling
  });

  test("a rail driven negative by reserve:true clamps to 0, never a negative envelope", async () => {
    const t = budgetHarness();
    // recordSpend uses reserve:true so real spend is never under-counted — it overshoots.
    await spend(t, A, DAILY_BUDGET_CENTS * 3);
    expect(await t.query(internal.guardrails.remainingDailyCents, { tenantId: A })).toBe(0);
  });
});

// ── 15.3-03: the FOLDER-INGEST rail ────────────────────────────────────────────────────
//
// These drive the REAL rate-limiter component, which is the only way to prove a reservation and
// a refund at all: the refund is a NEGATIVE `count`, an undocumented arithmetic property of
// @convex-dev/rate-limiter@0.3.2 rather than an API, so a mock would only prove the mock.
//
// Every test below names the mutation that turns it red, and every one of those mutations was
// actually run — a guarantee whose mutation does not break its test is not being sampled.
describe("folder-ingest rail: reserve, refund, and never starving the cockpit", () => {
  const T = "tenant_folder";

  /** A manifest that estimates to EXACTLY `cents`. One plain-text document costs one cent —
   *  `recordSpend` charges `Math.ceil(costUsd * 100)` per call and graph extraction is sub-cent —
   *  so N text files is N cents. The tests assert that, so this helper cannot go silently wrong. */
  const manifestOf = (cents: number) =>
    Array.from({ length: cents }, () => ({ size: 1_000, mimeType: "text/plain" }));

  const remaining = (t: ReturnType<typeof budgetHarness>, tenantId = T) =>
    t.query(internal.guardrails.ingestRemainingCents, { tenantId });

  /** A folder row holding a live reservation, ready to settle. */
  const seedFolder = (
    t: ReturnType<typeof budgetHarness>,
    reservedCents: number,
    reservedAt: number = Date.now(),
  ): Promise<Id<"vaultFolders">> =>
    t.run((ctx) =>
      ctx.db.insert("vaultFolders", {
        tenantId: T,
        name: "folder",
        source: "upload" as const,
        status: "ingesting" as const,
        memberCount: 0,
        terminalCount: 0,
        failedCount: 0,
        reservedCents,
        spentCents: 0,
        reservedAt,
        createdAt: Date.now(),
      }),
    );

  // 1. THE ROUND TRIP. 2500 -> reserve 900 -> 1600 -> refund 400 -> 2000, exactly.
  // Mutation RUN: delete the minus in `count: -refundedCents` (settleFolder) -> RED, the window
  // drops to 1200 instead of rising to 2000, because the "refund" spends again.
  test("reserve draws the window down and settle credits the unspent remainder back", async () => {
    const t = budgetHarness();
    expect(await remaining(t)).toBe(INGEST_DAILY_BUDGET_CENTS);

    const res = await t.mutation(internal.guardrails.reserveFolder, {
      tenantId: T,
      files: manifestOf(900),
    });
    expect(res.ok).toBe(true);
    expect(res.estCents).toBe(900); // the helper really does estimate what it claims
    expect(await remaining(t)).toBe(INGEST_DAILY_BUDGET_CENTS - 900);

    const folderId = await seedFolder(t, 400);
    const settled = await t.mutation(internal.guardrails.settleFolder, { folderId });
    expect(settled).toMatchObject({ refundedCents: 400, reason: "settled" });
    expect(await remaining(t)).toBe(2_000);
  });

  // 2. THE ORDERING TRAP. `check()` THROWS above capacity ("Rate limit ingestSpendCents count
  // 2501 exceeds 2500"), so a folder over the cap would produce a stack trace instead of the
  // locked plain-language refusal unless the ceiling comparison comes FIRST.
  // Mutation RUN: move the two `estCents > …` guards below the `check` calls -> RED, the call
  // REJECTS with `count 2501 exceeds 2500` instead of resolving.
  test("a folder over the cap RESOLVES to a governed refusal — it does not throw", async () => {
    const t = budgetHarness();
    const over = INGEST_DAILY_BUDGET_CENTS + 1;

    const res = await t.mutation(internal.guardrails.reserveFolder, {
      tenantId: T,
      files: manifestOf(over),
    });

    expect(res).toMatchObject({
      ok: false,
      reason: "over_folder_cap",
      estCents: over,
      remainingCents: INGEST_DAILY_BUDGET_CENTS,
      shortfallCents: 1,
      fileCount: over,
    });
    // NOTHING was consumed — a refusal is intact by construction, not by cleanup.
    expect(await remaining(t)).toBe(INGEST_DAILY_BUDGET_CENTS);
  });

  // 3(b). CROSS-RAIL ISOLATION, ingest -> cockpit. A folder spending its whole $25 must not
  // touch the agent the user relies on for actual work.
  // Mutation RUN: drop the `rail === "ingest"` branch in `recordSpend` -> RED, the cockpit is
  // refused with daily_budget_exhausted.
  test("a folder spending its entire $25 does not refuse the cockpit", async () => {
    const t = budgetHarness();
    await t.mutation(internal.guardrails.recordSpend, {
      tenantId: T,
      costUsd: INGEST_DAILY_BUDGET_CENTS / 100,
      rail: "ingest",
    });

    expect(await remaining(t)).toBe(0); // not vacuous: the ingest rail really is drained
    expect(await t.mutation(internal.guardrails.preCall, { tenantId: T })).toEqual({ ok: true });
  });

  // 4. IDEMPOTENT SETTLE. Workflow `onComplete` can be re-entered, and a second credit would be
  // free budget. The CAS is `reservedCents <= 0`, read and cleared in the same transaction.
  // Mutation RUN: delete the `if (folder.reservedCents <= 0) return none("already_settled")`
  // line -> RED, the second call refunds another 400 and the window reads 2400.
  test("settling twice does not credit twice", async () => {
    const t = budgetHarness();
    await t.mutation(internal.guardrails.reserveFolder, { tenantId: T, files: manifestOf(900) });
    const folderId = await seedFolder(t, 400);

    const first = await t.mutation(internal.guardrails.settleFolder, { folderId });
    const after = await remaining(t);
    const second = await t.mutation(internal.guardrails.settleFolder, { folderId });

    expect(first.refundedCents).toBe(400);
    expect(second).toMatchObject({ refundedCents: 0, reason: "already_settled" });
    expect(await remaining(t)).toBe(after);
  });

  // 5. TWO RESERVATIONS SUMMING ABOVE THE CAP. Exactly one wins; the loser gets a governed
  // refusal carrying a TRUTHFUL remaining figure, and total consumption never exceeds capacity.
  //
  // Honest about what this does and does not prove: convex-test SERIALISES mutations, so it
  // cannot exercise the transaction boundary that makes the guarantee true under real
  // concurrency (that boundary is "check and limit in ONE mutation", enforced by construction in
  // `reserveFolderInner`). What it does pin is that the check GATES at all and that the refusal
  // is truthful. Mutation RUN: delete both `rateLimiter.check` calls from `reserveFolderInner`
  // (leaving only the `limit(reserve:true)` pair, which never refuses) -> RED, both succeed.
  test("two folders that cannot both fit: one is reserved, one is refused truthfully", async () => {
    const t = budgetHarness();
    const half = Math.floor(INGEST_DAILY_BUDGET_CENTS * 0.6); // 1500 — two of these do not fit
    const files = manifestOf(half);

    const [a, b] = await Promise.all([
      t.mutation(internal.guardrails.reserveFolder, { tenantId: T, files }),
      t.mutation(internal.guardrails.reserveFolder, { tenantId: T, files }),
    ]);

    const winners = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers[0]).toMatchObject({
      ok: false,
      reason: "ingest_daily_exhausted",
      estCents: half,
    });
    // The refusal's own number is the truth, not a stale pre-flight figure.
    expect(losers[0]).toMatchObject({ remainingCents: INGEST_DAILY_BUDGET_CENTS - half });
    expect(await remaining(t)).toBe(INGEST_DAILY_BUDGET_CENTS - half);
    expect(await remaining(t)).toBeGreaterThanOrEqual(0); // never over-consumed
  });

  // 6. THE $25 DECISION IS NOT VACUOUS (the constants.test.ts idiom). The owner chose a window
  // ABOVE both existing ones because a folder upload is a bursty one-off, not a daily habit. If
  // someone "harmonises" the three numbers, the decision is gone and this says so.
  test("the ingest window is deliberately the largest of the three per-tenant rails", () => {
    expect(INGEST_DAILY_BUDGET_CENTS).toBeGreaterThan(DAILY_BUDGET_CENTS);
    expect(INGEST_DAILY_BUDGET_CENTS).toBeGreaterThan(MEDIA_DAILY_BUDGET_CENTS);
  });
});

// 3(a). CROSS-RAIL ISOLATION, cockpit -> ingest — the other direction, and the one that needs the
// whole spine rather than a gate call. A drained cockpit budget must not refuse a folder document
// MID-RUN; that is the "half-ingested folder" this phase exists to forbid.
//
// Fake timers for the vaultExtract.test.ts reason: the seam's `workflow.start` enqueues workpool
// functions via the scheduler, and under real timers they fire after the suite and retry-loop
// against a torn-down module runner. Only the SYNCHRONOUS effects are asserted.
describe("cross-rail isolation: a drained cockpit budget cannot refuse reserved folder work", () => {
  const TENANT = "tenant_isolation";
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function ingestHarness() {
    const t = convexTest(schema, modules);
    t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
    t.registerComponent("workflow", workflowSchema, workflowModules);
    t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
    t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
    return t;
  }

  /** Upload a SMOKE:: sentinel document through the REAL vaultUpload path — no model call, no
   *  spend, but the whole extractDoc spine runs. */
  async function seedDoc(t: ReturnType<typeof ingestHarness>): Promise<Id<"vaultDocuments">> {
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["SMOKE::extract::folder member text"], { type: "image/png" })),
    );
    const { vaultDocId } = await t
      .withIdentity({ subject: TENANT })
      .mutation(api.vault.vaultUpload, {
        storageId,
        filename: "member.png",
        mimeType: "image/png",
        size: 64,
        contentHash: `h-${Math.random()}`,
      });
    return vaultDocId;
  }

  const drainCockpit = (t: ReturnType<typeof ingestHarness>) =>
    t.mutation(internal.guardrails.recordSpend, {
      tenantId: TENANT,
      costUsd: DAILY_BUDGET_CENTS / 100,
    });

  /**
   * The state a folder document ACTUALLY runs in, and getting this wrong is how a green test
   * proves nothing. Draining the cockpit alone is not the scenario: a whole-folder reservation
   * takes the tenant's ingest window to 0 by design, so at the moment the first document runs
   * BOTH rails are empty. `reserved` is what says "this money is already paid".
   *
   * A first draft of this suite drained only the cockpit — and every test stayed GREEN when the
   * `reserved` early return was deleted, because the untouched ingest window answered the check.
   * The mutation run is what exposed that; the fixture is what fixes it.
   */
  async function drainBothRails(t: ReturnType<typeof ingestHarness>): Promise<void> {
    await drainCockpit(t);
    const res = await t.mutation(internal.guardrails.reserveFolder, {
      tenantId: TENANT,
      files: Array.from({ length: INGEST_DAILY_BUDGET_CENTS }, () => ({
        size: 1_000,
        mimeType: "text/plain",
      })),
    });
    expect(res.ok).toBe(true);
    expect(
      await t.query(internal.guardrails.ingestRemainingCents, { tenantId: TENANT }),
    ).toBe(0);
  }

  // THE CONTROL, and it is what makes the tests below mean anything: this is what folder ingest
  // did before 15.3-03, and what it goes back to doing the moment the rail stops being threaded.
  test("WITHOUT the rail, a drained cockpit budget refuses the document (the old behaviour)", async () => {
    const t = ingestHarness();
    await drainCockpit(t);
    const vaultDocId = await seedDoc(t);

    await t.action(internal.vaultExtract.extractDoc, { vaultDocId, tenantId: TENANT });

    const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("daily_budget_exhausted");
  }, 30000);

  // THE SECOND CONTROL: the rail alone is not enough. Unreserved ingest work still pays the
  // ingest window's own check, so the reservation-drained window refuses it. Without this test,
  // `reserved` could be deleted entirely and nothing would notice.
  test("WITH the rail but NOT reserved, the reservation-drained ingest window refuses it", async () => {
    const t = ingestHarness();
    await drainBothRails(t);
    const vaultDocId = await seedDoc(t);

    await t.action(internal.vaultExtract.extractDoc, {
      vaultDocId,
      tenantId: TENANT,
      spendRail: "ingest",
    });

    const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("daily_budget_exhausted");
  }, 30000);

  // THE GUARANTEE: a reserved folder document runs with BOTH rails at zero — the cockpit's
  // because someone else spent it, its own because ITS OWN reservation took it. Refusing here is
  // precisely the "refused halfway" failure the phase exists to forbid.
  // Mutation RUN: delete the `if (rail === "ingest" && reserved === true) return { ok: true }`
  // early return in `preCall` -> RED, the document fails with daily_budget_exhausted.
  test("WITH the reserved ingest rail, neither drained window can refuse it", async () => {
    const t = ingestHarness();
    await drainBothRails(t);
    const vaultDocId = await seedDoc(t);

    await t.action(internal.vaultExtract.extractDoc, {
      vaultDocId,
      tenantId: TENANT,
      spendRail: "ingest",
      reserved: true,
    });

    const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
    expect(doc?.status).toBe("processing"); // the seam ran and ingest was started
    expect(doc?.failureReason).toBeUndefined();
    expect(doc?.text).toBe("folder member text");
  }, 30000);
});
