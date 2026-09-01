// PayPal bounded READS — the thin adapter between the sealed credential and the pure normalizer
// (CLAUDE.md §1).
//
// ═══ THE GUARD THAT COMES BEFORE EVERY OTHER ONE ═══
//
// PayPal's Transaction Search documents ONE OAuth flow: client credentials. A token minted that way
// reads THE APP OWNER'S OWN PayPal account. So before this module reads anything, it re-derives
// WHOSE account the decrypted credential reaches — `classifyGrantSubject` — and returns
// `unavailable` for an `app_owner` subject. That check is not redundant with the ones in
// `paypalAuth`: those govern what may be SEALED, this governs what may be READ, and the whole
// defect this lane exists to prevent is a read that succeeds against the wrong merchant. Every other
// gate in this phase checks that the read WORKED, never whose money came back.
//
// WHAT THIS MODULE IS ALLOWED TO BE. It opens a credential, checks the subject, hands
// `connectorFetch.readPages` a path from the compile-time allow-list, runs the rows through
// `@pikar/revenue/providers/paypal`, and reports coverage. It contains:
//
//   • NO REQUEST VERB and NO TRANSPORT. `readPages` hardcodes GET and refuses a redirect.
//     `scripts/check-provider-lane.mjs` scans this file for a write verb and goes red on one.
//   • NO PATH PARAMETER. The caller picks an ENTITY from a two-member closed union; the path comes
//     from `PAYPAL_READ_PATHS` in the pure module, compared against the transport's allow-list in
//     both directions by the test file.
//   • NO ARITHMETIC. Every figure comes from `@pikar/revenue`'s `finance.ts` and `money.ts`.
//   • NO MODEL. Nothing here calls an LLM, and nothing downstream may let one produce, adjust or
//     repair a figure this returns — only explain one.
//
// ═══ NOTHING CAN CONNECT TODAY, AND THAT IS THE HONEST STATE ═══
//
// `paypalAuth.beginConnect` refuses: PayPal's third-party read surface (`partner-transactions`) is
// named in the published spec with no published operation, so it cannot be built from public
// documentation. This module is therefore complete and unreachable in production — which is the
// correct shape. The alternative, wiring the app's own client credentials into a tenant connection
// so that something reads, is the defect. 28-25 confronts the gap with the partner manager.
//
// NOT "use node": `readPages` uses the platform transport and `openCredential` uses
// `crypto.subtle`, both available in the default Convex runtime.

import type { Result } from "@pikar/core/result";
import {
  CAPS,
  type Currency,
  coverageOf,
  type FinanceResult,
  financeResult,
  groupByCurrency,
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
import {
  normalizeTransaction,
  PAYPAL_CURSOR_PARAM,
  PAYPAL_DEFAULT_WINDOW_DAYS,
  PAYPAL_MAX_PAGES,
  PAYPAL_MAX_WINDOW_DAYS,
  PAYPAL_READ_PATHS,
  type PayPalBalances,
  type PayPalEntity,
  parseBalances,
  parseTransactionsPage,
  paypalReadWindow,
  paypalWindowParams,
} from "@pikar/revenue/providers/paypal";
import { normalizeAll } from "@pikar/revenue/providers/shared";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, internalAction } from "./_generated/server";
import { requireCredentialKey } from "./connectorCredentials";
import { readPages } from "./connectorFetch";
import { tenantAction } from "./lib/functions";
import {
  classifyGrantSubject,
  parsePayPalCredential,
  requirePartnerMerchantId,
} from "./paypalAuth";
import { emitConnectorReadEvent, emitObservedRecoveryEvents } from "./revenueTelemetry";

const environmentArg = v.union(v.literal("sandbox"), v.literal("production"));

/**
 * The two entities a caller may name. A CLOSED UNION, not a string, and not a path. This is the
 * whole request surface of the PayPal rail: there is no way to express "GET this other path"
 * through it, and no way at all to express a write.
 */
const entityArg = v.union(v.literal("transactions"), v.literal("balances"));

type Rows = {
  transactions: Payment;
  balances: PayPalBalances;
};

/**
 * The `SourceAuthority` this rail speaks with.
 *
 * A payment rail owns WHEN CASH LANDED. It is NOT independent evidence that a booked invoice was
 * paid — believing both it and the accounting authority double-counts one business activity, which
 * `finance.reconcilePayments` refuses to do.
 */
const AUTHORITY = "payment_rail" as const;

const unavailable = (because: string): Projection<never> => ({
  state: "unavailable",
  provider: "paypal",
  because,
});

// ── The access token, and whose account it reaches ────────────────────────────────────────

type TokenOutcome = { ok: true; accessToken: string } | { ok: false; because: string };

/**
 * The token to read with — and the merchant it is bound to, checked here rather than trusted.
 *
 * There is no refresh branch, unlike the Stripe and QuickBooks lanes: PayPal's client-credentials
 * flow issues no refresh token, and nothing in this repository mints a PayPal token at all (see
 * `paypalAuth`'s header). A credential that has expired is a dead connection, not something this
 * module can renew behind the tenant's back.
 */
async function accessTokenFor(
  ctx: ActionCtx,
  args: { tenantId: string; environment: "sandbox" | "production" },
): Promise<TokenOutcome> {
  let partnerMerchantId: string;
  try {
    partnerMerchantId = requirePartnerMerchantId();
  } catch {
    // FAIL CLOSED, and this is the most important `catch` in the file. Without the partner's own
    // merchant id there is nothing to compare a grant against, so Pikar's account and a tenant's
    // merchant become indistinguishable — and the read would succeed either way.
    return { ok: false, because: "PayPal is not configured for this deployment" };
  }

  const connection = {
    tenantId: args.tenantId,
    provider: "paypal" as const,
    environment: args.environment,
  };
  const row = await ctx.runQuery(internal.connectorCredentials.get, connection);
  if (row === null) return { ok: false, because: "this tenant has no PayPal connection" };
  if (row.status === "revoked") {
    return { ok: false, because: "the PayPal connection was disconnected" };
  }
  if (!row.credentialCiphertextB64 || !row.credentialIvB64) {
    return { ok: false, because: "the PayPal credential is not available" };
  }

  const key = await requireCredentialKey(row.keyVersion);
  let credential: ReturnType<typeof parsePayPalCredential> = null;
  try {
    credential = parsePayPalCredential(
      await openCredential(
        key,
        {
          tenantId: args.tenantId,
          provider: "paypal",
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
  if (credential === null) return { ok: false, because: "the PayPal credential is not available" };

  const subject = classifyGrantSubject({
    partnerMerchantId,
    grantedMerchantId: credential.merchantId,
  });
  if (subject.kind !== "delegated_merchant") {
    // The whole point. A token that reaches Pikar's own PayPal account must never produce a
    // projection attributed to a tenant, and the failure has to be visible as a REFUSAL rather than
    // as a successful read of the wrong ledger.
    return {
      ok: false,
      because: "this PayPal credential reads Pikar's own account, not this tenant's merchant",
    };
  }

  if ((row.accessExpiresAt ?? 0) !== 0 && (row.accessExpiresAt ?? 0) <= Date.now()) {
    return { ok: false, because: "the PayPal access token has expired and cannot be renewed here" };
  }
  return { ok: true, accessToken: credential.accessToken };
}

// ── The bounded read ──────────────────────────────────────────────────────────────────────

type ReadOutcome<T> = { projection: Projection<T>; rejected: number };

/**
 * Read one entity over one window, under every bound this repo owns AND PayPal's own.
 *
 * THE PARTIAL RULE. A capped read, a 429, a lost page and a row that would not normalize all
 * produce a `partial` projection that NAMES what is missing. None of them produce a shorter `ready`
 * list: a prefix of a receipts ledger presented as complete understates what a business took in.
 *
 * MIXED CURRENCY IS NOT SEPARATED HERE, deliberately, for the same reason as the Stripe lane: a
 * PayPal merchant holds balances in whatever currencies it is configured for and every transaction
 * carries its own, so there is no "home currency" to pick and inferring one from the first row is
 * how a caller silently totals the wrong ledger. The projection carries them all and the derived
 * figures below total each currency on its own.
 */
async function readEntityRows<K extends keyof Rows>(
  ctx: ActionCtx,
  args: {
    tenantId: string;
    environment: "sandbox" | "production";
    entity: K & PayPalEntity;
    windowDays: number;
  },
): Promise<ReadOutcome<Rows[K]>> {
  const token = await accessTokenFor(ctx, args);
  if (!token.ok) return { projection: unavailable(token.because), rejected: 0 };

  const asOfMs = Date.now();
  const window = paypalReadWindow(asOfMs, args.windowDays);
  if (!window.ok) {
    return { projection: unavailable("the requested read window is out of bounds"), rejected: 0 };
  }

  const isBalances = args.entity === "balances";
  const read = await readPages<Record<string, unknown>>({
    provider: "paypal",
    environment: args.environment,
    path: PAYPAL_READ_PATHS[args.entity],
    accessToken: token.accessToken,
    cursorParam: PAYPAL_CURSOR_PARAM,
    ...(isBalances ? {} : { query: paypalWindowParams(window.value) }),
    // `/v1/reporting/balances` is a snapshot: one object, no page counters, nothing to walk.
    maxPages: isBalances ? 1 : PAYPAL_MAX_PAGES,
    parsePage: (raw) =>
      isBalances
        ? { items: [raw as Record<string, unknown>], cursor: null }
        : (() => {
            const page = parseTransactionsPage(raw);
            return { items: page.rows, cursor: page.cursor };
          })(),
  });

  await ctx.runMutation(internal.connectorCredentials.recordReadOutcome, {
    tenantId: args.tenantId,
    provider: "paypal",
    environment: args.environment,
    ...(read.stoppedBy?.kind === "failure" ? { failureClass: read.stoppedBy.failureClass } : {}),
  });

  const normalizers = {
    transactions: normalizeTransaction,
    balances: parseBalances,
  } as const;
  // The one cast in this file. `normalizers[args.entity]` is correct at runtime — the table is
  // keyed by the same closed union `K` is drawn from — but TypeScript widens the lookup to the
  // union of both return types and cannot re-narrow it against a generic index.
  const normalize = normalizers[args.entity] as (raw: unknown) => Result<Rows[K], string>;
  const normalized = normalizeAll(read.items, normalize);

  const missing: string[] = [];
  if (read.stoppedBy?.kind === "cap") {
    missing.push(`the read stopped at the ${read.stoppedBy.reason}`);
  }
  if (read.stoppedBy?.kind === "failure") {
    missing.push(`PayPal returned ${read.stoppedBy.failureClass}`);
  }
  if (normalized.rejected > 0) {
    missing.push(`${normalized.rejected} PayPal row(s) could not be read`);
  }

  const meta: ProjectionMeta = {
    provider: "paypal",
    authority: AUTHORITY,
    retrievedAt: asOfMs,
    // The window ends three hours back, because that is how long PayPal takes to list an executed
    // transaction. The coverage claimed here is therefore one this rail can actually stand behind.
    window: { startMs: window.value.startMs, endMs: window.value.endMs },
    capped: read.capped,
    // The balance snapshot has no object id of its own, so it contributes no source ref.
    sources: normalized.rows
      .slice(0, CAPS.maxSources)
      .map((row) => (row as { ref?: SourceRef }).ref)
      .filter((ref): ref is SourceRef => ref !== undefined),
  };
  const projection: Projection<Rows[K]> =
    missing.length === 0
      ? { state: "ready", meta, items: normalized.rows }
      : { state: "partial", meta, items: normalized.rows, missing: missing.join("; ") };

  const valid = validateProjection(projection);
  if (!valid.ok) {
    return {
      projection: unavailable("this PayPal read could not be validated"),
      rejected: normalized.rejected,
    };
  }
  return { projection, rejected: normalized.rejected };
}

/**
 * The gate, checked on every TENANT-FACING read — and deliberately NOT inside `readEntityRows`.
 *
 * The two axes only stay apart if the thing that EARNS a pass can run before the pass exists.
 * `providerGates.lane` becomes `passed` once a controlled live read has been observed, and 28-25
 * would observe it by driving `paypalReadEvidence` below. If the shared read path refused on
 * `lane !== "passed"`, the only way to ever seal PayPal would be to seal it FIRST and verify
 * afterwards — which publishes it into `availableProviders` for every tenant on evidence nobody
 * has. 28-05, 28-06 and 28-07 all reached the same conclusion; the gate governs CONSUMPTION.
 *
 * For PayPal the gate is doubly certain to refuse today: the open condition
 * `no-documented-revoke-endpoint` is unresolved, so `resolveProviderEligibility` will not return
 * `passed` on that alone, whatever the owner approved.
 */
async function gatedRead<K extends keyof Rows>(
  ctx: ActionCtx,
  args: {
    tenantId: string;
    environment: "sandbox" | "production";
    entity: K & PayPalEntity;
    windowDays: number;
  },
): Promise<ReadOutcome<Rows[K]>> {
  const gate = await ctx.runQuery(internal.providerGates.gateEligibility, {
    provider: "paypal",
    environment: args.environment,
  });
  if (gate.state !== "passed") {
    return { projection: unavailable(`the PayPal lane is ${gate.state}`), rejected: 0 };
  }
  return readEntityRows(ctx, args);
}

const windowArg = v.optional(v.number());

const clampWindow = (days: number | undefined): number => {
  if (days === undefined || !Number.isSafeInteger(days) || days < 1) {
    return PAYPAL_DEFAULT_WINDOW_DAYS;
  }
  return Math.min(days, PAYPAL_MAX_WINDOW_DAYS);
};

/**
 * The bounded read, tenant-scoped. The tenant comes from the authenticated identity — there is no
 * `tenantId` argument by which one tenant could read another's PayPal merchant.
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
    await emitConnectorReadEvent(ctx, ctx.tenantId, "paypal", outcome.projection);
    if (outcome.projection.state !== "unavailable" && entity === "transactions") {
      await emitObservedRecoveryEvents(
        ctx,
        ctx.tenantId,
        "paypal",
        outcome.projection.meta.retrievedAt,
        (outcome.projection.items as readonly Payment[])
          .filter((payment) => payment.invoiceId !== null)
          .map((payment) => ({
            externalRef: payment.invoiceId as string,
            status: "paid" as const,
          })),
      );
    }
    return outcome.projection;
  },
});

// ── The derived answers, computed by finance.ts and money.ts ──────────────────────────────

const currenciesOf = (amounts: readonly Money[]): Currency[] =>
  [...groupByCurrency(amounts).keys()].sort((a, b) => a.localeCompare(b));

/**
 * Cash actually received through the rail, per currency.
 *
 * IT GOES THROUGH `finance.reconcilePayments` EVEN WITH ONE SOURCE: `receiptsTotal` only accepts a
 * `Reconciled`, so there is no shape in this file that could total raw provider payments. When
 * 28-12/28-13 combine this with the QuickBooks lane, the same call refuses to count one business
 * activity twice.
 *
 * PayPal reversals arrive as their own negative transactions, so a window containing a refund
 * totals NET without this module subtracting anything.
 *
 * An UNAVAILABLE read yields `value: null` with an unavailable coverage, never a zero total. "We
 * could not see your PayPal merchant" and "you received nothing" are different sentences.
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
      entity: "transactions",
      windowDays: clampWindow(windowDays),
    });
    const coverage = coverageOf([projection]);
    if (projection.state === "unavailable") return financeResult(null, coverage);

    const reconciled = reconcilePayments([
      { authority: AUTHORITY, window: projection.meta.window, payments: projection.items },
    ]);
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
          missing: [...coverage.missing, "the PayPal receipts could not be totalled"],
        });
      }
      totals.push(total.value);
    }
    return financeResult(totals, coverage);
  },
});

/**
 * The AVAILABLE balance, per currency. The total is deliberately excluded: it includes withheld and
 * unsettled money, and reporting it as spendable would show cash the business cannot use.
 *
 * `null` means we could not see the merchant, and `finance.cashTimeline` treats a null opening
 * balance as UNKNOWN rather than as zero — which is the whole reason this returns null instead of
 * an empty list of totals.
 */
export const balanceOnHand = tenantAction({
  args: { environment: environmentArg },
  handler: async (ctx, { environment }): Promise<FinanceResult<readonly Money[] | null>> => {
    const { projection } = await gatedRead(ctx, {
      tenantId: ctx.tenantId,
      environment,
      entity: "balances",
      windowDays: PAYPAL_DEFAULT_WINDOW_DAYS,
    });
    const coverage = coverageOf([projection]);
    if (projection.state === "unavailable") return financeResult(null, coverage);

    const snapshot = projection.items[0];
    if (snapshot === undefined) return financeResult(null, coverage);
    const totals: Money[] = [];
    for (const currency of currenciesOf(snapshot.available)) {
      const sum = sumMoney(
        snapshot.available.filter((m) => m.currency === currency),
        currency,
      );
      if (!sum.ok) {
        return financeResult(null, {
          ...coverage,
          partial: true,
          missing: [...coverage.missing, "the PayPal balance could not be totalled"],
        });
      }
      totals.push(sum.value);
    }
    return financeResult(totals, coverage);
  },
});

// ── Lane evidence (28-25) ─────────────────────────────────────────────────────────────────

/**
 * The sanitized shape `scripts/smoke-paypal-read.mjs` records as lane evidence.
 *
 * COUNTS, STATES AND CLOSED LABELS ONLY (CLAUDE.md §4). No amount, no customer, no transaction id,
 * no merchant id, no account number, no token, and not one byte of a PayPal payload — `refCount`
 * rather than the refs themselves.
 */
export type PayPalReadEvidence = {
  entity: PayPalEntity;
  state: Projection<unknown>["state"];
  itemCount: number;
  capped: boolean;
  missing: string | null;
  rejected: number;
  retrievedAt: number | null;
  refCount: number;
  /**
   * Whether the credential this read used was bound to a merchant OTHER than Pikar's own — the one
   * fact that separates a tenant's revenue from the app owner's. Recorded as a BOOLEAN, never as
   * the merchant id.
   */
  delegatedMerchant: boolean;
};

/**
 * One entity read, reduced to evidence. INTERNAL — no browser reaches it — and UNGATED, because
 * this is what would EARN the lane its pass (see `gatedRead`). It cannot widen anything: it still
 * goes through `readEntityRows`, so the same allow-list, the same closed entity union, the same
 * caps, the same window bounds, the same app-owner refusal and the same GET-only transport apply.
 * The only thing it skips is the `lane === "passed"` check that would otherwise make the pass a
 * prerequisite for its own evidence.
 */
export const paypalReadEvidence = internalAction({
  args: { tenantId: v.string(), environment: environmentArg, entity: entityArg },
  handler: async (ctx, { tenantId, environment, entity }): Promise<PayPalReadEvidence> => {
    const token = await accessTokenFor(ctx, { tenantId, environment });
    const { projection, rejected } = await readEntityRows(ctx, {
      tenantId,
      environment,
      entity,
      windowDays: PAYPAL_DEFAULT_WINDOW_DAYS,
    });
    const delegatedMerchant = token.ok;
    if (projection.state === "unavailable") {
      return {
        entity,
        state: "unavailable",
        itemCount: 0,
        capped: false,
        // `because` is this repo's own closed prose, never a provider message.
        missing: projection.because,
        rejected,
        retrievedAt: null,
        refCount: 0,
        delegatedMerchant,
      };
    }
    return {
      entity,
      state: projection.state,
      itemCount: projection.items.length,
      capped: projection.meta.capped,
      missing: projection.state === "partial" ? projection.missing : null,
      rejected,
      retrievedAt: projection.meta.retrievedAt,
      refCount: projection.meta.sources.length,
      delegatedMerchant,
    };
  },
});
