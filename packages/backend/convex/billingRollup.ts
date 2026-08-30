// 28.1-07 (BILL-04) — THE INVOICE ROLLUP. Stripe has no built-in recurrence for standalone
// invoices, so the schedule is ours — and Convex's scheduling guarantees make the obvious shape
// wrong.
//
// ── WHY THE CRON POINTS AT A MUTATION ───────────────────────────────────────────────────────
// Scheduled MUTATIONS are executed EXACTLY ONCE and internal errors are auto-retried. Scheduled
// ACTIONS are executed AT MOST ONCE and are NOT auto-retried — they permanently fail on a
// transient error. A cron aimed straight at an `internalAction` that POSTs an invoice therefore
// drops a whole billing period in silence: no retry, no error surface, no invoice. So `tick` is
// an `internalMutation` that CLAIMS the period, and `scheduler.runAfter` from inside a mutation
// is ATOMIC with it — if the claim patch rolls back, nothing was scheduled.
// A cron run is also SKIPPED while the previous one is still executing, which is a second reason
// the outbound work cannot live in the tick itself.
//
// ── WHY THE `billingPeriods` ROW IS THE GUARD, AND THE `Idempotency-Key` IS NOT ─────────────
// Stripe prunes idempotency keys once they are ~24h old and then treats a reuse as a brand-new
// request. A rollup retried a day later with the identical key mints a SECOND invoice and
// double-bills the customer. The header is a SAME-DAY belt (`billingApi.ts` carries the same
// contract at the transport); the claim row is the braces, and it never expires. Every refusal in
// `postInvoice` below is therefore checked against the ROW before `stripePost` is reached.
//
// ── WHY THE DOCUMENT IS CREATED BEFORE ITS LINES ────────────────────────────────────────────
// DEVIATION from the plan, which specified items-first then one invoice. `POST /v1/invoices`
// pulls ALL pending invoice items for a customer, so items-first is unbounded BY CONSTRUCTION:
// the leftovers of a period that failed last month get swept onto this month's bill. The document
// is created first with `pending_invoice_items_behavior=exclude`, each line is attached to THAT
// invoice by id, and only then is it finalized — which is also what mints the hosted invoice page
// a draft does not have. Same one clean document, actually bounded.
//
// ── §4 ──────────────────────────────────────────────────────────────────────────────────────
// Nothing caller-written reaches Stripe or a row. A charge carries a code-owned `kind` from a
// CLOSED union and the line description is looked up from `INVOICE_LINE_LABELS`; a failure is
// stored as a code token (Stripe's shape-checked `error.code`, or one of ours), never prose.
import { REF_TOKEN } from "@pikar/billing/reconcile";
import { normalizeCurrency } from "@pikar/revenue/money";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { stripeHostedUrl, stripePost } from "./billingApi";
import { ownerMutation } from "./lib/functions";

// ── Bounds, all code-owned ────────────────────────────────────────────────────────────────────

/** How many due periods one tick may claim, per status. An unbounded scan on a money path is a
 *  defect waiting for a bad day; a backlog drains over consecutive days instead. */
export const PERIOD_SCAN_LIMIT = 100;

/** How many lines one invoice may carry. Beyond this the period is REFUSED rather than partially
 *  billed — a bill missing lines is a wrong bill, and a 500-line invoice is a runaway producer. */
export const MAX_PERIOD_CHARGES = 100;

/**
 * How long a `claimed` period may sit before a later tick takes it back.
 *
 * A stated multiple of the mechanism it backstops, never a round number chosen for looking
 * sensible (`reliabilitySweep.ts` idiom): a post is at most `MAX_PERIOD_CHARGES + 2` Stripe calls
 * at `BILLING_STRIPE_TIMEOUT_MS` each, well inside a Convex action's own ceiling. An hour of no
 * settle means the chain is not slow — it is GONE, and the action will never run again.
 */
export const CLAIM_STALE_MS = 60 * 60_000;

/**
 * How many times one period may be attempted before it stops.
 *
 * It STOPS rather than retrying for ever: a permanently-failing period hammering Stripe daily is
 * not resilience. The row stays `failed` and visible — never deleted, never marked done — so an
 * operator can still see it, and `reliability-sweep` remains the surface for non-terminal states.
 */
export const MAX_PERIOD_ATTEMPTS = 5;

/**
 * What a customer reads on their invoice, per charge kind.
 *
 * A CLOSED map over a closed union, and the only text this codebase ever puts on a document that
 * gets mailed out. A free-text description field on `billingPeriods` would be the one door by
 * which customer content — or a model's prose — could reach a customer-facing artefact (§4).
 */
export const INVOICE_LINE_LABELS = {
  subscription: "Pikar AI subscription",
  usage: "Pikar AI usage",
  adjustment: "Pikar AI adjustment",
} as const;

type ChargeKind = keyof typeof INVOICE_LINE_LABELS;
type Charge = Doc<"billingPeriods">["charges"][number];
/**
 * What the POSTING side sees: a charge with its provenance stripped (`periodForPost`). Separate
 * from `Charge` on purpose — `raisedBy` is a local fact about who raised the line, and the half of
 * this module that talks to Stripe has no business being able to read it (§4).
 */
export type PostedCharge = Omit<Charge, "raisedBy">;

// ── The keys ──────────────────────────────────────────────────────────────────────────────────

/**
 * The billing period a moment belongs to: the UTC month, `YYYY-MM`.
 *
 * DETERMINISTIC AND REF-SAFE, because the Stripe idempotency key is derived from it and from the
 * tenant id — and that key is an HTTP HEADER VALUE. A tenant id carrying a space or a CR/LF is
 * header injection; refusing here is a refusal, while letting `fetch` reject it later is a 500.
 * UTC, never local time: a local-time month rolls over at a different instant for every reader.
 */
export function periodKeyFor(tenantId: string, atMs: number): string {
  if (typeof tenantId !== "string" || tenantId.length === 0 || tenantId.length > 128) {
    throw new Error("periodKeyFor: tenantId must be a ref-safe token of 1-128 characters");
  }
  if (!REF_TOKEN.test(tenantId)) {
    throw new Error("periodKeyFor: tenantId must be ref-safe — the idempotency key is a header");
  }
  if (!Number.isSafeInteger(atMs)) {
    throw new Error("periodKeyFor: the period instant must be a safe integer count of ms");
  }
  return new Date(atMs).toISOString().slice(0, 7);
}

/** The DURABLE-looking key that is not durable. See the idempotency contract at the top. */
export function invoiceIdempotencyKey(tenantId: string, periodKey: string): string {
  return `billing-invoice:${tenantId}:${periodKey}`;
}

// ── The claim ─────────────────────────────────────────────────────────────────────────────────

/**
 * Every period a tick may claim right now, bounded.
 *
 * Three sources, and the third is the one that makes the promise "a period is never silently
 * dropped" true: a `claimed` row whose posting action died leaves no terminal and throws nothing,
 * so nothing else would ever notice it. `posted` is deliberately absent — it is TERMINAL.
 */
async function claimable(ctx: MutationCtx, nowMs: number): Promise<Doc<"billingPeriods">[]> {
  const out: Doc<"billingPeriods">[] = [];
  for (const status of ["pending", "failed"] as const) {
    const page = await ctx.db
      .query("billingPeriods")
      .withIndex("by_status_dueAt", (q) => q.eq("status", status).lte("dueAt", nowMs))
      .take(PERIOD_SCAN_LIMIT);
    out.push(
      ...page.filter(
        (row) =>
          row.attempts < MAX_PERIOD_ATTEMPTS &&
          // AUDIT #3, FAIL CLOSED: a `failed` row whose invoice already exists at Stripe is an
          // OPERATOR problem, not a retry. Re-posting mints a second document that also collects,
          // and the customer is billed twice for one period. `pending` rows never carry one.
          row.stripeInvoiceId === undefined,
      ),
    );
  }
  const claimed = await ctx.db
    .query("billingPeriods")
    .withIndex("by_status_dueAt", (q) => q.eq("status", "claimed").lte("dueAt", nowMs))
    .take(PERIOD_SCAN_LIMIT);
  out.push(
    ...claimed.filter(
      (row) => row.attempts < MAX_PERIOD_ATTEMPTS && nowMs - (row.claimedAt ?? 0) >= CLAIM_STALE_MS,
    ),
  );
  return out;
}

/**
 * THE CRON ENTRY POINT, and it is a MUTATION on purpose (see the header).
 *
 * The claim is read-then-patch under OCC, the same law as `spendLedger.recordMovement`: a
 * concurrent second tick is re-run by Convex, finds the row already `claimed`, and no-ops. So a
 * double tick claims once and schedules once.
 */
export const tick = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const nowMs = Date.now();
    for (const period of await claimable(ctx, nowMs)) {
      await ctx.db.patch(period._id, {
        status: "claimed",
        claimedAt: nowMs,
        attempts: period.attempts + 1,
      });
      // ATOMIC with the patch above. If the mutation rolls back, nothing was scheduled.
      await ctx.scheduler.runAfter(0, internal.billingRollup.postInvoice, { periodId: period._id });
    }
    return null;
  },
});

// ── What the action is allowed to see ─────────────────────────────────────────────────────────

const chargeValidator = v.object({
  ref: v.string(),
  kind: v.union(v.literal("subscription"), v.literal("usage"), v.literal("adjustment")),
  amountMinor: v.number(),
  currency: v.string(),
  occurredAt: v.number(),
});

/**
 * The claimed period plus its Stripe customer, or NULL when the period is not claimable work.
 *
 * Returning null for a period that is not `claimed` is THE DURABLE REFUSAL: a `posted` row cannot
 * be posted a second time, and the refusal happens here — in our own database, before `fetch` —
 * rather than in an idempotency key Stripe has already pruned.
 *
 * A missing mapping is null, NEVER "create one". Provisioning a Stripe customer to make an
 * invoice succeed mints a merchant-side object nothing in this database maps back to
 * (`billing.stripeCustomerFor`, same law).
 */
export const periodForPost = internalQuery({
  args: { periodId: v.id("billingPeriods") },
  returns: v.union(
    v.null(),
    v.object({
      tenantId: v.string(),
      periodKey: v.string(),
      periodStart: v.number(),
      periodEnd: v.number(),
      charges: v.array(chargeValidator),
      customerId: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { periodId }) => {
    const period = await ctx.db.get(periodId);
    if (period === null || period.status !== "claimed") return null;
    const mapping = await ctx.db
      .query("billingCustomers")
      .withIndex("by_tenant", (q) => q.eq("tenantId", period.tenantId))
      .first();
    return {
      tenantId: period.tenantId,
      periodKey: period.periodKey,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      // `raisedBy` is STRIPPED here, not carried. It is a local provenance fact; the action that
      // talks to Stripe has no use for it, and every field that does not cross this boundary is a
      // field that cannot leak across it (§4).
      charges: period.charges.map(({ raisedBy: _raisedBy, ...line }) => line),
      customerId: mapping?.stripeCustomerId ?? null,
    };
  },
});

// ── The document, decided before anything is sent ─────────────────────────────────────────────

type Prepared = {
  currency: string;
  lines: { ref: string; kind: ChargeKind; amountMinor: number }[];
};

/**
 * Decide the whole document from the claim row, or refuse it with a code — PURELY, and before a
 * single byte goes out. A half-posted invoice is not recoverable by anything here, so every
 * reason to refuse is found first.
 *
 * The window is HALF-OPEN, `[periodStart, periodEnd)`: `periodEnd` is the next period's first
 * instant, so a charge sitting exactly on it belongs to next month's bill and not to this one.
 */
export function prepareInvoice(period: {
  periodStart: number;
  periodEnd: number;
  charges: readonly PostedCharge[];
}): { ok: true; value: Prepared } | { ok: false; code: string } {
  const { charges, periodStart, periodEnd } = period;
  if (charges.length > MAX_PERIOD_CHARGES) return { ok: false, code: "too_many_charges" };

  const refs = new Set<string>();
  for (const charge of charges) {
    if (!Number.isSafeInteger(charge.amountMinor) || charge.amountMinor <= 0) {
      // Direction lives in the kind, never in the sign (`billingEvents`' law). A credit is a
      // Stripe CREDIT NOTE, not a negative line smuggled onto an invoice.
      return { ok: false, code: "unusable_charge_amount" };
    }
    if (!charge.ref || charge.ref.length > 64 || !REF_TOKEN.test(charge.ref)) {
      return { ok: false, code: "unusable_charge_ref" };
    }
    // The per-line idempotency key is derived from the ref, so two identical refs would collide
    // and Stripe would REPLAY the first line instead of adding the second — a silently short bill.
    if (refs.has(charge.ref)) return { ok: false, code: "duplicate_charge_ref" };
    refs.add(charge.ref);
    if (!Number.isSafeInteger(charge.occurredAt)) {
      return { ok: false, code: "unusable_charge_time" };
    }
  }

  const currencies = new Set(
    charges.map((charge) => {
      const normalized = normalizeCurrency(charge.currency);
      return normalized.ok ? normalized.value : "";
    }),
  );
  if (currencies.has("")) return { ok: false, code: "unusable_charge_currency" };
  // REFUSED, never summed: picking a winner would invent an exchange rate, and an invoice carries
  // exactly one currency (`@pikar/revenue`'s law, and `recordBillingMovement`'s).
  if (currencies.size !== 1) return { ok: false, code: "mixed_currency" };
  const currency = [...currencies][0] as string;

  const lines = charges
    .filter((charge) => charge.occurredAt >= periodStart && charge.occurredAt < periodEnd)
    .map((charge) => ({ ref: charge.ref, kind: charge.kind, amountMinor: charge.amountMinor }));
  // An invoice for nothing is not a document anybody should receive, and it would consume the
  // period's only claim. Refused, and therefore re-claimable.
  if (lines.length === 0) return { ok: false, code: "no_charges_in_period" };

  return { ok: true, value: { currency, lines } };
}

/** Stripe object ids are a prefix plus base62. Shape-checked before it is stored or interpolated
 *  into a request path. */
const INVOICE_ID = /^in_[A-Za-z0-9]{1,128}$/;

/** Seconds, because Stripe's `period[start]`/`period[end]` are UNIX timestamps, not ms. */
const seconds = (ms: number): string => String(Math.floor(ms / 1000));

// ── The outbound half — the ONLY action in this module ────────────────────────────────────────

/**
 * Post one period's invoice: create the bounded document, attach its lines, finalize it.
 *
 * AT MOST ONCE and never auto-retried. Everything durable about this function is therefore in the
 * two mutations either side of it: `tick` claimed the period, `settlePeriod` records the outcome,
 * and a run that dies in between leaves a stale `claimed` row that the next tick takes back.
 */
export const postInvoice = internalAction({
  args: { periodId: v.id("billingPeriods") },
  returns: v.null(),
  // The return type is ANNOTATED, not inferred, and it is not decoration: this handler calls two
  // functions in its OWN module through `internal.billingRollup.*`, so an inferred return makes
  // `typeof billingRollup` circular. TypeScript then falls back to `any` for the whole module —
  // which silently degrades `internal`/`api` inference in EVERY other file. Observed: 400+ new
  // errors across unrelated tests from this one missing annotation.
  handler: async (ctx, { periodId }): Promise<null> => {
    const period = await ctx.runQuery(internal.billingRollup.periodForPost, { periodId });
    // Not claimed — already posted, already settled, or gone. THE durable refusal, and it is
    // reached before any Stripe call, which is what makes it survive the 24h key pruning.
    if (period === null) return null;

    // AUDIT #3: once `/v1/invoices` has succeeded the document EXISTS at Stripe and, because
    // `auto_advance` is true, Stripe finalizes and collects it without us. A failure after this
    // point must therefore carry the id forward — losing it is what lets the next tick mint a
    // SECOND invoice that also collects. `crons.daily` guarantees that retry lands past Stripe's
    // ~24h idempotency-key pruning, so the key cannot save us either.
    let createdInvoiceId: string | null = null;
    const fail = (code: string): Promise<null> =>
      ctx.runMutation(internal.billingRollup.settlePeriod, {
        periodId,
        outcome: {
          ok: false as const,
          failureCode: code,
          ...(createdInvoiceId === null ? {} : { stripeInvoiceId: createdInvoiceId }),
        },
      });

    if (period.customerId === null) return await fail("no_stripe_customer");

    const prepared = prepareInvoice(period);
    if (!prepared.ok) return await fail(prepared.code);
    const { currency, lines } = prepared.value;
    const key = invoiceIdempotencyKey(period.tenantId, period.periodKey);
    // Stripe takes the currency lowercase; the ledger and our rows keep it canonical uppercase.
    const wire = currency.toLowerCase();

    // 1. THE DOCUMENT, created empty and BOUNDED. `pending_invoice_items_behavior=exclude` is the
    //    whole bound: without it this invoice swallows every unattached pending item the customer
    //    has, including the leftovers of a period that failed last month.
    const draft = await stripePost(
      "/v1/invoices",
      {
        customer: period.customerId,
        currency: wire,
        collection_method: "charge_automatically",
        auto_advance: "true",
        pending_invoice_items_behavior: "exclude",
        // AUDIT #4: the ONLY payment-method probe that can be live on the pinned API version.
        // `invoice.charge` and `invoice.payment_intent` are gone from Invoice post-Basil and we
        // never request expansions, so without this every `invoice.paid` is UNDETERMINABLE and
        // books no `actual` — card revenue would be unreachable by construction, fail-closed.
        "payment_settings[payment_method_types][0]": "card",
        "metadata[tenantId]": period.tenantId,
        "metadata[periodKey]": period.periodKey,
      },
      { idempotencyKey: key },
    );
    if (!draft.ok) return await fail(draft.error.code ?? `stripe_${draft.error.kind}`);
    const invoiceId = (draft.value as { id?: unknown } | null)?.id;
    if (typeof invoiceId !== "string" || !INVOICE_ID.test(invoiceId)) {
      return await fail("no_invoice_id");
    }
    createdInvoiceId = invoiceId;

    // 2. THE LINES, attached to THAT invoice by id. Each carries the explicit period, so the
    //    document says which window it bills even to a reader who never saw this row.
    for (const line of lines) {
      const item = await stripePost(
        "/v1/invoiceitems",
        {
          customer: period.customerId,
          invoice: invoiceId,
          amount: String(line.amountMinor),
          currency: wire,
          description: INVOICE_LINE_LABELS[line.kind],
          "period[start]": seconds(period.periodStart),
          "period[end]": seconds(period.periodEnd),
        },
        {
          idempotencyKey: `billing-invoice-item:${period.tenantId}:${period.periodKey}:${line.ref}`,
        },
      );
      if (!item.ok) return await fail(item.error.code ?? `stripe_${item.error.kind}`);
    }

    // 3. FINALIZE. A draft invoice has no `hosted_invoice_url`, and the hosted page is the ONLY
    //    payment surface this product has — card, or bank transfer, on Stripe's own page.
    const finalized = await stripePost(
      `/v1/invoices/${invoiceId}/finalize`,
      { auto_advance: "true" },
      { idempotencyKey: `billing-invoice-finalize:${period.tenantId}:${period.periodKey}` },
    );
    if (!finalized.ok) return await fail(finalized.error.code ?? `stripe_${finalized.error.kind}`);

    const body = finalized.value as {
      hosted_invoice_url?: unknown;
      amount_due?: unknown;
      currency?: unknown;
    } | null;
    const hostedInvoiceUrl = stripeHostedUrl(body?.hosted_invoice_url);
    // A finalized invoice with no usable hosted url is a bill nobody can pay. Reported as a
    // failure, never as a success with a missing link.
    if (hostedInvoiceUrl === null) return await fail("no_hosted_url");
    // STRIPE'S amount_due, not our subtotal: Stripe Tax adds lines we never sent, and reporting
    // our own sum as the bill would understate what the customer owes.
    const amountMinor = body?.amount_due;
    const settledCurrency = normalizeCurrency(String(body?.currency ?? ""));
    if (!Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0) {
      return await fail("unreadable_invoice_total");
    }
    if (!settledCurrency.ok) return await fail("unreadable_invoice_currency");

    await ctx.runMutation(internal.billingRollup.settlePeriod, {
      periodId,
      outcome: {
        ok: true as const,
        stripeInvoiceId: invoiceId,
        hostedInvoiceUrl,
        amountMinor: amountMinor as number,
        currency: settledCurrency.value,
      },
    });
    return null;
  },
});

// ── The settle ────────────────────────────────────────────────────────────────────────────────

const settleOutcome = v.union(
  v.object({
    ok: v.literal(true),
    stripeInvoiceId: v.string(),
    hostedInvoiceUrl: v.string(),
    amountMinor: v.number(),
    currency: v.string(),
  }),
  // AUDIT #3: optional, because a failure BEFORE `/v1/invoices` has no invoice to name.
  v.object({
    ok: v.literal(false),
    failureCode: v.string(),
    stripeInvoiceId: v.optional(v.string()),
  }),
);

/**
 * Record what the action did — a SEPARATE mutation, because the action is not transactional.
 *
 * It settles ONLY a `claimed` row, and that guard is the second half of one-period-one-invoice: a
 * settle arriving for a period that has already been posted (a duplicated action, a replayed
 * message, a late run) can never overwrite the invoice id that was recorded first.
 *
 * `attempts` is NOT incremented here. The claim already counted the attempt, so a failure that
 * never reached this mutation still burned one — which is the correct accounting for a chain that
 * died, and the reason `MAX_PERIOD_ATTEMPTS` bounds a severed chain too.
 */
export const settlePeriod = internalMutation({
  args: { periodId: v.id("billingPeriods"), outcome: settleOutcome },
  returns: v.null(),
  handler: async (ctx, { periodId, outcome }) => {
    const period = await ctx.db.get(periodId);
    if (period === null || period.status !== "claimed") return null;
    if (outcome.ok) {
      await ctx.db.patch(periodId, {
        status: "posted",
        postedAt: Date.now(),
        stripeInvoiceId: outcome.stripeInvoiceId,
        hostedInvoiceUrl: outcome.hostedInvoiceUrl,
        amountMinor: outcome.amountMinor,
        currency: outcome.currency,
        // Cleared: a period that succeeded on its third attempt must not still read as failing.
        failureCode: undefined,
      });
      return null;
    }
    // `failed`, not deleted and not `pending`: the code is what an operator reads, and the row
    // stays re-claimable by the next tick until `MAX_PERIOD_ATTEMPTS`.
    await ctx.db.patch(periodId, {
      status: "failed",
      failureCode: outcome.failureCode,
      // Kept so `claimable` can refuse this row. Never cleared on a later attempt: the invoice
      // does not stop existing at Stripe because we tried again.
      ...(outcome.stripeInvoiceId === undefined
        ? {}
        : { stripeInvoiceId: outcome.stripeInvoiceId }),
    });
    return null;
  },
});

/** Re-exported for the tenant-facing read in `billing.ts`, so the id type has one source. */
// ── The producer (28.1-10, BILL-04) ───────────────────────────────────────────────────────────

/**
 * The UTC month `atMs` falls in, half-open `[periodStart, periodEnd)` — the SAME window
 * `prepareInvoice` filters charges against. Deriving it anywhere else is how a charge gets opened
 * into a period that will later refuse it with `no_charges_in_period`: a bill for nothing, which
 * also consumes the period's only claim.
 *
 * `periodEnd` doubles as `dueAt`, so a period becomes claimable the instant its month closes and
 * never mid-month. `Date.UTC` rolls month 12 into the next January on its own.
 */
function monthWindow(atMs: number): { periodStart: number; periodEnd: number } {
  const at = new Date(atMs);
  return {
    periodStart: Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1),
    periodEnd: Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1),
  };
}

/**
 * THE ONLY WRITER OF `billingPeriods`, and it is OWNER-ONLY.
 *
 * 28.1-07 built a correct, bounded rollup with no input: nothing opened a period, so the cron ran
 * daily, found nothing due, and did nothing, for every tenant, forever. This is the input — a
 * one-off charge the owner types: a setup fee, custom work, a correction.
 *
 * `ownerMutation`, never `tenantMutation` (CLAUDE.md §2). A tenant must not be able to bill
 * themselves, and must not be able to bill anyone else.
 *
 * PROVENANCE COMES FROM `ctx`, NEVER FROM AN ARGUMENT. `requireOwner` has already resolved who is
 * calling; `raisedBy` is that identity and there is no parameter that could override it. A money
 * figure a request body can author, stored in a row that later renders as the owner's own charge,
 * is this repo's recorded provenance-laundering defect class.
 *
 * `kind` IS HARD-CODED HERE and is deliberately not a parameter — a parameter is how the metered
 * kind gets written by accident, and the phase's locked decision is that metering stays internal
 * for v1. The day metered events go to Stripe is the day the Customer Portal can no longer manage
 * those subscriptions.
 *
 * EVERY REFUSAL IS AT THE DOOR, not at the invoice. A charge that `prepareInvoice` would later
 * reject (a bad amount, a duplicate ref, a second currency, one line too many) is refused here
 * where the owner can see it, rather than silently turning a period into one that can only fail.
 *
 * A NON-`pending` PERIOD REFUSES rather than opening a second one. Silently opening another period
 * for a late charge would split one month across two invoices; an invoice already claimed or sent
 * cannot grow, and a charge landing on a `claimed` row would ride onto a retry.
 *
 * ponytail: no admin UI. The owner reaches this through the Convex dashboard or a script. The
 * upgrade path, the day it needs one, is an owner-only panel beside `BillingPanel` — the
 * validation and the provenance law live here, so a UI would only have to call it.
 */
export const raiseAdjustment = ownerMutation({
  args: {
    tenantId: v.string(),
    ref: v.string(),
    amountMinor: v.number(),
    currency: v.string(),
    occurredAt: v.optional(v.number()),
  },
  returns: v.id("billingPeriods"),
  handler: async (ctx, args) => {
    const occurredAt = args.occurredAt ?? Date.now();
    // Throws on a tenant id or an instant that is not ref-safe. That IS the refusal: the Stripe
    // idempotency key is derived from both and it is an HTTP HEADER VALUE.
    const periodKey = periodKeyFor(args.tenantId, occurredAt);

    if (!Number.isSafeInteger(args.amountMinor) || args.amountMinor <= 0) {
      // Direction lives in the kind, never in the sign. A credit is a Stripe credit note.
      throw new Error("raiseAdjustment: an amount must be a positive safe integer of minor units");
    }
    if (args.ref.length === 0 || args.ref.length > 64 || !REF_TOKEN.test(args.ref)) {
      throw new Error("raiseAdjustment: ref must be a ref-safe token of 1-64 characters");
    }
    const currency = normalizeCurrency(args.currency);
    if (!currency.ok) throw new Error("raiseAdjustment: unusable currency");

    const { periodStart, periodEnd } = monthWindow(occurredAt);
    const charge = {
      ref: args.ref,
      kind: "adjustment" as const,
      amountMinor: args.amountMinor,
      currency: currency.value,
      occurredAt,
      raisedBy: ctx.tenantId,
    };

    const existing = await ctx.db
      .query("billingPeriods")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId).eq("periodKey", periodKey))
      .first();

    let periodId: Id<"billingPeriods">;
    let chargeCount: number;
    if (existing === null) {
      periodId = await ctx.db.insert("billingPeriods", {
        tenantId: args.tenantId,
        periodKey,
        periodStart,
        periodEnd,
        dueAt: periodEnd,
        status: "pending",
        charges: [charge],
        attempts: 0,
      });
      chargeCount = 1;
    } else {
      if (existing.status !== "pending") {
        throw new Error(`raiseAdjustment: period ${periodKey} is ${existing.status}, not pending`);
      }
      // IDEMPOTENT ON `ref`, and the FIRST amount stands. `ref` is half the per-line Stripe
      // idempotency key, so a second line under the same ref would be replayed rather than added
      // — a silently short bill. Re-raising is a no-op, not a revaluation.
      if (existing.charges.some((row) => row.ref === args.ref)) return existing._id;
      if (existing.charges.length >= MAX_PERIOD_CHARGES) {
        throw new Error("raiseAdjustment: this period already carries the maximum lines");
      }
      // One invoice carries exactly one currency (`@pikar/revenue`'s law). Refusing here beats
      // letting `prepareInvoice` answer `mixed_currency` on a period nobody is watching.
      if (existing.charges.some((row) => row.currency !== currency.value)) {
        throw new Error("raiseAdjustment: this period is already denominated in another currency");
      }
      await ctx.db.patch(existing._id, { charges: [...existing.charges, charge] });
      periodId = existing._id;
      chargeCount = existing.charges.length + 1;
    }

    // §4: refs, ids, counts and the amount. No description field exists to hold a human note, and
    // that is the point — the owner's reason belongs in their own records, not in the audit log.
    await ctx.runMutation(internal.audit.log, {
      tenantId: args.tenantId,
      correlationId: `billing-period:${args.tenantId}:${periodKey}`,
      eventType: "billing.adjustment.raised",
      actor: ctx.tenantId,
      payload: {
        source: "billing",
        periodKey,
        ref: args.ref,
        kind: "adjustment",
        amountMinor: args.amountMinor,
        currency: currency.value,
        charges: chargeCount,
      },
    });
    return periodId;
  },
});

export type BillingPeriodId = Id<"billingPeriods">;
