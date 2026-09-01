// QuickBooks Online bounded READS — the thin adapter between the sealed credential and the pure
// normalizer (CLAUDE.md §1).
//
// WHAT THIS MODULE IS ALLOWED TO BE. It opens a credential, refreshes it if it is about to die,
// hands `connectorFetch.readPages` a path from the compile-time allow-list, runs the rows through
// `@pikar/revenue/providers/quickbooks`, and reports coverage. It contains:
//
//   • NO REQUEST VERB and NO TRANSPORT. `readPages` hardcodes GET and refuses a redirect; the only
//     non-GET in the whole connector plane is `connectorOAuth.postTokenForm`.
//     `scripts/check-provider-lane.mjs` scans this file for a write verb and goes red on one.
//   • NO PATH PARAMETER. The caller picks an ENTITY from a four-member closed union. The path is
//     built here from a pinned template and the realm id read out of the ciphertext.
//   • NO ARITHMETIC. Every figure comes from `@pikar/revenue`'s `finance.ts`. A second copy of that
//     math would be a second, divergent definition of a number the owner acts on.
//   • NO MODEL. Nothing here calls an LLM, and nothing downstream may let one produce, adjust or
//     repair a figure this returns — only explain one.
//
// WHY THE GATE IS CHECKED ON EVERY TENANT-FACING READ, AND ONLY THERE.
// `com.intuit.quickbooks.accounting` grants the whole Accounting API, and on 2026-08-27 the owner
// ACCEPTED that blast radius on an attestation nothing in this repository can check. So the three
// exported tenant actions go through `gatedRead` and return `unavailable` unless `providerGates`
// resolves `passed` — an admission is permission to build, not evidence that a live read and a
// live revoke were ever observed. The lane-evidence action `quickbooksReadEvidence` deliberately
// does NOT consult the gate, because it is the thing that PRODUCES the evidence 28-23 seals on;
// see `gatedRead`'s note.
//
// NOT "use node": `readPages` uses the platform fetch and `openCredential` uses `crypto.subtle`,
// both available in the default Convex runtime.

import type { Result } from "@pikar/core/result";
import {
  type Aging,
  agingReport,
  CAPS,
  type Currency,
  coverageOf,
  type FinanceResult,
  financeResult,
  type Invoice,
  type Money,
  type Obligation,
  openCredential,
  type Payment,
  type Projection,
  type ProjectionMeta,
  type SourceRef,
  sumMoney,
  validateProjection,
} from "@pikar/revenue";
import {
  boundedWindow,
  buildEntityQuery,
  normalizeAll,
  normalizeBill,
  normalizeCashAccount,
  normalizeInvoice,
  normalizePayment,
  parseQueryPage,
  QB_DEFAULT_WINDOW_DAYS,
  QB_MINOR_VERSION,
  QB_PAGE_SIZE,
  type QbEntity,
  type ReadWindow,
  separateByCurrency,
} from "@pikar/revenue/providers/quickbooks";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, internalAction } from "./_generated/server";
import { requireCredentialKey } from "./connectorCredentials";
import { readPages } from "./connectorFetch";
import { tenantAction } from "./lib/functions";
import { ACCESS_REFRESH_SKEW_MS, parseQbCredential } from "./quickbooksAuth";
import { emitConnectorReadEvent } from "./revenueTelemetry";

const environmentArg = v.union(v.literal("sandbox"), v.literal("production"));

/**
 * The four entities a caller may name. A CLOSED UNION, not a string, and not a path.
 *
 * This is the whole request surface of the QuickBooks rail. There is no way to express "GET this
 * other path" through it, which is what makes the allow-list in `connectorFetch` the real boundary
 * rather than a boundary a caller could route around.
 */
const entityArg = v.union(
  v.literal("Invoice"),
  v.literal("Payment"),
  v.literal("Bill"),
  v.literal("Account"),
);

/** The one path template this lane uses. `{}` is the realm id — one segment, never a `/`. */
const queryPath = (realmId: string): string => `/v3/company/${realmId}/query`;

/**
 * ISO 4217 for the company's books, from configuration.
 *
 * QuickBooks omits `CurrencyRef` entirely on every row when a company has multicurrency switched
 * off, so SOMETHING has to say what those amounts are denominated in. It is deployment
 * configuration rather than a caller argument because it is a fact about the tenant's books, not a
 * choice a request gets to make — and it defaults to USD only because Intuit's own sandbox
 * companies are USD. `ponytail:` upgrade path — read `CompanyInfo.Country`/`HomeCurrency` once the
 * connections panel (28-09) has somewhere to show it.
 */
const homeCurrency = (): Currency => (process.env.QUICKBOOKS_HOME_CURRENCY ?? "USD").toUpperCase();

// ── What a read hands back ────────────────────────────────────────────────────────────────

type Rows = {
  Invoice: Invoice;
  Payment: Payment;
  Bill: Obligation;
  Account: { ref: SourceRef; balance: Money };
};

/** The `SourceAuthority` this rail speaks with. The books own whether an invoice exists. */
const AUTHORITY = "accounting_authority" as const;

const unavailable = (because: string): Projection<never> => ({
  state: "unavailable",
  provider: "quickbooks",
  because,
});

/**
 * The access token to read with — refreshing first if it is close enough to expiry that a read
 * could outlive it.
 *
 * Refreshing goes through `quickbooksAuth.refreshConnection`, which holds the lease and commits
 * under the fence. This function must never send its own token request: a second refresh path is a
 * second way to race Intuit's rolling refresh token, and that hazard kills connections rather than
 * failing them.
 */
async function accessTokenFor(
  ctx: ActionCtx,
  args: { tenantId: string; environment: "sandbox" | "production" },
): Promise<{ ok: true; accessToken: string; realmId: string } | { ok: false; because: string }> {
  const connection = {
    tenantId: args.tenantId,
    provider: "quickbooks" as const,
    environment: args.environment,
  };
  const row = await ctx.runQuery(internal.connectorCredentials.get, connection);

  if (row === null) return { ok: false, because: "this tenant has no QuickBooks connection" };
  if (row.status === "revoked") {
    return { ok: false, because: "the QuickBooks connection was disconnected" };
  }
  if (!row.credentialCiphertextB64 || !row.credentialIvB64) {
    return { ok: false, because: "the QuickBooks credential is not available" };
  }

  const key = await requireCredentialKey(row.keyVersion);
  let credential: ReturnType<typeof parseQbCredential> = null;
  try {
    credential = parseQbCredential(
      await openCredential(
        key,
        {
          tenantId: args.tenantId,
          provider: "quickbooks",
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
  if (credential === null) {
    return { ok: false, because: "the QuickBooks credential is not available" };
  }

  const expiring = (row.accessExpiresAt ?? 0) - Date.now() <= ACCESS_REFRESH_SKEW_MS;
  if (!expiring) {
    return { ok: true, accessToken: credential.accessToken, realmId: credential.realmId };
  }
  const refreshed = await ctx.runAction(internal.quickbooksAuth.refreshConnection, {
    tenantId: args.tenantId,
    environment: args.environment,
  });
  if (refreshed.ok) {
    return { ok: true, accessToken: refreshed.accessToken, realmId: refreshed.realmId };
  }
  // A refresh that could not run because ANOTHER refresher holds the lease is not a dead
  // connection — the current access token is still valid for up to the skew window, so the read
  // proceeds on it rather than reporting an outage that does not exist. Racing it would be the
  // second concurrent refresh Intuit documents as able to revoke the grant outright.
  if (refreshed.reason === "refresh_in_flight" || refreshed.reason === "stale_revision") {
    return { ok: true, accessToken: credential.accessToken, realmId: credential.realmId };
  }
  return { ok: false, because: "the QuickBooks access token could not be renewed" };
}

// ── The bounded read ──────────────────────────────────────────────────────────────────────

type ReadOutcome<T> = { projection: Projection<T>; rejected: number };

/**
 * Read one entity over one window, under every bound this repo owns.
 *
 * THE PARTIAL RULE, which is the expensive one to get wrong. A capped read, a 429, a lost page and
 * a row that would not normalize all produce a `partial` projection that NAMES what is missing.
 * None of them produce a shorter `ready` list, because a prefix of a receivables ledger presented
 * as complete understates what a tenant is owed and every downstream confidence rule would then
 * report `high` over it.
 */
async function readEntityRows<K extends keyof Rows>(
  ctx: ActionCtx,
  args: {
    tenantId: string;
    environment: "sandbox" | "production";
    entity: K & QbEntity;
    windowDays: number;
  },
): Promise<ReadOutcome<Rows[K]>> {
  const token = await accessTokenFor(ctx, args);
  if (!token.ok) return { projection: unavailable(token.because), rejected: 0 };

  const asOfMs = Date.now();
  const window = boundedWindow(asOfMs, args.windowDays);
  if (!window.ok)
    return { projection: unavailable("the requested read window is out of bounds"), rejected: 0 };
  const base = buildEntityQuery(args.entity, window.value);
  if (!base.ok)
    return { projection: unavailable("that QuickBooks entity is not readable"), rejected: 0 };

  // Intuit paginates INSIDE the query text (`STARTPOSITION`/`MAXRESULTS`), so the transport's
  // cursor IS the next query string and `cursorParam` is `query`. `readPages` replaces rather than
  // appends it, and its repeated-cursor guard still sees a value that changes per page.
  let startPosition = 1;
  const read = await readPages<Record<string, unknown>>({
    provider: "quickbooks",
    environment: args.environment,
    path: queryPath(token.realmId),
    accessToken: token.accessToken,
    cursorParam: "query",
    query: new URLSearchParams({
      query: `${base.value} STARTPOSITION 1 MAXRESULTS ${QB_PAGE_SIZE}`,
      minorversion: QB_MINOR_VERSION,
    }),
    parsePage: (raw) => {
      const page = parseQueryPage(args.entity, raw, base.value, startPosition);
      startPosition += QB_PAGE_SIZE;
      return { items: page.rows, cursor: page.nextQuery };
    },
  });

  await ctx.runMutation(internal.connectorCredentials.recordReadOutcome, {
    tenantId: args.tenantId,
    provider: "quickbooks",
    environment: args.environment,
    ...(read.stoppedBy?.kind === "failure" ? { failureClass: read.stoppedBy.failureClass } : {}),
  });

  const home = homeCurrency();
  const normalizers = {
    Invoice: (raw: unknown) => normalizeInvoice(raw, home),
    Payment: (raw: unknown) => normalizePayment(raw, home),
    Bill: (raw: unknown) => normalizeBill(raw, home),
    Account: (raw: unknown) => normalizeCashAccount(raw, home),
  } as const;
  // The one cast in this file. `normalizers[args.entity]` is correct at runtime — the table is
  // keyed by the same closed union `K` is drawn from — but TypeScript widens the lookup to the
  // union of all four return types and cannot re-narrow it against a generic index.
  const normalize = normalizers[args.entity] as (raw: unknown) => Result<Rows[K], string>;
  const normalized = normalizeAll(read.items, normalize);

  const currencyOfRow = (row: Rows[K]): Currency => {
    const r = row as { total?: Money; amount?: Money; balance?: Money };
    return (r.total ?? r.amount ?? r.balance)?.currency ?? home;
  };
  const split = separateByCurrency(normalized.rows, currencyOfRow, home);

  const missing: string[] = [];
  if (read.stoppedBy?.kind === "cap")
    missing.push(`the read stopped at the ${read.stoppedBy.reason}`);
  if (read.stoppedBy?.kind === "failure")
    missing.push(`QuickBooks returned ${read.stoppedBy.failureClass}`);
  if (normalized.rejected > 0) {
    missing.push(`${normalized.rejected} QuickBooks row(s) could not be read`);
  }
  if (split.otherCurrencies.length > 0) {
    missing.push(`amounts in ${split.otherCurrencies.join(", ")} are reported separately`);
  }

  const meta: ProjectionMeta = {
    provider: "quickbooks",
    authority: AUTHORITY,
    retrievedAt: asOfMs,
    window: { startMs: window.value.startMs, endMs: window.value.endMs },
    capped: read.capped,
    sources: split.kept.slice(0, CAPS.maxSources).map((row) => (row as { ref: SourceRef }).ref),
  };
  const projection: Projection<Rows[K]> =
    missing.length === 0
      ? { state: "ready", meta, items: split.kept }
      : { state: "partial", meta, items: split.kept, missing: missing.join("; ") };

  // The contract module's own validator, run on the way out. A projection that would fail it — a
  // capped read marked `ready`, an over-wide window, a ref carrying content — must not reach a
  // consumer, and catching it here is cheaper than discovering it in a rendered figure.
  const valid = validateProjection(projection);
  if (!valid.ok)
    return {
      projection: unavailable("this QuickBooks read could not be validated"),
      rejected: normalized.rejected,
    };
  return { projection, rejected: normalized.rejected };
}

/**
 * The gate, checked on every TENANT-FACING read — and deliberately NOT inside `readEntityRows`.
 *
 * The two axes only stay apart if the thing that EARNS a pass can run before the pass exists.
 * `providerGates.lane` is `passed` once a controlled live read and a live revoke have been
 * observed, and 28-23 observes them by driving `quickbooksReadEvidence` below. If the shared read
 * path refused on `lane !== "passed"`, the only way to ever seal the lane would be to seal it
 * FIRST and verify afterwards — which publishes QuickBooks into `availableProviders` for every
 * tenant on evidence nobody has, i.e. exactly the decorative seal `providerGates` exists to
 * prevent. 28-05 reached the same conclusion for HubSpot an hour earlier; the gate governs
 * CONSUMPTION, and consumption is these three actions.
 */
async function gatedRead<K extends keyof Rows>(
  ctx: ActionCtx,
  args: {
    tenantId: string;
    environment: "sandbox" | "production";
    entity: K & QbEntity;
    windowDays: number;
  },
): Promise<ReadOutcome<Rows[K]>> {
  const gate = await ctx.runQuery(internal.providerGates.gateEligibility, {
    provider: "quickbooks",
    environment: args.environment,
  });
  // An admission is permission to BUILD. A passed lane is evidence a live read and a live revoke
  // were observed. Only the second one lets a tenant see a figure.
  if (gate.state !== "passed") {
    return { projection: unavailable(`the QuickBooks lane is ${gate.state}`), rejected: 0 };
  }
  return readEntityRows(ctx, args);
}

const windowArg = v.optional(v.number());

const clampWindow = (days: number | undefined): number => {
  if (days === undefined || !Number.isSafeInteger(days) || days < 1) return QB_DEFAULT_WINDOW_DAYS;
  return Math.min(days, CAPS.maxWindowDays);
};

/**
 * The bounded read, tenant-scoped. The tenant comes from the authenticated identity — there is no
 * `tenantId` argument by which one tenant could read another's books.
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
    await emitConnectorReadEvent(ctx, ctx.tenantId, "quickbooks", outcome.projection);
    return outcome.projection;
  },
});

// ── The one derived answer, computed by finance.ts ────────────────────────────────────────

export type ReceivablesSummary = FinanceResult<Aging | null>;

/**
 * Open receivables, aged.
 *
 * EVERY NUMBER IN HERE IS `finance.agingReport`'s. This function normalizes rows and hands them
 * over; it does not add, bucket, compare or round anything, and it must never start to. Coverage
 * and confidence come from `coverageOf` / `financeResult` for the same reason — a confidence rule
 * written twice is a confidence rule that disagrees with itself.
 *
 * An UNAVAILABLE read yields `value: null` with `confidence: "unavailable"`, never a zero total.
 * "We could not see your books" and "you are owed nothing" are different sentences and only one of
 * them is ever true here.
 */
export const receivablesSummary = tenantAction({
  args: { environment: environmentArg, windowDays: windowArg },
  handler: async (ctx, { environment, windowDays }): Promise<ReceivablesSummary> => {
    const { projection } = await gatedRead(ctx, {
      tenantId: ctx.tenantId,
      environment,
      entity: "Invoice",
      windowDays: clampWindow(windowDays),
    });
    const coverage = coverageOf([projection]);
    if (projection.state === "unavailable") return financeResult(null, coverage);

    const aged = agingReport(projection.items, Date.now(), homeCurrency());
    if (!aged.ok) {
      // A refusal from the finance core is a real gap, not a zero. Reporting it as unavailable
      // coverage keeps `confidenceFor` from promoting an empty answer.
      return financeResult(null, {
        ...coverage,
        partial: true,
        missing: [...coverage.missing, "the receivables ledger could not be aged"],
      });
    }
    return financeResult(aged.value, coverage);
  },
});

/**
 * Cash on hand: the sum of the tenant's active depository account balances, in the home currency.
 *
 * `sumMoney` from `@pikar/revenue` does the addition — including refusing to total two currencies
 * into one figure. `null` means we could not see the accounts, and `finance.cashTimeline` treats a
 * null opening balance as UNKNOWN rather than as zero, which is the whole reason this returns null
 * instead of a zero Money.
 */
export const cashOnHand = tenantAction({
  args: { environment: environmentArg },
  handler: async (ctx, { environment }): Promise<FinanceResult<Money | null>> => {
    const { projection } = await gatedRead(ctx, {
      tenantId: ctx.tenantId,
      environment,
      entity: "Account",
      windowDays: QB_DEFAULT_WINDOW_DAYS,
    });
    const coverage = coverageOf([projection]);
    if (projection.state === "unavailable") return financeResult(null, coverage);

    const total = sumMoney(
      projection.items.map((account) => account.balance),
      homeCurrency(),
    );
    if (!total.ok) {
      return financeResult(null, {
        ...coverage,
        partial: true,
        missing: [...coverage.missing, "the cash accounts could not be totalled"],
      });
    }
    return financeResult(total.value, coverage);
  },
});

export type { ReadWindow };

// ── Lane evidence (28-23) ─────────────────────────────────────────────────────────────────

/**
 * The sanitized shape `scripts/smoke-quickbooks-read.mjs` records as lane evidence.
 *
 * COUNTS, STATES AND CLOSED LABELS ONLY (CLAUDE.md §4). No amount, no customer, no realm id, no
 * token, and not one byte of an Intuit payload — `refCount` rather than the refs themselves,
 * because even an opaque provider id is a company's own identifier once it lands in a file that
 * gets pasted into a plan.
 */
export type QbReadEvidence = {
  entity: QbEntity;
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
 * through `readEntityRows`, so the same allow-list, the same closed entity union, the same caps
 * and the same GET-only transport apply. The only thing it skips is the `lane === "passed"` check
 * that would otherwise make the pass a prerequisite for the evidence behind it.
 */
export const quickbooksReadEvidence = internalAction({
  args: { tenantId: v.string(), environment: environmentArg, entity: entityArg },
  handler: async (ctx, { tenantId, environment, entity }): Promise<QbReadEvidence> => {
    const { projection, rejected } = await readEntityRows(ctx, {
      tenantId,
      environment,
      entity,
      windowDays: QB_DEFAULT_WINDOW_DAYS,
    });
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
    };
  },
});
