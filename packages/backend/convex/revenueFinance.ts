/**
 * Business-finance orchestration (28-11, REVN-05).
 *
 * This file selects bounded normalized projections and hands every calculation to
 * `@pikar/revenue`. It contains no financial formula and no model boundary. Provider modules are
 * reached through typed Convex function references rather than runtime imports, so an unavailable
 * or parked optional rail does not make this module fail to load.
 */
import {
  type Aging,
  agingReport,
  cashTimeline,
  type ConnectorEnvironment,
  coverageOf,
  DECISION_SUPPORT_NOTICE,
  type Eligibility,
  type FinanceResult,
  type Figure,
  financeResult,
  groupByCurrency,
  type Invoice,
  type Money,
  type Obligation,
  payrollGap,
  type Payment,
  type CashTimeline,
  type PayrollOutlook,
  type Projection,
  type Provider,
  receiptsTotal,
  reconcilePayments,
  sumMoney,
  validateProjection,
} from "@pikar/revenue";
import type { PayPalBalances } from "@pikar/revenue/providers/paypal";
import type { StripeBalance } from "@pikar/revenue/providers/stripe";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { tenantAction } from "./lib/functions";

const FINANCE_PROVIDERS = ["quickbooks", "stripe", "paypal"] as const;
type FinanceProvider = (typeof FINANCE_PROVIDERS)[number];

export type FinanceSourceReads = {
  quickbooks?: {
    invoices: Projection<Invoice>;
    payments: Projection<Payment>;
    obligations: Projection<Obligation>;
    accounts: Projection<{ ref: Invoice["ref"]; balance: Money }>;
  };
  stripe?: {
    charges: Projection<Payment>;
    invoices: Projection<Invoice>;
    balance: Projection<StripeBalance>;
  };
  paypal?: {
    transactions: Projection<Payment>;
    balances: Projection<PayPalBalances>;
  };
};

export type FinanceSourceStatus = {
  provider: FinanceProvider;
  state: Projection<unknown>["state"];
  coverage: readonly {
    authority: "accounting_authority" | "payment_rail";
    retrievedAt: number;
    window: { startMs: number; endMs: number };
    capped: boolean;
  }[];
  missing: readonly string[];
};

export type FinanceExclusion = {
  provider: FinanceProvider;
  scope: "source" | "receivables" | "receipts" | "opening_cash" | "payroll";
  because: string;
};

export type CashView = {
  currency: string | null;
  timeline: Figure<CashTimeline>;
};

export type PayrollView = {
  currency: string | null;
  outlook: Figure<PayrollOutlook>;
};

export type BusinessFinanceResult = {
  asOfMs: number;
  horizonDays: number;
  receivables: FinanceResult<readonly Aging[] | null>;
  receipts: FinanceResult<readonly Money[] | null>;
  cash: FinanceResult<readonly CashView[]>;
  payroll: FinanceResult<readonly PayrollView[]>;
  sources: readonly FinanceSourceStatus[];
  exclusions: readonly FinanceExclusion[];
  notice: typeof DECISION_SUPPORT_NOTICE;
};

const unavailable = <T>(provider: FinanceProvider, because: string): Projection<T> => ({
  state: "unavailable",
  provider,
  because,
});

/** Reject malformed projection metadata before any normalized item reaches a pure calculation. */
const accepted = <T>(provider: FinanceProvider, projection: Projection<T>): Projection<T> => {
  const actualProvider =
    projection.state === "unavailable" ? projection.provider : projection.meta.provider;
  return validateProjection(projection).ok && actualProvider === provider
    ? projection
    : unavailable(provider, "the normalized provider projection did not pass validation");
};

const projectionsFor = (
  provider: FinanceProvider,
  sources: FinanceSourceReads,
): readonly Projection<unknown>[] => {
  if (provider === "quickbooks") {
    const source = sources.quickbooks;
    return source === undefined
      ? []
      : [
          accepted(provider, source.invoices),
          accepted(provider, source.payments),
          accepted(provider, source.obligations),
          accepted(provider, source.accounts),
        ];
  }
  if (provider === "stripe") {
    const source = sources.stripe;
    return source === undefined
      ? []
      : [
          accepted(provider, source.charges),
          accepted(provider, source.invoices),
          accepted(provider, source.balance),
        ];
  }
  const source = sources.paypal;
  return source === undefined
    ? []
    : [accepted(provider, source.transactions), accepted(provider, source.balances)];
};

const sourceStatus = (
  provider: FinanceProvider,
  projections: readonly Projection<unknown>[],
): FinanceSourceStatus => {
  const available = projections.filter((p) => p.state !== "unavailable");
  const missing = projections.flatMap((p) =>
    p.state === "partial" ? [p.missing] : p.state === "unavailable" ? [provider] : [],
  );
  return {
    provider,
    state:
      projections.length === 0 || available.length === 0
        ? "unavailable"
        : projections.some((p) => p.state !== "ready")
          ? "partial"
          : "ready",
    coverage: available.map((p) => ({
      authority: p.meta.authority as "accounting_authority" | "payment_rail",
      retrievedAt: p.meta.retrievedAt,
      window: p.meta.window,
      capped: p.meta.capped,
    })),
    missing: [...new Set(missing)],
  };
};

const byCurrency = <T>(rows: readonly T[], moneyOf: (row: T) => Money): Map<string, T[]> => {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const currency = moneyOf(row).currency;
    const bucket = grouped.get(currency);
    if (bucket) bucket.push(row);
    else grouped.set(currency, [row]);
  }
  return grouped;
};

const availableItems = <T>(projection: Projection<T> | undefined): readonly T[] =>
  projection === undefined || projection.state === "unavailable" ? [] : projection.items;

const outputCoverage = (projections: readonly (Projection<unknown> | undefined)[]) =>
  coverageOf(projections.filter((p): p is Projection<unknown> => p !== undefined));

const degraded = (
  coverage: ReturnType<typeof coverageOf>,
  missing: string,
): ReturnType<typeof coverageOf> => ({
  ...coverage,
  partial: true,
  missing: [...coverage.missing, missing],
});

const sortedCurrencies = (values: Iterable<string>): string[] => [...new Set(values)].sort();

/**
 * Pure composition over already-normalized provider projections.
 *
 * This is intentionally exported: the provider adapters prove payload normalization, while this
 * boundary proves authority, currency separation and unknown/partial propagation without network
 * fixtures or a model.
 */
export function composeBusinessFinance(args: {
  sources: FinanceSourceReads;
  asOfMs: number;
  horizonDays: number;
}): BusinessFinanceResult {
  const sources: FinanceSourceReads = {
    ...(args.sources.quickbooks === undefined
      ? {}
      : {
          quickbooks: {
            invoices: accepted("quickbooks", args.sources.quickbooks.invoices),
            payments: accepted("quickbooks", args.sources.quickbooks.payments),
            obligations: accepted("quickbooks", args.sources.quickbooks.obligations),
            accounts: accepted("quickbooks", args.sources.quickbooks.accounts),
          },
        }),
    ...(args.sources.stripe === undefined
      ? {}
      : {
          stripe: {
            charges: accepted("stripe", args.sources.stripe.charges),
            invoices: accepted("stripe", args.sources.stripe.invoices),
            balance: accepted("stripe", args.sources.stripe.balance),
          },
        }),
    ...(args.sources.paypal === undefined
      ? {}
      : {
          paypal: {
            transactions: accepted("paypal", args.sources.paypal.transactions),
            balances: accepted("paypal", args.sources.paypal.balances),
          },
        }),
  };

  const statuses = FINANCE_PROVIDERS.map((provider) =>
    sourceStatus(provider, projectionsFor(provider, sources)),
  );
  const exclusions: FinanceExclusion[] = statuses
    .filter((source) => source.state === "unavailable")
    .map((source) => ({
      provider: source.provider,
      scope: "source",
      because: "the provider did not supply a passed, readable projection",
    }));

  const unavailableInputs: readonly [
    Projection<unknown> | undefined,
    FinanceProvider,
    Exclude<FinanceExclusion["scope"], "source">,
  ][] = [
    [sources.quickbooks?.invoices, "quickbooks", "receivables"],
    [sources.quickbooks?.payments, "quickbooks", "receipts"],
    [sources.quickbooks?.accounts, "quickbooks", "opening_cash"],
    [sources.quickbooks?.obligations, "quickbooks", "payroll"],
    [sources.stripe?.invoices, "stripe", "receivables"],
    [sources.stripe?.charges, "stripe", "receipts"],
    [sources.stripe?.balance, "stripe", "opening_cash"],
    [sources.paypal?.transactions, "paypal", "receipts"],
    [sources.paypal?.balances, "paypal", "opening_cash"],
  ];
  for (const [projection, provider, scope] of unavailableInputs) {
    if (projection?.state === "unavailable") {
      exclusions.push({
        provider,
        scope,
        because: `the normalized ${scope} input was unavailable`,
      });
    }
  }

  // Accounting owns receivables in every currency it reports. A rail may supply AR only where the
  // books supplied no ledger; that keeps Stripe useful alone without counting one invoice twice.
  const qboInvoices = availableItems(sources.quickbooks?.invoices);
  const stripeInvoices = availableItems(sources.stripe?.invoices);
  const qboInvoiceCurrencies = new Set(qboInvoices.map((invoice) => invoice.outstanding.currency));
  const selectedInvoices = [
    ...qboInvoices,
    ...stripeInvoices.filter((invoice) => {
      if (!qboInvoiceCurrencies.has(invoice.outstanding.currency)) return true;
      exclusions.push({
        provider: "stripe",
        scope: "receivables",
        because: "the accounting authority owns receivables in this currency",
      });
      return false;
    }),
  ];
  const receivablesInputs = [sources.quickbooks?.invoices, sources.stripe?.invoices];
  let receivablesCoverage = outputCoverage(receivablesInputs);
  let receivablesValue: readonly Aging[] | null = null;
  if (selectedInvoices.length === 0) {
    if (sources.quickbooks !== undefined || sources.stripe !== undefined) receivablesValue = null;
    else if (sources.paypal !== undefined) {
      receivablesValue = [];
      receivablesCoverage = degraded(
        outputCoverage(projectionsFor("paypal", sources)),
        "receivables are not visible from PayPal",
      );
    } else receivablesValue = null;
  } else {
    const reports: Aging[] = [];
    for (const [currency, invoices] of byCurrency(
      selectedInvoices,
      (invoice) => invoice.outstanding,
    )) {
      const report = agingReport(invoices, args.asOfMs, currency);
      if (!report.ok) {
        receivablesValue = null;
        receivablesCoverage = degraded(
          receivablesCoverage,
          "the normalized receivables ledger could not be aged",
        );
        reports.length = 0;
        break;
      }
      reports.push(report.value);
    }
    if (reports.length > 0) receivablesValue = reports.sort((a, b) => a.currency.localeCompare(b.currency));
  }
  const receivables = financeResult(receivablesValue, receivablesCoverage);

  const paymentProjections = [
    sources.quickbooks?.payments,
    sources.stripe?.charges,
    sources.paypal?.transactions,
  ];
  let receiptsCoverage = outputCoverage(paymentProjections);
  const paymentSources = paymentProjections.flatMap((projection) =>
    projection === undefined || projection.state === "unavailable"
      ? []
      : [
          {
            authority: projection.meta.authority,
            window: projection.meta.window,
            payments: projection.items,
          },
        ],
  );
  const reconciled = reconcilePayments(paymentSources);
  for (const row of reconciled.excluded) {
    const provider = row.payment.ref.provider;
    if (provider === "quickbooks" || provider === "stripe" || provider === "paypal") {
      exclusions.push({ provider, scope: "receipts", because: row.because });
    }
  }
  let receiptsValue: readonly Money[] | null = paymentSources.length === 0 ? null : [];
  if (paymentSources.length > 0) {
    const totals: Money[] = [];
    for (const currency of sortedCurrencies(reconciled.included.map((p) => p.amount.currency))) {
      const total = receiptsTotal(
        {
          included: reconciled.included.filter((p) => p.amount.currency === currency),
          excluded: reconciled.excluded,
        },
        currency,
      );
      if (!total.ok) {
        receiptsValue = null;
        receiptsCoverage = degraded(
          receiptsCoverage,
          "the normalized receipts could not be totalled",
        );
        totals.length = 0;
        break;
      }
      totals.push(total.value);
    }
    if (receiptsValue !== null) receiptsValue = totals;
  }
  const receipts = financeResult(receiptsValue, receiptsCoverage);

  const qboAccounts = availableItems(sources.quickbooks?.accounts).map((row) => row.balance);
  const stripeBalances = availableItems(sources.stripe?.balance).flatMap((row) => row.available);
  const paypalBalances = availableItems(sources.paypal?.balances).flatMap((row) => row.available);
  const qboCashCurrencies = new Set(qboAccounts.map((amount) => amount.currency));
  const selectedOpening = [
    ...qboAccounts,
    ...stripeBalances.filter((amount) => {
      if (!qboCashCurrencies.has(amount.currency)) return true;
      exclusions.push({
        provider: "stripe",
        scope: "opening_cash",
        because: "the accounting authority owns opening cash in this currency",
      });
      return false;
    }),
    ...paypalBalances.filter((amount) => {
      if (!qboCashCurrencies.has(amount.currency)) return true;
      exclusions.push({
        provider: "paypal",
        scope: "opening_cash",
        because: "the accounting authority owns opening cash in this currency",
      });
      return false;
    }),
  ];
  const openingByCurrency = groupByCurrency(selectedOpening);
  const openingTotals = new Map<string, Money>();
  let openingInvalid = false;
  for (const [currency, amounts] of openingByCurrency) {
    const total = sumMoney(amounts, currency);
    if (!total.ok) {
      openingInvalid = true;
      break;
    }
    openingTotals.set(currency, total.value);
  }

  const obligations = availableItems(sources.quickbooks?.obligations);
  const timelineCurrencies = sortedCurrencies([
    ...openingTotals.keys(),
    ...selectedInvoices.map((invoice) => invoice.outstanding.currency),
    ...obligations.map((obligation) => obligation.amount.currency),
  ]);
  if (timelineCurrencies.length === 0) timelineCurrencies.push("");

  const operationalProjections = [
    sources.quickbooks?.accounts,
    sources.quickbooks?.invoices,
    sources.quickbooks?.obligations,
    sources.stripe?.balance,
    sources.stripe?.invoices,
    sources.paypal?.balances,
  ];
  let cashCoverage = outputCoverage(operationalProjections);
  if (openingInvalid) cashCoverage = degraded(cashCoverage, "opening cash could not be totalled");
  const cashRows: CashView[] = [];
  const payrollRows: PayrollView[] = [];
  let payrollCoverage = cashCoverage;

  for (const currency of timelineCurrencies) {
    const openingCash = currency === "" || openingInvalid ? null : (openingTotals.get(currency) ?? null);
    const inflows = selectedInvoices
      .filter((invoice) => invoice.outstanding.currency === currency && invoice.dueAt !== null)
      .map((invoice) => ({ atMs: invoice.dueAt as number, amount: invoice.outstanding }));
    const currencyObligations = obligations.filter(
      (obligation) => obligation.amount.currency === currency,
    );
    const timeline = cashTimeline({
      openingCash,
      asOfMs: args.asOfMs,
      horizonDays: args.horizonDays,
      inflows,
      outflows: currencyObligations.map((obligation) => ({
        atMs: obligation.dueAt,
        amount: obligation.amount,
      })),
    });
    cashRows.push({
      currency: currency === "" ? null : currency,
      timeline: timeline.ok
        ? timeline.value
        : {
            state: "not-computable",
            because: "the normalized cash inputs contradicted one another",
          },
    });

    const outlook = payrollGap({
      openingCash,
      asOfMs: args.asOfMs,
      horizonDays: args.horizonDays,
      expectedInflows: inflows,
      obligations: currencyObligations,
    });
    payrollRows.push({
      currency: currency === "" ? null : currency,
      outlook: outlook.ok
        ? outlook.value
        : {
            state: "not-computable",
            because: "the normalized payroll inputs contradicted one another",
          },
    });
  }

  if (!obligations.some((obligation) => obligation.kind === "payroll")) {
    payrollCoverage = degraded(payrollCoverage, "an explicit payroll obligation is required");
    exclusions.push({
      provider: "quickbooks",
      scope: "payroll",
      because: "no explicit payroll obligation was available for this window",
    });
  }

  return {
    asOfMs: args.asOfMs,
    horizonDays: args.horizonDays,
    receivables,
    receipts,
    cash: financeResult(cashRows, cashCoverage),
    payroll: financeResult(payrollRows, payrollCoverage),
    sources: statuses,
    exclusions,
    notice: DECISION_SUPPORT_NOTICE,
  };
}

type GateArgs = { provider: Provider; environment: ConnectorEnvironment };
const gateEligibility = makeFunctionReference<"query", GateArgs, Eligibility>(
  "providerGates:gateEligibility",
);

const quickbooksRead = <T>(entity: "Invoice" | "Payment" | "Bill" | "Account") =>
  makeFunctionReference<
    "action",
    { environment: ConnectorEnvironment; entity: typeof entity; windowDays?: number },
    Projection<T>
  >("quickbooks:readEntity");
const stripeRead = <T>(entity: "balance" | "charges" | "invoices") =>
  makeFunctionReference<
    "action",
    { environment: ConnectorEnvironment; entity: typeof entity; windowDays?: number },
    Projection<T>
  >("stripeConnector:readEntity");
const paypalRead = <T>(entity: "transactions" | "balances") =>
  makeFunctionReference<
    "action",
    { environment: ConnectorEnvironment; entity: typeof entity; windowDays?: number },
    Projection<T>
  >("paypalConnector:readEntity");

const safeAction = async <T>(
  read: () => Promise<Projection<T>>,
  provider: FinanceProvider,
): Promise<Projection<T>> => {
  try {
    return accepted(provider, await read());
  } catch {
    return unavailable(provider, "the provider read failed before a normalized result was returned");
  }
};

/** Gate first, then resolve only the adapters whose lane is passed and unexpired. */
export async function readPassedFinanceSources(
  ctx: Pick<ActionCtx, "runAction" | "runQuery">,
  environment: ConnectorEnvironment,
  windowDays: number,
): Promise<FinanceSourceReads> {
  const gates = new Map<FinanceProvider, Eligibility>();
  for (const provider of FINANCE_PROVIDERS) {
    gates.set(provider, await ctx.runQuery(gateEligibility, { provider, environment }));
  }

  const sources: FinanceSourceReads = {};
  if (gates.get("quickbooks")?.state === "passed") {
    sources.quickbooks = {
      invoices: await safeAction(
        () =>
          ctx.runAction(quickbooksRead<Invoice>("Invoice"), {
            environment,
            entity: "Invoice",
            windowDays,
          }),
        "quickbooks",
      ),
      payments: await safeAction(
        () =>
          ctx.runAction(quickbooksRead<Payment>("Payment"), {
            environment,
            entity: "Payment",
            windowDays,
          }),
        "quickbooks",
      ),
      obligations: await safeAction(
        () =>
          ctx.runAction(quickbooksRead<Obligation>("Bill"), {
            environment,
            entity: "Bill",
            windowDays,
          }),
        "quickbooks",
      ),
      accounts: await safeAction(
        () =>
          ctx.runAction(quickbooksRead<{ ref: Invoice["ref"]; balance: Money }>("Account"), {
            environment,
            entity: "Account",
            windowDays,
          }),
        "quickbooks",
      ),
    };
  }
  if (gates.get("stripe")?.state === "passed") {
    sources.stripe = {
      charges: await safeAction(
        () =>
          ctx.runAction(stripeRead<Payment>("charges"), {
            environment,
            entity: "charges",
            windowDays,
          }),
        "stripe",
      ),
      invoices: await safeAction(
        () =>
          ctx.runAction(stripeRead<Invoice>("invoices"), {
            environment,
            entity: "invoices",
            windowDays,
          }),
        "stripe",
      ),
      balance: await safeAction(
        () =>
          ctx.runAction(stripeRead<StripeBalance>("balance"), {
            environment,
            entity: "balance",
            windowDays,
          }),
        "stripe",
      ),
    };
  }
  if (gates.get("paypal")?.state === "passed") {
    sources.paypal = {
      transactions: await safeAction(
        () =>
          ctx.runAction(paypalRead<Payment>("transactions"), {
            environment,
            entity: "transactions",
            windowDays,
          }),
        "paypal",
      ),
      balances: await safeAction(
        () =>
          ctx.runAction(paypalRead<PayPalBalances>("balances"), {
            environment,
            entity: "balances",
            windowDays,
          }),
        "paypal",
      ),
    };
  }
  return sources;
}

const environmentArg = v.union(v.literal("sandbox"), v.literal("production"));

/** Tenant-facing immutable business-finance result. The caller cannot supply a tenant id. */
export const businessFinance = tenantAction({
  args: {
    environment: environmentArg,
    horizonDays: v.optional(v.number()),
  },
  handler: async (ctx, { environment, horizonDays }): Promise<BusinessFinanceResult> => {
    const horizon =
      horizonDays !== undefined && Number.isSafeInteger(horizonDays) && horizonDays >= 1
        ? Math.min(horizonDays, 400)
        : 30;
    const asOfMs = Date.now();
    const sources = await readPassedFinanceSources(ctx, environment, horizon);
    return composeBusinessFinance({ sources, asOfMs, horizonDays: horizon });
  },
});
