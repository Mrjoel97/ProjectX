import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
// The rails are proven against the REAL rate-limiter component, not a stub: `getValue` returning
// STORED rather than rolled-forward state is the whole reason `railView` exists, and no fake would
// reproduce it. Relative imports — the packages block deep specifiers (guardrails.test.ts idiom).
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  DAILY_BUDGET_CENTS,
  DEPLOYMENT_BUDGET_CENTS,
  DEPLOYMENT_INGEST_BUDGET_CENTS,
  DEPLOYMENT_MEDIA_BUDGET_CENTS,
  INGEST_DAILY_BUDGET_CENTS,
  MEDIA_DAILY_BUDGET_CENTS,
  rateLimiter,
} from "./guardrails";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  // `audit.log` maintains the auditCounts aggregate; the control mutations write through it.
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

type T = ReturnType<typeof harness>;

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = "America/New_York";

/** A signed-in user. `tenantId` is the users._id string — the subject's session suffix is dropped. */
async function signIn(t: T, opts: { owner?: boolean } = {}) {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", opts.owner === undefined ? {} : { owner: opts.owner }),
  );
  return { userId, tenantId: String(userId), as: t.withIdentity({ subject: `${userId}|s` }) };
}

async function insertEvent(
  t: T,
  row: {
    tenantId: string;
    rail: "reasoning" | "media" | "ingest";
    phase: "estimated" | "reserved" | "actual" | "refunded" | "adjustment";
    amountCents: number;
    correlationId: string;
    createdAt: number;
    mediaJobId?: Id<"mediaJobs">;
    kind?: string;
  },
) {
  return await t.run((ctx) => ctx.db.insert("spendEvents", row));
}

const openCoverage = (t: T, tenantId: string, coverageStartedAt: number) =>
  t.run((ctx) => ctx.db.insert("spendCoverage", { tenantId, coverageStartedAt }));

afterEach(() => {
  vi.useRealTimers();
});

describe("finance.summary — two planes, kept apart", () => {
  test("an unauthenticated caller cannot read any tenant projection", async () => {
    const t = harness();
    const now = Date.now();
    const window = { sinceMs: now - DAY_MS, untilMs: now, browserTimeZone: TZ };

    await expect(t.query(api.finance.summary, window)).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(t.query(api.finance.spendSeries, window)).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(
      t.query(api.finance.mediaLedger, {
        sinceMs: now - DAY_MS,
        untilMs: now,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("personal rails report the tenant's OWN window and never the deployment ceiling", async () => {
    const t = harness();
    const { tenantId, as } = await signIn(t);
    const now = Date.now();

    // Drain every KEYLESS deployment window to nothing. The tenant has spent zero.
    await t.run(async (ctx) => {
      await rateLimiter.limit(ctx, "deploymentSpendCents", {
        count: DEPLOYMENT_BUDGET_CENTS,
        reserve: true,
      });
      await rateLimiter.limit(ctx, "deploymentMediaSpendCents", {
        count: DEPLOYMENT_MEDIA_BUDGET_CENTS,
        reserve: true,
      });
      await rateLimiter.limit(ctx, "deploymentIngestSpendCents", {
        count: DEPLOYMENT_INGEST_BUDGET_CENTS,
        reserve: true,
      });
    });
    // ...and spend a little of this tenant's own reasoning rail, so the assertion is not vacuous.
    await t.run((ctx) =>
      rateLimiter.limit(ctx, "dailySpendCents", { key: tenantId, count: 120, reserve: true }),
    );

    const result = await as.query(api.finance.summary, {
      sinceMs: now - DAY_MS,
      untilMs: now,
      browserTimeZone: TZ,
    });

    expect(result.rails.map((rail) => rail.rail)).toEqual(["reasoning", "media", "ingest"]);
    expect(result.rails.map((rail) => rail.capCents)).toEqual([
      DAILY_BUDGET_CENTS,
      MEDIA_DAILY_BUDGET_CENTS,
      INGEST_DAILY_BUDGET_CENTS,
    ]);
    // `guardrails.remainingDailyCents` would return min(tenant, deployment) = 0 for all three here.
    // A tenant surface must not be able to learn that the DEPLOYMENT is drained.
    expect(result.rails[0]?.remainingCents).toBe(DAILY_BUDGET_CENTS - 120);
    expect(result.rails[1]?.remainingCents).toBe(MEDIA_DAILY_BUDGET_CENTS);
    expect(result.rails[2]?.remainingCents).toBe(INGEST_DAILY_BUDGET_CENTS);

    const serialized = JSON.stringify(result);
    for (const ceiling of [
      DEPLOYMENT_BUDGET_CENTS,
      DEPLOYMENT_MEDIA_BUDGET_CENTS,
      DEPLOYMENT_INGEST_BUDGET_CENTS,
    ]) {
      expect(serialized).not.toContain(String(ceiling));
    }
  });

  test("a rail whose window rolled overnight shows today's allowance, not yesterday's zero", async () => {
    const t = harness();
    const { tenantId, as } = await signIn(t);

    // Spend the whole day, two days ago.
    vi.useFakeTimers();
    const twoDaysAgo = Date.now() - 2 * DAY_MS;
    vi.setSystemTime(twoDaysAgo);
    await t.run((ctx) =>
      rateLimiter.limit(ctx, "dailySpendCents", {
        key: tenantId,
        count: DAILY_BUDGET_CENTS,
        reserve: true,
      }),
    );
    vi.useRealTimers();

    const now = Date.now();
    const result = await as.query(api.finance.summary, {
      sinceMs: now - DAY_MS,
      untilMs: now,
      browserTimeZone: TZ,
    });

    // `getValue` reports the STORED value — 0 — because its own roll-forward passes `now = ts`.
    // Showing that would tell a tenant with a full allowance that they are out of budget.
    expect(result.rails[0]?.remainingCents).toBe(DAILY_BUDGET_CENTS);
    expect(result.rails[0]?.usedCents).toBe(0);
    // The reset instant is the CURRENT window's end, so it is still ahead of us.
    expect(result.rails[0]?.resetsAtMs).toBeGreaterThan(now);
    expect(result.rails[0]?.resetTimeZone).toBe("UTC");
  });

  test("no coverage row is unknown, a pre-coverage window says so, and a covered empty one is $0", async () => {
    const t = harness();
    const { tenantId, as } = await signIn(t);
    const now = Date.now();

    const unknown = await as.query(api.finance.summary, {
      sinceMs: now - DAY_MS,
      untilMs: now,
      browserTimeZone: TZ,
    });
    expect(unknown.coverageStartedAt).toBeNull();
    expect(unknown.tracked).toEqual({ coverage: "unknown", reason: "not-started" });

    await openCoverage(t, tenantId, now - 2 * 60 * 60 * 1000);

    const precedes = await as.query(api.finance.summary, {
      sinceMs: now - DAY_MS,
      untilMs: now,
      browserTimeZone: TZ,
    });
    // An uninstrumented stretch can never be backfilled, so it must never total to a confident $0.
    expect(precedes.tracked).toEqual({ coverage: "unknown", reason: "window-precedes-coverage" });

    const covered = await as.query(api.finance.summary, {
      sinceMs: now - 60 * 60 * 1000,
      untilMs: now,
      browserTimeZone: TZ,
    });
    expect(covered.tracked.coverage).toBe("covered");
    if (covered.tracked.coverage !== "covered") throw new Error("expected covered");
    // Covered with no events is a CONFIDENT nothing — the opposite lie from the one above.
    expect(covered.tracked.totals.actual).toEqual({
      phase: "actual",
      amountCents: 0,
      currency: "USD",
    });
  });

  test("mixed rails and phases: unlanded is per rail, and media's can never resolve", async () => {
    const t = harness();
    const { tenantId, as } = await signIn(t);
    const now = Date.now();
    const at = now - 30 * 60 * 1000;
    await openCoverage(t, tenantId, now - DAY_MS);

    // Ingest: reserved 900, refunded 400 → 500 still out.
    await insertEvent(t, {
      tenantId,
      rail: "ingest",
      phase: "reserved",
      amountCents: 900,
      correlationId: "f:folder1:1",
      createdAt: at,
    });
    await insertEvent(t, {
      tenantId,
      rail: "ingest",
      phase: "refunded",
      amountCents: 400,
      correlationId: "f:folder1:1",
      createdAt: at,
    });
    // Media: reserved a whole batch of 300, one line landed at 110 → 190 permanently over-reserved.
    await insertEvent(t, {
      tenantId,
      rail: "media",
      phase: "reserved",
      amountCents: 300,
      correlationId: "mediabatch:b1",
      createdAt: at,
    });
    await insertEvent(t, {
      tenantId,
      rail: "media",
      phase: "actual",
      amountCents: 110,
      correlationId: "mediabatch:b1:j1",
      createdAt: at,
    });
    await insertEvent(t, {
      tenantId,
      rail: "reasoning",
      phase: "actual",
      amountCents: 42,
      correlationId: "req:r1:prepare",
      createdAt: at,
    });

    const result = await as.query(api.finance.summary, {
      sinceMs: now - DAY_MS + 1,
      untilMs: now,
      browserTimeZone: TZ,
    });
    expect(result.tracked.coverage).toBe("covered");
    if (result.tracked.coverage !== "covered") throw new Error("expected covered");

    expect(result.tracked.byRail.ingest.unlanded.amountCents).toBe(500);
    expect(result.tracked.byRail.media.unlanded.amountCents).toBe(190);
    expect(result.tracked.byRail.reasoning.unlanded.amountCents).toBe(0);
    // The blended figure is the SUM of the per-rail ones. Re-deriving it from blended sums would
    // let ingest's 400c refund cancel media money that can never come back.
    expect(result.tracked.totals.unlanded.amountCents).toBe(690);
    expect(result.tracked.totals.actual.amountCents).toBe(152);

    // A page must be able to tell "in flight" from "gone", and this is the only fact that says so.
    expect(result.unlandedResolves).toEqual({ reasoning: true, ingest: true, media: false });
  });

  test("another tenant's movements never enter the window", async () => {
    const t = harness();
    const mine = await signIn(t);
    const theirs = await signIn(t);
    const now = Date.now();
    await openCoverage(t, mine.tenantId, now - DAY_MS);

    await insertEvent(t, {
      tenantId: theirs.tenantId,
      rail: "media",
      phase: "actual",
      amountCents: 777,
      correlationId: "mediabatch:foreign:j1",
      createdAt: now - 60_000,
    });

    const result = await mine.as.query(api.finance.summary, {
      sinceMs: now - DAY_MS + 1,
      untilMs: now,
      browserTimeZone: TZ,
    });
    if (result.tracked.coverage !== "covered") throw new Error("expected covered");
    expect(result.tracked.totals.actual.amountCents).toBe(0);
    // Anti-vacuity: the foreign row really is there and really is inside the window.
    expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toHaveLength(1);

    const ledger = await mine.as.query(api.finance.mediaLedger, {
      sinceMs: now - DAY_MS + 1,
      untilMs: now,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(ledger.items).toHaveLength(0);
  });

  test("a window longer than the reported month, or an inverted one, is refused", async () => {
    const t = harness();
    const { as } = await signIn(t);
    const now = Date.now();

    await expect(
      as.query(api.finance.summary, {
        sinceMs: now - 40 * DAY_MS,
        untilMs: now,
        browserTimeZone: TZ,
      }),
    ).rejects.toThrow(/maximum span/);
    await expect(
      as.query(api.finance.summary, { sinceMs: now, untilMs: now - DAY_MS, browserTimeZone: TZ }),
    ).rejects.toThrow(/before untilMs/);
    await expect(
      as.query(api.finance.summary, {
        sinceMs: now - DAY_MS,
        untilMs: now,
        browserTimeZone: "Nowhere/Nothing",
      }),
    ).rejects.toThrow(/IANA/);
  });
});

describe("finance.spendSeries — bucketed without inventing history", () => {
  test("buckets on UTC days, and a bucket that precedes coverage stays unknown", async () => {
    const t = harness();
    const { tenantId, as } = await signIn(t);

    // Anchor to a real UTC midnight so the bucket boundaries are checkable.
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const sinceMs = today - 2 * DAY_MS;
    const untilMs = today + DAY_MS - 1;
    // Coverage opens at the START of the middle day: the first bucket is genuinely unknown.
    await openCoverage(t, tenantId, today - DAY_MS);

    await insertEvent(t, {
      tenantId,
      rail: "reasoning",
      phase: "actual",
      amountCents: 33,
      correlationId: "req:day-2:prepare",
      createdAt: sinceMs + 5_000,
    });
    await insertEvent(t, {
      tenantId,
      rail: "media",
      phase: "actual",
      amountCents: 250,
      correlationId: "mediabatch:mid:j1",
      createdAt: today - DAY_MS + 5_000,
    });

    const series = await as.query(api.finance.spendSeries, {
      sinceMs,
      untilMs,
      browserTimeZone: TZ,
    });

    expect(series.buckets.map((bucket) => bucket.startMs)).toEqual([
      today - 2 * DAY_MS,
      today - DAY_MS,
      today,
    ]);
    // The first day's 33c is REAL money that landed before instrumentation. Reporting it would be
    // as dishonest as reporting a zero: the window is simply not one we can vouch for.
    expect(series.buckets[0]).toMatchObject({
      coverage: "unknown",
      reason: "window-precedes-coverage",
    });
    const middle = series.buckets[1];
    if (middle?.coverage !== "covered") throw new Error("expected the middle bucket covered");
    expect(middle.byRail.media.actual.amountCents).toBe(250);
    expect(middle.byRail.reasoning.actual.amountCents).toBe(0);
    expect(series.buckets[2]).toMatchObject({ coverage: "covered" });

    // Display timezone is resolved and labelled; it never reached the bucketing above.
    expect(series.window.timeZone).toBe(TZ);
    expect(series.window.timeZoneSource).toBe("browser-fallback");
  });
});

describe("finance.mediaLedger — bounded and tie-safe", () => {
  test("pages a timestamp tie exactly once and stops", async () => {
    const t = harness();
    const { tenantId, as } = await signIn(t);
    const now = Date.now();
    const tied = now - 60_000;
    for (let index = 0; index < 5; index += 1) {
      await insertEvent(t, {
        tenantId,
        rail: "media",
        phase: "actual",
        amountCents: 10 + index,
        // Every line of one batch shares a createdAt; the id is what separates them.
        correlationId: `mediabatch:tie:j${index}`,
        createdAt: tied,
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const result: { items: { correlationId: string }[]; nextCursor: string | null } =
        await as.query(api.finance.mediaLedger, {
          sinceMs: now - DAY_MS,
          untilMs: now,
          paginationOpts: { numItems: 2, cursor },
        });
      seen.push(...result.items.map((item) => item.correlationId));
      cursor = result.nextCursor;
      if (cursor === null) break;
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  test("returns only the media rail, marks a truncated page partial, and refuses a bad window", async () => {
    const t = harness();
    const { tenantId, as } = await signIn(t);
    const now = Date.now();

    await insertEvent(t, {
      tenantId,
      rail: "media",
      phase: "reserved",
      amountCents: 300,
      correlationId: "mediabatch:b1",
      createdAt: now - 120_000,
      kind: "video",
    });
    await insertEvent(t, {
      tenantId,
      rail: "media",
      phase: "actual",
      amountCents: 84,
      correlationId: "mediabatch:b1:j1",
      createdAt: now - 60_000,
      kind: "video",
    });
    await insertEvent(t, {
      tenantId,
      rail: "reasoning",
      phase: "actual",
      amountCents: 5,
      correlationId: "req:r1:prepare",
      createdAt: now - 60_000,
    });

    const firstPage = await as.query(api.finance.mediaLedger, {
      sinceMs: now - DAY_MS,
      untilMs: now,
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(firstPage.items).toHaveLength(1);
    // Newest first.
    expect(firstPage.items[0]).toMatchObject({ phase: "actual", amountCents: 84, currency: "USD" });
    expect(firstPage.bound.partial).toBe(true);
    expect(firstPage.bound.partialReason).toBe("row-cap");
    expect(firstPage.unlandedResolves).toBe(false);

    const whole = await as.query(api.finance.mediaLedger, {
      sinceMs: now - DAY_MS,
      untilMs: now,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(whole.items).toHaveLength(2);
    expect(whole.bound.partial).toBe(false);

    await expect(
      as.query(api.finance.mediaLedger, {
        sinceMs: now,
        untilMs: now,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/INVALID_WINDOW/);
  });
});

describe("finance owner controls — the server is the boundary", () => {
  const configRow = (t: T) => t.run((ctx) => ctx.db.query("guardrailConfig").first());
  const auditRows = (t: T) => t.run((ctx) => ctx.db.query("audit").collect());

  test("a non-owner is rejected directly, not merely denied a button", async () => {
    const t = harness();
    const { as } = await signIn(t, { owner: false });

    await expect(as.query(api.finance.globalRails, {})).rejects.toThrow(/OWNER_REQUIRED/);
    await expect(as.query(api.finance.controls, {})).rejects.toThrow(/OWNER_REQUIRED/);
    await expect(as.mutation(api.finance.setMasterKillSwitch, { on: true })).rejects.toThrow(
      /OWNER_REQUIRED/,
    );
    await expect(as.mutation(api.finance.setMediaKillSwitch, { on: true })).rejects.toThrow(
      /OWNER_REQUIRED/,
    );
    await expect(as.mutation(api.finance.setPerRequestBudget, { budgetUsd: 1 })).rejects.toThrow(
      /OWNER_REQUIRED/,
    );

    // Anti-vacuity: the refusals wrote nothing, so a later green cannot come from a missing row.
    expect(await configRow(t)).toBeNull();
    expect(await auditRows(t)).toHaveLength(0);

    await expect(t.query(api.finance.globalRails, {})).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(t.mutation(api.finance.setMasterKillSwitch, { on: true })).rejects.toThrow(
      /UNAUTHENTICATED/,
    );
  });

  test("global rails are three separate ceilings, read on their own", async () => {
    const t = harness();
    const { as } = await signIn(t, { owner: true });

    await t.run((ctx) =>
      rateLimiter.limit(ctx, "deploymentMediaSpendCents", { count: 2_500, reserve: true }),
    );

    const { rails } = await as.query(api.finance.globalRails, {});
    expect(rails.map((rail) => rail.capCents)).toEqual([
      DEPLOYMENT_BUDGET_CENTS,
      DEPLOYMENT_MEDIA_BUDGET_CENTS,
      DEPLOYMENT_INGEST_BUDGET_CENTS,
    ]);
    // Draining one rail must not move the other two — they are separate money.
    expect(rails[0]?.remainingCents).toBe(DEPLOYMENT_BUDGET_CENTS);
    expect(rails[1]?.remainingCents).toBe(DEPLOYMENT_MEDIA_BUDGET_CENTS - 2_500);
    expect(rails[2]?.remainingCents).toBe(DEPLOYMENT_INGEST_BUDGET_CENTS);
  });

  test("controls read the same default-on-read state the guard enforces", async () => {
    const t = harness();
    const { as } = await signIn(t, { owner: true });

    const before = await as.query(api.finance.controls, {});
    expect(before).toMatchObject({
      masterKillSwitch: { on: false, requiresConfirmation: true },
      mediaKillSwitch: { on: false, requiresConfirmation: true },
      budgetUsdPerRequest: { usd: 0.05, requiresConfirmation: true },
      updatedAt: null,
      stored: false,
    });
    expect(before.budgetUsdPerRequest.maxUsd).toBe(DAILY_BUDGET_CENTS / 100);

    expect(await as.mutation(api.finance.setMediaKillSwitch, { on: true })).toEqual({
      changed: true,
      on: true,
    });

    const after = await as.query(api.finance.controls, {});
    // The two switches are INDEPENDENT: pausing paid generation must not pause the email cockpit.
    expect(after.mediaKillSwitch.on).toBe(true);
    expect(after.masterKillSwitch.on).toBe(false);
    expect(after.stored).toBe(true);
    expect(after.updatedAt).toBeGreaterThan(0);
    // The insert branch must write EVERY field, not just the one that was flipped.
    expect(await configRow(t)).toMatchObject({
      killSwitch: false,
      mediaKillSwitch: true,
      budgetUsdPerRequest: 0.05,
    });
  });

  test("the per-request budget refuses anything outside its range and normalizes what it takes", async () => {
    const t = harness();
    const { as } = await signIn(t, { owner: true });

    for (const budgetUsd of [Number.NaN, 0, -1, DAILY_BUDGET_CENTS / 100 + 0.01, 1e9]) {
      await expect(as.mutation(api.finance.setPerRequestBudget, { budgetUsd })).rejects.toThrow();
    }
    // Anti-vacuity: five refusals wrote nothing at all.
    expect(await configRow(t)).toBeNull();

    expect(await as.mutation(api.finance.setPerRequestBudget, { budgetUsd: 0.1234 })).toEqual({
      changed: true,
      budgetUsd: 0.123,
    });
    // Stored and returned must be the SAME number, or the owner edits a value they never saw.
    expect((await configRow(t))?.budgetUsdPerRequest).toBe(0.123);
    expect((await as.query(api.finance.controls, {})).budgetUsdPerRequest.usd).toBe(0.123);
  });

  test("every accepted change writes exactly one safe audit row; a no-op writes none", async () => {
    const t = harness();
    const { tenantId, as } = await signIn(t, { owner: true });

    expect(await as.mutation(api.finance.setMasterKillSwitch, { on: true })).toEqual({
      changed: true,
      on: true,
    });
    // Re-flipping to the value already stored is not a transition; an event for it would make the
    // log claim the deployment changed at an instant when it did not.
    expect(await as.mutation(api.finance.setMasterKillSwitch, { on: true })).toEqual({
      changed: false,
      on: true,
    });
    await as.mutation(api.finance.setPerRequestBudget, { budgetUsd: 0.02 });

    const rows = (await auditRows(t)).filter((row) => row.eventType === "finance.control.changed");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.payload)).toEqual([
      { control: "master_kill_switch", from: false, to: true },
      { control: "per_request_budget_usd", from: 0.05, to: 0.02 },
    ]);
    // CLAUDE.md §4: booleans, numbers and a code-owned control name — nothing identifying.
    for (const row of rows) {
      expect(Object.keys(row.payload).sort()).toEqual(["control", "from", "to"]);
      expect(row.actor).toBe("owner");
      expect(row.tenantId).toBe(tenantId);
    }
  });
});
