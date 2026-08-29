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
import { v } from "convex/values";
import { stripePost } from "./billingApi";
import { tenantAction, tenantQuery } from "./lib/functions";

/**
 * How long two Customer Portal requests share one idempotency key.
 *
 * DELIBERATELY NOT the checkout's daily window, and the difference is load-bearing: a portal
 * session `url` is SINGLE-USE and short-lived, so replaying a day-old key hands the user back a
 * link that has already been spent. Sixty seconds collapses a double-click and nothing more.
 */
export const PORTAL_IDEMPOTENCY_WINDOW_MS = 60_000;

/** Where a hosted Stripe page is allowed to send a browser. */
const STRIPE_HOSTED_SUFFIX = ".stripe.com";

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
    success_url: `${origin}/dashboard/settings?checkout=success`,
    cancel_url: `${origin}/dashboard/settings?checkout=cancel`,
  };
}

/**
 * Lift ONLY the hosted url out of a Stripe response, and only if it points at Stripe.
 *
 * The caller redirects a browser to whatever comes back, so an unvalidated `url` field is an
 * open redirect with a Stripe response as its source. Everything else in the response — the
 * customer id, `customer_details.email`, the amount — is dropped here rather than at the UI.
 *
 * ponytail: host suffix check, not an allow-list of `checkout.` and `billing.`. Ceiling: it would
 * accept a Stripe CUSTOM DOMAIN only if that domain were still under stripe.com, and we configure
 * none. Upgrade path: if a custom Checkout domain is ever configured, name it explicitly here.
 */
function hostedUrl(value: unknown): string | null {
  const raw = (value as { url?: unknown } | null)?.url;
  if (typeof raw !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!parsed.hostname.endsWith(STRIPE_HOSTED_SUFFIX)) return null;
  return raw;
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
 * 28.1-05 creates the `billingCustomers` table and fills this in. Until then there is no table to
 * read, so it is null for every tenant — and null must NEVER become "create one". Provisioning a
 * customer to make a portal call succeed mints a Stripe object nothing maps back to.
 */
function stripeCustomerId(_tenantId: string): string | null {
  return null;
}

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
    const customerId = stripeCustomerId(ctx.tenantId);
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
 * `unknown` is NOT `not_subscribed` and is never a free tier or a zero. 28.1-05 creates
 * `billingCustomers`; today there is no row to read for anyone, so `unknown` is the only answer
 * the code has evidence for. The other two literals are the contract 28.1-05 fills in — they are
 * UNREACHABLE today and no test pretends otherwise.
 */
export const billingStatus = tenantQuery({
  args: {},
  returns: v.object({
    state: v.union(v.literal("unknown"), v.literal("not_subscribed"), v.literal("subscribed")),
  }),
  handler: async () => ({ state: "unknown" as const }),
});
