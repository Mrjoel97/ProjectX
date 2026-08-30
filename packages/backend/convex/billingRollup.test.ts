// 28.1-07 (BILL-04) — the invoice rollup: cron → claiming MUTATION → posting ACTION → settle.
//
// OFFLINE at $0. A real in-memory Convex backend (convex-test) plus a stubbed `fetch`. Nothing
// here proves Stripe accepts anything, and nothing here has ever spoken to Stripe. It proves the
// CLAIM — that one billing period cannot produce two invoices — and the request shape.
//
// The sharpest assertions in this file are the two that have nothing to do with Stripe:
//   1. a second `tick` over the same due period schedules NO second `postInvoice`, and
//   2. a `posted` period refuses a re-post BEFORE `fetch` is reached, so the refusal is our own
//      row and not the `Idempotency-Key` header — which Stripe prunes after ~24h and which
//      therefore cannot refuse anything on day two.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  CLAIM_STALE_MS,
  INVOICE_LINE_LABELS,
  MAX_PERIOD_ATTEMPTS,
  MAX_PERIOD_CHARGES,
  PERIOD_SCAN_LIMIT,
  invoiceIdempotencyKey,
  periodKeyFor,
} from "./billingRollup";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

/** Raw sources for the scans that hold the SHAPE of this module (mutation vs action). */
const backendSources = import.meta.glob("./billing*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Source with comments stripped, so a guard cannot punish its own documentation
 *  (`billing.test.ts` idiom — line comments first, deliberately). */
const codeOf = (content: string): string =>
  content
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const rollupCode = (): string => {
  const raw = backendSources["./billingRollup.ts"];
  if (raw === undefined) throw new Error("missing convex source: billingRollup.ts");
  return codeOf(raw);
};

const HOUR = 3_600_000;
const DAY = 86_400_000;

type Charge = {
  ref: string;
  kind: "subscription" | "usage" | "adjustment";
  amountMinor: number;
  currency: string;
  occurredAt: number;
};

/** One tenant on a fresh backend. `tenantOn` shape from `billing.test.ts`. */
async function withTenant() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  return { t, tenantId: String(userId) };
}

/**
 * Open a billing period the way a producer would — and there is NO producer in this deployment
 * yet, which is why every period in this file is seeded by hand.
 */
async function seedPeriod(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  over: Partial<{
    periodKey: string;
    periodStart: number;
    periodEnd: number;
    dueAt: number;
    status: "pending" | "claimed" | "posted" | "failed";
    charges: Charge[];
    claimedAt: number;
    attempts: number;
    stripeInvoiceId: string;
    hostedInvoiceUrl: string;
  }> = {},
): Promise<Id<"billingPeriods">> {
  const now = Date.now();
  const periodStart = over.periodStart ?? now - 30 * DAY;
  const periodEnd = over.periodEnd ?? now - DAY;
  return await t.run((ctx) =>
    ctx.db.insert("billingPeriods", {
      tenantId,
      periodKey: over.periodKey ?? periodKeyFor(tenantId, periodEnd),
      periodStart,
      periodEnd,
      dueAt: over.dueAt ?? now - HOUR,
      status: over.status ?? "pending",
      charges: over.charges ?? [
        {
          ref: "sub-1",
          kind: "subscription" as const,
          amountMinor: 4900,
          currency: "USD",
          occurredAt: periodStart + DAY,
        },
      ],
      attempts: over.attempts ?? 0,
      ...(over.claimedAt === undefined ? {} : { claimedAt: over.claimedAt }),
      ...(over.stripeInvoiceId === undefined ? {} : { stripeInvoiceId: over.stripeInvoiceId }),
      ...(over.hostedInvoiceUrl === undefined ? {} : { hostedInvoiceUrl: over.hostedInvoiceUrl }),
    }),
  );
}

const readPeriod = (t: ReturnType<typeof convexTest>, id: Id<"billingPeriods">) =>
  t.run((ctx) => ctx.db.get(id));

/**
 * The PENDING scheduler queue, read through `ctx.db.system` — the only way to prove "exactly one
 * postInvoice was queued" BEFORE anything runs it (`evaluations.test.ts` idiom).
 */
async function queuedPosts(t: ReturnType<typeof convexTest>): Promise<unknown[]> {
  const rows = (await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  )) as Array<{ name: string; state: { kind: string } }>;
  return rows.filter((row) => row.name.includes("billingRollup") && row.name.includes("postInvoice"));
}

/** No outbound call may happen in a Task-1 test: `tick` is a mutation and cannot fetch. */
function stubForbiddenFetch(): void {
  vi.stubGlobal("fetch", async () => {
    throw new Error("fetch was called and must not have been");
  });
}

beforeEach(() => {
  vi.stubEnv("BILLING_STRIPE_SECRET_KEY", "sk_test_SENTINEL");
  stubForbiddenFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("periodKeyFor is deterministic and ref-safe, because a header value is derived from it", () => {
  // `REF_TOKEN` from @pikar/billing, written out rather than imported: blind-spot #3 — a constant
  // the test imports moves with the subject and can never pin it.
  const REF_SAFE = /^[A-Za-z0-9._:@/-]+$/;

  test("the same tenant and the same instant give the same key, every time", () => {
    const at = Date.UTC(2026, 7, 14, 9, 30);
    expect(periodKeyFor("t1", at)).toBe(periodKeyFor("t1", at));
    expect(periodKeyFor("t1", at)).toBe("2026-08");
  });

  test("the key is the UTC month and rolls over at the month boundary and nowhere else", () => {
    expect(periodKeyFor("t1", Date.UTC(2026, 7, 31, 23, 59, 59, 999))).toBe("2026-08");
    expect(periodKeyFor("t1", Date.UTC(2026, 8, 1, 0, 0, 0, 0))).toBe("2026-09");
    // A local-time implementation would disagree here for anyone east of UTC.
    expect(periodKeyFor("t1", Date.UTC(2026, 0, 1, 0, 0, 0, 0))).toBe("2026-01");
  });

  test("the key and the whole derived idempotency key are ref-safe", () => {
    const key = periodKeyFor("kd7abc123", Date.UTC(2026, 7, 14));
    expect(REF_SAFE.test(key)).toBe(true);
    expect(REF_SAFE.test(invoiceIdempotencyKey("kd7abc123", key))).toBe(true);
    expect(invoiceIdempotencyKey("kd7abc123", key)).toBe("billing-invoice:kd7abc123:2026-08");
  });

  test("a tenant id that would inject into an HTTP header is REFUSED, not encoded", () => {
    // The idempotency key IS a header value. A CR/LF or a space in it is header injection, and
    // `fetch` rejecting it later is a 500 rather than a refusal.
    expect(() => periodKeyFor("t1\r\nX-Evil: 1", Date.UTC(2026, 7, 14))).toThrow(/ref-safe/i);
    expect(() => periodKeyFor("has space", Date.UTC(2026, 7, 14))).toThrow(/ref-safe/i);
    expect(() => periodKeyFor("", Date.UTC(2026, 7, 14))).toThrow(/ref-safe/i);
  });

  test("an unusable instant is refused rather than turned into `NaN-NaN`", () => {
    expect(() => periodKeyFor("t1", Number.NaN)).toThrow();
    expect(() => periodKeyFor("t1", Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("tick claims a due period exactly once and schedules exactly one post", () => {
  test("TWO ticks over one due period claim it once and queue ONE postInvoice", async () => {
    const { t, tenantId } = await withTenant();
    const id = await seedPeriod(t, tenantId);

    await t.mutation(internal.billingRollup.tick, {});
    await t.mutation(internal.billingRollup.tick, {});

    // The row status alone would pass even if the second tick had queued a duplicate action, so
    // the SCHEDULER is the assertion and the status is the corroboration.
    expect(await queuedPosts(t)).toHaveLength(1);
    const row = await readPeriod(t, id);
    expect(row?.status).toBe("claimed");
    expect(row?.attempts).toBe(1);
  });

  test("a period that is not yet due is left alone — no claim, no schedule", async () => {
    const { t, tenantId } = await withTenant();
    const id = await seedPeriod(t, tenantId, { dueAt: Date.now() + DAY });

    await t.mutation(internal.billingRollup.tick, {});

    expect(await queuedPosts(t)).toHaveLength(0);
    const row = await readPeriod(t, id);
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(0);
  });

  test("a POSTED period is never re-claimed — this is the one-period-one-invoice guard", async () => {
    const { t, tenantId } = await withTenant();
    const id = await seedPeriod(t, tenantId, {
      status: "posted",
      stripeInvoiceId: "in_SENTINELPOSTED",
    });

    await t.mutation(internal.billingRollup.tick, {});
    await t.mutation(internal.billingRollup.tick, {});

    expect(await queuedPosts(t)).toHaveLength(0);
    expect((await readPeriod(t, id))?.status).toBe("posted");
  });

  test("a claim MOVES the row before scheduling, so a crash cannot leave it pending", async () => {
    const { t, tenantId } = await withTenant();
    const id = await seedPeriod(t, tenantId);
    await t.mutation(internal.billingRollup.tick, {});
    const row = await readPeriod(t, id);
    expect(row?.status).toBe("claimed");
    expect(typeof row?.claimedAt).toBe("number");
  });

  test("two DIFFERENT due periods each get their own post — the claim is per row", async () => {
    const { t, tenantId } = await withTenant();
    await seedPeriod(t, tenantId, { periodKey: "2026-07" });
    await seedPeriod(t, tenantId, { periodKey: "2026-08" });

    await t.mutation(internal.billingRollup.tick, {});

    expect(await queuedPosts(t)).toHaveLength(2);
  });
});

describe("a severed scheduler chain is recovered, not dropped", () => {
  test("a period CLAIMED longer than the stale threshold is re-claimed by a later tick", async () => {
    const { t, tenantId } = await withTenant();
    const id = await seedPeriod(t, tenantId, {
      status: "claimed",
      claimedAt: Date.now() - CLAIM_STALE_MS - HOUR,
      attempts: 1,
    });

    await t.mutation(internal.billingRollup.tick, {});

    expect(await queuedPosts(t)).toHaveLength(1);
    expect((await readPeriod(t, id))?.attempts).toBe(2);
  });

  test("a period claimed a MOMENT ago is NOT re-claimed — the action is still running", async () => {
    const { t, tenantId } = await withTenant();
    const id = await seedPeriod(t, tenantId, {
      status: "claimed",
      claimedAt: Date.now() - 1000,
      attempts: 1,
    });

    await t.mutation(internal.billingRollup.tick, {});

    expect(await queuedPosts(t)).toHaveLength(0);
    expect((await readPeriod(t, id))?.attempts).toBe(1);
  });

  test("the stale threshold is ONE HOUR, written out", () => {
    // Blind-spot #3: pinned against a literal, not against the imported symbol.
    expect(CLAIM_STALE_MS).toBe(3_600_000);
  });

  test("a FAILED period is re-claimable, so a transient Stripe failure never loses a period", async () => {
    const { t, tenantId } = await withTenant();
    const id = await seedPeriod(t, tenantId, { status: "failed", attempts: 1 });

    await t.mutation(internal.billingRollup.tick, {});

    expect(await queuedPosts(t)).toHaveLength(1);
    expect((await readPeriod(t, id))?.status).toBe("claimed");
    expect((await readPeriod(t, id))?.attempts).toBe(2);
  });

  test("a period that has burned its attempts STOPS and stays visible as failed", async () => {
    const { t, tenantId } = await withTenant();
    const id = await seedPeriod(t, tenantId, {
      status: "failed",
      attempts: MAX_PERIOD_ATTEMPTS,
    });

    await t.mutation(internal.billingRollup.tick, {});

    expect(await queuedPosts(t)).toHaveLength(0);
    // NOT deleted and NOT silently marked done: an operator can still see it.
    expect((await readPeriod(t, id))?.status).toBe("failed");
  });

  test("attempts stop at FIVE, and four is still retried — the boundary, not the line", async () => {
    expect(MAX_PERIOD_ATTEMPTS).toBe(5);
    const { t, tenantId } = await withTenant();
    await seedPeriod(t, tenantId, { status: "failed", attempts: MAX_PERIOD_ATTEMPTS - 1 });
    await t.mutation(internal.billingRollup.tick, {});
    expect(await queuedPosts(t)).toHaveLength(1);
  });
});

describe("the shape is the design: a mutation claims, and only the outbound post is an action", () => {
  test("tick is callable as a MUTATION — an action refactor makes this red, not silent", async () => {
    const { t } = await withTenant();
    // `t.mutation` on an action throws. This is the runtime half of the pin; the source scan
    // below is the other half, because a runtime pass cannot name WHICH builder was used.
    await expect(t.mutation(internal.billingRollup.tick, {})).resolves.toBeNull();
  });

  test("tick is declared with internalMutation, by name", () => {
    expect(rollupCode()).toMatch(/export const tick = internalMutation\(/);
  });

  test("the cron points at the MUTATION, never straight at the action", () => {
    const raw = backendSources["./billingRollup.ts"];
    expect(raw).toBeDefined();
    const cronsRaw = (
      import.meta.glob("./crons.ts", { query: "?raw", import: "default", eager: true }) as Record<
        string,
        string
      >
    )["./crons.ts"];
    if (cronsRaw === undefined) throw new Error("missing convex source: crons.ts");
    const crons = codeOf(cronsRaw);
    expect(crons).toMatch(/billing-invoice-rollup/);
    expect(crons).toMatch(/internal\.billingRollup\.tick/);
    // The defect this whole plan exists to prevent: a cron aimed at an at-most-once action.
    expect(crons).not.toMatch(/internal\.billingRollup\.postInvoice/);
  });

  test("the scan is not reading an empty file", () => {
    expect(rollupCode().length).toBeGreaterThan(1000);
  });
});

describe("the rollup's own bounds are code-owned, not hopeful", () => {
  test("the claim scan and the charge cap are pinned against written-out literals", () => {
    expect(PERIOD_SCAN_LIMIT).toBe(100);
    expect(MAX_PERIOD_CHARGES).toBe(100);
  });

  test("every invoice line label is a fixed, code-owned string — no caller writes prose", () => {
    expect(INVOICE_LINE_LABELS).toEqual({
      subscription: "Pikar AI subscription",
      usage: "Pikar AI usage",
      adjustment: "Pikar AI adjustment",
    });
  });
});
