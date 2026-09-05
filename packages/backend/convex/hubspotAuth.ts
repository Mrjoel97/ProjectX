// HubSpot OAuth lifecycle — the THIN adapter (CLAUDE.md §1).
//
// Every constant, URL and body shape lives in `@pikar/revenue/providers/hubspot` (pure, testable,
// Convex-free). Every security mechanic lives in the shared modules: one-time state in
// `connectorOAuth`, the sealed envelope, refresh lease and 4-state revocation record in
// `connectorCredentials`, the GET-only allow-listed transport in `connectorFetch`. This module
// only wires them together and touches the database.
//
// NOT "use node": these are actions over the default runtime, which has `fetch` and
// `crypto.subtle` — the same runtime `gmailAuth.disconnectGoogle` already revokes a Google grant
// on. There is no direct `fetch` here at all: the one POST the connector plane makes goes through
// `connectorOAuth.postTokenForm`, which is what keeps the read-only scan in
// `scripts/check-provider-lane.mjs` literally true for every `hubspot*.ts` module.
//
// NO PROVIDER-GATE CHECK LIVES HERE, deliberately. `providerGates` governs CONSUMPTION — a
// consumer reads the passed-only `availableProviders` projection. Gating the connect/read path on
// a PASSED lane would be circular: the lane cannot pass until a live read and a live revoke have
// been observed, and neither can happen without a connection. 28-09 builds the connections surface
// on top of the gate; this module is what the wave-7 lane runner drives to produce the evidence.

import {
  type ConnectorEnvironment,
  openCredential,
  type RevocationUpstream,
  sealCredential,
} from "@pikar/revenue";
import {
  buildHubSpotAuthorizeUrl,
  HUBSPOT_DATASET_PATHS,
  HUBSPOT_READ_SCOPES,
  HUBSPOT_REVOKE_URL,
  HUBSPOT_TOKEN_URL,
  parseTokenResponse,
  revokeBody,
  tokenExchangeBody,
  tokenRefreshBody,
} from "@pikar/revenue/providers/hubspot";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { type ActionCtx, internalAction } from "./_generated/server";
import { hashExternalAccountId, requireCredentialKey } from "./connectorCredentials";
import { readPages } from "./connectorFetch";
import {
  type ConnectResult,
  classifyRevokeOutcome,
  DEFAULT_REDIRECT_PATH,
  postTokenForm,
} from "./connectorOAuth";
import { tenantAction } from "./lib/functions";

const PROVIDER = "hubspot" as const;

const environmentArg = v.union(v.literal("sandbox"), v.literal("production"));

// ── Deployment configuration ──────────────────────────────────────────────────────────────

export type HubSpotOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/** True when the three deployment values exist. Booleans only — never the values themselves. */
export function hubspotConfigured(): boolean {
  return Boolean(
    process.env.HUBSPOT_OAUTH_CLIENT_ID &&
      process.env.HUBSPOT_OAUTH_CLIENT_SECRET &&
      process.env.HUBSPOT_OAUTH_REDIRECT_URI,
  );
}

/**
 * FAILS CLOSED, and the error names the VARIABLE, never its value. There is no development
 * fallback here for the same reason `connectorCredentials.requireCredentialKey` has none
 * (`p25-no-dev-fallback`): a connector that quietly falls back writes rows that look like a real
 * grant and are not.
 */
export function requireHubSpotConfig(): HubSpotOAuthConfig {
  const clientId = process.env.HUBSPOT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.HUBSPOT_OAUTH_REDIRECT_URI;
  if (!clientId) throw new Error("HubSpot OAuth env not configured: HUBSPOT_OAUTH_CLIENT_ID");
  if (!clientSecret) {
    throw new Error("HubSpot OAuth env not configured: HUBSPOT_OAUTH_CLIENT_SECRET");
  }
  if (!redirectUri) {
    throw new Error("HubSpot OAuth env not configured: HUBSPOT_OAUTH_REDIRECT_URI");
  }
  return { clientId, clientSecret, redirectUri };
}

// ── The sealed blob ───────────────────────────────────────────────────────────────────────

/**
 * What the envelope holds. ONE blob, so access and refresh token are always replaced together and
 * there is no window in which a fresh access token sits beside a dead refresh token.
 *
 * `scope` is in here rather than in a column because a granted-scope string is a capability
 * inventory (`gmailAuth.gmailStatus`'s standing rule), and `hubId` because the portal id is the
 * tenant's own account identifier.
 */
export type HubSpotCredential = {
  accessToken: string;
  refreshToken: string;
  scope: string;
  hubId: string | null;
};

const parseCredential = (plaintext: string): HubSpotCredential => JSON.parse(plaintext);

// ── Connect ───────────────────────────────────────────────────────────────────────────────

/**
 * Mint a one-time state and return the consent URL.
 *
 * A `tenantAction` so the tenant comes from the authenticated identity; the state row is written by
 * `connectorOAuth.mintConnectState`, which takes no tenant argument for the same reason.
 */
export const hubspotConnectUrl = tenantAction({
  args: { environment: environmentArg, redirectPath: v.optional(v.string()) },
  handler: async (ctx, { environment, redirectPath }): Promise<{ url: string }> => {
    // GATE BEFORE CONFIG. `mintConnectState` holds the connect-start gate, so minting first means
    // an unauthorized caller is refused with `PROVIDER_NOT_CONNECTABLE` before learning anything —
    // reading the deployment config first told a stranger whether this provider is set up here.
    // ponytail: an unconfigured deployment now leaves ONE state row that expires in 10 minutes.
    // Cheaper than a second gate call, and the row grants nothing on its own.
    const { state } = await ctx.runMutation(api.connectorOAuth.mintConnectState, {
      provider: PROVIDER,
      environment,
      redirectPath: redirectPath ?? DEFAULT_REDIRECT_PATH,
    });
    const config = requireHubSpotConfig();
    return {
      url: buildHubSpotAuthorizeUrl({
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        state,
      }),
    };
  },
});

/**
 * Finish a consent: burn the state, exchange the code, verify the portal, seal the credential.
 *
 * `internalAction` because a callback carries no session. The HTTP route that calls it is a later
 * plan's (28-09) surface; nothing here depends on which route that is, and the result is one of
 * `connectorOAuth`'s closed `ConnectResult` values so a provider error string can never be echoed
 * into a redirect that lands in browser history (CLAUDE.md §4).
 *
 * ORDER MATTERS. The state is consumed BEFORE the exchange: a replayed or grafted callback must
 * cost zero code exchanges and zero writes. And `consumeConnectState` is given no tenantId — the
 * tenant is read out of the row the state hash resolves to, so a callback can only ever reach the
 * tenant that minted it.
 */
export const completeHubSpotConnect = internalAction({
  args: { code: v.string(), state: v.string(), environment: environmentArg },
  handler: async (
    ctx,
    { code, state, environment },
  ): Promise<{ result: ConnectResult; redirectPath: string }> => {
    const consumed = await ctx.runMutation(internal.connectorOAuth.consumeConnectState, {
      state,
      provider: PROVIDER,
      environment,
    });
    if (!consumed.ok) return { result: "invalid_state", redirectPath: DEFAULT_REDIRECT_PATH };
    const { tenantId, connectionId, redirectPath } = consumed;

    let config: HubSpotOAuthConfig;
    try {
      config = requireHubSpotConfig();
    } catch {
      return { result: "unavailable", redirectPath };
    }

    const posted = await postTokenForm({
      url: HUBSPOT_TOKEN_URL,
      form: tokenExchangeBody({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
        code,
      }),
    });
    if (!posted.ok) return { result: "exchange_failed", redirectPath };
    const tokens = parseTokenResponse(posted.body);
    if (!tokens.ok) return { result: "exchange_failed", redirectPath };

    // Re-consent must return the SAME portal. The check runs only when BOTH the stored hash and an
    // observed `hub_id` exist — a missing `hub_id` is unknown, and unknown does not satisfy a
    // binding check, it skips it. Recording nothing is honest; recording a match we never saw
    // would make the guard look enforced when it is not.
    const existing = await ctx.runQuery(internal.connectorCredentials.get, {
      tenantId,
      provider: PROVIDER,
      environment,
    });
    const externalAccountHash =
      tokens.value.hubId === null ? undefined : await hashExternalAccountId(tokens.value.hubId);
    if (
      existing?.externalAccountHash !== undefined &&
      externalAccountHash !== undefined &&
      existing.externalAccountHash !== externalAccountHash
    ) {
      return { result: "account_mismatch", redirectPath };
    }

    // `connectionId` comes from the STATE row, minted before the redirect, so the AAD tuple was
    // fixed before any token existed and a callback cannot choose which connection to seal into.
    // On re-consent the existing row keeps its original connection id, or the envelope would be
    // sealed to a scope the row no longer has.
    const scope = existing?.connectionId ?? connectionId;
    const key = await requireCredentialKey();
    const envelope = await sealCredential(
      key,
      { tenantId, provider: PROVIDER, connectionId: scope, environment },
      JSON.stringify({
        accessToken: tokens.value.accessToken,
        refreshToken: tokens.value.refreshToken,
        // The scope set as WE requested it. HubSpot's token response does not restate the grant,
        // so this records what was asked for — never a wider string inferred from a 200.
        scope: HUBSPOT_READ_SCOPES.join(" "),
        hubId: tokens.value.hubId,
      } satisfies HubSpotCredential),
    );

    await ctx.runMutation(internal.connectorCredentials.upsertSealed, {
      tenantId,
      provider: PROVIDER,
      environment,
      connectionId: scope,
      credentialCiphertextB64: envelope.ciphertextB64,
      credentialIvB64: envelope.ivB64,
      keyVersion: envelope.keyVersion,
      accessExpiresAt: Date.now() + tokens.value.expiresInSec * 1000,
      externalAccountHash,
    });
    return { result: "connected", redirectPath };
  },
});

// ── Access tokens ─────────────────────────────────────────────────────────────────────────

/** How long before expiry a token is refreshed anyway. One read must not straddle the boundary. */
export const ACCESS_REFRESH_SKEW_MS = 120_000;

/** The refresh lease. Long enough for one POST, short enough that a crash does not wedge a row. */
export const REFRESH_LEASE_TTL_MS = 60_000;

export type AccessTokenResult =
  | { ok: true; accessToken: string; accessExpiresAt: number | null }
  | { ok: false; reason: "not_connected" | "revoked" | "reauth" | "busy" | "provider_error" };

/**
 * The token every HubSpot read runs on, refreshed if it is close to expiry.
 *
 * A PLAIN FUNCTION, not a Convex function: `hubspot.ts` calls it in-process rather than paying a
 * `runAction` round trip, and — more to the point — an access token that is never a Convex
 * function's RETURN VALUE is one that cannot be reached by naming a function.
 *
 * TWO GUARDS AROUND THE REFRESH, both from `connectorCredentials` and neither re-implemented here:
 * the LEASE stops a second refresher starting, and `revision` fences one that already started,
 * slept past its lease and came back with a stale credential. A `busy` answer is a real answer —
 * the caller retries the read later rather than racing.
 */
export async function ensureHubSpotAccessToken(
  ctx: ActionCtx,
  input: { tenantId: string; environment: ConnectorEnvironment },
): Promise<AccessTokenResult> {
  const { tenantId, environment } = input;
  const row = await ctx.runQuery(internal.connectorCredentials.get, {
    tenantId,
    provider: PROVIDER,
    environment,
  });
  if (!row) return { ok: false, reason: "not_connected" };
  // `revoked` IS CHECKED FIRST, and the order is the whole point. A disconnect clears the
  // ciphertext and keeps the row, so a ciphertext test placed above this one would absorb every
  // revoked connection into `not_connected` — the outer-guard-swallows-the-inner failure this
  // repo has now shipped twice. "You disconnected this" and "you never connected this" are
  // different sentences and the connections surface says different things about them.
  if (row.status === "revoked") return { ok: false, reason: "revoked" };
  if (!row.credentialCiphertextB64 || !row.credentialIvB64) {
    return { ok: false, reason: "not_connected" };
  }

  const key = await requireCredentialKey(row.keyVersion);
  const scope = {
    tenantId,
    provider: PROVIDER,
    connectionId: row.connectionId,
    environment,
  } as const;
  const credential = parseCredential(
    await openCredential(key, scope, {
      ciphertextB64: row.credentialCiphertextB64,
      ivB64: row.credentialIvB64,
      keyVersion: row.keyVersion,
      algorithm: "AES-256-GCM",
    }),
  );

  const expiresAt = row.accessExpiresAt ?? 0;
  if (expiresAt - ACCESS_REFRESH_SKEW_MS > Date.now()) {
    return {
      ok: true,
      accessToken: credential.accessToken,
      accessExpiresAt: row.accessExpiresAt ?? null,
    };
  }

  const config = requireHubSpotConfig();
  const leaseId = crypto.randomUUID();
  const lease = await ctx.runMutation(internal.connectorCredentials.acquireRefreshLease, {
    tenantId,
    provider: PROVIDER,
    environment,
    leaseId,
    ttlMs: REFRESH_LEASE_TTL_MS,
  });
  if (!lease.ok || lease.revision === undefined) return { ok: false, reason: "busy" };

  const posted = await postTokenForm({
    url: HUBSPOT_TOKEN_URL,
    form: tokenRefreshBody({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: credential.refreshToken,
    }),
  });
  if (!posted.ok) {
    // 400 and 401 both mean the grant is gone as far as HubSpot is concerned; anything else is a
    // transient we must not turn into a reconnect prompt the user cannot act on.
    const dead = posted.statusCode === 400 || posted.statusCode === 401;
    await ctx.runMutation(internal.connectorCredentials.recordReadOutcome, {
      tenantId,
      provider: PROVIDER,
      environment,
      failureClass: dead ? "reauth" : "provider_error",
    });
    return { ok: false, reason: dead ? "reauth" : "provider_error" };
  }
  const refreshed = parseTokenResponse(posted.body);
  if (!refreshed.ok) return { ok: false, reason: "provider_error" };

  const accessExpiresAt = Date.now() + refreshed.value.expiresInSec * 1000;
  const envelope = await sealCredential(
    key,
    scope,
    JSON.stringify({
      accessToken: refreshed.value.accessToken,
      refreshToken: refreshed.value.refreshToken,
      scope: credential.scope,
      hubId: refreshed.value.hubId ?? credential.hubId,
    } satisfies HubSpotCredential),
  );
  const committed = await ctx.runMutation(internal.connectorCredentials.commitRefresh, {
    tenantId,
    provider: PROVIDER,
    environment,
    leaseId,
    revision: lease.revision,
    credentialCiphertextB64: envelope.ciphertextB64,
    credentialIvB64: envelope.ivB64,
    keyVersion: envelope.keyVersion,
    accessExpiresAt,
  });
  // The fence refused: a disconnect or a competing refresh landed while this one was in flight.
  // The new token is real but the row is not ours to write, so the caller retries rather than
  // running a read on a credential the database disagrees with.
  if (!committed.ok) return { ok: false, reason: "busy" };
  return { ok: true, accessToken: refreshed.value.accessToken, accessExpiresAt };
}

// ── Revocation ────────────────────────────────────────────────────────────────────────────

/**
 * What a disconnect actually achieved. `residualAccessUntil` is the HONEST half: HubSpot's revoke
 * kills the refresh token, and whether it also kills already-issued ACCESS tokens is UNDOCUMENTED
 * (the legacy `DELETE` explicitly did not). Until `probeRevocationCascade` proves otherwise on a
 * live grant, a successful revoke reports the access token's own expiry as the window in which
 * residual access MAY survive, and the connections surface must say so.
 */
export type RevokeResult = {
  upstream: RevocationUpstream;
  residualAccessUntil: number | null;
};

async function revokeGrant(
  ctx: ActionCtx,
  input: { tenantId: string; environment: ConnectorEnvironment },
): Promise<RevokeResult> {
  const { tenantId, environment } = input;
  const row = await ctx.runQuery(internal.connectorCredentials.get, {
    tenantId,
    provider: PROVIDER,
    environment,
  });
  if (!row) return { upstream: "not_attempted", residualAccessUntil: null };

  let refreshToken: string | null = null;
  if (row.credentialCiphertextB64 && row.credentialIvB64) {
    const key = await requireCredentialKey(row.keyVersion);
    refreshToken = parseCredential(
      await openCredential(
        key,
        { tenantId, provider: PROVIDER, connectionId: row.connectionId, environment },
        {
          ciphertextB64: row.credentialCiphertextB64,
          ivB64: row.credentialIvB64,
          keyVersion: row.keyVersion,
          algorithm: "AES-256-GCM",
        },
      ),
    ).refreshToken;
  }

  let statusCode: number | undefined;
  let attempted = false;
  if (refreshToken !== null && hubspotConfigured()) {
    const config = requireHubSpotConfig();
    attempted = true;
    const posted = await postTokenForm({
      url: HUBSPOT_REVOKE_URL,
      form: revokeBody({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        token: refreshToken,
        tokenTypeHint: "refresh_token",
      }),
    });
    statusCode = posted.statusCode ?? undefined;
  }

  // The classifier owns the four states, and it is the reason `confirmed` cannot be manufactured:
  // it consults `PROVIDER_REVOKE_SUPPORT`, where hubspot is `unproven`, so a 2xx comes back
  // `confirmed` WITH `residualAccessUnproven` set rather than as a clean kill.
  const outcome = classifyRevokeOutcome({ provider: PROVIDER, attempted, statusCode });
  const residualAccessUntil = outcome.residualAccessUnproven ? (row.accessExpiresAt ?? null) : null;
  await ctx.runMutation(internal.connectorCredentials.recordRevocation, {
    tenantId,
    provider: PROVIDER,
    environment,
    upstream: outcome.upstream,
    statusCode,
    ...(residualAccessUntil === null ? {} : { residualAccessUntil }),
  });
  return { upstream: outcome.upstream, residualAccessUntil };
}

/** The user's own disconnect. Returns the honest outcome, never a boolean "disconnected". */
export const disconnectHubSpot = tenantAction({
  args: { environment: environmentArg },
  handler: (ctx, { environment }): Promise<RevokeResult> =>
    revokeGrant(ctx, { tenantId: ctx.tenantId, environment }),
});

// ── The open condition: does revoke cascade to access tokens? ─────────────────────────────

/**
 * `null` means INCONCLUSIVE, and it is a first-class answer. A probe that could only say
 * true/false would report a network blip as "the cascade works".
 */
export type CascadeProbe = {
  /** The allow-listed read that ran BEFORE the revoke, so a failure after it means something. */
  before: "ok" | "failed";
  upstream: RevocationUpstream;
  after: "ok" | "rejected" | "failed";
  /** true = access token died with the grant; false = it survived; null = nothing was proven. */
  cascaded: boolean | null;
};

/**
 * PROVE OR DISPROVE `revoke-cascades-to-access-tokens` — the HubSpot admission's one open
 * condition, and a named deliverable of 28-05.
 *
 * The whole probe is ONE action because the access token must not outlive it: we hold the
 * pre-revocation token in memory across the revoke, re-issue the SAME allow-listed GET, and record
 * what actually happened. `recordRevocation` has already cleared the stored ciphertext by then, so
 * there is no way to run this read after the fact — which is exactly why it cannot be split.
 *
 * IT DESTROYS A GRANT. `confirm: "revoke"` is required so it cannot be reached by a mistyped
 * function name, and it is `internalAction` so no browser can reach it at all.
 *
 * IT CLEARS NOTHING. The return value is EVIDENCE. Whether the condition is resolved is 28-22's
 * judgment, recorded on the `providerGates` row by an owner seal — not by this function, and not by
 * the smoke script that calls it.
 */
export const probeRevocationCascade = internalAction({
  args: {
    tenantId: v.string(),
    environment: environmentArg,
    confirm: v.literal("revoke"),
  },
  handler: async (ctx, { tenantId, environment }): Promise<CascadeProbe> => {
    const token = await ensureHubSpotAccessToken(ctx, { tenantId, environment });
    if (!token.ok) {
      return { before: "failed", upstream: "not_attempted", after: "failed", cascaded: null };
    }

    // One cheap, bounded, allow-listed GET. `owners` is the smallest list HubSpot will serve and
    // carries nothing we retain beyond ids.
    const probeRead = () =>
      readPages({
        provider: PROVIDER,
        environment,
        path: HUBSPOT_DATASET_PATHS.owners,
        accessToken: token.accessToken,
        cursorParam: "after",
        query: new URLSearchParams({ limit: "1" }),
        parsePage: () => ({ items: [], cursor: null }),
        maxPages: 1,
      });

    const before = await probeRead();
    if (before.stoppedBy?.kind === "failure") {
      // Nothing can be concluded from a token that did not work BEFORE the revoke.
      return { before: "failed", upstream: "not_attempted", after: "failed", cascaded: null };
    }

    const revoked = await revokeGrant(ctx, { tenantId, environment });
    const after = await probeRead();
    const failure = after.stoppedBy?.kind === "failure" ? after.stoppedBy.failureClass : null;

    // Only `reauth` (401) proves the token stopped being accepted. A 429 or a 500 proves nothing,
    // and reporting either as a cascade would clear an open condition on a coincidence.
    const cascaded =
      failure === null ? false : failure === "reauth" || failure === "forbidden" ? true : null;
    return {
      before: "ok",
      upstream: revoked.upstream,
      after: failure === null ? "ok" : cascaded === true ? "rejected" : "failed",
      cascaded,
    };
  },
});
