// BILL-03 — the billing book of record, proven at the seam a caller actually uses.
//
// `billingEvents` is a SEPARATE book from `spendEvents` by owner decision (2026-08-28): money-in
// must never be summed into a `Record<SpendRail, SpendTotals>` that Phase 26 Finance renders as
// what Pikar SPENDS. The proof that the spend plane is untouched lives in `billing.test.ts`.
import { UNRECONCILED_RETURN_DAYS, UNRECONCILED_SWEEP_DAYS } from "@pikar/billing/reconcile";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import {
  BILLING_EVENT_PAGE_LIMIT,
  billingCoverageFor,
  ensureBillingCoverage,
  listBillingEventsFor,
  recordBillingMovement,
} from "./billingLedger";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const source = import.meta.glob("./billingLedger.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const TENANT = "tenant_a";
const OTHER = "tenant_b";

function mv(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    phase: "actual" as const,
    amountMinor: 4900,
    currency: "USD",
    correlationId: "billing/in_1",
    kind: "invoice-paid-card",
    createdAt: 10_000,
    ...overrides,
  };
}

const rows = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => await ctx.db.query("billingEvents").collect());

describe("the billing ledger's append path", () => {
  test("a replayed (tenant, correlation, phase) inserts ONCE and ignores the replayed amount", async () => {
    const t = convexTest(schema, modules);

    const first = await t.run((ctx) => recordBillingMovement(ctx, mv()));
    const replay = await t.run((ctx) => recordBillingMovement(ctx, mv()));
    // A retry reporting a DIFFERENT number is an upstream bug; letting it through would rewrite
    // recorded money in a table that cannot be corrected.
    const drifted = await t.run((ctx) => recordBillingMovement(ctx, mv({ amountMinor: 999_999 })));

    expect(replay).toBe(first);
    expect(drifted).toBe(first);
    const stored = await rows(t);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.amountMinor).toBe(4900);
  });

  test("a reservation and its later actual SHARE one correlation and BOTH persist", async () => {
    const t = convexTest(schema, modules);

    // This is the exact bug the phase key prevents: a correlation-only guard would swallow the
    // `actual` as a duplicate of the `reserved`, and bank-transfer money would never be collected.
    await t.run((ctx) =>
      recordBillingMovement(ctx, mv({ phase: "reserved", kind: "cash-funded" })),
    );
    await t.run((ctx) => recordBillingMovement(ctx, mv({ phase: "actual", kind: "cash-applied" })));

    const stored = await rows(t);
    expect(stored).toHaveLength(2);
    expect(stored.map((r) => r.phase).sort()).toEqual(["actual", "reserved"]);
  });

  test("the same correlation under a DIFFERENT tenant is a different row", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => recordBillingMovement(ctx, mv()));
    await t.run((ctx) => recordBillingMovement(ctx, mv({ tenantId: OTHER })));
    expect(await rows(t)).toHaveLength(2);
  });

  test("a non-positive or non-safe-integer amount is REFUSED, and leaves no coverage behind", async () => {
    const t = convexTest(schema, modules);

    for (const amountMinor of [0, -1, 12.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      await expect(
        t.run((ctx) => recordBillingMovement(ctx, mv({ amountMinor }))),
      ).rejects.toThrow();
    }
    expect(await rows(t)).toHaveLength(0);
    // Validation runs BEFORE coverage is opened, so a refused movement leaves NOTHING behind —
    // an opened coverage would turn "we never watched" into a false confident zero.
    expect(await t.run((ctx) => billingCoverageFor(ctx, TENANT))).toBeNull();
  });

  test("a correlationId or kind outside the ref-safe token set is REFUSED", async () => {
    const t = convexTest(schema, modules);
    for (const correlationId of [
      "billing/in 1",
      "Paid the invoice for Acme",
      "",
      "a".repeat(200),
    ]) {
      await expect(
        t.run((ctx) => recordBillingMovement(ctx, mv({ correlationId }))),
      ).rejects.toThrow();
    }
    await expect(
      t.run((ctx) => recordBillingMovement(ctx, mv({ kind: "card paid" }))),
    ).rejects.toThrow();
    expect(await rows(t)).toHaveLength(0);
  });

  test("an unusable currency is REFUSED rather than defaulted to USD", async () => {
    const t = convexTest(schema, modules);
    for (const currency of ["", "dollars", "US"]) {
      await expect(t.run((ctx) => recordBillingMovement(ctx, mv({ currency })))).rejects.toThrow();
    }
    expect(await rows(t)).toHaveLength(0);
  });

  test("currency is canonicalised, so Stripe's lowercase `usd` is not a second currency", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => recordBillingMovement(ctx, mv({ currency: "usd" })));
    const [row] = await rows(t);
    expect(row?.currency).toBe("USD");
  });

  test("a currency MISMATCH inside one correlation is REFUSED rather than summed", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => recordBillingMovement(ctx, mv({ phase: "estimated", currency: "USD" })));
    await expect(
      t.run((ctx) => recordBillingMovement(ctx, mv({ phase: "actual", currency: "EUR" }))),
    ).rejects.toThrow();
    const stored = await rows(t);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.currency).toBe("USD");
  });
});

describe("billing coverage is UNKNOWN, never zero", () => {
  test("a tenant with no coverage reads null — and null is not a number a caller can add up", async () => {
    const t = convexTest(schema, modules);
    const coverage = await t.run((ctx) => billingCoverageFor(ctx, TENANT));

    expect(coverage).toBeNull();
    // The whole point of the null: a caller must not be able to mistake "we never watched" for
    // "watched since the epoch" or for a zero. Both of those are confident lies about revenue.
    expect(coverage).not.toBe(0);
    expect(typeof coverage).not.toBe("number");
  });

  test("ensureBillingCoverage is insert-if-absent and never moves the start forward", async () => {
    const t = convexTest(schema, modules);
    const first = await t.run((ctx) => ensureBillingCoverage(ctx, TENANT, 5_000));
    const second = await t.run((ctx) => ensureBillingCoverage(ctx, TENANT, 9_999));

    expect(first).toBe(5_000);
    expect(second).toBe(5_000);
    expect(await t.run((ctx) => ctx.db.query("billingCoverage").collect())).toHaveLength(1);
    expect(await t.run((ctx) => billingCoverageFor(ctx, TENANT))).toBe(5_000);
    // Coverage with zero events is a KNOWN empty history; no coverage at all stays unknown.
    expect(await t.run((ctx) => billingCoverageFor(ctx, OTHER))).toBeNull();
  });

  test("recording a movement opens coverage at that movement's time", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => recordBillingMovement(ctx, mv({ createdAt: 7_777 })));
    expect(await t.run((ctx) => billingCoverageFor(ctx, TENANT))).toBe(7_777);
  });
});

describe("reads are bounded", () => {
  // A constant the test IMPORTS cannot be pinned by mutating it — the oracle would move with the
  // subject. The literal below is the pin.
  test("BILLING_EVENT_PAGE_LIMIT is 500", () => {
    expect(BILLING_EVENT_PAGE_LIMIT).toBe(500);
  });

  // Same discipline for the two clocks the unapplied-funds surface is read against.
  test("Stripe's unreconciled-funds clock is 75 days to return and 90 to sweep", () => {
    expect(UNRECONCILED_RETURN_DAYS).toBe(75);
    expect(UNRECONCILED_SWEEP_DAYS).toBe(90);
    expect(UNRECONCILED_RETURN_DAYS).toBeLessThan(UNRECONCILED_SWEEP_DAYS);
  });

  test("the window is half-open [since, until) — the `until` row is excluded", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const createdAt of [100, 200, 300]) {
        await recordBillingMovement(
          ctx,
          mv({ createdAt, correlationId: `billing/in_${createdAt}` }),
        );
      }
    });

    const inside = await t.run((ctx) =>
      listBillingEventsFor(ctx, { tenantId: TENANT, sinceMs: 100, untilMs: 300 }),
    );
    expect(inside.map((r) => r.createdAt)).toEqual([100, 200]);
  });

  test("a request for MORE than the cap returns the cap, never everything", async () => {
    const t = convexTest(schema, modules);
    const over = BILLING_EVENT_PAGE_LIMIT + 3;
    await t.run(async (ctx) => {
      for (let i = 0; i < over; i++) {
        await recordBillingMovement(
          ctx,
          mv({ createdAt: 1_000 + i, correlationId: `billing/x_${i}` }),
        );
      }
    });

    const asked = await t.run((ctx) =>
      listBillingEventsFor(ctx, {
        tenantId: TENANT,
        sinceMs: 0,
        untilMs: 1_000_000,
        limit: 10_000,
      }),
    );
    expect(asked).toHaveLength(BILLING_EVENT_PAGE_LIMIT);
    expect(await rows(t)).toHaveLength(over);
  });

  test("the read is tenant-scoped — another tenant's rows are not in the window", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => recordBillingMovement(ctx, mv()));
    await t.run((ctx) => recordBillingMovement(ctx, mv({ tenantId: OTHER })));
    const mine = await t.run((ctx) =>
      listBillingEventsFor(ctx, { tenantId: TENANT, sinceMs: 0, untilMs: 1_000_000 }),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.tenantId).toBe(TENANT);
  });
});

// `billingEvents` and `billingCoverage` are `audit_immutable` in `packages/core/src/tenantData.ts`.
// That category carries TWO obligations, and this is the first: the writer must be INSERT-ONLY
// (CLAUDE.md §3), or the classification is a lie. Same scan `spendLedger.test.ts` runs.
describe("the billing ledger is append-only", () => {
  test("the module contains no way to mutate a recorded movement", () => {
    const src = Object.values(source).join("\n");
    // A floor, not a truthiness check: an unresolved glob joins to "" and every negative
    // assertion below then passes over nothing.
    expect(src.length).toBeGreaterThan(500);
    // A BARE call name, matching `spendLedger.test.ts:193` — which is what the comment above
    // always claimed this was. The previous pattern asked for a table-name string as `patch`'s
    // first argument; `ctx.db.patch(id, fields)` never takes one, so it had zero reachable
    // matches and discharged an `audit_immutable` obligation by being unable to fail (28.1-11
    // #11). This module inserts and reads. It has no legitimate patch.
    expect(src).not.toMatch(/db\.patch\(/);
    expect(src).not.toMatch(/db\.replace\(/);
    expect(src).not.toMatch(/db\.delete\(/);
    expect(src).toMatch(/db\.insert\(\s*["']billingEvents["']/);
  });
});
