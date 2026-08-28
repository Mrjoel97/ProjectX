// QuickBooks Online OAuth — realm binding, rolling refresh, revoke-before-delete.
//
// A THIN ADAPTER (CLAUDE.md §1). The consent round-trip, the one-time state, the redirect hygiene,
// the single token POST and the revocation-honesty rule all live in `connectorOAuth.ts`; the
// encryption, the single-flight lease and the `revision` fence live in `connectorCredentials.ts`.
// What is genuinely Intuit's and lives HERE: the endpoints, the scope, the realm binding, the
// shape of a grant, and the refusal to ever retry a refresh.
//
// THIS MODULE CONTAINS NO REQUEST VERB AND NO TRANSPORT. `scripts/check-provider-lane.mjs` scans
// every `quickbooks*.ts` for a write verb or a direct transport call and goes red on either, which
// is what keeps "the allow-list is the only boundary" a checkable claim rather than a promise.
// `com.intuit.quickbooks.accounting` is the ONLY Accounting-API scope Intuit publishes, it grants
// WRITES, and the vendor will not constrain it — so a stolen live token has full Accounting-API
// write reach and NOTHING vendor-side stops it. The owner accepted that blast radius explicitly
// (docs/connectors/quickbooks-suitability.md). Containment is entirely ours and it is exactly two
// things: `connectorFetch`'s compile-time GET/query allow-list, and the absence from this repo of
// any code path that could name another verb.
//
// THE ROLLING-REFRESH HAZARD — the reason this module looks paranoid. Intuit documents that two
// concurrent refreshes with the same refresh token leave the first successful and the second
// `invalid_grant`, AND that Intuit's servers MAY THEN REVOKE the token the first call issued. A
// racing or retried refresh does not degrade the connection — it KILLS it, and the tenant
// re-consents from scratch. Hence: a lease before the request, a `revision` fence before the write,
// exactly ONE attempt, and no retry on any failure class whatsoever.
//
// NOT "use node": `crypto.subtle` and the platform fetch are both available in the default Convex
// runtime, exactly as in `connectorCredentials.ts`.
import {
  type ConnectionFailureClass,
  type ConnectorEnvironment,
  openCredential,
  sealCredential,
} from "@pikar/revenue";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  hashExternalAccountId,
  requireCredentialKey,
} from "./connectorCredentials";
import {
  callbackRedirectPath,
  classifyRevokeOutcome,
  type ConnectResult,
  postTokenForm,
} from "./connectorOAuth";
import { tenantAction } from "./lib/functions";

// ── Intuit's endpoints, pinned ────────────────────────────────────────────────────────────
//
// Verified 2026-08-27 from the OIDC discovery documents and the OAuth 2.0 doc page. Production and
// sandbox share all three: the SANDBOX SPLIT IS IN THE API ORIGIN (`connectorFetch`'s
// `PROVIDER_API_ORIGINS`), not in the authorization plane.

export const QB_AUTHORIZE_ENDPOINT = "https://appcenter.intuit.com/connect/oauth2";
export const QB_TOKEN_ENDPOINT = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const QB_REVOKE_ENDPOINT = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

/**
 * The only Accounting-API scope in existence, and it grants writes.
 *
 * There is no read-only alternative to request. Searched and confirmed on 2026-08-27: every `.read`
 * scope in Intuit's catalogue is outside the Accounting API (GraphQL custom fields, payroll,
 * workforce, time tracking) and none covers Invoice, Bill, JournalEntry, Customer or Reports.
 * Narrowing this string is not an available move; the allow-list is the whole containment story.
 */
export const QB_SCOPE = "com.intuit.quickbooks.accounting";

/**
 * How long a refresher may hold the lease.
 *
 * Long enough for one token request under `TOKEN_POST_TIMEOUT_MS` plus a seal, short enough that a
 * refresher which died mid-flight does not wedge the connection until someone notices. The
 * `revision` fence is what makes an expired lease safe to take: a straggler that comes back after
 * its lease lapsed still cannot commit over a newer credential.
 */
export const REFRESH_LEASE_TTL_MS = 45_000;

/**
 * Refresh this far before the access token actually dies. Intuit issues 60-minute access tokens; a
 * read that starts 30 seconds before expiry and finishes after it would 401 for no reason.
 */
export const ACCESS_REFRESH_SKEW_MS = 5 * 60_000;

/** Intuit's own default, restated so a caller never has to assume one. */
export const ACCESS_TOKEN_TTL_S = 3600;

// ── The sealed blob ───────────────────────────────────────────────────────────────────────

/**
 * What one QuickBooks connection's ciphertext holds. ONE blob, so replacing the access token and
 * the rotated refresh token is a single-field patch inside one Convex transaction and there is no
 * instant at which the row carries a new access token beside a dead refresh token.
 *
 * `realmId` is in HERE and nowhere else in the clear. Its SHA-256 goes on the row as
 * `externalAccountHash` so a re-consent can be recognised as the same company without the id
 * sitting in a column (CLAUDE.md §4).
 */
export type QbCredential = {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  scope: string;
};

/**
 * A QuickBooks company id. Numeric, and validated rather than trusted, because it is the ONE piece
 * of the callback that arrives as a query parameter and then becomes a PATH SEGMENT in every
 * subsequent read (`/v3/company/{realmId}/query`). `connectorFetch`'s segment allow-list would
 * refuse a `/` or a `%2f` on its own; this refuses everything that is not a plain company id, so
 * the two checks are independent rather than one check written twice.
 */
export const isRealmId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9]{1,32}$/.test(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/** Parse the sealed plaintext back. Returns `null` on anything unexpected — never a partial blob. */
export function parseQbCredential(plaintext: string): QbCredential | null {
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
  if (!isRealmId(blob.realmId)) return null;
  if (!isNonEmptyString(blob.scope)) return null;
  return {
    accessToken: blob.accessToken,
    refreshToken: blob.refreshToken,
    realmId: blob.realmId,
    scope: blob.scope,
  };
}

// ── The grant ─────────────────────────────────────────────────────────────────────────────

export type QbGrant = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
};

/**
 * An Intuit token response, or `null`.
 *
 * `refresh_token` is REQUIRED, not optional-with-a-fallback. Intuit rotates the value roughly every
 * 24 hours and returns the current one on every grant; a response without one is a shape this code
 * does not understand, and quietly keeping the previous value would leave a stale refresh token
 * sealed on the row — which is the exact state that later reads as a dead connection.
 *
 * Both lifetimes fall back to Intuit's documented defaults rather than to zero: a missing
 * `expires_in` must not make a fresh token look already-expired and trigger the immediate second
 * refresh that Intuit warns can kill the grant.
 */
export function parseQbGrant(body: unknown, nowMs: number): QbGrant | null {
  if (typeof body !== "object" || body === null) return null;
  const grant = body as Record<string, unknown>;
  if (!isNonEmptyString(grant.access_token)) return null;
  if (!isNonEmptyString(grant.refresh_token)) return null;
  const accessSeconds =
    typeof grant.expires_in === "number" && Number.isFinite(grant.expires_in) && grant.expires_in > 0
      ? grant.expires_in
      : ACCESS_TOKEN_TTL_S;
  // 100 days, rolling, extended on each use.
  const refreshSeconds =
    typeof grant.x_refresh_token_expires_in === "number" &&
    Number.isFinite(grant.x_refresh_token_expires_in) &&
    grant.x_refresh_token_expires_in > 0
      ? grant.x_refresh_token_expires_in
      : 8_640_000;
  return {
    accessToken: grant.access_token,
    refreshToken: grant.refresh_token,
    accessExpiresAt: nowMs + accessSeconds * 1000,
    refreshExpiresAt: nowMs + refreshSeconds * 1000,
  };
}

/**
 * A failed token request as one of the closed failure classes.
 *
 * DELIBERATELY STATUS-ONLY. The shared token helper never returns a failure BODY — a provider error
 * body is vendor content that can carry an account identifier (CLAUDE.md §4) — so the OAuth `error`
 * code is not available here and this does not pretend otherwise. It costs nothing, because the
 * ACTION is the same for every class: STOP. Intuit's documented hazard is that retrying or racing a
 * refresh can revoke the grant outright, so there is no class whose right answer is "try again".
 *
 * A 4xx from the token endpoint is `reauth`: the grant is gone and only a fresh consent restores
 * it. 401 is separated out as `forbidden` because on the TOKEN endpoint it means our own client
 * credentials were rejected — a deployment fault the tenant cannot fix by reconnecting, and telling
 * them to reconnect would send them round a loop that cannot end.
 */
export function classifyTokenFailure(statusCode: number | null): ConnectionFailureClass {
  if (statusCode === null) return "network";
  if (statusCode === 401) return "forbidden";
  if (statusCode >= 400 && statusCode < 500) return "reauth";
  return "provider_error";
}

// ── Deployment configuration ──────────────────────────────────────────────────────────────

type QbApp = { clientId: string; clientSecret: string; redirectUri: string };

/**
 * The Intuit app credentials. FAILS CLOSED — a missing value throws and no value is ever named in
 * the error, only its variable name.
 *
 * `QUICKBOOKS_REDIRECT_URI` must match a redirect URI registered on the Intuit app exactly. It is
 * read from configuration rather than derived from a request, so a forged callback cannot influence
 * where the next authorization lands.
 */
function requireQbApp(): QbApp {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
  if (!clientId) throw new Error("QuickBooks is not configured: QUICKBOOKS_CLIENT_ID");
  if (!clientSecret) throw new Error("QuickBooks is not configured: QUICKBOOKS_CLIENT_SECRET");
  if (!redirectUri) throw new Error("QuickBooks is not configured: QUICKBOOKS_REDIRECT_URI");
  if (!redirectUri.startsWith("https://") && !redirectUri.startsWith("http://localhost")) {
    throw new Error("QUICKBOOKS_REDIRECT_URI must be https (or a localhost development origin).");
  }
  return { clientId, clientSecret, redirectUri };
}

/** The consent URL. Every parameter is code-owned except `state`, which is a server-minted nonce. */
export function quickbooksAuthorizeUrl(app: QbApp, state: string): string {
  const url = new URL(QB_AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QB_SCOPE);
  url.searchParams.set("redirect_uri", app.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

const environmentArg = v.union(v.literal("sandbox"), v.literal("production"));

// ── Begin consent ─────────────────────────────────────────────────────────────────────────

/**
 * Mint a one-time state and hand back Intuit's consent URL.
 *
 * A `tenantAction`, so the tenant comes from the authenticated identity: there is no argument by
 * which a caller could start a connect on somebody else's behalf. The state row (and with it the
 * `connectionId` the eventual tokens are sealed under) is written by `mintConnectState` before this
 * returns, so the credential AAD tuple exists before any token does.
 */
export const beginConnect = tenantAction({
  args: { environment: environmentArg, redirectPath: v.string() },
  handler: async (ctx, { environment, redirectPath }): Promise<{ url: string }> => {
    const app = requireQbApp();
    // `mintConnectState` is itself a tenantMutation and derives the tenant from the identity this
    // action already authenticated — there is no `tenantId` argument to get wrong.
    const minted = await ctx.runMutation(api.connectorOAuth.mintConnectState, {
      provider: "quickbooks",
      environment,
      redirectPath,
    });
    return { url: quickbooksAuthorizeUrl(app, minted.state) };
  },
});

// ── The callback ──────────────────────────────────────────────────────────────────────────

export type CallbackResult = { redirectTo: string; result: ConnectResult };

/**
 * Finish a consent. STATE FIRST, ALWAYS.
 *
 * `consumeConnectState` runs before the code is exchanged and before the realm is looked at, so a
 * replayed, expired, cross-provider or grafted callback performs ZERO external calls and ZERO
 * writes. It takes no `tenantId` — the tenant is read out of the row the nonce resolves to, which
 * is what stops an attacker who completed their own consent from grafting their company onto
 * someone else's tenant.
 *
 * Then, in order: validate the realm, exchange exactly once, refuse a realm swap, seal.
 *
 * An `internalAction` because it must never be callable from a browser: it is reached by the HTTP
 * callback route, which supplies the provider's own query parameters. Registering that route is
 * deliberately not this plan's file — see the playbook's "Known gaps".
 */
export const handleCallback = internalAction({
  args: {
    environment: environmentArg,
    state: v.string(),
    /** Absent when the user denied consent or Intuit reported an error. */
    code: v.optional(v.string()),
    realmId: v.optional(v.string()),
    /** Intuit's own `error` parameter. Recorded as a BRANCH, never echoed into the redirect. */
    denied: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CallbackResult> => {
    const app = requireQbApp();
    const consumed = await ctx.runMutation(internal.connectorOAuth.consumeConnectState, {
      state: args.state,
      provider: "quickbooks",
      environment: args.environment,
    });
    // A refusal carries no tenant, no connection id and no redirect path, so there is nothing to
    // seal a token into even if a caller ignored `ok`. The user lands on the default surface.
    if (!consumed.ok) {
      return {
        redirectTo: callbackRedirectPath("", "quickbooks", "invalid_state"),
        result: "invalid_state",
      };
    }
    const done = (result: ConnectResult): CallbackResult => ({
      redirectTo: callbackRedirectPath(consumed.redirectPath, "quickbooks", result),
      result,
    });

    if (args.denied === true || !isNonEmptyString(args.code)) return done("denied");
    // The realm is validated BEFORE the exchange. It becomes a path segment in every later read,
    // and a shape that could never be used is not worth spending a single-use code on.
    if (!isRealmId(args.realmId)) return done("account_mismatch");

    const posted = await postTokenForm({
      url: QB_TOKEN_ENDPOINT,
      form: new URLSearchParams({
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: app.redirectUri,
      }),
      basicAuth: { clientId: app.clientId, clientSecret: app.clientSecret },
    });
    if (!posted.ok) return done("exchange_failed");
    const grant = parseQbGrant(posted.body, Date.now());
    if (grant === null) return done("exchange_failed");

    // Re-consent must land on the SAME company. A different realm is terminal, not a silent
    // re-seal over a grant that belongs to another set of books.
    const externalAccountHash = await hashExternalAccountId(args.realmId);
    const existing = await ctx.runQuery(internal.connectorCredentials.get, {
      tenantId: consumed.tenantId,
      provider: "quickbooks",
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
      provider: "quickbooks";
      connectionId: string;
      environment: ConnectorEnvironment;
    } = {
      tenantId: consumed.tenantId,
      provider: "quickbooks",
      connectionId: consumed.connectionId,
      environment: args.environment,
    };
    const blob: QbCredential = {
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      realmId: args.realmId,
      scope: QB_SCOPE,
    };
    const sealed = await sealCredential(key, scope, JSON.stringify(blob));
    await ctx.runMutation(internal.connectorCredentials.upsertSealed, {
      tenantId: consumed.tenantId,
      provider: "quickbooks",
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
 * Why a refresh did not produce a new access token. Each value names WHICH guard or step refused,
 * because "refresh failed" is unactionable and — more to the point — because 28-03 shipped a fence
 * test that was silently satisfied by the lease in front of it. A caller (and a test) must be able
 * to tell the two apart from the outside.
 */
export type RefreshOutcome =
  | { ok: true; accessToken: string; realmId: string; rotated: boolean }
  | { ok: false; reason: "not_connected" }
  | { ok: false; reason: "no_credential" }
  /** THE LEASE refused: another refresher holds it. Not an error — the other one is doing the work. */
  | { ok: false; reason: "refresh_in_flight" }
  /** THE FENCE refused: this refresher's credential is stale. Its new tokens are DISCARDED. */
  | { ok: false; reason: "stale_revision" }
  | { ok: false; reason: "grant_failed"; failureClass: ConnectionFailureClass };

/**
 * Exchange the rolling refresh token for a new access token, exactly once.
 *
 * THE THREE RULES, in the order they bite:
 *
 *  1. TAKE THE LEASE FIRST. Two concurrent refreshes with the same refresh token leave the first
 *     successful and the second `invalid_grant`, and Intuit MAY then revoke the token the first
 *     call issued — the connection dies and the user re-consents. The lease is what stops the
 *     second request from ever being made.
 *  2. NEVER RETRY. Not on a 5xx, not on a timeout, not on a network error. A retry is a second
 *     request with the same refresh token, which is the same hazard wearing a different name.
 *     Every failure returns; the caller's next scheduled read takes the lease again cleanly.
 *  3. COMMIT UNDER THE FENCE. `commitRefresh` compares `revision` BEFORE it compares the lease id,
 *     so a refresher that slept past its lease and came back with a stale credential is refused
 *     even though it still holds a valid-looking lease. Its tokens are thrown away rather than
 *     written over a newer grant.
 *
 * The realm id survives untouched: it is read out of the OLD blob and written into the new one, so
 * a refresh can never rebind a connection to another company.
 */
export const refreshConnection = internalAction({
  args: { tenantId: v.string(), environment: environmentArg },
  handler: async (ctx, { tenantId, environment }): Promise<RefreshOutcome> => {
    const app = requireQbApp();
    const connection = { tenantId, provider: "quickbooks", environment } as const;

    const leaseId = crypto.randomUUID();
    const lease = await ctx.runMutation(internal.connectorCredentials.acquireRefreshLease, {
      ...connection,
      leaseId,
      ttlMs: REFRESH_LEASE_TTL_MS,
    });
    if (!lease.ok || lease.revision === undefined) {
      // `acquireRefreshLease` says `ok: false` for BOTH "no such connection" and "someone else
      // holds it", and those are different facts about the world. Resolving which one it was costs
      // one read and is the difference between a test that proves the LEASE refused and a test that
      // merely proves something did — the exact confusion 28-03's fence test died of.
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
      provider: "quickbooks" as const,
      connectionId: row.connectionId,
      environment,
    };
    let current: QbCredential | null;
    try {
      current = parseQbCredential(
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

    // ONE attempt. See rule 2 above — there is no retry loop here and there must never be one.
    const posted = await postTokenForm({
      url: QB_TOKEN_ENDPOINT,
      form: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
      }),
      basicAuth: { clientId: app.clientId, clientSecret: app.clientSecret },
    });
    if (!posted.ok) {
      const failureClass = classifyTokenFailure(posted.statusCode);
      await ctx.runMutation(internal.connectorCredentials.recordReadOutcome, {
        ...connection,
        failureClass,
      });
      return { ok: false, reason: "grant_failed", failureClass };
    }
    const grant = parseQbGrant(posted.body, Date.now());
    if (grant === null) {
      await ctx.runMutation(internal.connectorCredentials.recordReadOutcome, {
        ...connection,
        failureClass: "provider_error",
      });
      return { ok: false, reason: "grant_failed", failureClass: "provider_error" };
    }

    // BOTH tokens into one blob, and the realm carried across unchanged. Intuit rotates the refresh
    // token value about every 24 hours; persisting the response's value is not an optimisation, it
    // is the difference between a live connection tomorrow and a dead one.
    const sealed = await sealCredential(
      key,
      scope,
      JSON.stringify({
        accessToken: grant.accessToken,
        refreshToken: grant.refreshToken,
        realmId: current.realmId,
        scope: current.scope,
      } satisfies QbCredential),
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
      realmId: current.realmId,
      rotated: grant.refreshToken !== current.refreshToken,
    };
  },
});

// ── Disconnect ────────────────────────────────────────────────────────────────────────────

/**
 * Revoke upstream FIRST, then clear the local ciphertext — and record which of those actually
 * happened.
 *
 * QuickBooks is the one Phase 28 provider with a documented, confirmed revocation endpoint, so it
 * is the one provider that can honestly reach `revocation.upstream = "confirmed"`. That makes the
 * ordering matter more here than anywhere else: clearing the local copy first would leave a live
 * Intuit grant with no token left to revoke it with, permanently.
 *
 * The REFRESH token is what gets revoked, not the access token: Intuit kills the whole grant from
 * either, and revoking the short-lived access token would leave the durable one alive.
 *
 * A failed or unattempted revoke still clears the local copy — deleting our copy is a real and
 * useful act — but it is recorded as `attempted_failed` / `not_attempted`, never as `confirmed`.
 * The user's sentence is "we deleted our copy and Intuit confirmed" or "we deleted our copy and
 * could not reach Intuit", and those are different sentences.
 */
export const disconnect = tenantAction({
  args: { environment: environmentArg },
  handler: async (
    ctx,
    { environment },
  ): Promise<{ cleared: boolean; upstream: string; statusCode: number | null }> => {
    const connection = { tenantId: ctx.tenantId, provider: "quickbooks", environment } as const;
    const row = await ctx.runQuery(internal.connectorCredentials.get, connection);

    let attempted = false;
    let statusCode: number | undefined;
    if (row !== null && row.credentialCiphertextB64 && row.credentialIvB64) {
      const key = await requireCredentialKey(row.keyVersion);
      let credential: QbCredential | null = null;
      try {
        credential = parseQbCredential(
          await openCredential(
            key,
            {
              tenantId: ctx.tenantId,
              provider: "quickbooks",
              connectionId: row.connectionId,
              environment,
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
      if (credential !== null) {
        const app = requireQbApp();
        attempted = true;
        const posted = await postTokenForm({
          url: QB_REVOKE_ENDPOINT,
          // Intuit documents a JSON body here, unlike the token endpoint's form encoding.
          form: new URLSearchParams({ token: credential.refreshToken }),
          asJson: true,
          basicAuth: { clientId: app.clientId, clientSecret: app.clientSecret },
        });
        statusCode = posted.statusCode ?? undefined;
      }
    }

    const outcome = classifyRevokeOutcome({
      provider: "quickbooks",
      attempted,
      ...(statusCode === undefined ? {} : { statusCode }),
    });
    const cleared = await ctx.runMutation(internal.connectorCredentials.recordRevocation, {
      ...connection,
      upstream: outcome.upstream,
      ...(statusCode === undefined ? {} : { statusCode }),
    });
    return { cleared: cleared.cleared, upstream: outcome.upstream, statusCode: statusCode ?? null };
  },
});
