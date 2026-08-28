// Phase 28 connector OAuth round-trip — the SHARED SECURITY MECHANICS, not a connector runtime.
//
// gmailAuth.ts and microsoftAuth.ts are the two concrete implementations 28-CONTEXT required before
// generalising anything, and this module is the generalisation of exactly the parts that were
// identical in both and got weaker each time they were retyped: bind the tenant into the round
// trip, refuse a replay, and never let a secret reach a redirect. Everything provider-specific —
// authorize URL, token endpoint, code exchange, account verification, refresh grant — deliberately
// stays in each provider's own module (28-05..28-08). There is no plugin registry here, no
// provider-agnostic client, and no config for a value that never changes.
//
// WHAT THIS FIXES relative to the two originals. Both signed `state` with an HMAC of the tenantId.
// An HMAC binds the tenant, so it stops tenant grafting, but it is REPLAYABLE forever: the same
// state verifies on the tenth callback as on the first, and the signing key is the OAuth client
// secret, so any relying party that learns it can mint states. The connector providers hold other
// people's financial data, so state here is a server-random nonce stored as a SHA-256 hash in a row
// that is consumed once (28-RESEARCH, "One-time OAuth state").
//
// NOT "use node": these are DB helpers plus one client-safe tenantQuery, exactly like gmailAuth.ts.
// Provider callback handlers live in their own modules and reach `consumeConnectState` through
// ctx.runMutation.
import type { Provider, RevocationUpstream } from "@pikar/revenue";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { newConnectionId } from "./connectorCredentials";
import { tenantMutation, tenantQuery } from "./lib/functions";

// ── Argument validators ───────────────────────────────────────────────────────────────────

const providerArg = v.union(
  v.literal("hubspot"),
  v.literal("quickbooks"),
  v.literal("stripe"),
  v.literal("paypal"),
);
const environmentArg = v.union(v.literal("sandbox"), v.literal("production"));

// ── State lifetime ────────────────────────────────────────────────────────────────────────

/**
 * How long a mint is good for. Ten minutes is a consent screen plus a slow login, and nothing
 * else — a state that outlives the browser tab it was minted for is a replay target sitting in a
 * user's history. gmailAuth's HMAC state had no expiry at all; this is the second half of the fix.
 */
export const STATE_TTL_MS = 10 * 60_000;

/** 32 bytes of CSPRNG. Never stored — only its SHA-256 is. */
function mintNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  // base64url: the value travels in a query string, so `+` and `/` must not appear.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 hex, the same idiom as `gmailAuth.hmacHex` and `connectorCredentials.hashExternalAccountId`. */
export async function hashState(nonce: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Redirect hygiene ──────────────────────────────────────────────────────────────────────

/** Where a callback lands when the stored path is missing or fails validation. */
export const DEFAULT_REDIRECT_PATH = "/dashboard/profile";

/** Long enough for any route this app has, short enough that a URL cannot be smuggled in. */
const REDIRECT_PATH_CAP = 128;

/**
 * A same-origin, query-free, fragment-free in-app path — or null.
 *
 * An OAuth callback that honours an attacker-chosen redirect hands the authorization code to
 * whoever asked for it. The check is a CHARACTER ALLOW-LIST rather than a blocklist of known
 * tricks: `//host`, `/\host`, `%2f%2fhost`, a `\n` header injection and a `user@host` authority are
 * each their own bypass of a blocklist, and the next one has not been invented yet. Nothing but
 * unreserved URL characters and `/` gets through, so there is no encoding left to be clever with.
 */
export function safeRedirectPath(raw: string): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > REDIRECT_PATH_CAP) return null;
  if (!raw.startsWith("/")) return null;
  // `//host` is protocol-relative and leaves the origin. `/\host` is the variant some URL parsers
  // normalise INTO `//host`, so it has to die here too.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (!/^\/[A-Za-z0-9\-._~/]*$/.test(raw)) return null;
  if (raw.includes("..")) return null;
  return raw;
}

/**
 * How a provider callback ends, as a closed set. This is the ONLY thing besides the provider name
 * that reaches the browser, which is what makes "the redirect cannot carry a secret" structural: a
 * provider error string is never echoed, so it can never carry a code, a token or a customer name
 * into a URL that lands in browser history and the referrer header (CLAUDE.md §4).
 */
export const CONNECT_RESULTS = [
  "connected",
  "denied",
  "invalid_state",
  "exchange_failed",
  "account_mismatch",
  "unavailable",
] as const;
export type ConnectResult = (typeof CONNECT_RESULTS)[number];

/**
 * The callback's `Location`. Both inputs come from closed sets — an unknown result degrades to
 * `unavailable` rather than being echoed, and an unsafe path falls back rather than being partly
 * honoured.
 */
export function callbackRedirectPath(
  redirectPath: string,
  provider: Provider,
  result: ConnectResult,
): string {
  const path = safeRedirectPath(redirectPath) ?? DEFAULT_REDIRECT_PATH;
  const safeResult = (CONNECT_RESULTS as readonly string[]).includes(result)
    ? result
    : "unavailable";
  return `${path}?connect=${provider}&result=${safeResult}`;
}

// ── Revocation honesty ────────────────────────────────────────────────────────────────────

/**
 * WHAT EACH PROVIDER'S DOCUMENTATION ACTUALLY ESTABLISHES about server-side revocation, as of the
 * 2026-08-27 admission decisions. This is a record of evidence, not a capability wish-list, and it
 * is the reason `classifyRevokeOutcome` cannot be talked into `confirmed`.
 *
 *  • `quickbooks` — `confirmed`. `POST https://developer.api.intuit.com/v2/oauth2/tokens/revoke`,
 *    live in the OIDC discovery document, 200 on success. Revoking removes the app's permissions.
 *  • `hubspot` — `unproven`. `POST /oauth/2026-03/token/revoke` exists, but no primary page says it
 *    invalidates already-issued ACCESS tokens, and the legacy `DELETE` explicitly did NOT cascade.
 *    A 200 kills the refresh token; access tokens may live out their TTL. 28-05 must test this.
 *  • `stripe` — `unsupported`. No documented platform-initiated revoke for Stripe Apps; only user
 *    uninstall plus an `account.application.deauthorized` webhook. Connect's
 *    `POST /oauth/deauthorize` belongs to the OTHER flow and no documentation says it applies here.
 *  • `paypal` — `unsupported`. No revocation endpoint is documented anywhere. Seller-side removal
 *    of granted permissions is an account action, not an API.
 *
 * Change an entry only with a documentation link in the provider's suitability record.
 */
export const PROVIDER_REVOKE_SUPPORT: Record<Provider, "confirmed" | "unproven" | "unsupported"> = {
  hubspot: "unproven",
  quickbooks: "confirmed",
  stripe: "unsupported",
  paypal: "unsupported",
};

export type RevokeOutcome = {
  upstream: RevocationUpstream;
  /**
   * The grant was revoked as far as the provider's API goes, but the cascade to already-issued
   * ACCESS tokens is undocumented. The caller MUST pass `recordRevocation` a `residualAccessUntil`
   * when this is true, or the connections surface will claim a completeness nobody proved.
   */
  residualAccessUnproven: boolean;
};

/**
 * Turn what actually happened into one of the four upstream states — and make the dishonest answer
 * unreachable.
 *
 * THE FIRST GUARD IS THE POINT. A provider with no documented revoke endpoint returns `unsupported`
 * before anything else is examined, INCLUDING a 200. There is no endpoint a 200 could have come
 * from, so a 200 here means the caller pointed a revoke at something else and is about to record
 * "the grant is dead" for a PayPal grant that is still live. Deleting our local copy is a real and
 * useful act; it is not revocation, and Invariant 12 exists because the product must not say it is.
 *
 * `not_attempted` stays distinct from `unsupported`: "we have an endpoint and skipped it" and "there
 * is no endpoint" are different apologies and lead to different next steps for the user.
 */
export function classifyRevokeOutcome(input: {
  provider: Provider;
  /** Did we actually issue a revoke request? */
  attempted: boolean;
  /** The provider's HTTP status CODE only — never a body (CLAUDE.md §4). Absent = network/throw. */
  statusCode?: number;
}): RevokeOutcome {
  const support = PROVIDER_REVOKE_SUPPORT[input.provider];
  if (support === "unsupported") return { upstream: "unsupported", residualAccessUnproven: false };
  if (!input.attempted) return { upstream: "not_attempted", residualAccessUnproven: false };

  const ok = input.statusCode !== undefined && input.statusCode >= 200 && input.statusCode < 300;
  // Deliberately NOT gmailAuth's "400 also counts": that rule is Google's ("already invalid"), and
  // Intuit documents 400 as plain failure. A borrowed success rule is a manufactured success.
  if (!ok) return { upstream: "attempted_failed", residualAccessUnproven: false };
  return { upstream: "confirmed", residualAccessUnproven: support === "unproven" };
}

// ── Mint (public, tenant-scoped) ──────────────────────────────────────────────────────────

/**
 * Start a connect: mint a one-time state and the connection id it will seal into.
 *
 * `tenantMutation`, so the tenant comes from the authenticated identity and there is no argument by
 * which a caller could mint a state bound to somebody else. The `connectionId` is minted HERE,
 * before the redirect, so the credential AAD tuple is fixed before any token exists — a callback
 * cannot choose which connection its tokens get bound to.
 *
 * The raw nonce is returned to the caller and never stored. The provider module turns it into that
 * provider's authorize URL; building that URL is not this module's business.
 */
export const mintConnectState = tenantMutation({
  args: {
    provider: providerArg,
    environment: environmentArg,
    /** Where the callback should land. Validated NOW so a bad target dies before consent. */
    redirectPath: v.string(),
  },
  handler: async (
    ctx,
    { provider, environment, redirectPath },
  ): Promise<{ state: string; connectionId: string; expiresAt: number }> => {
    const path = safeRedirectPath(redirectPath);
    if (!path) throw new Error("Unsafe connector redirect path");

    const state = mintNonce();
    const now = Date.now();
    const expiresAt = now + STATE_TTL_MS;
    const connectionId = newConnectionId();
    await ctx.db.insert("connectorOAuthStates", {
      tenantId: ctx.tenantId,
      provider,
      environment,
      stateHash: await hashState(state),
      connectionId,
      redirectPath: path,
      expiresAt,
      createdAt: now,
    });
    return { state, connectionId, expiresAt };
  },
});

/**
 * The diagnostic read: how many consents are in flight, per provider. Counts and status ONLY — no
 * hash, no nonce, no connection id, nothing a support session could paste into a callback.
 */
export const pendingConnectStates = tenantQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    Array<{ provider: Provider; environment: "sandbox" | "production"; pending: number }>
  > => {
    const now = Date.now();
    const counts = new Map<
      string,
      { provider: Provider; environment: "sandbox" | "production"; pending: number }
    >();
    for (const row of await ctx.db
      .query("connectorOAuthStates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect()) {
      if (row.usedAt !== undefined || row.expiresAt <= now) continue;
      const key = `${row.provider}:${row.environment}`;
      const seen = counts.get(key);
      if (seen) seen.pending += 1;
      else counts.set(key, { provider: row.provider, environment: row.environment, pending: 1 });
    }
    return [...counts.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  },
});

// ── Consume (internal, callback-side) ─────────────────────────────────────────────────────

export type ConsumeStateResult =
  | { ok: true; tenantId: string; connectionId: string; redirectPath: string }
  | {
      ok: false;
      reason:
        | "unknown_state"
        | "provider_mismatch"
        | "environment_mismatch"
        | "already_used"
        | "expired";
    };

/**
 * Validate and burn a state — step 1 of the callback, BEFORE the code exchange (28-RESEARCH).
 *
 * THERE IS NO `tenantId` ARGUMENT, and that is the security property, not an omission. The callback
 * arrives from the provider with a code and a state and no session; if it could also name a tenant,
 * an attacker who completes their own consent could graft their provider account onto somebody
 * else's tenant. The tenant is READ OUT of the row the state resolves to, so the only tenant a
 * callback can ever reach is the one that minted it.
 *
 * ATOMICITY IS THE PLATFORM'S. A Convex mutation is a serializable transaction, so the read of
 * `usedAt` and the write that sets it cannot interleave with a second callback — no lease, no CAS,
 * no extra column (CLAUDE.md §8 rung 4). This is exactly why consuming is a mutation and not a
 * query the callback action checks first.
 *
 * FIVE GUARDS, EACH WITH ITS OWN REASON. They are not merged and they do not share a return value:
 * 28-03 shipped a test whose case was silently satisfied by an outer guard and never reached the
 * inner one it was named after, and the only durable defence is that every guard can be observed
 * refusing alone. Keep the reasons distinct.
 *
 * A REFUSAL CARRIES NOTHING. No tenantId, no connectionId, no redirectPath — so a caller that
 * ignores `ok` still has no connection scope to seal a token into, and "zero exchange, zero store"
 * does not depend on the caller's good manners.
 *
 * A refusal also does NOT burn the row. A wrong-provider or wrong-environment probe against a
 * state the user is legitimately mid-consent with must not consume it and strand a real connect.
 */
export const consumeConnectState = internalMutation({
  args: { state: v.string(), provider: providerArg, environment: environmentArg },
  handler: async (ctx, { state, provider, environment }): Promise<ConsumeStateResult> => {
    // The nonce is hashed on the way IN, so the lookup value and the stored value are the same
    // one-way digest and a database read yields nothing presentable at a callback.
    const stateHash = await hashState(state);
    const row = await ctx.db
      .query("connectorOAuthStates")
      .withIndex("by_state", (q) => q.eq("stateHash", stateHash))
      .unique();

    if (!row) return { ok: false, reason: "unknown_state" };
    if (row.provider !== provider) return { ok: false, reason: "provider_mismatch" };
    if (row.environment !== environment) return { ok: false, reason: "environment_mismatch" };
    if (row.usedAt !== undefined) return { ok: false, reason: "already_used" };
    if (row.expiresAt <= Date.now()) return { ok: false, reason: "expired" };

    await ctx.db.patch(row._id, { usedAt: Date.now() });
    return {
      ok: true,
      tenantId: row.tenantId,
      connectionId: row.connectionId,
      // Re-validated on the way out as well: the row was written by a validated mint, but a
      // defence that only runs at the write is one migration away from not running at all.
      redirectPath: safeRedirectPath(row.redirectPath) ?? DEFAULT_REDIRECT_PATH,
    };
  },
});

// ── The token POST (shared, and the ONLY non-GET a connector may make) ────────────────────

/**
 * Post one `application/x-www-form-urlencoded` OAuth token request and hand back a STATUS CODE and
 * a parsed body — nothing else.
 *
 * WHY IT LIVES HERE and not in a provider module. Every rail needs exactly three POSTs (exchange,
 * refresh, revoke) and they differ only in the form body, which each provider builds in its own
 * pure module. Retyping this per rail is how the third one forgets `redirect: "error"` or starts
 * logging a response body. It also keeps the guarantee `scripts/check-provider-lane.mjs` scans
 * for literally true: a LANE module (`hubspot*.ts`, `quickbooks*.ts`, ...) contains no write verb
 * and no direct fetch, because the only POST in the connector plane is this one.
 *
 * THREE THINGS IT REFUSES TO DO.
 *   • It never follows a redirect. `redirect: "error"` — undici would otherwise replay the form,
 *     client secret and all, at whatever origin the provider named.
 *   • It never returns, logs or throws the response TEXT. A provider error body is vendor content
 *     and can carry an account identifier (CLAUDE.md §4); only the status code travels.
 *   • It never takes a header or a method parameter. The URL is the caller's, from a pinned
 *     constant in the provider's pure module; everything else is fixed here.
 */
export type TokenPostResult = {
  /** 2xx. A caller must not infer success from a parsed body alone. */
  ok: boolean;
  /** The provider's HTTP status code, or `null` when the request never completed. */
  statusCode: number | null;
  /** Parsed JSON on 2xx, `null` otherwise or on unparseable bytes. */
  body: unknown;
};

/** One attempt, no retries: a token exchange is single-use and replaying one can burn the grant. */
export const TOKEN_POST_TIMEOUT_MS = 15_000;

/** Enough for any token response; a megabyte of "JSON" is a maintenance page, not a grant. */
const TOKEN_BODY_BYTE_CAP = 64_000;

export async function postTokenForm(input: {
  url: string;
  form: URLSearchParams;
  /**
   * HTTP Basic client authentication, when the provider requires it rather than accepting the
   * client credentials as form fields. Intuit does: its token and revoke endpoints are documented
   * with `Authorization: Basic base64(client_id:client_secret)` and nothing else, and RFC 6749
   * §2.3.1 makes body credentials the OPTIONAL half a server may not support. HubSpot's endpoint
   * takes form fields, so this stays optional rather than becoming the one true way.
   *
   * The secret is consumed into a header inside this function and is never returned or logged.
   */
  basicAuth?: { clientId: string; clientSecret: string };
  /**
   * Send `form`'s pairs as a flat JSON object instead of `application/x-www-form-urlencoded`.
   *
   * One flag rather than a second body type, because the only caller that needs it is Intuit's
   * revoke endpoint, which documents a JSON `{"token": "..."}` body. The pairs, the https check,
   * the redirect refusal, the timeout and the "no body ever leaves" rule are identical either way,
   * and a parallel function would be a second place for one of those to be forgotten.
   */
  asJson?: boolean;
  /** Test seam only. Production passes nothing and gets the platform fetch. */
  fetchImpl?: typeof fetch;
}): Promise<TokenPostResult> {
  if (!input.url.startsWith("https://")) {
    throw new Error("A connector token endpoint must be https.");
  }
  const send = input.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "Content-Type":
      input.asJson === true ? "application/json" : "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (input.basicAuth !== undefined) {
    const { clientId, clientSecret } = input.basicAuth;
    if (clientId === "" || clientSecret === "") {
      // Refusing beats sending `Basic Og==`: an empty credential produces a 400 the caller would
      // then classify as the tenant's dead grant, and the user would be told to reconnect over a
      // deployment misconfiguration reconnecting cannot fix.
      throw new Error("A connector token endpoint needs both client credentials.");
    }
    headers.Authorization = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
  }
  const body =
    input.asJson === true ? JSON.stringify(Object.fromEntries(input.form)) : input.form.toString();
  let response: Response;
  try {
    response = await send(input.url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(TOKEN_POST_TIMEOUT_MS),
      headers,
      body,
    });
  } catch {
    return { ok: false, statusCode: null, body: null };
  }

  const ok = response.status >= 200 && response.status < 300;
  if (!ok) return { ok: false, statusCode: response.status, body: null };

  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false, statusCode: response.status, body: null };
  }
  if (text.length > TOKEN_BODY_BYTE_CAP) {
    return { ok: false, statusCode: response.status, body: null };
  }
  try {
    return { ok: true, statusCode: response.status, body: JSON.parse(text) };
  } catch {
    // A 200 that is not JSON is not a grant. The text itself never leaves this function.
    return { ok: false, statusCode: response.status, body: null };
  }
}
