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

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Task 2 — postInvoice: accumulate the items, roll ONE document, settle the claim.
//
// Against a stubbed `fetch` that captures every Request. The order below is INVOICE FIRST, then
// the items attached to it by id, then finalize — see the deviation note in `billingRollup.ts`.
// Items-first is unbounded by construction: `POST /v1/invoices` sweeps in every unattached
// pending item the customer has, which is the "bill that swallows next month" defect.
// ────────────────────────────────────────────────────────────────────────────────────────────────

type Recorded = { url: string; body: string; headers: Record<string, string> };

let calls: Recorded[] = [];

const INVOICE_ID = "in_SENTINELINVOICE";
const HOSTED = "https://invoice.stripe.com/i/acct_SENTINEL/test_SENTINELHOSTED";

/** Stripe's replies, keyed by the path each call takes. */
function stubStripe(over: { finalize?: { status: number; body?: unknown } } = {}): void {
  calls = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
    });
    if (url.endsWith("/finalize")) {
      const reply = over.finalize ?? {
        status: 200,
        body: {
          id: INVOICE_ID,
          object: "invoice",
          status: "open",
          hosted_invoice_url: HOSTED,
          amount_due: 4900,
          currency: "usd",
        },
      };
      return new Response(JSON.stringify(reply.body ?? {}), {
        status: reply.status,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/v1/invoiceitems")) {
      return new Response(JSON.stringify({ id: "ii_SENTINELITEM", object: "invoiceitem" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // POST /v1/invoices — the draft. `customer_email` is here on purpose: it must not escape.
    return new Response(
      JSON.stringify({
        id: INVOICE_ID,
        object: "invoice",
        status: "draft",
        customer_email: "SENTINEL-BUYER@example.com",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

const byPath = (suffix: string) => calls.filter((c) => c.url.endsWith(suffix));
const form = (call: Recorded) => new URLSearchParams(call.body);
const keyOf = (call: Recorded) => call.headers["Idempotency-Key"];

/** Map a tenant to a Stripe customer, the way `billingWebhook.receiveAndApply` would. */
async function mapCustomer(t: ReturnType<typeof convexTest>, tenantId: string, cus: string) {
  await t.run((ctx) =>
    ctx.db.insert("billingCustomers", {
      tenantId,
      stripeCustomerId: cus,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

/** Claim the period and run the whole scheduled chain, as the cron would. */
async function rollup(t: ReturnType<typeof convexTest>) {
  await t.mutation(internal.billingRollup.tick, {});
  await t.finishInProgressScheduledFunctions();
}

describe("postInvoice rolls ONE bounded document and settles the claim", () => {
  test("the invoice is created FIRST with pending items EXCLUDED, then the items are attached", async () => {
    const { t, tenantId } = await withTenant();
    await mapCustomer(t, tenantId, "cus_SENTINEL");
    const id = await seedPeriod(t, tenantId);
    stubStripe();

    await rollup(t);

    // Exactly one invoice document, and it is the FIRST call.
    expect(byPath("/v1/invoices")).toHaveLength(1);
    expect(calls[0]?.url.endsWith("/v1/invoices")).toBe(true);
    const invoice = form(byPath("/v1/invoices")[0] as Recorded);
    expect(invoice.get("customer")).toBe("cus_SENTINEL");
    expect(invoice.get("collection_method")).toBe("charge_automatically");
    expect(invoice.get("auto_advance")).toBe("true");
    // THE WINDOW BOUND. Without this the document swallows every unattached pending item the
    // customer has — including the leftovers of a period that failed last month.
    expect(invoice.get("pending_invoice_items_behavior")).toBe("exclude");

    // One item, attached to THAT invoice by id, carrying the explicit period.
    const items = byPath("/v1/invoiceitems");
    expect(items).toHaveLength(1);
    const item = form(items[0] as Recorded);
    expect(item.get("invoice")).toBe(INVOICE_ID);
    expect(item.get("amount")).toBe("4900");
    expect(item.get("currency")).toBe("usd");
    expect(item.get("description")).toBe(INVOICE_LINE_LABELS.subscription);
    const row = await readPeriod(t, id);
    expect(item.get("period[start]")).toBe(String(Math.floor((row?.periodStart ?? 0) / 1000)));
    expect(item.get("period[end]")).toBe(String(Math.floor((row?.periodEnd ?? 0) / 1000)));

    // …and it is finalized, because a DRAFT invoice has no hosted page to pay on.
    expect(byPath(`/v1/invoices/${INVOICE_ID}/finalize`)).toHaveLength(1);
  });

  test("EVERY outbound POST carries an Idempotency-Key, and the invoice key is the derived one", async () => {
    const { t, tenantId } = await withTenant();
    await mapCustomer(t, tenantId, "cus_SENTINEL");
    const id = await seedPeriod(t, tenantId);
    stubStripe();

    await rollup(t);

    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) expect(keyOf(call)).toBeTruthy();
    const row = await readPeriod(t, id);
    expect(keyOf(byPath("/v1/invoices")[0] as Recorded)).toBe(
      `billing-invoice:${tenantId}:${row?.periodKey}`,
    );
    // Every key is distinct per call — a shared key would make Stripe replay the FIRST response
    // for the item and the finalize too.
    expect(new Set(calls.map(keyOf)).size).toBe(calls.length);
  });

  test("the SAME period posted twice sends the SAME key AND the same body", async () => {
    const { t, tenantId } = await withTenant();
    await mapCustomer(t, tenantId, "cus_SENTINEL");
    const id = await seedPeriod(t, tenantId);
    stubStripe();

    await rollup(t);
    const first = calls.map((c) => ({ url: c.url, body: c.body, key: keyOf(c) }));

    // The action died after the POST and before the settle: the row is `claimed` and stale.
    await t.run((ctx) =>
      ctx.db.patch(id, { status: "claimed", claimedAt: Date.now() - CLAIM_STALE_MS - HOUR }),
    );
    stubStripe();
    await rollup(t);
    const second = calls.map((c) => ({ url: c.url, body: c.body, key: keyOf(c) }));

    // Stripe ERRORS when one key is replayed with different parameters, so key and body must
    // derive from the same inputs. Asserted together, deliberately.
    expect(second).toEqual(first);
  });

  test("on success the period is posted with the invoice id and the hosted url, and nothing else", async () => {
    const { t, tenantId } = await withTenant();
    await mapCustomer(t, tenantId, "cus_SENTINEL");
    const id = await seedPeriod(t, tenantId);
    stubStripe();

    await rollup(t);

    const row = await readPeriod(t, id);
    expect(row?.status).toBe("posted");
    expect(row?.stripeInvoiceId).toBe(INVOICE_ID);
    expect(row?.hostedInvoiceUrl).toBe(HOSTED);
    // Stripe's amount_due, not our subtotal: Stripe Tax adds lines we never sent.
    expect(row?.amountMinor).toBe(4900);
    expect(row?.currency).toBe("USD");
    expect(typeof row?.postedAt).toBe("number");
    expect(row?.failureCode).toBeUndefined();
    // The buyer's email came back on the draft and must not have been written anywhere (§4).
    expect(JSON.stringify(row)).not.toMatch(/SENTINEL-BUYER/);
  });

  test("a posted period is never posted again — and the refusal is OUR ROW, before fetch", async () => {
    const { t, tenantId } = await withTenant();
    await mapCustomer(t, tenantId, "cus_SENTINEL");
    const id = await seedPeriod(t, tenantId);
    stubStripe();
    await rollup(t);
    expect((await readPeriod(t, id))?.status).toBe("posted");

    // THE 24-HOUR HOLE. Stripe prunes idempotency keys after ~24h and then generates a NEW
    // request, so the header cannot refuse this. A fresh stub with NO memory of the first key is
    // exactly that world — and the claim row is what still refuses.
    stubStripe();
    await t.action(internal.billingRollup.postInvoice, { periodId: id });

    expect(calls).toHaveLength(0);
    const row = await readPeriod(t, id);
    expect(row?.stripeInvoiceId).toBe(INVOICE_ID);
    expect(row?.status).toBe("posted");
  });

  test("settlePeriod itself refuses to settle a period that is not claimed", async () => {
    const { t, tenantId } = await withTenant();
    const id = await seedPeriod(t, tenantId, {
      status: "posted",
      stripeInvoiceId: "in_FIRSTANDONLY",
    });

    await t.mutation(internal.billingRollup.settlePeriod, {
      periodId: id,
      outcome: {
        ok: true,
        stripeInvoiceId: "in_SECONDONE",
        hostedInvoiceUrl: HOSTED,
        amountMinor: 9900,
        currency: "USD",
      },
    });

    const row = await readPeriod(t, id);
    expect(row?.stripeInvoiceId).toBe("in_FIRSTANDONLY");
    expect(row?.amountMinor).toBeUndefined();
  });
});

describe("a failure leaves the period re-claimable, never dropped and never half-posted", () => {
  test("a Stripe refusal marks the period failed with a CODE and no invoice id", async () => {
    const { t, tenantId } = await withTenant();
    await mapCustomer(t, tenantId, "cus_SENTINEL");
    const id = await seedPeriod(t, tenantId);
    stubStripe({ finalize: { status: 402, body: { error: { code: "card_declined" } } } });

    await rollup(t);

    const row = await readPeriod(t, id);
    expect(row?.status).toBe("failed");
    expect(row?.stripeInvoiceId).toBeUndefined();
    expect(row?.hostedInvoiceUrl).toBeUndefined();
    expect(row?.failureCode).toBe("card_declined");
    expect(row?.attempts).toBe(1);
  });

  test("…and the NEXT tick picks it up again, so a transient failure costs a day, not a period", async () => {
    const { t, tenantId } = await withTenant();
    await mapCustomer(t, tenantId, "cus_SENTINEL");
    const id = await seedPeriod(t, tenantId);
    stubStripe({ finalize: { status: 500 } });
    await rollup(t);
    expect((await readPeriod(t, id))?.status).toBe("failed");

    stubStripe();
    await rollup(t);

    const row = await readPeriod(t, id);
    expect(row?.status).toBe("posted");
    expect(row?.attempts).toBe(2);
  });

  test("a tenant with NO Stripe customer is refused before fetch, never auto-provisioned", async () => {
    const { t, tenantId } = await withTenant();
    const id = await seedPeriod(t, tenantId);
    stubStripe();

    await rollup(t);

    expect(calls).toHaveLength(0);
    const row = await readPeriod(t, id);
    expect(row?.status).toBe("failed");
    expect(row?.failureCode).toBe("no_stripe_customer");
  });

  test("a hosted url that is not a Stripe https origin is REFUSED, not stored", async () => {
    const { t, tenantId } = await withTenant();
    await mapCustomer(t, tenantId, "cus_SENTINEL");
    const id = await seedPeriod(t, tenantId);
    stubStripe({
      finalize: {
        status: 200,
        body: {
          id: INVOICE_ID,
          status: "open",
          hosted_invoice_url: "https://invoice.stripe.com.evil.example/i/pay",
          amount_due: 4900,
          currency: "usd",
        },
      },
    });

    await rollup(t);

    const row = await readPeriod(t, id);
    expect(row?.status).toBe("failed");
    expect(row?.hostedInvoiceUrl).toBeUndefined();
  });
});

describe("the document is bounded by the PERIOD, not by whatever is pending", () => {
  test("a charge that falls outside the period window is not put on the invoice", async () => {
    const { t, tenantId } = await withTenant();
    await mapCustomer(t, tenantId, "cus_SENTINEL");
    const now = Date.now();
    const periodStart = now - 30 * DAY;
    const periodEnd = now - DAY;
    await seedPeriod(t, tenantId, {
      periodStart,
      periodEnd,
      charges: [
        {
          ref: "in-window",
          kind: "usage",
          amountMinor: 700,
          currency: "USD",
          occurredAt: periodStart + DAY,
        },
        {
          ref: "next-month",
          kind: "usage",
          amountMinor: 999_999,
          currency: "USD",
          occurredAt: periodEnd + DAY,
        },
        {
          ref: "last-month",
          kind: "usage",
          amountMinor: 888_888,
          currency: "USD",
          occurredAt: periodStart - DAY,
        },
      ],
    });
    stubStripe();

    await rollup(t);

    const items = byPath("/v1/invoiceitems");
    expect(items).toHaveLength(1);
    expect(form(items[0] as Recorded).get("amount")).toBe("700");
    // The half-open window: `periodEnd` itself is the NEXT period's first instant.
    expect(calls.map((c) => c.body).join("|")).not.toMatch(/999999|888888/);
  });

  test("a period whose every charge is out of window is failed, not invoiced for nothing", async () => {
    const { t, tenantId } = await withTenant();
    await mapCustomer(t, tenantId, "cus_SENTINEL");
    const now = Date.now();
    const id = await seedPeriod(t, tenantId, {
      periodStart: now - 30 * DAY,
      periodEnd: now - DAY,
      charges: [{ ref: "late", kind: "usage", amountMinor: 700, currency: "USD", occurredAt: now }],
    });
    stubStripe();

    await rollup(t);

    expect(calls).toHaveLength(0);
    expect((await readPeriod(t, id))?.failureCode).toBe("no_charges_in_period");
  });

  test("two currencies in one period are REFUSED, never summed into an invented rate", async () => {
    const { t, tenantId } = await withTenant();
    await mapCustomer(t, tenantId, "cus_SENTINEL");
    const now = Date.now();
    const id = await seedPeriod(t, tenantId, {
      charges: [
        { ref: "a", kind: "usage", amountMinor: 100, currency: "USD", occurredAt: now - 2 * DAY },
        { ref: "b", kind: "usage", amountMinor: 100, currency: "EUR", occurredAt: now - 2 * DAY },
      ],
    });
    stubStripe();

    await rollup(t);

    expect(calls).toHaveLength(0);
    expect((await readPeriod(t, id))?.failureCode).toBe("mixed_currency");
  });

  test("a duplicate charge ref is refused — the per-item key would collide and drop a line", async () => {
    const { t, tenantId } = await withTenant();
    await mapCustomer(t, tenantId, "cus_SENTINEL");
    const now = Date.now();
    const id = await seedPeriod(t, tenantId, {
      charges: [
        { ref: "same", kind: "usage", amountMinor: 100, currency: "USD", occurredAt: now - 2 * DAY },
        { ref: "same", kind: "usage", amountMinor: 250, currency: "USD", occurredAt: now - 2 * DAY },
      ],
    });
    stubStripe();

    await rollup(t);

    expect(calls).toHaveLength(0);
    expect((await readPeriod(t, id))?.failureCode).toBe("duplicate_charge_ref");
  });

  test("a period with more charges than the cap is refused rather than partially billed", async () => {
    const { t, tenantId } = await withTenant();
    await mapCustomer(t, tenantId, "cus_SENTINEL");
    const now = Date.now();
    const charges: Charge[] = Array.from({ length: MAX_PERIOD_CHARGES + 1 }, (_, i) => ({
      ref: `usage-${i}`,
      kind: "usage" as const,
      amountMinor: 10,
      currency: "USD",
      occurredAt: now - 2 * DAY,
    }));
    const id = await seedPeriod(t, tenantId, { charges });
    stubStripe();

    await rollup(t);

    expect(calls).toHaveLength(0);
    const row = await readPeriod(t, id);
    expect(row?.status).toBe("failed");
    expect(row?.failureCode).toBe("too_many_charges");
  });

  test("a non-positive or non-integer amount is refused — direction never lives in the sign", async () => {
    const { t, tenantId } = await withTenant();
    await mapCustomer(t, tenantId, "cus_SENTINEL");
    const now = Date.now();
    const id = await seedPeriod(t, tenantId, {
      charges: [
        {
          ref: "credit",
          kind: "adjustment",
          amountMinor: -500,
          currency: "USD",
          occurredAt: now - 2 * DAY,
        },
      ],
    });
    stubStripe();

    await rollup(t);

    expect(calls).toHaveLength(0);
    expect((await readPeriod(t, id))?.failureCode).toBe("unusable_charge_amount");
  });
});

describe("the module shape is the design", () => {
  test("tick and settlePeriod are internalMutation; postInvoice is the ONLY internalAction", () => {
    const code = rollupCode();
    expect(code).toMatch(/export const tick = internalMutation\(/);
    expect(code).toMatch(/export const settlePeriod = internalMutation\(/);
    expect(code).toMatch(/export const postInvoice = internalAction\(/);
    // Exactly one action in the module: a second is a second at-most-once link in the chain.
    expect([...code.matchAll(/internalAction\(/g)]).toHaveLength(1);
  });

  test("the outbound half goes through billingApi, never through a bare fetch", () => {
    const code = rollupCode();
    expect(code).toMatch(/stripePost/);
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/api\.stripe\.com/);
  });
});
