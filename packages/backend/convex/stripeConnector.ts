// Stripe bounded READS — the thin adapter between the sealed credential and the pure normalizer
// (CLAUDE.md §1).
//
// Named `stripeConnector`, not `stripe`, and the name is a boundary rather than a style choice: a
// SECOND, WRITE-CAPABLE Stripe integration lives in this repository under `convex/billing*.ts` and
// `packages/billing/`, charging from PIKAR'S OWN merchant account. This module reads a TENANT'S
// account, read-only, and must never reference that one or read a `BILLING_STRIPE_*` name.
// `stripeConnector.test.ts` scans for both.
//
// WHAT THIS MODULE IS ALLOWED TO BE. It opens a credential, refreshes it if it is about to die,
// hands `connectorFetch.readPages` a path from the compile-time allow-list, runs the rows through
// `@pikar/revenue/providers/stripe`, and reports coverage. It contains:
//
//   • NO REQUEST VERB and NO TRANSPORT. `readPages` hardcodes GET and refuses a redirect.
//     `scripts/check-provider-lane.mjs` scans this file for a write verb and goes red on one.
//   • NO PATH PARAMETER. The caller picks an ENTITY from a five-member closed union; the path comes
//     from `STRIPE_READ_PATHS` in the pure module, which is compared against the transport's
//     allow-list in both directions by the test file.
//   • NO ARITHMETIC. Every figure comes from `@pikar/revenue`'s `finance.ts` and `money.ts`.
//   • NO MODEL. Nothing here calls an LLM, and nothing downstream may let one produce, adjust or
//     repair a figure this returns — only explain one.
//
// THE WRITE BOUNDARY IS THE VENDOR'S, NOT ONLY OURS. A Stripe App declaring only `*_read` manifest
// permissions cannot express a write with the token it is given. That is strictly stronger than the
// QuickBooks lane, where a write-capable scope makes this repo's allow-list the entire containment
// story. The allow-list here is the second line, not the only one.
//
// WHY THE GATE IS CHECKED ON EVERY TENANT-FACING READ, AND ONLY THERE. Stripe's admission is an
// OWNER OVERRIDE recorded on 2026-08-27 against evidence that did not support production, and its
// open condition — no documented platform-initiated revocation — is still open. So the four
// exported tenant actions go through `gatedRead` and return `unavailable` unless `providerGates`
// resolves `passed`. The lane-evidence action `stripeReadEvidence` deliberately does NOT consult
// the gate, because it is the thing that PRODUCES the evidence 28-24 seals on; see `gatedRead`.
//
// NOT "use node": `readPages` uses the platform fetch and `openCredential` uses `crypto.subtle`,
// both available in the default Convex runtime.

import type { Result } from "@pikar/core/result";
import {
  CAPS,
  type Currency,
  coverageOf,
  type FinanceResult,
  financeResult,
  groupByCurrency,
  type Invoice,
  type Money,
  openCredential,
  type Payment,
  type Projection,
  type ProjectionMeta,
  receiptsTotal,
  reconcilePayments,
  type SourceRef,
  sumMoney,
  validateProjection,
} from "@pikar/revenue";
import { boundedWindow, normalizeAll } from "@pikar/revenue/providers/shared";
import {
  normalizeCharge,
  normalizeDispute,
  normalizePayout,
  normalizeStripeInvoice,
  parseBalance,
  parseListPage,
  STRIPE_CURSOR_PARAM,
  STRIPE_DEFAULT_WINDOW_DAYS,
  STRIPE_MAX_PAGES,
  STRIPE_READ_PATHS,
  type StripeBalance,
  type StripeDispute,
  type StripeEntity,
  type StripePayout,
  stripeWindowParams,
} from "@pikar/revenue/providers/stripe";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, internalAction } from "./_generated/server";
import { requireCredentialKey } from "./connectorCredentials";
import { readPages } from "./connectorFetch";
import { tenantAction } from "./lib/functions";
import { emitConnectorReadEvent } from "./revenueTelemetry";
import { ACCESS_REFRESH_SKEW_MS, parseStripeCredential, stripeApp } from "./stripeAuth";

const environmentArg = v.union(v.literal("sandbox"), v.literal("production"));

/**
 * The five entities a caller may name. A CLOSED UNION, not a string, and not a path. This is the
 * whole request surface of the Stripe rail: there is no way to express "GET this other path"
 * through it, and no way at all to express a write.
 */
const entityArg = v.union(
  v.literal("balance"),
  v.literal("charges"),
  v.literal("invoices"),
  v.literal("payouts"),
  v.literal("disputes"),
);

// ── What a read hands back ────────────────────────────────────────────────────────────────

type Rows = {
  balance: StripeBalance;
  charges: Payment;
  invoices: Invoice;
  payouts: StripePayout;
  disputes: StripeDispute;
};

/**
 * The `SourceAuthority` this rail speaks with, for every entity.
 *
 * A payment rail owns WHEN CASH LANDED. It is NOT independent evidence that a booked invoice was
 * paid — believing both it and the accounting authority double-counts one business activity, which
 * is exactly what `finance.reconcilePayments` refuses to do. Stripe's facts stay supplemental to
 * the books until that deterministic reconciliation selects them.
 */
const AUTHORITY = "payment_rail" as const;

const unavailable = (because: string): Projection<never> => ({
  state: "unavailable",
  provider: "stripe",
  because,
});

/**
 * Fixed search parameters per entity, on top of the window.
 *
 * `invoices` is narrowed to `status=open` — the receivables question. The normalizer independently
 * refuses `draft`, `void` and `uncollectible`, so nothing un-owed can be aged even if this filter
 * is ever dropped; the filter exists so a tenant with drafts does not turn every read `partial` on
 * rejected rows that were never missing data in the first place.
 */
const ENTITY_FILTERS: Partial<Record<StripeEntity, Record<string, string>>> = {
  invoices: { status: "open" },
};

// ── The access token ──────────────────────────────────────────────────────────────────────

/**
 * The access token to read with — refreshing first if it is close enough to expiry that a read
 * could outlive it. Stripe's access tokens last one hour.
 *
 * Refreshing goes through `stripeAuth.refreshConnection`, which holds the lease and commits under
 * the fence. This function must never send its own token request: Stripe rolls the refresh token on
 * every exchange, so a second refresh path is a second way to race a value that has already moved.
 */
async function accessTokenFor(
  ctx: ActionCtx,
  args: { tenantId: string; environment: "sandbox" | "production" },
): Promise<{ ok: true; accessToken: string } | { ok: false; because: string }> {
  const connection = {
    tenantId: args.tenantId,
    provider: "stripe" as const,
    environment: args.environment,
  };
  const row = await ctx.runQuery(internal.connectorCredentials.get, connection);

  if (row === null) return { ok: false, because: "this tenant has no Stripe connection" };
  if (row.status === "revoked") {
    return { ok: false, because: "the Stripe connection was disconnected" };
  }
  if (!row.credentialCiphertextB64 || !row.credentialIvB64) {
    return { ok: false, because: "the Stripe credential is not available" };
  }

  const key = await requireCredentialKey(row.keyVersion);
  let credential: ReturnType<typeof parseStripeCredential> = null;
  try {
    credential = parseStripeCredential(
      await openCredential(
        key,
        {
          tenantId: args.tenantId,
          provider: "stripe",
          connectionId: row.connectionId,
          environment: args.environment,
        },
        {
          ciphertextB64: row.credentialCiphertextB64,
          ivB64: row.credentialIvB64,
          keyVersion: row.keyVersion,
          algorithm: "AES-256-GCM",
        },
      ),
    );
  } catch {
    credential = null;
  }
  if (credential === null) return { ok: false, because: "the Stripe credential is not available" };

  const expiring = (row.accessExpiresAt ?? 0) - Date.now() <= ACCESS_REFRESH_SKEW_MS;
  if (!expiring) return { ok: true, accessToken: credential.accessToken };

  const refreshed = await ctx.runAction(internal.stripeAuth.refreshConnection, {
    tenantId: args.tenantId,
    environment: args.environment,
  });
  if (refreshed.ok) return { ok: true, accessToken: refreshed.accessToken };
  // A refresh that could not run because ANOTHER refresher holds the lease is not a dead
  // connection — the current access token is still valid for up to the skew window, so the read
  // proceeds on it rather than reporting an outage that does not exist.
  if (refreshed.reason === "refresh_in_flight" || refreshed.reason === "stale_revision") {
    return { ok: true, accessToken: credential.accessToken };
  }
  return { ok: false, because: "the Stripe access token could not be renewed" };
}

// ── The bounded read ──────────────────────────────────────────────────────────────────────

type ReadOutcome<T> = { projection: Projection<T>; rejected: number };

/**
 * Read one entity over one window, under every bound this repo owns.
 *
 * THE PARTIAL RULE, which is the expensive one to get wrong. A capped read, a 429, a lost page and
 * a row that would not normalize all produce a `partial` projection that NAMES what is missing.
 * None of them produce a shorter `ready` list: a prefix of a receipts ledger presented as complete
 * understates what a business took in, and every downstream confidence rule would then report over
 * it as though nothing were absent.
 *
 * MIXED CURRENCY IS NOT SEPARATED HERE, deliberately. A Stripe account settles in whatever
 * currencies it is configured for and every row carries its own; there is no "home currency" to
 * pick and inferring one from the first row is how a caller silently totals the wrong ledger. The
 * projection carries them all, and the derived figures below total each currency on its own.
 */
async function readEntityRows<K extends keyof Rows>(
  ctx: ActionCtx,
  args: {
    tenantId: string;
    environment: "sandbox" | "production";
    entity: K & StripeEntity;
    windowDays: number;
  },
): Promise<ReadOutcome<Rows[K]>> {
  // The version pin FIRST, before a token is opened or a request is shaped. An unset or malformed
  // pin is a deployment fault, and reading against whichever API version the connected account's
  // dashboard happens to be on is how a projection silently changes meaning.
  let apiVersion: string;
  try {
    apiVersion = stripeApp().apiVersion;
  } catch {
    return { projection: unavailable("Stripe is not configured for this deployment"), rejected: 0 };
  }

  const token = await accessTokenFor(ctx, args);
  if (!token.ok) return { projection: unavailable(token.because), rejected: 0 };

  const asOfMs = Date.now();
  const window = boundedWindow(asOfMs, args.windowDays);
  if (!window.ok) {
    return { projection: unavailable("the requested read window is out of bounds"), rejected: 0 };
  }

  const isBalance = args.entity === "balance";
  const query = isBalance ? undefined : stripeWindowParams(window.value);
  const filters: Record<string, string> = ENTITY_FILTERS[args.entity] ?? {};
  for (const [key, value] of Object.entries(filters)) query?.set(key, value);

  const read = await readPages<Record<string, unknown>>({
    provider: "stripe",
    environment: args.environment,
    path: STRIPE_READ_PATHS[args.entity],
    accessToken: token.accessToken,
    cursorParam: STRIPE_CURSOR_PARAM,
    ...(query === undefined ? {} : { query }),
    stripeApiVersion: apiVersion,
    // `/v1/balance` is a RETRIEVE, not a list: one object, no `has_more`, nothing to page.
    maxPages: isBalance ? 1 : STRIPE_MAX_PAGES,
    parsePage: (raw) =>
      isBalance
        ? { items: [raw as Record<string, unknown>], cursor: null }
        : (() => {
            const page = parseListPage(raw);
            return { items: page.rows, cursor: page.cursor };
          })(),
  });

  await ctx.runMutation(internal.connectorCredentials.recordReadOutcome, {
    tenantId: args.tenantId,
    provider: "stripe",
    environment: args.environment,
    ...(read.stoppedBy?.kind === "failure" ? { failureClass: read.stoppedBy.failureClass } : {}),
  });

  const normalizers = {
    balance: parseBalance,
    charges: normalizeCharge,
    invoices: normalizeStripeInvoice,
    payouts: normalizePayout,
    disputes: normalizeDispute,
  } as const;
  // The one cast in this file. `normalizers[args.entity]` is correct at runtime — the table is
  // keyed by the same closed union `K` is drawn from — but TypeScript widens the lookup to the
  // union of all five return types and cannot re-narrow it against a generic index.
  const normalize = normalizers[args.entity] as (raw: unknown) => Result<Rows[K], string>;
  const normalized = normalizeAll(read.items, normalize);

  const missing: string[] = [];
  if (read.stoppedBy?.kind === "cap") {
    missing.push(`the read stopped at the ${read.stoppedBy.reason}`);
  }
  if (read.stoppedBy?.kind === "failure") {
    missing.push(`Stripe returned ${read.stoppedBy.failureClass}`);
  }
  if (normalized.rejected > 0) {
    missing.push(`${normalized.rejected} Stripe row(s) could not be read`);
  }

  const meta: ProjectionMeta = {
    provider: "stripe",
    authority: AUTHORITY,
    retrievedAt: asOfMs,
    window: { startMs: window.value.startMs, endMs: window.value.endMs },
    capped: read.capped,
    // The balance is a snapshot with no object id of its own, so it contributes no source ref.
    sources: normalized.rows
      .slice(0, CAPS.maxSources)
      .map((row) => (row as { ref?: SourceRef }).ref)
      .filter((ref): ref is SourceRef => ref !== undefined),
  };
  const projection: Projection<Rows[K]> =
    missing.length === 0
      ? { state: "ready", meta, items: normalized.rows }
      : { state: "partial", meta, items: normalized.rows, missing: missing.join("; ") };

  // The contract module's own validator, run on the way out. A projection that would fail it — a
  // capped read marked `ready`, an over-wide window, a ref carrying content — must not reach a
  // consumer, and catching it here is cheaper than discovering it in a rendered figure.
  const valid = validateProjection(projection);
  if (!valid.ok) {
    return {
      projection: unavailable("this Stripe read could not be validated"),
      rejected: normalized.rejected,
    };
  }
  return { projection, rejected: normalized.rejected };
}

/**
 * The gate, checked on every TENANT-FACING read — and deliberately NOT inside `readEntityRows`.
 *
 * The two axes only stay apart if the thing that EARNS a pass can run before the pass exists.
 * `providerGates.lane` becomes `passed` once a controlled live read has been observed, and 28-24
 * observes it by driving `stripeReadEvidence` below. If the shared read path refused on
 * `lane !== "passed"`, the only way to ever seal Stripe would be to seal it FIRST and verify
 * afterwards — which publishes it into `availableProviders` for every tenant on evidence nobody
 * has. 28-05 and 28-06 reached the same conclusion; the gate governs CONSUMPTION.
 *
 * For Stripe there is a second reason the gate must bite here. The admission is an OWNER OVERRIDE
 * against evidence that did not support production, and the open condition
 * `platform-initiated-revocation` is unresolved — so `resolveProviderEligibility` refuses `passed`
 * on that alone, whatever else is true.
 */
async function gatedRead<K extends keyof Rows>(
  ctx: ActionCtx,
  args: {
    tenantId: string;
    environment: "sandbox" | "production";
    entity: K & StripeEntity;
    windowDays: number;
  },
): Promise<ReadOutcome<Rows[K]>> {
  const gate = await ctx.runQuery(internal.providerGates.gateEligibility, {
    provider: "stripe",
    environment: args.environment,
  });
  if (gate.state !== "passed") {
    return { projection: unavailable(`the Stripe lane is ${gate.state}`), rejected: 0 };
  }
  return readEntityRows(ctx, args);
}

const windowArg = v.optional(v.number());

const clampWindow = (days: number | undefined): number => {
  if (days === undefined || !Number.isSafeInteger(days) || days < 1) {
    return STRIPE_DEFAULT_WINDOW_DAYS;
  }
  return Math.min(days, CAPS.maxWindowDays);
};

/**
 * The bounded read, tenant-scoped. The tenant comes from the authenticated identity — there is no
 * `tenantId` argument by which one tenant could read another's Stripe account.
 */
export const readEntity = tenantAction({
  args: { environment: environmentArg, entity: entityArg, windowDays: windowArg },
  handler: async (ctx, { environment, entity, windowDays }) => {
    const outcome = await gatedRead(ctx, {
      tenantId: ctx.tenantId,
      environment,
      entity,
      windowDays: clampWindow(windowDays),
    });
    await emitConnectorReadEvent(ctx, ctx.tenantId, "stripe", outcome.projection);
    return outcome.projection;
  },
});

// ── The derived answers, computed by finance.ts and money.ts ──────────────────────────────

/**
 * The currencies present in a set of amounts, sorted by code.
 *
 * Stripe accounts are routinely multi-currency, and two currencies never combine without an FX rate
 * nobody supplied — so every figure below is a LIST, never one number over a currency somebody
 * picked. Sorted so the answer is stable rather than insertion-ordered.
 */
const currenciesOf = (amounts: readonly Money[]): Currency[] =>
  [...groupByCurrency(amounts).keys()].sort((a, b) => a.localeCompare(b));

/** Per-currency totals where the amounts themselves are the input. `sumMoney` fits exactly. */
function totalsPerCurrency(
  amounts: readonly Money[],
  total: (list: readonly Money[], currency: Currency) => Result<Money, string>,
): Result<Money[], string> {
  const out: Money[] = [];
  for (const currency of currenciesOf(amounts)) {
    const sum = total(
      amounts.filter((m) => m.currency === currency),
      currency,
    );
    if (!sum.ok) return sum;
    out.push(sum.value);
  }
  return { ok: true, value: out };
}

/**
 * Cash actually received through the rail, per currency.
 *
 * IT GOES THROUGH `finance.reconcilePayments` EVEN WITH ONE SOURCE, and that is the point rather
 * than ceremony: `receiptsTotal` only accepts a `Reconciled`, so there is no shape in this file
 * that could total raw provider payments. When 28-12/28-13 combine this with the QuickBooks lane,
 * the same call is what refuses to count one business activity twice — a Stripe charge that the
 * books already booked is EXCLUDED there, not added.
 *
 * An UNAVAILABLE read yields `value: null` with `confidence: "unavailable"`, never a zero total.
 * "We could not see your Stripe account" and "you received nothing" are different sentences.
 */
export const receiptsSummary = tenantAction({
  args: { environment: environmentArg, windowDays: windowArg },
  handler: async (
    ctx,
    { environment, windowDays },
  ): Promise<FinanceResult<readonly Money[] | null>> => {
    const { projection } = await gatedRead(ctx, {
      tenantId: ctx.tenantId,
      environment,
      entity: "charges",
      windowDays: clampWindow(windowDays),
    });
    const coverage = coverageOf([projection]);
    if (projection.state === "unavailable") return financeResult(null, coverage);

    const reconciled = reconcilePayments([
      { authority: AUTHORITY, window: projection.meta.window, payments: projection.items },
    ]);
    // Not `totalsPerCurrency`: `receiptsTotal` takes a `Reconciled`, not a list of amounts, and a
    // helper handed a list it then ignored would be a signature that lies. Each currency gets its
    // own `Reconciled` view of the SAME reconciliation, so the double-count refusal still applies.
    const totals: Money[] = [];
    for (const currency of currenciesOf(reconciled.included.map((p) => p.amount))) {
      const total = receiptsTotal(
        {
          included: reconciled.included.filter((p) => p.amount.currency === currency),
          excluded: reconciled.excluded,
        },
        currency,
      );
      if (!total.ok) {
        return financeResult(null, {
          ...coverage,
          partial: true,
          missing: [...coverage.missing, "the Stripe receipts could not be totalled"],
        });
      }
      totals.push(total.value);
    }
    return financeResult(totals, coverage);
  },
});

/**
 * The AVAILABLE balance, per currency. Pending is deliberately excluded: it has not settled, and
 * adding it would report money the business cannot use as if it could.
 *
 * `null` means we could not see the account, and `finance.cashTimeline` treats a null opening
 * balance as UNKNOWN rather than as zero — which is the whole reason this returns null instead of
 * an empty list of totals.
 */
export const balanceOnHand = tenantAction({
  args: { environment: environmentArg },
  handler: async (ctx, { environment }): Promise<FinanceResult<readonly Money[] | null>> => {
    const { projection } = await gatedRead(ctx, {
      tenantId: ctx.tenantId,
      environment,
      entity: "balance",
      windowDays: STRIPE_DEFAULT_WINDOW_DAYS,
    });
    const coverage = coverageOf([projection]);
    if (projection.state === "unavailable") return financeResult(null, coverage);

    const balance = projection.items[0];
    if (balance === undefined) return financeResult(null, coverage);
    const totals = totalsPerCurrency(balance.available, sumMoney);
    if (!totals.ok) {
      return financeResult(null, {
        ...coverage,
        partial: true,
        missing: [...coverage.missing, "the Stripe balance could not be totalled"],
      });
    }
    return financeResult(totals.value, coverage);
  },
});

/**
 * Open receivables billed through Stripe, and money at risk.
 *
 * NO AGING IS COMPUTED HERE. `finance.agingReport` needs one currency and Stripe hands back
 * several; 28-12 owns combining these rows with the accounting authority's, which is where a
 * single-currency aging question can honestly be asked. This returns the normalized rows and their
 * coverage, and nothing else.
 */
export const openInvoices = tenantAction({
  args: { environment: environmentArg, windowDays: windowArg },
  handler: async (ctx, { environment, windowDays }) => {
    const outcome = await gatedRead(ctx, {
      tenantId: ctx.tenantId,
      environment,
      entity: "invoices",
      windowDays: clampWindow(windowDays),
    });
    return outcome.projection;
  },
});

// ── Lane evidence (28-24) ─────────────────────────────────────────────────────────────────

/**
 * The sanitized shape `scripts/smoke-stripe-read.mjs` records as lane evidence.
 *
 * COUNTS, STATES AND CLOSED LABELS ONLY (CLAUDE.md §4). No amount, no customer, no charge id, no
 * account id, no token, and not one byte of a Stripe payload — `refCount` rather than the refs
 * themselves, because even an opaque Stripe object id is a business's own identifier once it lands
 * in a file that gets pasted into a plan.
 */
export type StripeReadEvidence = {
  entity: StripeEntity;
  /**
   * The Stripe API version this read was pinned to, read from the DEPLOYMENT's own configuration —
   * `null` when the lane is unconfigured and therefore could not read at all.
   *
   * It is reported by the read rather than typed by the operator running the smoke script, because
   * an operator-supplied version is an unverified claim about a shape: the evidence would name a
   * version the deployment never used, and nothing downstream could tell.
   */
  apiVersion: string | null;
  state: Projection<unknown>["state"];
  itemCount: number;
  capped: boolean;
  missing: string | null;
  rejected: number;
  retrievedAt: number | null;
  refCount: number;
};

/**
 * One entity read, reduced to evidence. INTERNAL — no browser reaches it — and UNGATED, because
 * this is what earns the lane its pass (see `gatedRead`). It cannot widen anything: it still goes
 * through `readEntityRows`, so the same allow-list, the same closed entity union, the same caps,
 * the same version pin and the same GET-only transport apply. The only thing it skips is the
 * `lane === "passed"` check that would otherwise make the pass a prerequisite for its own evidence.
 */
export const stripeReadEvidence = internalAction({
  args: { tenantId: v.string(), environment: environmentArg, entity: entityArg },
  handler: async (ctx, { tenantId, environment, entity }): Promise<StripeReadEvidence> => {
    let apiVersion: string | null;
    try {
      apiVersion = stripeApp().apiVersion;
    } catch {
      apiVersion = null;
    }
    const { projection, rejected } = await readEntityRows(ctx, {
      tenantId,
      environment,
      entity,
      windowDays: STRIPE_DEFAULT_WINDOW_DAYS,
    });
    if (projection.state === "unavailable") {
      return {
        entity,
        apiVersion,
        state: "unavailable",
        itemCount: 0,
        capped: false,
        // `because` is this repo's own closed prose, never a provider message.
        missing: projection.because,
        rejected,
        retrievedAt: null,
        refCount: 0,
      };
    }
    return {
      entity,
      apiVersion,
      state: projection.state,
      itemCount: projection.items.length,
      capped: projection.meta.capped,
      missing: projection.state === "partial" ? projection.missing : null,
      rejected,
      retrievedAt: projection.meta.retrievedAt,
      refCount: projection.meta.sources.length,
    };
  },
});
