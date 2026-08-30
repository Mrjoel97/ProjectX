// 28.1-04 (BILL-01) — the two tenant-facing billing doors, and there are only two.
//
// Everything else about subscription management is Stripe's HOSTED surface by decision: no
// Elements, no embedded checkout, no Payment Link, and no custom upgrade / downgrade / cancel /
// payment-method UI anywhere in this repo. That decision is what keeps card data, CVCs, expiry
// and 3DS entirely outside this codebase — a scan in `billing.test.ts` holds it.
//
// MIGRATION TRIGGER, recorded so it is not discovered the hard way: the day usage events are
// metered TO Stripe, the Customer Portal can no longer manage those subscriptions and management
// must move to the Subscription Update API. v1 avoids this by keeping metering internal. That is
// a migration, not a flag flip.
import { TRIAL_DAYS } from "@pikar/billing/config";
import { subscriptionState } from "@pikar/billing/events";
import { unappliedStage } from "@pikar/billing/reconcile";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery } from "./_generated/server";
import { stripeHostedUrl, stripePost } from "./billingApi";
import { billingCoverageFor } from "./billingLedger";
import { tenantAction, tenantQuery } from "./lib/functions";

/**
 * How long two Customer Portal requests share one idempotency key.
 *
 * DELIBERATELY NOT the checkout's daily window, and the difference is load-bearing: a portal
 * session `url` is SINGLE-USE and short-lived, so replaying a day-old key hands the user back a
 * link that has already been spent. Sixty seconds collapses a double-click and nothing more.
 */
export const PORTAL_IDEMPOTENCY_WINDOW_MS = 60_000;

/** The result shape both doors return: a hosted url, or a code-token refusal. Never prose. */
type Door = { ok: true; url: string } | { ok: false; reason: string };

const doorReturns = v.union(
  v.object({ ok: v.literal(true), url: v.string() }),
  v.object({ ok: v.literal(false), reason: v.string() }),
);

/**
 * The UTC day a checkout belongs to. Matches the ~24h window Stripe itself keeps an idempotency
 * key for, so the key and the guarantee expire together rather than one outliving the other.
 */
export function billingPeriodKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * The price to subscribe to, read as a LITERAL `process.env.X` so `convex/env.test.ts` can see it.
 *
 * It is deployment config rather than a source constant because a TEST price id must never be
 * readable as a live one — the two accounts hold different objects under the same name.
 */
function requirePriceId(): string {
  const priceId = process.env.BILLING_STRIPE_PRICE_ID;
  if (typeof priceId !== "string" || priceId.trim() === "") {
    throw new Error("BILLING_STRIPE_PRICE_ID is not set — refusing to open Checkout");
  }
  return priceId;
}

/**
 * The app origin Stripe returns the buyer to.
 *
 * No `?? "http://localhost:3111"` fallback, unlike the older routes in `http.ts`: a checkout whose
 * `success_url` points at a dead origin takes the money and strands the buyer on nothing.
 */
function requireAppOrigin(): string {
  const origin = process.env.SITE_URL;
  if (typeof origin !== "string" || origin.trim() === "") {
    throw new Error("SITE_URL is not set — refusing to open Checkout with no return origin");
  }
  return origin.replace(/\/+$/, "");
}

/**
 * The Checkout session parameters, built from inputs ONLY so the same inputs always produce the
 * same body — Stripe errors when one idempotency key is replayed with different parameters.
 *
 * `trialDays` is an ARGUMENT rather than a config read so the unconfigured case is testable at a
 * boundary. A null, zero, negative or fractional trial is not a trial: it refuses instead of
 * quietly opening a checkout that charges immediately, which is a different product than the one
 * the pricing page promises.
 */
export function checkoutParams(input: {
  tenantId: string;
  priceId: string;
  trialDays: number | null;
  origin: string;
}): Record<string, string> {
  const { tenantId, priceId, trialDays, origin } = input;
  if (typeof trialDays !== "number" || !Number.isInteger(trialDays) || trialDays <= 0) {
    throw new Error("TRIAL_DAYS is not configured — refusing to open Checkout with no trial");
  }
  return {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "subscription_data[trial_period_days]": String(trialDays),
    // A TRIAL, not freemium: the card is collected up front so the subscription auto-converts.
    // `if_required` would open a trial with no payment method and silently become freemium.
    payment_method_collection: "always",
    // THE THREAD. 28.1-05's `checkout.session.completed` handler has no other way back to a
    // tenant; without it a paid checkout has nothing to match and must dead-letter.
    client_reference_id: tenantId,
    "metadata[tenantId]": tenantId,
    // THE SAME THREAD, ON THE SUBSCRIPTION. `client_reference_id` lives on the Checkout Session
    // only, and Stripe does not guarantee delivery order: a `customer.subscription.created` that
    // overtakes its `checkout.session.completed` carries no session, so without this it cannot be
    // attributed to a tenant at all and must dead-letter. Added in 28.1-05 (deviation Rule 2) —
    // "order-independent" is not achievable with one thread.
    "subscription_data[metadata][tenantId]": tenantId,
    success_url: `${origin}/dashboard/settings?checkout=success`,
    cancel_url: `${origin}/dashboard/settings?checkout=cancel`,
  };
}

/**
 * Lift ONLY the hosted url out of a Checkout/Portal session response, and only if it is Stripe's.
 *
 * The caller redirects a browser to whatever comes back, so an unvalidated `url` field is an open
 * redirect with a Stripe response as its source. Everything else in the response — the customer
 * id, `customer_details.email`, the amount — is dropped here rather than at the UI.
 *
 * The origin check itself lives in `billingApi.ts` (`stripeHostedUrl`), shared with the invoice
 * rollup, which reads the same class of url off `invoice.hosted_invoice_url`.
 */
function hostedUrl(value: unknown): string | null {
  return stripeHostedUrl((value as { url?: unknown } | null)?.url);
}

/**
 * POST a hosted-page session and return its url or a refusal.
 *
 * The refusal reason is Stripe's shape-checked `error.code` or the failure KIND — both code
 * tokens. No Stripe prose, no status text and no body excerpt reaches a caller or a log
 * (CLAUDE.md §4); `billingApi.ts` has already dropped them.
 */
async function hostedSession(
  path: string,
  params: Record<string, string>,
  idempotencyKey: string,
): Promise<Door> {
  const result = await stripePost(path, params, { idempotencyKey });
  if (!result.ok) return { ok: false, reason: result.error.code ?? `stripe_${result.error.kind}` };
  const url = hostedUrl(result.value);
  if (url === null) return { ok: false, reason: "no_hosted_url" };
  return { ok: true, url };
}

/**
 * The Customer Portal transport, exported so it is exercised rather than dead.
 *
 * `portalLink` cannot reach this until 28.1-05 lands the tenant↔customer mapping, and an
 * untested arm sitting behind a green suite is a gap this repo has already paid for twice.
 */
export function portalSession(
  customerId: string,
  returnUrl: string,
  idempotencyKey: string,
): Promise<Door> {
  return hostedSession(
    "/v1/billing_portal/sessions",
    { customer: customerId, return_url: returnUrl },
    idempotencyKey,
  );
}

/**
 * The tenant's Stripe customer id, or null.
 *
 * An `internalQuery` rather than a helper because `portalLink` is an ACTION and an action has no
 * `ctx.db` — the same shape `requireOwnerAction` takes for the same reason. Not client-callable,
 * so there is no second door to authorize; `tenantId` arrives from `tenantAction`'s own identity
 * resolution and is never caller-supplied.
 *
 * Null must NEVER become "create one". Provisioning a Stripe customer to make a portal call
 * succeed mints a merchant-side object that nothing in this database maps back to.
 */
export const stripeCustomerFor = internalQuery({
  args: { tenantId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { tenantId }) => {
    const row = await ctx.db
      .query("billingCustomers")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .first();
    return row?.stripeCustomerId ?? null;
  },
});

/** BILL-01: start a Stripe-hosted Checkout for the flat-rate plan. */
export const startCheckout = tenantAction({
  args: {},
  returns: doorReturns,
  handler: async (ctx): Promise<Door> => {
    const priceId = requirePriceId();
    const origin = requireAppOrigin();
    return hostedSession(
      "/v1/checkout/sessions",
      checkoutParams({ tenantId: ctx.tenantId, priceId, trialDays: TRIAL_DAYS, origin }),
      // Deterministic per (tenant, price, UTC day): a double-click cannot mint two sessions, and
      // the key is derived from exactly the inputs that build the body above.
      `checkout:${ctx.tenantId}:${priceId}:${billingPeriodKey(Date.now())}`,
    );
  },
});

/**
 * BILL-01: open the Customer Portal, which is where upgrade, downgrade, cancel and
 * payment-method changes all live. There is deliberately no custom UI for any of them.
 */
export const portalLink = tenantAction({
  args: {},
  returns: doorReturns,
  handler: async (ctx): Promise<Door> => {
    const customerId = await ctx.runQuery(internal.billing.stripeCustomerFor, {
      tenantId: ctx.tenantId,
    });
    if (customerId === null) return { ok: false, reason: "no_stripe_customer" };
    const origin = requireAppOrigin();
    const window = Math.floor(Date.now() / PORTAL_IDEMPOTENCY_WINDOW_MS);
    return portalSession(
      customerId,
      `${origin}/dashboard/settings`,
      `portal:${ctx.tenantId}:${customerId}:${window}`,
    );
  },
});

/**
 * BILL-01: what this tenant's billing state is — or, honestly, that we do not know.
 *
 * `unknown` is NOT `not_subscribed` and is never a free tier or a zero, and 28.1-05 did not change
 * that — it only gave the other two arms a row to be reached from. THREE things still answer
 * `unknown`: no mapping at all, a mapping written by a checkout that has not yet seen a
 * `customer.subscription.*` (status `pending`), and any status Stripe adds after
 * `subscriptionState` was written. The classification is @pikar/billing's; this handler only reads
 * the row.
 */
export const billingStatus = tenantQuery({
  args: {},
  returns: v.object({
    state: v.union(v.literal("unknown"), v.literal("not_subscribed"), v.literal("subscribed")),
  }),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("billingCustomers")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .first();
    return { state: subscriptionState(row?.status) };
  },
});

/**
 * How many held balances one read returns. A tenant has ONE Stripe customer, so in practice this
 * is one row per currency — the cap exists because an unbounded read on a money surface is a
 * defect waiting for a bad day, not because the number is expected to be large.
 */
export const UNAPPLIED_FUNDS_PAGE_LIMIT = 100;

const DAY_MS = 86_400_000;

/**
 * BILL-03: money we HOLD that is attached to nothing — with its AGE, which is the whole point.
 *
 * **THIS IS NOT "MONEY ARRIVED", AND GETTING IT BACKWARDS IS THE TRAP THE RESEARCH FLAGGED.**
 * Under Stripe's DEFAULT automatic reconciliation, `cash_balance.funds_available` fires only when
 * a positive balance REMAINS after reconciliation. So every row here is leftover bank-transfer
 * money in the customer's cash balance that Stripe could not match to an invoice — not a payment,
 * and not revenue. It books ZERO `billingEvents` rows for exactly that reason.
 *
 * THE AGE IS THE ACTIONABLE HALF. The amount alone cannot be acted on, because unreconciled money
 * has a clock: Stripe emails reminders, attempts to RETURN the funds to the customer's bank at
 * `UNRECONCILED_RETURN_DAYS` (75), and SWEEPS what it cannot return to the account balance by
 * `UNRECONCILED_SWEEP_DAYS` (90). A screen that shows the number without the age reports a
 * standing balance that is quietly about to leave.
 *
 * COVERAGE IS REPORTED SEPARATELY AND IS NEVER FOLDED INTO THE LIST. An empty list under
 * `unknown` means "we have never watched this tenant's billing"; an empty list under `known` means
 * "there is genuinely nothing held". Rendering both as "nothing owed" is the `CashFigure` mistake
 * (`@pikar/core`'s `cash.ts`): missing history is unknown, never zero.
 */
export const unappliedFunds = tenantQuery({
  args: {},
  returns: v.object({
    coverage: v.union(v.literal("unknown"), v.literal("known")),
    coverageStartedAt: v.union(v.number(), v.null()),
    funds: v.array(
      v.object({
        stripeObjectId: v.string(),
        amountMinor: v.number(),
        currency: v.string(),
        ageDays: v.number(),
        stage: v.union(v.literal("held"), v.literal("return-attempted"), v.literal("swept")),
      }),
    ),
    /** True when the cap bit. Said out loud, because a silently partial money list is a wrong one. */
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    const coverageStartedAt = await billingCoverageFor(ctx, ctx.tenantId);
    const page = await ctx.db
      .query("billingUnapplied")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .take(UNAPPLIED_FUNDS_PAGE_LIMIT + 1);
    const now = Date.now();

    return {
      // `null` is the unknown, and it is not collapsed into a zero anywhere on the way out.
      coverage: coverageStartedAt === null ? ("unknown" as const) : ("known" as const),
      coverageStartedAt,
      funds: page.slice(0, UNAPPLIED_FUNDS_PAGE_LIMIT).map((row) => {
        // From `observedAt`, which is when the money was FIRST seen unapplied and never moves —
        // so the clock keeps running while the row sits here, which is the behaviour that makes
        // the 75/90 stages mean anything. Two currencies are two rows and are never combined.
        const ageDays = Math.max(0, Math.floor((now - row.observedAt) / DAY_MS));
        return {
          stripeObjectId: row.stripeObjectId,
          amountMinor: row.amountMinor,
          currency: row.currency,
          ageDays,
          stage: unappliedStage(ageDays),
        };
      }),
      truncated: page.length > UNAPPLIED_FUNDS_PAGE_LIMIT,
    };
  },
});

/**
 * How many invoices one read returns. A monthly biller reaches this in four years, so the cap is
 * about never letting a money surface run unbounded — not about the number being expected.
 */
export const INVOICE_PAGE_LIMIT = 50;

/**
 * BILL-04: the tenant's invoices, as ONE LINK EACH.
 *
 * B2B customers who cannot pay by card pay on Stripe's HOSTED INVOICE PAGE
 * (`invoice.hosted_invoice_url`). We serve that link and nothing else: no invoice renderer, no
 * payment form, no card field and no custom 3DS anywhere in this repo (locked decision, and
 * `billing.test.ts` scans both this subsystem and `apps/web` to hold it). The hosted page is also
 * what handles authentication and, where the merchant's country supports it, prints the bank
 * transfer instructions.
 *
 * BANK TRANSFER IS COUNTRY-GATED AND THIS DEPLOYMENT CANNOT ANSWER IT. `BANK_TRANSFER_ENABLED` is
 * `true` in config but `HEAD_OFFICE_COUNTRY` is null and `CONFIG_CONFIRMED` is false — the
 * business is not registered yet. If bank transfer turns out NOT to be available for the eventual
 * country, nothing here changes and nothing here is faked: the hosted page simply serves card
 * payment and the transfer instructions do not appear. The code path is not deleted, because the
 * law it encodes (we serve a link, we never render a payment surface) is what makes it safe to
 * enable later. Recorded in `docs/playbooks/billing.md`.
 *
 * ONLY `posted` PERIODS. A `pending` or `claimed` period is work in progress and a `failed` one is
 * an operator's problem — neither is a document anybody owes money on, and neither has a hosted
 * url to serve. Showing them would turn an internal state machine into a billing statement.
 *
 * COVERAGE IS REPORTED SEPARATELY, exactly as `unappliedFunds` does it: an empty list under
 * `unknown` means "this ledger has never watched this tenant", an empty list under `known` means
 * "there is genuinely no invoice". Missing history is unknown, never zero (`@pikar/core`'s
 * `cash.ts`).
 */
export const invoices = tenantQuery({
  args: {},
  returns: v.object({
    coverage: v.union(v.literal("unknown"), v.literal("known")),
    coverageStartedAt: v.union(v.number(), v.null()),
    invoices: v.array(
      v.object({
        periodKey: v.string(),
        periodStart: v.number(),
        periodEnd: v.number(),
        postedAt: v.number(),
        amountMinor: v.number(),
        currency: v.string(),
        /** Stripe's, verbatim. It was validated to an https `*.stripe.com` origin before it was
         *  stored (`billingApi.stripeHostedUrl`); nothing re-writes it on the way out. */
        hostedInvoiceUrl: v.string(),
      }),
    ),
    /** True when the cap bit. A silently partial list of bills is a wrong one. */
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    const coverageStartedAt = await billingCoverageFor(ctx, ctx.tenantId);
    const page = await ctx.db
      .query("billingPeriods")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .take(INVOICE_PAGE_LIMIT + 1);

    return {
      coverage: coverageStartedAt === null ? ("unknown" as const) : ("known" as const),
      coverageStartedAt,
      invoices: page
        .slice(0, INVOICE_PAGE_LIMIT)
        // ponytail: filter after the page rather than a fourth index on `status`. Ceiling: a
        // tenant with more than INVOICE_PAGE_LIMIT unposted periods would push posted ones off
        // the page. Upgrade path: a `by_tenant_status` index, the day a producer exists at all.
        .flatMap((row) =>
          row.status === "posted" &&
          row.hostedInvoiceUrl !== undefined &&
          row.postedAt !== undefined &&
          row.amountMinor !== undefined &&
          row.currency !== undefined
            ? [
                {
                  periodKey: row.periodKey,
                  periodStart: row.periodStart,
                  periodEnd: row.periodEnd,
                  postedAt: row.postedAt,
                  amountMinor: row.amountMinor,
                  currency: row.currency,
                  hostedInvoiceUrl: row.hostedInvoiceUrl,
                },
              ]
            : [],
        ),
      truncated: page.length > INVOICE_PAGE_LIMIT,
    };
  },
});
