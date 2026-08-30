// Stripe App OAuth — read-only by construction, account-bound, and honest about revocation.
//
// A THIN ADAPTER (CLAUDE.md §1). The consent round-trip, the one-time state, the redirect hygiene,
// the single token request and the revocation-honesty rule live in `connectorOAuth.ts`; the
// encryption, the single-flight lease and the `revision` fence live in `connectorCredentials.ts`.
// What is genuinely Stripe's and lives HERE: the endpoints, the manifest permissions, the
// live/test-mode binding, the connected-account binding, and the shape of a grant.
//
// ═══ THE ROUTE, AND WHY IT IS NOT THE ONE THE PLAN WAS WRITTEN AGAINST ═══
//
// The 2026-08-05 research said Stripe read-only required becoming a Connect **Extension**. That
// door is CLOSED, not gated — Stripe: "Stripe Apps replaces Connect extensions — You can no longer
// build new Connect extensions." The Connect `read_only` scope "can only be specified for
// extensions", so it is permanently unavailable to this repo.
//
// The route built here is a **Stripe App** with `stripe_api_access_type: "oauth"` declaring only
// `*_read` manifest permissions. That is read-only BY CONSTRUCTION at the vendor: the token cannot
// express a write, which is a strictly stronger position than the QuickBooks lane, where a
// write-capable scope is contained only by this repo's own allow-list.
//
// DOC HAZARD, recorded so nobody re-derives the dead path: Stripe's
// `connect/oauth-changes-for-standard-platforms` page still tells you to "contact us" for Extension
// functionality. It was never updated for the deprecation. Do not follow it.
//
// ═══ REVOCATION IS AN OPEN CONDITION AND THIS MODULE KEEPS IT OPEN ═══
//
// There is NO documented platform-initiated revoke or uninstall for Stripe Apps. The only two
// documented mechanisms are the USER uninstalling from Settings -> Installed Apps, and the
// `account.application.deauthorized` event that reports it afterwards. Connect's deauthorize
// endpoint belongs to the OTHER flow and no Stripe documentation says it applies to app installs.
//
// So `disconnect` here attempts NOTHING upstream. It clears the local ciphertext — a real and
// useful act — and records `revocation.upstream = "unsupported"`, which is the honest member of
// 28-03's four-state union. It must never record `confirmed`; `classifyRevokeOutcome` makes that
// unreachable for this provider even if a 200 arrived from somewhere. 28-CONTEXT requires
// per-tenant revocation, the owner approved Stripe anyway as a recorded OVERRIDE, and 28-24 owes
// the answer. Nothing in this file closes it.
//
// NOT "use node": `crypto.subtle` and the platform transport are both reached through the shared
// modules, exactly as in `quickbooksAuth.ts`.
import {
  type ConnectionFailureClass,
  type ConnectorEnvironment,
  openCredential,
  sealCredential,
} from "@pikar/revenue";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { type ActionCtx, internalAction } from "./_generated/server";
import { hashExternalAccountId, requireCredentialKey } from "./connectorCredentials";
import {
  type ConnectResult,
  callbackRedirectPath,
  classifyRevokeOutcome,
  postTokenForm,
} from "./connectorOAuth";
import { tenantAction } from "./lib/functions";

// ── Stripe's endpoints, pinned ────────────────────────────────────────────────────────────
//
// Verified 2026-08-27 from primary vendor documentation. Test and live mode share BOTH: the mode
// split is carried by the grant's `livemode` flag and by which secret key signs the exchange, not
// by a different host.

/** The Stripe Apps consent screen. NOT `connect.stripe.com` — that host is the dead route. */
export const STRIPE_AUTHORIZE_ENDPOINT = "https://marketplace.stripe.com/oauth/v2/authorize";

/** The token exchange and the rolling refresh. Plain Stripe API host. */
export const STRIPE_TOKEN_ENDPOINT = "https://api.stripe.com/v1/oauth/token";

/**
 * The MANIFEST permissions this app declares — every one a read.
 *
 * A Stripe App's access is governed by these, not by the OAuth `scope` string (which comes back as
 * the literal `stripe_apps` for every install). This constant is therefore documentation of the
 * app's registration rather than a request parameter, and it is asserted member-by-member in
 * `stripeConnector.test.ts`: a rename that dropped a `_read` suffix would be the exact substitution
 * this phase forbids.
 *
 * These must match the uploaded `stripe-app.json` manifest EXACTLY. Adding one is a permission
 * change users re-consent to, and it is only ever a `*_read`.
 */
export const STRIPE_APP_PERMISSIONS = [
  "balance_read",
  "charge_read",
  "invoice_read",
  "payout_read",
  "dispute_read",
  "customer_read",
  "connected_account_read",
] as const;

/**
 * The scope string a Stripe App install returns. Literally `stripe_apps` — not `read_only`, not
 * anything else. Anything else means the grant did not come from a Stripe App, and accepting it
 * would silently put this lane back on the dead Connect route.
 */
export const STRIPE_GRANT_SCOPE = "stripe_apps";

/**
 * How long a refresher may hold the lease. Same reasoning as the QuickBooks lane: long enough for
 * one token request plus a seal, short enough that a refresher which died mid-flight does not wedge
 * the connection. The `revision` fence is what makes an expired lease safe to take.
 */
export const REFRESH_LEASE_TTL_MS = 45_000;

/** Refresh this far before expiry, so a read that starts near the edge does not 401 for nothing. */
export const ACCESS_REFRESH_SKEW_MS = 5 * 60_000;

/** Stripe's documented access-token life: one hour. Restated so a caller never assumes one. */
export const ACCESS_TOKEN_TTL_S = 3600;

/** Stripe's documented refresh-token life: one year, rolled on every exchange. */
export const REFRESH_TOKEN_TTL_S = 365 * 86_400;

// ── The sealed blob ───────────────────────────────────────────────────────────────────────

/**
 * What one Stripe connection's ciphertext holds. ONE blob, so replacing the access token and the
 * rolled refresh token is a single-field patch inside one Convex transaction.
 *
 * `accountId` is in HERE and nowhere else in the clear. Its SHA-256 goes on the row as
 * `externalAccountHash` so a re-consent can be recognised as the same Stripe account without the
 * `acct_***` id sitting in a column (CLAUDE.md §4).
 */
export type StripeCredential = {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  scope: string;
};

/**
 * A Stripe connected-account id, validated rather than trusted.
 *
 * It never becomes a path segment on this lane — the OAuth access token is already account-scoped,
 * so no `Stripe-Account` header is used — but it IS the binding that decides whether a re-consent
 * is the same business, and a shape check is what stops "any string at all" from being that
 * binding.
 */
export const isStripeAccountId = (value: unknown): value is string =>
  typeof value === "string" && /^acct_[A-Za-z0-9]{1,64}$/.test(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/** Parse the sealed plaintext back. Returns `null` on anything unexpected — never a partial blob. */
export function parseStripeCredential(plaintext: string): StripeCredential | null {
  let raw: unknown;
  try {
    raw = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const blob = raw as Record<string, unknown>;
  if (!isNonEmptyString(blob.accessToken)) return null;
  if (!isNonEmptyString(blob.refreshToken)) return null;
  if (!isStripeAccountId(blob.accountId)) return null;
  if (blob.scope !== STRIPE_GRANT_SCOPE) return null;
  return {
    accessToken: blob.accessToken,
    refreshToken: blob.refreshToken,
    accountId: blob.accountId,
    scope: blob.scope,
  };
}

// ── The grant ─────────────────────────────────────────────────────────────────────────────

export type StripeGrant = {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  /** Stripe's own statement of which mode this grant reads. Checked against the connection. */
  livemode: boolean;
  accessExpiresAt: number;
  refreshExpiresAt: number;
};

/**
 * A Stripe OAuth token response, or `null`.
 *
 * FOUR THINGS ARE REQUIRED, not optional-with-a-fallback.
 *
 *  • `refresh_token` — Stripe ROLLS it on every exchange and returns the current one. A response
 *    without one is a shape this code does not understand, and quietly keeping the previous value
 *    would leave a stale token sealed on the row, which later reads as a dead connection.
 *  • `stripe_user_id` — the connected account. Without it there is nothing to bind to.
 *  • `scope === "stripe_apps"` — see `STRIPE_GRANT_SCOPE`. A Connect-vocabulary scope string of any
 *    kind is refused, because a grant that speaks it is not a Stripe App install.
 *  • `livemode` — an absent mode cannot be checked against the connection's environment, and
 *    defaulting it either way silently binds a sandbox connection to real books or vice versa.
 *
 * The lifetimes fall back to Stripe's documented defaults rather than to zero: a missing
 * `expires_in` must not make a fresh token look already-expired and trigger an immediate second
 * refresh that burns the rolled token for nothing.
 */
export function parseStripeGrant(body: unknown, nowMs: number): StripeGrant | null {
  if (typeof body !== "object" || body === null) return null;
  const grant = body as Record<string, unknown>;
  if (!isNonEmptyString(grant.access_token)) return null;
  if (!isNonEmptyString(grant.refresh_token)) return null;
  if (!isStripeAccountId(grant.stripe_user_id)) return null;
  if (grant.scope !== STRIPE_GRANT_SCOPE) return null;
  if (typeof grant.livemode !== "boolean") return null;
  const accessSeconds =
    typeof grant.expires_in === "number" &&
    Number.isFinite(grant.expires_in) &&
    grant.expires_in > 0
      ? grant.expires_in
      : ACCESS_TOKEN_TTL_S;
  return {
    accessToken: grant.access_token,
    refreshToken: grant.refresh_token,
    accountId: grant.stripe_user_id,
    livemode: grant.livemode,
    accessExpiresAt: nowMs + accessSeconds * 1000,
    refreshExpiresAt: nowMs + REFRESH_TOKEN_TTL_S * 1000,
  };
}

/**
 * A failed token request as one of the closed failure classes. DELIBERATELY STATUS-ONLY — the
 * shared token helper never returns a failure BODY, because a Stripe error body carries an account
 * identifier and a human-readable message (CLAUDE.md §4).
 *
 * 401 on the TOKEN endpoint means OUR secret key was rejected: a deployment fault the tenant cannot
 * fix by reconnecting, and telling them to reconnect would send them round a loop that cannot end.
 * Every other 4xx means the grant is gone and only a fresh consent restores it.
 */
export function classifyTokenFailure(statusCode: number | null): ConnectionFailureClass {
  if (statusCode === null) return "network";
  if (statusCode === 401) return "forbidden";
  if (statusCode >= 400 && statusCode < 500) return "reauth";
  return "provider_error";
}

/** Does a grant's mode match the connection it is being sealed into? */
export const modeMatches = (livemode: boolean, environment: ConnectorEnvironment): boolean =>
  livemode === (environment === "production");

// ── Deployment configuration ──────────────────────────────────────────────────────────────

export type StripeApp = {
  clientId: string;
  secretKey: string;
  redirectUri: string;
  apiVersion: string;
};

/**
 * A Stripe API version pin, e.g. `2024-06-20` or a release-named `2025-03-31.basil`.
 *
 * The FORMAT is validated; the VALUE is deployment configuration with no default, deliberately.
 * Stripe ships breaking changes per version, and an unpinned read silently takes whichever version
 * the connected account's dashboard happens to be on — which the tenant can change under us. This
 * repository cannot verify a currently-valid Stripe version string offline, so it refuses to invent
 * one: an unset pin means the lane cannot read, rather than reading against an unknown shape.
 */
const API_VERSION_SHAPE = /^\d{4}-\d{2}-\d{2}(\.[a-z0-9_]+)?$/;

export const isStripeApiVersion = (value: unknown): value is string =>
  typeof value === "string" && API_VERSION_SHAPE.test(value);

/**
 * The Stripe App credentials. FAILS CLOSED — a missing value throws and no value is ever named in
 * the error, only its variable name.
 *
 * THE `STRIPE_APP_` PREFIX IS LOAD-BEARING and is not cosmetic. A second, WRITE-CAPABLE Stripe
 * integration lives in this repository under a `BILLING_STRIPE_*` prefix; it charges from Pikar's
 * own merchant account and points the opposite way. This lane reads a TENANT'S account, read-only.
 * Nothing here may ever read a name from the other prefix, and `stripeConnector.test.ts` scans for
 * it, because the naming split is the only thing keeping the wrong secret out of the wrong path.
 */
function requireStripeApp(): StripeApp {
  const clientId = process.env.STRIPE_APP_CLIENT_ID;
  const secretKey = process.env.STRIPE_APP_SECRET_KEY;
  const redirectUri = process.env.STRIPE_APP_REDIRECT_URI;
  const apiVersion = process.env.STRIPE_APP_API_VERSION;
  if (!clientId) throw new Error("Stripe is not configured: STRIPE_APP_CLIENT_ID");
  if (!secretKey) throw new Error("Stripe is not configured: STRIPE_APP_SECRET_KEY");
  if (!redirectUri) throw new Error("Stripe is not configured: STRIPE_APP_REDIRECT_URI");
  if (!apiVersion) throw new Error("Stripe is not configured: STRIPE_APP_API_VERSION");
  // A publishable key (`pk_`) or a restricted key (`rk_`) configured here would fail at Stripe with
  // a 401 that `classifyTokenFailure` reports as a deployment fault — correct, but only after a
  // round trip. Refusing the shape up front says which name is wrong. No format check on the client
  // id: refusing a real credential on a shape this repo cannot verify is the worse failure.
  if (!secretKey.startsWith("sk_")) {
    throw new Error("STRIPE_APP_SECRET_KEY must be a Stripe secret key.");
  }
  if (!redirectUri.startsWith("https://") && !redirectUri.startsWith("http://localhost")) {
    throw new Error("STRIPE_APP_REDIRECT_URI must be https (or a localhost development origin).");
  }
  if (!isStripeApiVersion(apiVersion)) {
    throw new Error("STRIPE_APP_API_VERSION must be a pinned Stripe API version.");
  }
  return { clientId, secretKey, redirectUri, apiVersion };
}

/** Deployment config, for the read module. Throws the same way rather than degrading silently. */
export const stripeApp = (): StripeApp => requireStripeApp();

/**
 * The consent URL. Every parameter is code-owned except `state`, which is a server-minted nonce.
 *
 * THERE IS NO `scope` PARAMETER, and its absence is the point. A Stripe App's access comes from its
 * manifest permissions — all `*_read` — so there is no scope string to get wrong and no field in
 * which a wider grant could be requested "for later".
 */
export function stripeAuthorizeUrl(app: StripeApp, state: string): string {
  const url = new URL(STRIPE_AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("redirect_uri", app.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

const environmentArg = v.union(v.literal("sandbox"), v.literal("production"));

// ── Begin consent ─────────────────────────────────────────────────────────────────────────

/**
 * Mint a one-time state and hand back Stripe's consent URL.
 *
 * A `tenantAction`, so the tenant comes from the authenticated identity: there is no argument by
 * which a caller could start a connect on somebody else's behalf. The state row (and with it the
 * `connectionId` the eventual tokens are sealed under) is written before this returns, so the
 * credential AAD tuple exists before any token does.
 */
export const beginConnect = tenantAction({
  args: { environment: environmentArg, redirectPath: v.string() },
  handler: async (ctx, { environment, redirectPath }): Promise<{ url: string }> => {
    // GATE BEFORE CONFIG. `mintConnectState` holds the connect-start gate, so minting first means
    // an unauthorized caller is refused with `PROVIDER_NOT_CONNECTABLE` before learning anything —
    // reading the deployment config first told a stranger whether this provider is set up here.
    // ponytail: an unconfigured deployment now leaves ONE state row that expires in 10 minutes.
    // Cheaper than a second gate call, and the row grants nothing on its own.
    const minted = await ctx.runMutation(api.connectorOAuth.mintConnectState, {
      provider: "stripe",
      environment,
      redirectPath,
    });
    return { url: stripeAuthorizeUrl(requireStripeApp(), minted.state) };
  },
});

// ── The callback ──────────────────────────────────────────────────────────────────────────

export type CallbackResult = { redirectTo: string; result: ConnectResult };

/**
 * Finish a consent. STATE FIRST, ALWAYS.
 *
 * `consumeConnectState` runs before the code is exchanged, so a replayed, expired, cross-provider
 * or grafted callback performs ZERO external calls and ZERO writes. It takes no `tenantId` — the
 * tenant is read out of the row the nonce resolves to, which is what stops an attacker who
 * completed their own consent from grafting their Stripe account onto someone else's tenant.
 *
 * Then, in order: exchange exactly once, check the MODE, refuse an account swap, seal.
 *
 * THE MODE CHECK IS NOT A FORMALITY. A production connection sealed from a test-mode grant reads a
 * sandbox account's fabricated charges and presents them as the business's cash. It is reported as
 * `account_mismatch` because that is the closed-set member that means "this grant is not for this
 * connection"; the redirect carries no detail either way (CLAUDE.md §4).
 *
 * An `internalAction` because it must never be callable from a browser: it is reached by the HTTP
 * callback route, which supplies the provider's own query parameters. Registering that route is
 * deliberately not this plan's file — see the playbook's "Known gaps".
 */
export const handleCallback = internalAction({
  args: {
    environment: environmentArg,
    state: v.string(),
    /** Absent when the user denied consent or Stripe reported an error. */
    code: v.optional(v.string()),
    /** Stripe's own `error` parameter. Recorded as a BRANCH, never echoed into the redirect. */
    denied: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CallbackResult> => {
    const app = requireStripeApp();
    const consumed = await ctx.runMutation(internal.connectorOAuth.consumeConnectState, {
      state: args.state,
      provider: "stripe",
      environment: args.environment,
    });
    if (!consumed.ok) {
      return {
        redirectTo: callbackRedirectPath("", "stripe", "invalid_state"),
        result: "invalid_state",
      };
    }
    const done = (result: ConnectResult): CallbackResult => ({
      redirectTo: callbackRedirectPath(consumed.redirectPath, "stripe", result),
      result,
    });

    if (args.denied === true || !isNonEmptyString(args.code)) return done("denied");

    const posted = await postTokenForm({
      url: STRIPE_TOKEN_ENDPOINT,
      form: new URLSearchParams({
        grant_type: "authorization_code",
        code: args.code,
      }),
      // Stripe authenticates every API request with the secret key as a bearer credential; the
      // token endpoint is on the same host and takes the app developer's secret key.
      bearerAuth: app.secretKey,
    });
    if (!posted.ok) return done("exchange_failed");
    const grant = parseStripeGrant(posted.body, Date.now());
    if (grant === null) return done("exchange_failed");
    if (!modeMatches(grant.livemode, args.environment)) return done("account_mismatch");

    // Re-consent must land on the SAME Stripe account. A different one is terminal, not a silent
    // re-seal over a grant that belongs to another business.
    const externalAccountHash = await hashExternalAccountId(grant.accountId);
    const existing = await ctx.runQuery(internal.connectorCredentials.get, {
      tenantId: consumed.tenantId,
      provider: "stripe",
      environment: args.environment,
    });
    if (
      existing?.externalAccountHash !== undefined &&
      existing.externalAccountHash !== externalAccountHash
    ) {
      return done("account_mismatch");
    }

    const key = await requireCredentialKey("v1");
    const scope: {
      tenantId: string;
      provider: "stripe";
      connectionId: string;
      environment: ConnectorEnvironment;
    } = {
      tenantId: consumed.tenantId,
      provider: "stripe",
      connectionId: consumed.connectionId,
      environment: args.environment,
    };
    const blob: StripeCredential = {
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      accountId: grant.accountId,
      scope: STRIPE_GRANT_SCOPE,
    };
    const sealed = await sealCredential(key, scope, JSON.stringify(blob));
    await ctx.runMutation(internal.connectorCredentials.upsertSealed, {
      tenantId: consumed.tenantId,
      provider: "stripe",
      environment: args.environment,
      connectionId: consumed.connectionId,
      credentialCiphertextB64: sealed.ciphertextB64,
      credentialIvB64: sealed.ivB64,
      keyVersion: sealed.keyVersion,
      accessExpiresAt: grant.accessExpiresAt,
      refreshExpiresAt: grant.refreshExpiresAt,
      externalAccountHash,
    });
    return done("connected");
  },
});

// ── Refresh ───────────────────────────────────────────────────────────────────────────────

/**
 * Why a refresh did not produce a new access token. Each value names WHICH guard refused, because
 * "refresh failed" is unactionable and because 28-03 shipped a fence test that was silently
 * satisfied by the lease in front of it. A caller — and a test — must be able to tell them apart
 * from the outside.
 */
export type RefreshOutcome =
  | { ok: true; accessToken: string; accountId: string; rotated: boolean }
  | { ok: false; reason: "not_connected" }
  | { ok: false; reason: "no_credential" }
  /** THE LEASE refused: another refresher holds it. Not an error — the other one is doing the work. */
  | { ok: false; reason: "refresh_in_flight" }
  /** THE FENCE refused: this refresher's credential is stale. Its new tokens are DISCARDED. */
  | { ok: false; reason: "stale_revision" }
  | { ok: false; reason: "grant_failed"; failureClass: ConnectionFailureClass };

/**
 * Exchange the rolled refresh token for a new access token, exactly once.
 *
 * ONE ATTEMPT, NO RETRIES, on any failure class. Stripe rolls the refresh token on every exchange,
 * so a retry is a second request carrying a value the first request may already have consumed —
 * and a racing refresher is the same hazard wearing a different name. The lease stops the second
 * request from being made; the `revision` fence stops one that already started, slept past its
 * lease and came back with a stale credential from writing over a newer grant.
 *
 * The account id survives untouched: it is read out of the OLD blob and written into the new one,
 * so a refresh can never rebind a connection to another Stripe account.
 */
export const refreshConnection = internalAction({
  args: { tenantId: v.string(), environment: environmentArg },
  handler: async (ctx, { tenantId, environment }): Promise<RefreshOutcome> => {
    const app = requireStripeApp();
    const connection = { tenantId, provider: "stripe", environment } as const;

    const leaseId = crypto.randomUUID();
    const lease = await ctx.runMutation(internal.connectorCredentials.acquireRefreshLease, {
      ...connection,
      leaseId,
      ttlMs: REFRESH_LEASE_TTL_MS,
    });
    if (!lease.ok || lease.revision === undefined) {
      // `acquireRefreshLease` says `ok: false` for BOTH "no such connection" and "someone else
      // holds it", and those are different facts. Resolving which costs one read and is the
      // difference between a test that proves the LEASE refused and one that proves something did.
      const missing = await ctx.runQuery(internal.connectorCredentials.get, connection);
      return { ok: false, reason: missing === null ? "not_connected" : "refresh_in_flight" };
    }

    const row = await ctx.runQuery(internal.connectorCredentials.get, connection);
    if (row === null) return { ok: false, reason: "not_connected" };
    if (
      row.credentialCiphertextB64 === undefined ||
      row.credentialIvB64 === undefined ||
      row.status === "revoked"
    ) {
      return { ok: false, reason: "no_credential" };
    }

    const key = await requireCredentialKey(row.keyVersion);
    const scope = {
      tenantId,
      provider: "stripe" as const,
      connectionId: row.connectionId,
      environment,
    };
    let current: StripeCredential | null;
    try {
      current = parseStripeCredential(
        await openCredential(key, scope, {
          ciphertextB64: row.credentialCiphertextB64,
          ivB64: row.credentialIvB64,
          keyVersion: row.keyVersion,
          algorithm: "AES-256-GCM",
        }),
      );
    } catch {
      current = null;
    }
    if (current === null) return { ok: false, reason: "no_credential" };

    // ONE attempt. There is no retry loop here and there must never be one.
    const posted = await postTokenForm({
      url: STRIPE_TOKEN_ENDPOINT,
      form: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
      }),
      bearerAuth: app.secretKey,
    });
    if (!posted.ok) {
      const failureClass = classifyTokenFailure(posted.statusCode);
      await ctx.runMutation(internal.connectorCredentials.recordReadOutcome, {
        ...connection,
        failureClass,
      });
      return { ok: false, reason: "grant_failed", failureClass };
    }
    const grant = parseStripeGrant(posted.body, Date.now());
    if (grant === null) {
      await ctx.runMutation(internal.connectorCredentials.recordReadOutcome, {
        ...connection,
        failureClass: "provider_error",
      });
      return { ok: false, reason: "grant_failed", failureClass: "provider_error" };
    }
    // A refresh that came back bound to a DIFFERENT Stripe account is not a refresh. Sealing it
    // would rebind the tenant's connection to another business's books without a consent screen.
    if (grant.accountId !== current.accountId) {
      await ctx.runMutation(internal.connectorCredentials.recordReadOutcome, {
        ...connection,
        failureClass: "unsupported_account",
      });
      return { ok: false, reason: "grant_failed", failureClass: "unsupported_account" };
    }

    const sealed = await sealCredential(
      key,
      scope,
      JSON.stringify({
        accessToken: grant.accessToken,
        refreshToken: grant.refreshToken,
        accountId: current.accountId,
        scope: current.scope,
      } satisfies StripeCredential),
    );
    const committed = await ctx.runMutation(internal.connectorCredentials.commitRefresh, {
      ...connection,
      leaseId,
      revision: lease.revision,
      credentialCiphertextB64: sealed.ciphertextB64,
      credentialIvB64: sealed.ivB64,
      keyVersion: sealed.keyVersion,
      accessExpiresAt: grant.accessExpiresAt,
      refreshExpiresAt: grant.refreshExpiresAt,
    });
    // The fence refused: the row moved under this refresher. Its perfectly good new tokens are
    // DISCARDED rather than written over whatever replaced them.
    if (!committed.ok) return { ok: false, reason: "stale_revision" };

    return {
      ok: true,
      accessToken: grant.accessToken,
      accountId: current.accountId,
      rotated: grant.refreshToken !== current.refreshToken,
    };
  },
});

// ── Disconnect: local only, and it says so ────────────────────────────────────────────────

export type DisconnectOutcome = { cleared: boolean; upstream: string; statusCode: number | null };

/**
 * Clear the local ciphertext and record what actually happened upstream: NOTHING.
 *
 * THIS IS THE OPEN CONDITION, IMPLEMENTED HONESTLY RATHER THAN CLOSED. Stripe documents no
 * platform-initiated revoke or uninstall for Stripe Apps. Only the user can uninstall, and
 * `account.application.deauthorized` reports it after the fact. So there is no request to make, no
 * status code to interpret, and NO ORDERING QUESTION: `attempted` is `false` because attempting
 * would mean pointing a revoke at an endpoint that belongs to a different flow, and a 200 from
 * there would be recorded as a confirmed revocation of a grant that is still live.
 *
 * `classifyRevokeOutcome` returns `unsupported` for this provider before it examines anything at
 * all, so `confirmed` is unreachable here by construction rather than by this function's manners.
 *
 * What the tenant must be told, and what `connectorCredentials.connectorStatuses` carries to the
 * UI: Pikar has stopped using and deleted its copy; the grant stays live on Stripe's side until the
 * user uninstalls the app from Settings -> Installed Apps. 28-24 owes the answer on whether Stripe
 * offers anything better.
 */
async function clearLocally(
  ctx: ActionCtx,
  { tenantId, environment }: { tenantId: string; environment: "sandbox" | "production" },
): Promise<DisconnectOutcome> {
  const connection = { tenantId, provider: "stripe", environment } as const;
  const outcome = classifyRevokeOutcome({ provider: "stripe", attempted: false });
  const cleared = await ctx.runMutation(internal.connectorCredentials.recordRevocation, {
    ...connection,
    upstream: outcome.upstream,
  });
  return { cleared: cleared.cleared, upstream: outcome.upstream, statusCode: null };
}

export const disconnect = tenantAction({
  args: { environment: environmentArg },
  handler: (ctx, { environment }): Promise<DisconnectOutcome> =>
    clearLocally(ctx, { tenantId: ctx.tenantId, environment }),
});

/**
 * The lane runner's disconnect (`scripts/smoke-stripe-read.mjs --revoke`, consumed by 28-24).
 * Internal, so no browser reaches it. ONE body shared with the tenant action, so the two cannot
 * drift into telling the user different things about the same act.
 */
export const disconnectForTenant = internalAction({
  args: { tenantId: v.string(), environment: environmentArg, confirm: v.literal("revoke") },
  handler: (ctx, { tenantId, environment }): Promise<DisconnectOutcome> =>
    clearLocally(ctx, { tenantId, environment }),
});
