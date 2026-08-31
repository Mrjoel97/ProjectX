import {
  DECISION_SUPPORT_NOTICE,
  type Invoice,
  type Money,
  type Obligation,
  type Payment,
  type Projection,
  type Provider,
  type SourceAuthority,
} from "@pikar/revenue";
import type { PayPalBalances } from "@pikar/revenue/providers/paypal";
import type { StripeBalance } from "@pikar/revenue/providers/stripe";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { ActionCtx } from "./_generated/server";
import {
  composeBusinessFinance,
  type FinanceSourceReads,
  readPassedFinanceSources,
} from "./revenueFinance";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 31);
const WINDOW = { startMs: NOW - 30 * DAY, endMs: NOW };

const money = (minor: number, currency = "USD"): Money => ({ minor, currency });

const ready = <T>(
  provider: Provider,
  authority: SourceAuthority,
  items: readonly T[],
): Extract<Projection<T>, { state: "ready" }> => ({
  state: "ready",
  meta: {
    provider,
    authority,
    retrievedAt: NOW,
    window: WINDOW,
    capped: false,
    sources: items.flatMap((item) => {
      const ref = (item as { ref?: Invoice["ref"] }).ref;
      return ref === undefined ? [] : [ref];
    }),
  },
  items,
});

const partial = <T>(
  provider: Provider,
  authority: SourceAuthority,
  items: readonly T[],
  missing: string,
): Projection<T> => ({
  ...ready(provider, authority, items),
  state: "partial",
  missing,
});

const unavailable = <T>(provider: Provider, because = "the source is unavailable"): Projection<T> =>
  ({ state: "unavailable", provider, because });

const invoice = (
  provider: Provider,
  id: string,
  amount: Money,
  dueAt = NOW + 5 * DAY,
): Invoice => ({
  ref: { provider, kind: "invoice", id },
  customerRef: `customer_${id}`,
  issuedAt: NOW - 10 * DAY,
  dueAt,
  total: amount,
  outstanding: amount,
});

const payment = (
  provider: Provider,
  id: string,
  amount: Money,
  paidAt = NOW - DAY,
  invoiceId: string | null = null,
): Payment => ({
  ref: { provider, kind: "payment", id },
  authority: provider === "quickbooks" ? "accounting_authority" : "payment_rail",
  invoiceId,
  paidAt,
  amount,
});

const obligation = (id: string, amount: Money, kind: Obligation["kind"]): Obligation => ({
  ref: { provider: "quickbooks", kind: "bill", id },
  kind,
  dueAt: NOW + 3 * DAY,
  amount,
});

const qbo = (over: Partial<FinanceSourceReads["quickbooks"]> = {}) => ({
  invoices: ready("quickbooks", "accounting_authority", [
    invoice("quickbooks", "qbo-invoice", money(5_000)),
  ]),
  payments: ready("quickbooks", "accounting_authority", [
    payment("quickbooks", "qbo-payment", money(2_000), NOW - DAY, "qbo-invoice"),
  ]),
  obligations: ready("quickbooks", "accounting_authority", [
    obligation("payroll", money(4_000), "payroll"),
  ]),
  accounts: ready("quickbooks", "accounting_authority", [
    {
      ref: { provider: "quickbooks" as const, kind: "account", id: "cash" },
      balance: money(10_000),
    },
  ]),
  ...over,
});

const stripe = (currency = "USD"): FinanceSourceReads["stripe"] => ({
  charges: ready("stripe", "payment_rail", [
    payment("stripe", "stripe-charge", money(3_000, currency)),
  ]),
  invoices: ready("stripe", "payment_rail", [
    invoice("stripe", "stripe-invoice", money(1_000, currency)),
  ]),
  balance: ready<StripeBalance>("stripe", "payment_rail", [
    { available: [money(20_000, currency)], pending: [money(900, currency)] },
  ]),
});

const paypal = (currency = "USD"): FinanceSourceReads["paypal"] => ({
  transactions: ready("paypal", "payment_rail", [
    payment("paypal", "paypal-payment", money(7_000, currency)),
  ]),
  balances: ready<PayPalBalances>("paypal", "payment_rail", [
    { available: [money(30_000, currency)], total: [money(31_000, currency)] },
  ]),
});

const compose = (sources: FinanceSourceReads) =>
  composeBusinessFinance({ sources, asOfMs: NOW, horizonDays: 30 });

const passed = { state: "passed", reasons: [], unresolvedConditions: [] } as const;
const parked = {
  state: "parked",
  reasons: ["lane_not_passed"],
  unresolvedConditions: [],
} as const;

const readsForTenant = async (fixture: ReturnType<typeof qbo>) => {
  const ctx = {
    runQuery: async (_reference: unknown, args: { provider: Provider }) =>
      args.provider === "quickbooks" ? passed : parked,
    runAction: async (_reference: unknown, args: { entity: string }) => {
      if (args.entity === "Invoice") return fixture.invoices;
      if (args.entity === "Payment") return fixture.payments;
      if (args.entity === "Bill") return fixture.obligations;
      if (args.entity === "Account") return fixture.accounts;
      throw new Error(`unexpected entity ${args.entity}`);
    },
  } as unknown as Pick<ActionCtx, "runAction" | "runQuery">;

  return readPassedFinanceSources(ctx, "sandbox", 30);
};

describe("business-finance source orchestration", () => {
  test("no rails is useful but honestly unavailable, never a zero", () => {
    const result = compose({});

    expect(result.receipts.value).toBeNull();
    expect(result.receipts.confidence).toBe("unavailable");
    expect(result.cash.value[0]?.timeline).toMatchObject({
      state: "unknown",
      needs: expect.stringMatching(/opening cash/i),
    });
    expect(result.payroll.value[0]?.outlook.state).toBe("unknown");
    expect(result.sources.map((source) => [source.provider, source.state])).toEqual([
      ["quickbooks", "unavailable"],
      ["stripe", "unavailable"],
      ["paypal", "unavailable"],
    ]);
    expect(result.notice).toBe(DECISION_SUPPORT_NOTICE);
  });

  test("QuickBooks alone owns opening cash, receivables and booked receipts", () => {
    const result = compose({ quickbooks: qbo() });

    expect(result.receivables.value?.[0]?.outstanding).toEqual(money(5_000));
    expect(result.receipts.value).toEqual([money(2_000)]);
    expect(result.cash.value[0]).toMatchObject({
      currency: "USD",
      timeline: { state: "known", value: { closing: money(11_000) } },
    });
    expect(result.payroll.value[0]?.outlook).toMatchObject({
      state: "known",
      value: { covered: true, firstShortfallAt: null },
    });
  });

  test("Stripe alone remains useful and keeps its own currency", () => {
    const result = compose({ stripe: stripe("EUR") });

    expect(result.receivables.value?.[0]?.currency).toBe("EUR");
    expect(result.receipts.value).toEqual([money(3_000, "EUR")]);
    expect(result.cash.value[0]).toMatchObject({
      currency: "EUR",
      timeline: { state: "known", value: { closing: money(21_000, "EUR") } },
    });
    expect(result.payroll.value[0]?.outlook).toMatchObject({ state: "unknown" });
  });

  test("PayPal alone reports rail receipts and available balance without inventing AR", () => {
    const result = compose({ paypal: paypal("TZS") });

    expect(result.receivables.value).toEqual([]);
    expect(result.receipts.value).toEqual([money(7_000, "TZS")]);
    expect(result.cash.value[0]).toMatchObject({
      currency: "TZS",
      timeline: { state: "known", value: { closing: money(30_000, "TZS") } },
    });
  });

  test("the accounting window excludes overlapping Stripe and PayPal receipts", () => {
    const result = compose({ quickbooks: qbo(), stripe: stripe(), paypal: paypal() });

    expect(result.receipts.value).toEqual([money(2_000)]);
    expect(result.exclusions.filter((row) => row.scope === "receipts")).toEqual([
      expect.objectContaining({ provider: "stripe", because: expect.stringMatching(/accounting/) }),
      expect.objectContaining({ provider: "paypal", because: expect.stringMatching(/accounting/) }),
    ]);
    expect(result.cash.value).toHaveLength(1);
    expect(result.cash.value[0]?.currency).toBe("USD");
    expect(result.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "stripe", scope: "opening_cash" }),
        expect.objectContaining({ provider: "paypal", scope: "opening_cash" }),
      ]),
    );
  });

  test("partial and refreshed-failed reads can only lower coverage", () => {
    const first = compose({ quickbooks: qbo() });
    const partialResult = compose({
      quickbooks: qbo({
        invoices: partial(
          "quickbooks",
          "accounting_authority",
          [invoice("quickbooks", "qbo-invoice", money(5_000))],
          "the next page was not returned",
        ),
      }),
    });
    const failed = compose({
      quickbooks: qbo({
        invoices: unavailable("quickbooks", "the refreshed connection failed"),
        payments: unavailable("quickbooks", "the refreshed connection failed"),
        obligations: unavailable("quickbooks", "the refreshed connection failed"),
        accounts: unavailable("quickbooks", "the refreshed connection failed"),
      }),
    });

    expect(first.receivables.confidence).toBe("high");
    expect(partialResult.receivables.confidence).toBe("medium");
    expect(failed.receivables.confidence).toBe("unavailable");
    expect(failed.receivables.value).toBeNull();
    expect(failed.sources[0]).toMatchObject({ state: "unavailable" });
  });
});

describe("business-finance provenance boundary", () => {
  test("two tenant contexts retrieve only their own distinct amount and currency sentinels", async () => {
    const tenantA = qbo({
      invoices: ready("quickbooks", "accounting_authority", [
        invoice("quickbooks", "tenant-a-invoice", money(11_111, "USD")),
      ]),
      payments: ready("quickbooks", "accounting_authority", [
        payment("quickbooks", "tenant-a-payment", money(2_222, "USD")),
      ]),
      obligations: ready("quickbooks", "accounting_authority", [
        obligation("tenant-a-payroll", money(3_333, "USD"), "payroll"),
      ]),
      accounts: ready("quickbooks", "accounting_authority", [
        {
          ref: { provider: "quickbooks", kind: "account", id: "tenant-a-cash" },
          balance: money(44_444, "USD"),
        },
      ]),
    });
    const tenantB = qbo({
      invoices: ready("quickbooks", "accounting_authority", [
        invoice("quickbooks", "tenant-b-invoice", money(77_777, "TZS")),
      ]),
      payments: ready("quickbooks", "accounting_authority", [
        payment("quickbooks", "tenant-b-payment", money(8_888, "TZS")),
      ]),
      obligations: ready("quickbooks", "accounting_authority", [
        obligation("tenant-b-payroll", money(9_999, "TZS"), "payroll"),
      ]),
      accounts: ready("quickbooks", "accounting_authority", [
        {
          ref: { provider: "quickbooks", kind: "account", id: "tenant-b-cash" },
          balance: money(66_666, "TZS"),
        },
      ]),
    });

    const [sourcesA, sourcesB] = await Promise.all([
      readsForTenant(tenantA),
      readsForTenant(tenantB),
    ]);
    const resultA = compose(sourcesA);
    const resultB = compose(sourcesB);

    expect(resultA.receivables.value?.[0]).toMatchObject({
      currency: "USD",
      outstanding: money(11_111, "USD"),
    });
    expect(resultA.cash.value[0]).toMatchObject({
      currency: "USD",
      timeline: { state: "known", value: { closing: money(52_222, "USD") } },
    });
    expect(JSON.stringify(resultA)).not.toContain("tenant-b");
    expect(JSON.stringify(resultA)).not.toContain("77777");

    // Anti-vacuity: B's fixture must be retrievable and numerically distinct, or A's absence
    // assertions could pass against an orchestration path that returned no provider data at all.
    expect(resultB.receivables.value?.[0]).toMatchObject({
      currency: "TZS",
      outstanding: money(77_777, "TZS"),
    });
    expect(resultB.cash.value[0]).toMatchObject({
      currency: "TZS",
      timeline: { state: "known", value: { closing: money(134_444, "TZS") } },
    });
  });

  test("the orchestration boundary has no tenant argument, model import or repair prompt", () => {
    const source = readFileSync(new URL("./revenueFinance.ts", import.meta.url), "utf8");
    const tenantActionArgs = source.match(
      /export const businessFinance = tenantAction\(\{[\s\S]*?args:\s*\{([\s\S]*?)\},\s*handler:/,
    )?.[1];

    expect(tenantActionArgs).toBeDefined();
    expect(tenantActionArgs).not.toMatch(/tenantId/);
    expect(source).not.toMatch(/from\s+["'][^"']*(?:llm|agent|skills)[^"']*["']/i);
    expect(source).not.toMatch(/(?:prompt|repair|generateText|chatCompletion)\s*\(/i);
    expect(source).toMatch(/agingReport\(/);
    expect(source).toMatch(/cashTimeline\(/);
    expect(source).toMatch(/payrollGap\(/);
    expect(source).toMatch(/receiptsTotal\(/);
  });

  test("malformed provider numbers stop at pure validation and never become displayed figures", () => {
    const malformed = money(Number.NaN);
    const result = compose({
      quickbooks: qbo({
        invoices: ready("quickbooks", "accounting_authority", [
          invoice("quickbooks", "malformed-invoice", malformed),
        ]),
        payments: ready("quickbooks", "accounting_authority", [
          payment("quickbooks", "malformed-payment", malformed),
        ]),
        obligations: ready("quickbooks", "accounting_authority", [
          obligation("malformed-payroll", malformed, "payroll"),
        ]),
        accounts: ready("quickbooks", "accounting_authority", [
          {
            ref: { provider: "quickbooks", kind: "account", id: "malformed-cash" },
            balance: malformed,
          },
        ]),
      }),
    });

    expect(result.receivables.value).toBeNull();
    expect(result.receipts.value).toBeNull();
    expect(result.cash.value[0]?.timeline.state).not.toBe("known");
    expect(result.payroll.value[0]?.outlook.state).not.toBe("known");
  });

  test("every finance result carries review semantics and each unavailable input names its exclusion", () => {
    const result = compose({
      quickbooks: qbo({ invoices: unavailable("quickbooks", "invoice refresh failed") }),
    });

    for (const output of [result.receivables, result.receipts, result.cash, result.payroll]) {
      expect(output.notice).toBe(DECISION_SUPPORT_NOTICE);
      expect(output.coverage).toMatchObject({
        providers: expect.any(Array),
        authorities: expect.any(Array),
        missing: expect.any(Array),
      });
    }
    expect(result.notice).toBe(DECISION_SUPPORT_NOTICE);
    expect(result.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "quickbooks",
          scope: "receivables",
          because: expect.stringMatching(/unavailable/i),
        }),
      ]),
    );
    expect(result.exclusions.every((row) => row.because.trim().length > 0)).toBe(true);
  });
});
