// 28.1-04 (BILL-01, BILL-02) — THE outbound transport to PIKAR'S OWN Stripe account.
//
// This is the only place in the repo that talks outward to `api.stripe.com` on Pikar's own
// credentials. Everything that charges, invoices or links to a hosted Stripe page goes through
// `stripePost` / `stripeGet` and through nothing else.
//
// NOT `connectorFetch.ts`. That module is Phase 28's READ rail into a TENANT's Stripe account:
// hard-coded `method: "GET"`, a deliberately empty `stripe: []` path allow-list, and a different
// secret family (`STRIPE_APP_*`). Opposite direction, opposite trust boundary. Widening it to
// carry a POST on Pikar's own key is the single thing the `billing*` / `stripe*` name split
// exists to prevent.
//
// No `stripe` npm package: it is not installed, a few lines cover form-encoded POST + GET
// (CLAUDE.md §8 rung 5), and it would drag a bundle into the Convex runtime.
//
// NOT `"use node"`, deliberately: nothing here needs a Node API, and a `"use node"` module may
// hold only actions — which would stop `billing.ts` importing these functions at all.
//
// ── THE IDEMPOTENCY CONTRACT ────────────────────────────────────────────────────────────────
// `Idempotency-Key` on a Stripe POST is a SAME-DAY BELT ONLY. Stripe prunes keys after ~24h and
// then treats the request as brand new, so a retry more than a day later mints a SECOND object —
// a second subscription, a second invoice, a second charge. The durable guard is always our own
// claim row (28.1-07's `billingPeriods`). This header never replaces it and must never be cited
// as if it did.
import { STRIPE_API_BASE, STRIPE_API_VERSION } from "@pikar/billing/config";
import { err, ok, type Result } from "@pikar/core/result";

/**
 * How long one Stripe call may take. Convex actions are at-most-once and a hung call burns the
 * whole action budget, so the deadline is code-owned rather than left to the platform default.
 */
export const BILLING_STRIPE_TIMEOUT_MS = 20_000;

/**
 * Why a Stripe call failed, in refs and codes ONLY (CLAUDE.md §4).
 *
 * There is deliberately no `message`, no `param` and no body excerpt. Stripe's `error.message` is
 * prose written for a human and routinely quotes the offending value back — an email address, a
 * customer name, an object id someone else owns — and everything in this type is a candidate for
 * an audit row or a structured log.
 */
export type StripeFailure = {
  /** `http` = Stripe answered and refused. `network`/`timeout` = it never answered. */
  kind: "http" | "network" | "timeout";
  status: number | null;
  /** Stripe's `error.code` enum token, shape-checked. Null when absent or not a token. */
  code: string | null;
  /** Stripe's `Request-Id` header — the only handle their support will act on. */
  requestId: string | null;
};

/** Stripe's error codes are lower snake_case enum tokens. Anything else is prose, so it is dropped. */
const ERROR_CODE = /^[a-z0-9_]{1,64}$/;
/** Stripe request ids are `req_` + base62. */
const REQUEST_ID = /^req_[A-Za-z0-9]{1,64}$/;

const token = (value: unknown, shape: RegExp): string | null =>
  typeof value === "string" && shape.test(value) ? value : null;

/**
 * The secret key for Pikar's own merchant account, read as a LITERAL `process.env.X` because
 * `convex/env.test.ts` scans source text — a computed `process.env[name]` is invisible to it and
 * would drop this name out of `ENV_MANIFEST` coverage entirely.
 *
 * Blank counts as unset: `npx convex env set X ""` is the classic false-ready. There is no
 * development fallback (`p25-no-dev-fallback`) — a fallback here would charge a real card from a
 * misconfigured deployment.
 */
function requireSecret(): string {
  const key = process.env.BILLING_STRIPE_SECRET_KEY;
  if (typeof key !== "string" || key.trim() === "") {
    throw new Error("BILLING_STRIPE_SECRET_KEY is not set — refusing to call Stripe");
  }
  return key;
}

/**
 * The `Stripe-Version` we pin ourselves, never the account default.
 *
 * A null pin refuses for the SAME reason an unset secret does, and this is the non-obvious half:
 * an unpinned request still works, so nothing fails — it just silently inherits whatever version
 * the Dashboard is on, and the version decides whether an invoice's tax field is
 * `total_tax_amounts` or `total_taxes`. Sending a request that our parsers may not be able to
 * read is worse than not sending it.
 */
function requireApiVersion(): string {
  if (typeof STRIPE_API_VERSION !== "string" || STRIPE_API_VERSION.trim() === "") {
    throw new Error(
      "STRIPE_API_VERSION is not pinned in @pikar/billing/config — refusing to call Stripe",
    );
  }
  return STRIPE_API_VERSION;
}

/**
 * Form-encode, key-sorted.
 *
 * Sorting is what makes the body a pure function of the parameter SET rather than of the order
 * the caller happened to write them in. Stripe errors when one idempotency key is replayed with
 * different parameters, so "same inputs ⇒ same body" has to hold byte-for-byte.
 */
function encodeForm(params: Record<string, string>): string {
  return new URLSearchParams(
    Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ).toString();
}

async function send(url: string, init: RequestInit): Promise<Result<unknown, StripeFailure>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(BILLING_STRIPE_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    const timedOut = name === "TimeoutError" || name === "AbortError";
    return err({
      kind: timedOut ? "timeout" : "network",
      status: null,
      code: null,
      requestId: null,
    });
  }

  const requestId = token(response.headers.get("Request-Id"), REQUEST_ID);

  if (!response.ok) {
    // The body is read ONLY to lift `error.code`. Nothing else from it escapes this function —
    // not the message, not the param, not the request_log_url, not a non-JSON body.
    let code: string | null = null;
    try {
      const parsed = (await response.json()) as { error?: { code?: unknown } } | null;
      code = token(parsed?.error?.code, ERROR_CODE);
    } catch {
      code = null;
    }
    return err({ kind: "http", status: response.status, code, requestId });
  }

  try {
    return ok(await response.json());
  } catch {
    // A 2xx whose body will not parse is a failure, never a success with an empty value: a caller
    // reaching for `.url` on it would otherwise get `undefined` and report a broken link as fine.
    return err({ kind: "http", status: response.status, code: null, requestId });
  }
}

/**
 * A MUTATING Stripe call. `idempotencyKey` is a required parameter, not an option and not a
 * defaulted one — Convex actions are at-most-once while Stripe's own client retries, so a keyless
 * POST is how a duplicate subscription gets created. Read the idempotency contract at the top of
 * this file before treating it as a durable guard; it is not one.
 */
export async function stripePost(
  path: string,
  params: Record<string, string>,
  opts: { idempotencyKey: string },
): Promise<Result<unknown, StripeFailure>> {
  const key = requireSecret();
  const version = requireApiVersion();
  const idempotencyKey = opts?.idempotencyKey;
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
    throw new Error("stripePost requires a non-blank idempotencyKey");
  }
  return send(`${STRIPE_API_BASE}${path}`, {
    method: "POST",
    body: encodeForm(params),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": version,
      "Idempotency-Key": idempotencyKey,
    },
  });
}

/**
 * Is the outbound rail configured at all? `requireSecret`/`requireApiVersion` THROW, which is right
 * for a call that must not proceed — but a caller that has to report "configured or not" as a
 * FAILURE CODE rather than an exception needs to ask without catching. The env read stays in this
 * module, so `BILLING_STRIPE_SECRET_KEY` still has exactly one consumer (28.1-08).
 */
export function billingConfigured(): boolean {
  const key = process.env.BILLING_STRIPE_SECRET_KEY;
  return typeof key === "string" && key.trim() !== "";
}

/**
 * A DESTRUCTIVE Stripe call, and the only one in this repo.
 *
 * Stripe's IMMEDIATE cancellation is `DELETE /v1/subscriptions/{id}`. `POST` with
 * `cancel_at_period_end` schedules one instead, which is the wrong answer for a tenant erasure
 * (BILL-06): the subscription would go on charging a card belonging to nobody until the period
 * boundary, which is precisely the failure the requirement names.
 *
 * Keyed like `stripePost`, and required for the same reason — a Convex action is at-most-once, so a
 * cancellation retried without a key is a second DELETE that Stripe treats as a brand-new request.
 * Read the idempotency contract at the top of this file: the header is a same-day belt only.
 */
export async function stripeDelete(
  path: string,
  opts: { idempotencyKey: string },
): Promise<Result<unknown, StripeFailure>> {
  const key = requireSecret();
  const version = requireApiVersion();
  const idempotencyKey = opts?.idempotencyKey;
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
    throw new Error("stripeDelete requires a non-blank idempotencyKey");
  }
  return send(`${STRIPE_API_BASE}${path}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Stripe-Version": version,
      "Idempotency-Key": idempotencyKey,
    },
  });
}

/** Where a hosted Stripe page is allowed to send a browser. */
const STRIPE_HOSTED_SUFFIX = ".stripe.com";

/**
 * Validate a hosted Stripe url out of a Stripe response.
 *
 * A caller either redirects a browser to this or stores it and renders it as a link, so an
 * unvalidated url field is an open redirect with a Stripe response as its source. It lives HERE,
 * beside the transport, because both consumers read it off a Stripe body: `billing.ts` off a
 * Checkout/Portal session's `url`, and `billingRollup.ts` off an invoice's `hosted_invoice_url`.
 * One definition, or the second copy is the one that forgets the scheme check.
 *
 * ponytail: host SUFFIX check, not an allow-list of `checkout.`/`billing.`/`invoice.`. Ceiling: it
 * would accept a Stripe CUSTOM DOMAIN only if that domain were still under stripe.com, and we
 * configure none. Upgrade path: if a custom domain is ever configured, name it explicitly here.
 */
export function stripeHostedUrl(raw: unknown): string | null {
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
 * A READ. No `Idempotency-Key`: Stripe honours it on POST only, and sending one on a GET is a
 * silent no-op that reads like a guarantee.
 *
 * ponytail: no pagination, no retry. 28.1-05/06 add them at the call site if a listing ever needs
 * them; today nothing in production calls this and the shape exists so the read half of the
 * transport is not invented in a hurry later.
 */
export async function stripeGet(
  path: string,
  query?: Record<string, string>,
): Promise<Result<unknown, StripeFailure>> {
  const key = requireSecret();
  const version = requireApiVersion();
  const url = new URL(`${STRIPE_API_BASE}${path}`);
  for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
  return send(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Stripe-Version": version,
    },
  });
}
