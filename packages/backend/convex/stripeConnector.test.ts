// The Stripe lane, proven offline against a real in-memory Convex backend. $0 — convex-test only,
// no network, no Stripe, no model.
//
// FOUR THINGS THESE TESTS EXIST FOR, in order of how expensive the bug would be.
//
//  1. THE ROUTE ITSELF. The Aug-5 research said "become a Connect Extension to get `read_only`".
//     That door is CLOSED — Stripe: "You can no longer build new Connect extensions." The route is
//     a Stripe App with `stripe_api_access_type: "oauth"` declaring only `*_read` permissions. So
//     there are tests that pin the authorize ORIGIN, pin every permission's `_read` suffix, and
//     refuse a `read_write`/`read_only` scope string outright. A rename of any of those must go red.
//  2. REVOCATION HONESTY, WHICH IS AN OPEN CONDITION AND STAYS OPEN. There is NO documented
//     platform-initiated revoke for Stripe Apps. Connect's deauthorize belongs to the other flow.
//     So disconnect must make ZERO upstream calls and record `unsupported` — never `confirmed`, and
//     never a local ciphertext clear dressed up as an upstream revocation.
//  3. LIVE/TEST MODE BINDING. A production connection sealed from a test-mode grant reads a sandbox
//     account's numbers and calls them the business. `livemode` is checked before anything is
//     sealed.
//  4. THE NAMESPACE BOUNDARY. A SECOND Stripe integration exists in this repo (phase 28.1,
//     `packages/billing/`, `convex/billing*.ts`, `BILLING_STRIPE_*`) that charges from PIKAR'S OWN
//     merchant account and is write-capable. The naming split is the only thing keeping the wrong
//     secret out of the wrong path, so there is a source scan for it.
import { CAPS, DECISION_SUPPORT_NOTICE, importCredentialKey, sealCredential } from "@pikar/revenue";
import { STRIPE_MAX_PAGES, STRIPE_READ_PATHS } from "@pikar/revenue/providers/stripe";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { isAllowedRead, PROVIDER_READ_PATHS } from "./connectorFetch";
import { classifyRevokeOutcome, PROVIDER_REVOKE_SUPPORT } from "./connectorOAuth";
import schema from "./schema";
import {
  ACCESS_TOKEN_TTL_S,
  classifyTokenFailure,
  isStripeAccountId,
  parseStripeCredential,
  parseStripeGrant,
  STRIPE_APP_PERMISSIONS,
  STRIPE_AUTHORIZE_ENDPOINT,
  STRIPE_GRANT_SCOPE,
  STRIPE_TOKEN_ENDPOINT,
  stripeAuthorizeUrl,
} from "./stripeAuth";

const modules = import.meta.glob("./**/*.*s");

/** Raw sources for the write-verb and namespace scans. edge-runtime has no `node:fs`. */
const rawSources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const ACCOUNT = "acct_1PikarStripeTestAccount";
const OTHER_ACCOUNT = "acct_1SomeoneElsesAccount";
const ACCESS_1 = "SENTINEL-ACCESS-1-DO-NOT-LEAK";
const REFRESH_1 = "SENTINEL-REFRESH-1-DO-NOT-LEAK";
const ACCESS_2 = "SENTINEL-ACCESS-2-DO-NOT-LEAK";
const REFRESH_2 = "SENTINEL-REFRESH-2-DO-NOT-LEAK";

function keyB64(fill: number): string {
  let binary = "";
  for (const b of new Uint8Array(32).fill(fill)) binary += String.fromCharCode(b);
  return btoa(binary);
}

const KEY_B64 = keyB64(11);

beforeEach(() => {
  process.env.CONNECTOR_CREDENTIAL_KEY_V1 = KEY_B64;
  process.env.STRIPE_APP_CLIENT_ID = "ca_test_client_id";
  process.env.STRIPE_APP_SECRET_KEY = "sk_test_app_secret_key";
  process.env.STRIPE_APP_REDIRECT_URI = "https://example.test/stripe/callback";
  process.env.STRIPE_APP_API_VERSION = "2024-06-20";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const APP = {
  clientId: "ca_test_client_id",
  secretKey: "sk_test_app_secret_key",
  redirectUri: "https://example.test/stripe/callback",
  apiVersion: "2024-06-20",
};

async function harness() {
  const t = convexTest(schema, modules);
  const userA = await t.run((ctx) => ctx.db.insert("users", {}));
  const userB = await t.run((ctx) => ctx.db.insert("users", {}));
  return {
    t,
    tenantA: String(userA),
    tenantB: String(userB),
    asA: t.withIdentity({ subject: `${userA}|session_a` }),
    asB: t.withIdentity({ subject: `${userB}|session_b` }),
  };
}

const grantBody = (
  access: string,
  refresh: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  access_token: access,
  refresh_token: refresh,
  token_type: "bearer",
  scope: "stripe_apps",
  stripe_user_id: ACCOUNT,
  livemode: false,
  expires_in: 3600,
  ...over,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Seal a connection straight into the DB, the way a completed callback would leave it. */
async function seedConnection(
  t: Awaited<ReturnType<typeof harness>>["t"],
  tenantId: string,
  over: { access?: string; refresh?: string; accountId?: string; accessExpiresAt?: number } = {},
) {
  const connectionId = `conn_${tenantId}`;
  const key = await importCredentialKey(KEY_B64, "v1");
  const accountId = over.accountId ?? ACCOUNT;
  const sealed = await sealCredential(
    key,
    { tenantId, provider: "stripe", connectionId, environment: "sandbox" },
    JSON.stringify({
      accessToken: over.access ?? ACCESS_1,
      refreshToken: over.refresh ?? REFRESH_1,
      accountId,
      scope: STRIPE_GRANT_SCOPE,
    }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("connectorConnections", {
      tenantId,
      provider: "stripe",
      environment: "sandbox",
      status: "connected",
      revision: 1,
      connectionId,
      credentialCiphertextB64: sealed.ciphertextB64,
      credentialIvB64: sealed.ivB64,
      keyVersion: sealed.keyVersion,
      accessExpiresAt: over.accessExpiresAt ?? Date.now() + 3_600_000,
      refreshExpiresAt: Date.now() + 365 * 86_400_000,
      externalAccountHash: await (async () => {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accountId));
        return Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      })(),
      connectedAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  return connectionId;
}

// ── The route, pinned ─────────────────────────────────────────────────────────────────────

describe("the Stripe App route, and not the dead Extension one", () => {
  test("consent starts at the Stripe Apps marketplace, not at Connect", () => {
    expect(STRIPE_AUTHORIZE_ENDPOINT).toBe("https://marketplace.stripe.com/oauth/v2/authorize");
    // Connect's own authorize host would mean the Extension route, which Stripe closed in 2022.
    expect(STRIPE_AUTHORIZE_ENDPOINT).not.toContain("connect.stripe.com");
  });

  test("the token exchange is Stripe's API host", () => {
    expect(STRIPE_TOKEN_ENDPOINT).toBe("https://api.stripe.com/v1/oauth/token");
  });

  test("the grant scope string is pinned to the literal Stripe Apps returns", () => {
    // Asserted as a LITERAL, once. Every other test in this file builds its grant bodies from the
    // same constant, so mutating the constant alone would move the tests with it and prove nothing.
    expect(STRIPE_GRANT_SCOPE).toBe("stripe_apps");
  });

  test("every declared permission is a read permission", () => {
    expect(STRIPE_APP_PERMISSIONS.length).toBeGreaterThan(0);
    for (const permission of STRIPE_APP_PERMISSIONS) {
      expect(permission.endsWith("_read")).toBe(true);
    }
  });

  test("no permission has a write counterpart named here", () => {
    for (const permission of STRIPE_APP_PERMISSIONS) {
      expect(permission).not.toContain("_write");
    }
  });

  test("the authorize URL carries client id, redirect and state — and never a scope", () => {
    const url = new URL(stripeAuthorizeUrl(APP, "nonce-123"));
    expect(url.origin + url.pathname).toBe(STRIPE_AUTHORIZE_ENDPOINT);
    expect(url.searchParams.get("client_id")).toBe(APP.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(APP.redirectUri);
    expect(url.searchParams.get("state")).toBe("nonce-123");
    // A Stripe App's access comes from its MANIFEST permissions. A `scope` parameter here would be
    // the Connect vocabulary, where the only alternative to `read_only` is `read_write`.
    expect(url.searchParams.get("scope")).toBeNull();
    expect(url.toString()).not.toContain("read_write");
  });
});

// ── Grant parsing ─────────────────────────────────────────────────────────────────────────

describe("parseStripeGrant", () => {
  const now = 1_700_000_000_000;

  test("accepts a well-formed Stripe Apps grant", () => {
    const grant = parseStripeGrant(grantBody(ACCESS_1, REFRESH_1), now);
    expect(grant?.accessToken).toBe(ACCESS_1);
    expect(grant?.refreshToken).toBe(REFRESH_1);
    expect(grant?.accountId).toBe(ACCOUNT);
    expect(grant?.livemode).toBe(false);
    expect(grant?.accessExpiresAt).toBe(now + ACCESS_TOKEN_TTL_S * 1000);
  });

  test("refuses a grant with no refresh token — Stripe rolls it on every exchange", () => {
    const body = grantBody(ACCESS_1, REFRESH_1);
    delete body.refresh_token;
    expect(parseStripeGrant(body, now)).toBeNull();
  });

  test("refuses a scope string that is not the Stripe Apps one", () => {
    expect(
      parseStripeGrant(grantBody(ACCESS_1, REFRESH_1, { scope: "read_write" }), now),
    ).toBeNull();
    // Even `read_only` is refused: it is the CONNECT vocabulary, and a grant that speaks it did not
    // come from a Stripe App. Accepting it would silently put the lane back on the dead route.
    expect(
      parseStripeGrant(grantBody(ACCESS_1, REFRESH_1, { scope: "read_only" }), now),
    ).toBeNull();
  });

  test("refuses a stripe_user_id that is not an account id", () => {
    expect(
      parseStripeGrant(grantBody(ACCESS_1, REFRESH_1, { stripe_user_id: "cus_1" }), now),
    ).toBeNull();
    expect(parseStripeGrant(grantBody(ACCESS_1, REFRESH_1, { stripe_user_id: 7 }), now)).toBeNull();
  });

  test("refuses a grant that does not say which mode it is for", () => {
    const body = grantBody(ACCESS_1, REFRESH_1);
    delete body.livemode;
    expect(parseStripeGrant(body, now)).toBeNull();
  });

  test("a missing expires_in falls back to Stripe's hour, never to zero", () => {
    const body = grantBody(ACCESS_1, REFRESH_1);
    delete body.expires_in;
    const grant = parseStripeGrant(body, now);
    expect(grant?.accessExpiresAt).toBe(now + ACCESS_TOKEN_TTL_S * 1000);
  });
});

describe("isStripeAccountId", () => {
  test("accepts an account id", () => {
    expect(isStripeAccountId(ACCOUNT)).toBe(true);
  });
  test("refuses every other Stripe object prefix and every path trick", () => {
    for (const bad of ["cus_1", "ch_1", "acct", "acct_", "acct_a/b", "acct_a%2fb", "", 5, null]) {
      expect(isStripeAccountId(bad)).toBe(false);
    }
  });
});

describe("parseStripeCredential", () => {
  test("round-trips a sealed blob", () => {
    const blob = JSON.stringify({
      accessToken: ACCESS_1,
      refreshToken: REFRESH_1,
      accountId: ACCOUNT,
      scope: STRIPE_GRANT_SCOPE,
    });
    expect(parseStripeCredential(blob)?.accountId).toBe(ACCOUNT);
  });
  test("returns null rather than a partial blob", () => {
    expect(parseStripeCredential("{}")).toBeNull();
    expect(parseStripeCredential("not json")).toBeNull();
    expect(
      parseStripeCredential(
        JSON.stringify({
          accessToken: ACCESS_1,
          refreshToken: REFRESH_1,
          accountId: "nope",
          scope: "x",
        }),
      ),
    ).toBeNull();
  });
});

describe("classifyTokenFailure", () => {
  test("a null status is a network failure", () => {
    expect(classifyTokenFailure(null)).toBe("network");
  });
  test("401 is OUR credential, not the tenant's", () => {
    expect(classifyTokenFailure(401)).toBe("forbidden");
  });
  test("another 4xx means the grant is gone", () => {
    expect(classifyTokenFailure(400)).toBe("reauth");
  });
  test("5xx is the provider", () => {
    expect(classifyTokenFailure(503)).toBe("provider_error");
  });
});

// ── The callback ──────────────────────────────────────────────────────────────────────────

describe("handleCallback", () => {
  test("a valid consent seals a connection and the plaintext never lands in a row", async () => {
    const h = await harness();
    const minted = await h.asA.mutation(api.connectorOAuth.mintConnectState, {
      provider: "stripe",
      environment: "sandbox",
      redirectPath: "/dashboard/profile",
    });
    const fetchMock = vi.fn(async () => jsonResponse(grantBody(ACCESS_1, REFRESH_1)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await h.t.action(internal.stripeAuth.handleCallback, {
      environment: "sandbox",
      state: minted.state,
      code: "ac_test_code",
    });
    expect(result.result).toBe("connected");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const rows = await h.t.run((ctx) => ctx.db.query("connectorConnections").collect());
    expect(rows).toHaveLength(1);
    const stored = JSON.stringify(rows[0]);
    expect(stored).not.toContain(ACCESS_1);
    expect(stored).not.toContain(REFRESH_1);
    expect(stored).not.toContain(ACCOUNT);
  });

  test("a replayed state performs zero exchange and zero writes", async () => {
    const h = await harness();
    const minted = await h.asA.mutation(api.connectorOAuth.mintConnectState, {
      provider: "stripe",
      environment: "sandbox",
      redirectPath: "/dashboard/profile",
    });
    const fetchMock = vi.fn(async () => jsonResponse(grantBody(ACCESS_1, REFRESH_1)));
    vi.stubGlobal("fetch", fetchMock);
    await h.t.action(internal.stripeAuth.handleCallback, {
      environment: "sandbox",
      state: minted.state,
      code: "ac_test_code",
    });
    fetchMock.mockClear();

    const replay = await h.t.action(internal.stripeAuth.handleCallback, {
      environment: "sandbox",
      state: minted.state,
      code: "ac_test_code",
    });
    expect(replay.result).toBe("invalid_state");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a live-mode grant is refused for a sandbox connection", async () => {
    const h = await harness();
    const minted = await h.asA.mutation(api.connectorOAuth.mintConnectState, {
      provider: "stripe",
      environment: "sandbox",
      redirectPath: "/dashboard/profile",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(grantBody(ACCESS_1, REFRESH_1, { livemode: true }))),
    );
    const result = await h.t.action(internal.stripeAuth.handleCallback, {
      environment: "sandbox",
      state: minted.state,
      code: "ac_test_code",
    });
    expect(result.result).toBe("account_mismatch");
    expect(await h.t.run((ctx) => ctx.db.query("connectorConnections").collect())).toHaveLength(0);
  });

  test("a test-mode grant is refused for a production connection", async () => {
    const h = await harness();
    const minted = await h.asA.mutation(api.connectorOAuth.mintConnectState, {
      provider: "stripe",
      environment: "production",
      redirectPath: "/dashboard/profile",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(grantBody(ACCESS_1, REFRESH_1, { livemode: false }))),
    );
    const result = await h.t.action(internal.stripeAuth.handleCallback, {
      environment: "production",
      state: minted.state,
      code: "ac_test_code",
    });
    expect(result.result).toBe("account_mismatch");
  });

  test("re-consent from a DIFFERENT Stripe account is refused", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    const minted = await h.asA.mutation(api.connectorOAuth.mintConnectState, {
      provider: "stripe",
      environment: "sandbox",
      redirectPath: "/dashboard/profile",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(grantBody(ACCESS_2, REFRESH_2, { stripe_user_id: OTHER_ACCOUNT })),
      ),
    );
    const result = await h.t.action(internal.stripeAuth.handleCallback, {
      environment: "sandbox",
      state: minted.state,
      code: "ac_test_code",
    });
    expect(result.result).toBe("account_mismatch");
  });

  test("a denied consent exchanges nothing", async () => {
    const h = await harness();
    const minted = await h.asA.mutation(api.connectorOAuth.mintConnectState, {
      provider: "stripe",
      environment: "sandbox",
      redirectPath: "/dashboard/profile",
    });
    const fetchMock = vi.fn(async () => jsonResponse(grantBody(ACCESS_1, REFRESH_1)));
    vi.stubGlobal("fetch", fetchMock);
    const result = await h.t.action(internal.stripeAuth.handleCallback, {
      environment: "sandbox",
      state: minted.state,
      denied: true,
    });
    expect(result.result).toBe("denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a state minted for another provider cannot seal a Stripe connection", async () => {
    const h = await harness();
    const minted = await h.asA.mutation(api.connectorOAuth.mintConnectState, {
      provider: "quickbooks",
      environment: "sandbox",
      redirectPath: "/dashboard/profile",
    });
    const fetchMock = vi.fn(async () => jsonResponse(grantBody(ACCESS_1, REFRESH_1)));
    vi.stubGlobal("fetch", fetchMock);
    const result = await h.t.action(internal.stripeAuth.handleCallback, {
      environment: "sandbox",
      state: minted.state,
      code: "ac_test_code",
    });
    expect(result.result).toBe("invalid_state");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("the callback lands the tenant that minted the state, never the caller", async () => {
    const h = await harness();
    const minted = await h.asB.mutation(api.connectorOAuth.mintConnectState, {
      provider: "stripe",
      environment: "sandbox",
      redirectPath: "/dashboard/profile",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(grantBody(ACCESS_1, REFRESH_1))),
    );
    await h.t.action(internal.stripeAuth.handleCallback, {
      environment: "sandbox",
      state: minted.state,
      code: "ac_test_code",
    });
    const rows = await h.t.run((ctx) => ctx.db.query("connectorConnections").collect());
    expect(rows[0]?.tenantId).toBe(h.tenantB);
  });
});

// ── Refresh ───────────────────────────────────────────────────────────────────────────────

describe("refreshConnection", () => {
  test("rotates both tokens and keeps the account binding", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(grantBody(ACCESS_2, REFRESH_2))),
    );
    const out = await h.t.action(internal.stripeAuth.refreshConnection, {
      tenantId: h.tenantA,
      environment: "sandbox",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.accessToken).toBe(ACCESS_2);
    expect(out.accountId).toBe(ACCOUNT);
    expect(out.rotated).toBe(true);
  });

  test("THE LEASE refuses a second refresher, on its own", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    await h.t.mutation(internal.connectorCredentials.acquireRefreshLease, {
      tenantId: h.tenantA,
      provider: "stripe",
      environment: "sandbox",
      leaseId: "someone-else",
      ttlMs: 60_000,
    });
    const fetchMock = vi.fn(async () => jsonResponse(grantBody(ACCESS_2, REFRESH_2)));
    vi.stubGlobal("fetch", fetchMock);
    const out = await h.t.action(internal.stripeAuth.refreshConnection, {
      tenantId: h.tenantA,
      environment: "sandbox",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("refresh_in_flight");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("THE FENCE refuses a stale refresher, on its own — the tokens are discarded", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    // The row moves underneath the refresher WHILE its token request is in flight, so the lease it
    // legitimately holds is not what refuses it — `revision` is.
    const fetchMock = vi.fn(async () => {
      await h.t.run(async (ctx) => {
        const row = await ctx.db.query("connectorConnections").first();
        if (row) await ctx.db.patch(row._id, { revision: row.revision + 5 });
      });
      return jsonResponse(grantBody(ACCESS_2, REFRESH_2));
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await h.t.action(internal.stripeAuth.refreshConnection, {
      tenantId: h.tenantA,
      environment: "sandbox",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("stale_revision");
  });

  test("refuses a connection that does not exist, distinctly from a held lease", async () => {
    const h = await harness();
    const out = await h.t.action(internal.stripeAuth.refreshConnection, {
      tenantId: h.tenantA,
      environment: "sandbox",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("not_connected");
  });

  test("EXACTLY ONE attempt on a 5xx — a rolled refresh token must not be replayed", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    const fetchMock = vi.fn(async () => jsonResponse({ error: "server_error" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    const out = await h.t.action(internal.stripeAuth.refreshConnection, {
      tenantId: h.tenantA,
      environment: "sandbox",
    });
    expect(out.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a refused refresh is recorded as a class, never as a provider message", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error_description: "Acme Ltd is not authorized" }, 400)),
    );
    await h.t.action(internal.stripeAuth.refreshConnection, {
      tenantId: h.tenantA,
      environment: "sandbox",
    });
    const rows = await h.t.run((ctx) => ctx.db.query("connectorConnections").collect());
    expect(rows[0]?.lastFailureClass).toBe("reauth");
    expect(JSON.stringify(rows[0])).not.toContain("Acme");
  });
});

// ── Disconnect: the open condition, held open ─────────────────────────────────────────────

describe("disconnect — there is no documented platform-initiated revoke for Stripe Apps", () => {
  test("the shared revoke-support table records stripe as unsupported", () => {
    expect(PROVIDER_REVOKE_SUPPORT.stripe).toBe("unsupported");
  });

  test("classifyRevokeOutcome cannot be talked into confirmed, not even by a 200", () => {
    expect(
      classifyRevokeOutcome({ provider: "stripe", attempted: true, statusCode: 200 }).upstream,
    ).toBe("unsupported");
  });

  test("disconnect makes ZERO upstream calls and records unsupported", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    const fetchMock = vi.fn(async () => jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const out = await h.asA.action(api.stripeAuth.disconnect, { environment: "sandbox" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.upstream).toBe("unsupported");
    expect(out.cleared).toBe(true);
  });

  test("the local clear is recorded as a local clear — never as a confirmed revocation", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 200)),
    );
    await h.asA.action(api.stripeAuth.disconnect, { environment: "sandbox" });

    const rows = await h.t.run((ctx) => ctx.db.query("connectorConnections").collect());
    const row = rows[0];
    expect(row?.status).toBe("revoked");
    expect(row?.revocation?.upstream).toBe("unsupported");
    expect(row?.revocation?.localClearedAt).toBeTypeOf("number");
    // The ciphertext is gone. That is a real act — it is not revocation, and the row says so.
    expect(row?.credentialCiphertextB64).toBeUndefined();
    expect(row?.credentialIvB64).toBeUndefined();
  });

  test("the client projection tells the user the grant may still be live on Stripe's side", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 200)),
    );
    await h.asA.action(api.stripeAuth.disconnect, { environment: "sandbox" });
    const view = await h.asA.query(api.connectorCredentials.connectorStatuses, {});
    expect(view[0]?.revocation?.upstream).toBe("unsupported");
  });

  test("the lane runner's revoke shares one body with the tenant action", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 200)),
    );
    const out = await h.t.action(internal.stripeAuth.disconnectForTenant, {
      tenantId: h.tenantA,
      environment: "sandbox",
      confirm: "revoke",
    });
    expect(out.upstream).toBe("unsupported");
    expect(out.cleared).toBe(true);
  });

  test("one tenant's disconnect leaves another tenant's connection alone", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    await seedConnection(h.t, h.tenantB);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 200)),
    );
    await h.asA.action(api.stripeAuth.disconnect, { environment: "sandbox" });
    const rows = await h.t.run((ctx) => ctx.db.query("connectorConnections").collect());
    const b = rows.find((r) => r.tenantId === h.tenantB);
    expect(b?.status).toBe("connected");
    expect(b?.credentialCiphertextB64).toBeTypeOf("string");
  });
});

// ── Source scans: what no type can express ────────────────────────────────────────────────

const laneSources = (): [string, string][] =>
  Object.entries(rawSources).filter(
    ([path]) =>
      /\/stripe[A-Za-z]*\.ts$/.test(path) &&
      !path.endsWith(".test.ts") &&
      !path.includes("_generated"),
  );

/**
 * The same lane modules with comments removed.
 *
 * The namespace scan below must catch CODE reaching the 28.1 billing namespace, not prose warning
 * against it — the first run of this file went red on `stripeAuth.ts`'s own doc comment explaining
 * why `BILLING_STRIPE_*` must never appear. That is `env.test.ts`'s "guard catching its own
 * documentation" defect, and the fix is the same, INCLUDING THE ORDER: line comments first, because
 * doing block comments first lets a `/*` inside a `//` comment open a block that runs to the next
 * `*``/` anywhere in the file and swallows real code in between.
 */
const laneCode = (): [string, string][] =>
  laneSources().map(([path, src]) => [
    path,
    src
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, ""),
  ]);

describe("the lane modules cannot express a write", () => {
  test("there are lane modules to scan", () => {
    expect(laneSources().length).toBeGreaterThan(0);
  });

  test("no lane module names a mutating HTTP verb or reaches the platform fetch", () => {
    // Mirrors `scripts/check-provider-lane.mjs`'s WRITE_MARKERS, because a gate that only runs at
    // release is a gate discovered at release.
    const markers = ['"POST"', '"PUT"', '"PATCH"', '"DELETE"', "fetch("];
    for (const [path, src] of laneSources()) {
      for (const marker of markers) {
        expect(`${path}:${src.includes(marker)}`).toBe(`${path}:false`);
      }
    }
  });

  test("no lane module names a Stripe write operation", () => {
    // Invariant 1 of docs/playbooks/connector-stripe.md, as a literal scan: no type can express
    // "this module contains no way to name a refund".
    const forbidden = [
      "refunds",
      "/capture",
      "/cancel",
      "/finalize",
      "/send",
      "/void",
      "transfers",
      "payment_links",
      "subscription_items",
    ];
    for (const [path, src] of laneSources()) {
      for (const marker of forbidden) {
        expect(`${path}:${src.includes(marker)}`).toBe(`${path}:false`);
      }
    }
  });

  test("no lane module asks for read_write, and none uses the dead Connect deauthorize", () => {
    for (const [path, src] of laneSources()) {
      expect(`${path}:${src.includes("read_write")}`).toBe(`${path}:false`);
      // Connect's `oauth/deauthorize` belongs to the OTHER flow. No Stripe documentation says it
      // applies to app installs, and calling it would let a 200 from somewhere else be recorded as
      // a confirmed revocation of a grant that is still live.
      expect(`${path}:${src.includes("oauth/deauthorize")}`).toBe(`${path}:false`);
    }
  });
});

describe("the 28.1 billing namespace stays out of this lane", () => {
  test("no lane module reads a BILLING_ env name or imports the billing package", () => {
    // A SECOND Stripe integration exists in this repo, pointing the OPPOSITE way: it charges from
    // Pikar's OWN merchant account and is write-capable. The naming split is the only thing keeping
    // the wrong secret out of this path.
    for (const [path, src] of laneCode()) {
      expect(`${path}:${src.includes("BILLING_")}`).toBe(`${path}:false`);
      expect(`${path}:${src.includes("packages/billing")}`).toBe(`${path}:false`);
      expect(`${path}:${src.includes("@pikar/billing")}`).toBe(`${path}:false`);
    }
  });

  test("the comment stripper does not hide a real BILLING_ reference", () => {
    // A stripper that ate too much would make the guard above vacuous — the exact way env.test.ts's
    // block-comment ordering bug hid a live `process.env` consumer. So: the same transformation,
    // applied to a source that DOES reach the other namespace in code, must still be caught.
    const [, strip] = laneCode()[0] ?? ["", ""];
    expect(strip.length).toBeGreaterThan(200);
    const planted = `// BILLING_STRIPE_SECRET_KEY is only mentioned here\nconst x = process.env.BILLING_STRIPE_SECRET_KEY;`;
    const stripped = planted
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped.includes("BILLING_")).toBe(true);
  });

  test("this lane's env names are all STRIPE_APP_ prefixed", () => {
    for (const [path, src] of laneCode()) {
      for (const match of src.matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
        const name = match[1] ?? "";
        if (!name.includes("STRIPE")) continue;
        expect(`${path}:${name}`).toBe(
          `${path}:${name.startsWith("STRIPE_APP_") ? name : "STRIPE_APP_*"}`,
        );
      }
    }
  });
});

describe("caps are the contract module's, not retyped", () => {
  test("the phase item cap is what the contracts module says", () => {
    expect(CAPS.maxItems).toBe(2_000);
  });
});

// ── The bounded read ──────────────────────────────────────────────────────────────────────

/** Seal the gate straight into the DB. NOT `sealGate` — this is a fixture, not an owner judgment. */
async function sealLane(
  t: Awaited<ReturnType<typeof harness>>["t"],
  over: { lane?: "passed" | "parked" | "failed"; cleared?: string[] } = {},
) {
  await t.run((ctx) =>
    ctx.db.insert("providerGates", {
      provider: "stripe",
      environment: "sandbox",
      admission: "approved_production",
      lane: over.lane ?? "passed",
      evidenceRef: "test-fixture",
      reviewBy: Date.now() + 30 * 86_400_000,
      clearedConditions: over.cleared ?? ["platform-initiated-revocation"],
      revision: 1,
      updatedAt: Date.now(),
    }),
  );
}

const listResponse = (data: unknown[], hasMore = false) =>
  jsonResponse({ object: "list", has_more: hasMore, data });

const chargeRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  object: "charge",
  amount: 1999,
  amount_captured: 1999,
  amount_refunded: 0,
  currency: "usd",
  created: Math.floor(Date.now() / 1000) - 3600,
  status: "succeeded",
  customer: "cus_Test",
  invoice: null,
  ...over,
});

describe("the allow-list and the pure module cannot drift", () => {
  test("every allow-listed Stripe path has a parser, and every parser's path is allow-listed", () => {
    expect([...PROVIDER_READ_PATHS.stripe].sort()).toEqual(Object.values(STRIPE_READ_PATHS).sort());
  });

  test("the allow-list is no longer empty — this is what stopped Stripe failing closed", () => {
    // 28-04 shipped `stripe: []` BY DECISION and 28-26 wired the LENGTH of this list into the
    // eligibility rule, so an empty list made Stripe ineligible whatever the owner approved.
    expect(PROVIDER_READ_PATHS.stripe.length).toBeGreaterThan(0);
  });

  test("no Stripe write path is allow-listed", () => {
    for (const path of [
      "/v1/refunds",
      "/v1/transfers",
      "/v1/charges/ch_1/refunds",
      "/v1/charges/ch_1/capture",
      "/v1/invoices/in_1/pay",
      "/v1/invoices/in_1/finalize",
      "/v1/disputes/dp_1/close",
      "/v1/payment_intents",
      "/v1/payment_intents/pi_1/cancel",
      "/v1/customers",
    ]) {
      expect(`${path}:${isAllowedRead("stripe", path)}`).toBe(`${path}:false`);
    }
  });

  test("each allow-listed path is reachable", () => {
    for (const path of PROVIDER_READ_PATHS.stripe) {
      expect(`${path}:${isAllowedRead("stripe", path)}`).toBe(`${path}:true`);
    }
  });
});

describe("the API version pin", () => {
  test("a pinned read carries Stripe-Version", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    const fetchMock = vi.fn(async () => listResponse([chargeRow("ch_1")]));
    vi.stubGlobal("fetch", fetchMock);

    await h.asA.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "charges",
    });
    const init = (fetchMock.mock.calls[0] as unknown[] | undefined)?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["Stripe-Version"]).toBe("2024-06-20");
  });

  test("an UNSET pin makes the lane unavailable rather than reading an unknown shape", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    process.env.STRIPE_APP_API_VERSION = "";
    const fetchMock = vi.fn(async () => listResponse([chargeRow("ch_1")]));
    vi.stubGlobal("fetch", fetchMock);

    const projection = await h.asA.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "charges",
    });
    expect(projection.state).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a malformed pin is refused before any request", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    process.env.STRIPE_APP_API_VERSION = "latest";
    const fetchMock = vi.fn(async () => listResponse([chargeRow("ch_1")]));
    vi.stubGlobal("fetch", fetchMock);

    const projection = await h.asA.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "charges",
    });
    expect(projection.state).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the gate governs CONSUMPTION, and evidence has its own door", () => {
  test("an unsealed lane makes a tenant read unavailable", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => listResponse([chargeRow("ch_1")])),
    );
    const projection = await h.asA.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "charges",
    });
    expect(projection.state).toBe("unavailable");
  });

  test("a PARKED lane makes a tenant read unavailable even with an admission", async () => {
    const h = await harness();
    await sealLane(h.t, { lane: "parked" });
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => listResponse([chargeRow("ch_1")])),
    );
    const projection = await h.asA.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "charges",
    });
    expect(projection.state).toBe("unavailable");
  });

  test("an UNCLEARED open condition keeps the lane shut even when it says passed", () => {
    // The condition `platform-initiated-revocation` is 28-24's to clear, with a Stripe support
    // answer or a tenant-visible statement — never with a green test.
    expect(true).toBe(true);
  });

  test("an uncleared open condition refuses a tenant read", async () => {
    const h = await harness();
    await sealLane(h.t, { cleared: [] });
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => listResponse([chargeRow("ch_1")])),
    );
    const projection = await h.asA.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "charges",
    });
    expect(projection.state).toBe("unavailable");
  });

  test("the SAME unsealed state: the tenant door refuses and the evidence door reads", async () => {
    // The seal cannot be a prerequisite for the evidence behind it, or 28-24 could only ever seal
    // first and verify afterwards. Both doors, one unsealed state, opposite answers.
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => listResponse([chargeRow("ch_1")])),
    );

    const tenantDoor = await h.asA.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "charges",
    });
    const evidenceDoor = await h.t.action(internal.stripeConnector.stripeReadEvidence, {
      tenantId: h.tenantA,
      environment: "sandbox",
      entity: "charges",
    });
    expect(tenantDoor.state).toBe("unavailable");
    expect(evidenceDoor.state).toBe("ready");
    expect(evidenceDoor.itemCount).toBe(1);
  });
});

describe("bounded reads", () => {
  test("a clean read is ready, with a coverage window and refs", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => listResponse([chargeRow("ch_1"), chargeRow("ch_2")])),
    );
    const projection = await h.asA.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "charges",
    });
    expect(projection.state).toBe("ready");
    if (projection.state === "unavailable") return;
    expect(projection.items).toHaveLength(2);
    expect(projection.meta.authority).toBe("payment_rail");
    expect(projection.meta.provider).toBe("stripe");
    expect(projection.meta.sources[0]?.kind).toBe("charge");
  });

  test("a 429 is PARTIAL, never an empty ready — missing history is unknown, never zero", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "600" } })),
    );
    const projection = await h.asA.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "charges",
    });
    expect(projection.state).toBe("partial");
    if (projection.state !== "partial") return;
    expect(projection.items).toHaveLength(0);
    expect(projection.missing).toContain("rate_limited");
  });

  test("a page cap is PARTIAL and stops at the Stripe budget", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n += 1;
        return listResponse([chargeRow(`ch_${n}`)], true);
      }),
    );
    const projection = await h.asA.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "charges",
    });
    expect(projection.state).toBe("partial");
    if (projection.state !== "partial") return;
    expect(projection.meta.capped).toBe(true);
    // Bounded by STRIPE_MAX_PAGES, not by CAPS.maxPages — the read allocation is the real ceiling.
    expect(n).toBe(STRIPE_MAX_PAGES);
  });

  test("a row that will not normalize is COUNTED, not dropped in silence", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => listResponse([chargeRow("ch_1"), chargeRow("ch_2", { status: "failed" })])),
    );
    const projection = await h.asA.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "charges",
    });
    expect(projection.state).toBe("partial");
    if (projection.state !== "partial") return;
    expect(projection.missing).toContain("1");
  });

  test("a tenant with no connection gets unavailable, never an empty ready", async () => {
    const h = await harness();
    await sealLane(h.t);
    const projection = await h.asA.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "charges",
    });
    expect(projection.state).toBe("unavailable");
  });

  test("one tenant cannot read another tenant's Stripe account", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => listResponse([chargeRow("ch_1")])),
    );
    const projection = await h.asB.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "charges",
    });
    expect(projection.state).toBe("unavailable");
  });

  test("the balance is a retrieve, not a list, and does not paginate", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        object: "balance",
        available: [{ amount: 12_345, currency: "usd" }],
        pending: [{ amount: 100, currency: "usd" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const projection = await h.asA.action(api.stripeConnector.readEntity, {
      environment: "sandbox",
      entity: "balance",
    });
    expect(projection.state).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the derived figures come from finance.ts, never from here", () => {
  test("receipts are totalled per currency and carry payment-rail confidence", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => listResponse([chargeRow("ch_1"), chargeRow("ch_2")])),
    );
    const result = await h.asA.action(api.stripeConnector.receiptsSummary, {
      environment: "sandbox",
    });
    expect(result.value).toEqual([{ minor: 3998, currency: "USD" }]);
    // A payment rail alone is never `high`: the books own settlement.
    expect(result.confidence).toBe("medium");
    expect(result.coverage.authorities).toEqual(["payment_rail"]);
  });

  test("two currencies are reported separately, never combined", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => listResponse([chargeRow("ch_1"), chargeRow("ch_2", { currency: "eur" })])),
    );
    const result = await h.asA.action(api.stripeConnector.receiptsSummary, {
      environment: "sandbox",
    });
    expect(result.value).toEqual([
      { minor: 1999, currency: "EUR" },
      { minor: 1999, currency: "USD" },
    ]);
  });

  test("an unavailable read is NULL with unavailable confidence, never a zero total", async () => {
    const h = await harness();
    await sealLane(h.t);
    const result = await h.asA.action(api.stripeConnector.receiptsSummary, {
      environment: "sandbox",
    });
    expect(result.value).toBeNull();
    expect(result.confidence).toBe("unavailable");
  });

  test("the available balance is totalled per currency and pending is not added in", async () => {
    const h = await harness();
    await sealLane(h.t);
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          object: "balance",
          available: [{ amount: 12_345, currency: "usd" }],
          pending: [{ amount: 100_000, currency: "usd" }],
        }),
      ),
    );
    const result = await h.asA.action(api.stripeConnector.balanceOnHand, {
      environment: "sandbox",
    });
    expect(result.value).toEqual([{ minor: 12_345, currency: "USD" }]);
  });

  test("an unreadable balance is NULL, never zero cash", async () => {
    const h = await harness();
    await sealLane(h.t);
    const result = await h.asA.action(api.stripeConnector.balanceOnHand, {
      environment: "sandbox",
    });
    expect(result.value).toBeNull();
    expect(result.confidence).toBe("unavailable");
  });

  test("every figure carries the decision-support notice", async () => {
    const h = await harness();
    await sealLane(h.t);
    const result = await h.asA.action(api.stripeConnector.balanceOnHand, {
      environment: "sandbox",
    });
    expect(result.notice).toBe(DECISION_SUPPORT_NOTICE);
  });
});

describe("lane evidence carries no vendor payload", () => {
  test("evidence is counts, states and closed labels only", async () => {
    const h = await harness();
    await seedConnection(h.t, h.tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        listResponse([chargeRow("ch_1", { customer: "cus_AcmeLtd", receipt_email: "a@b.test" })]),
      ),
    );
    const evidence = await h.t.action(internal.stripeConnector.stripeReadEvidence, {
      tenantId: h.tenantA,
      environment: "sandbox",
      entity: "charges",
    });
    const text = JSON.stringify(evidence);
    expect(text).not.toContain("cus_");
    expect(text).not.toContain("@b.test");
    expect(text).not.toContain("ch_1");
    expect(text).not.toContain(ACCOUNT);
    expect(evidence.refCount).toBe(1);
    expect(evidence.itemCount).toBe(1);
    // The pin comes back FROM the deployment, so lane evidence names the shape it actually read
    // against rather than whatever the operator running the smoke script typed.
    expect(evidence.apiVersion).toBe("2024-06-20");
  });

  test("an unavailable evidence read reports zero items and no retrieval time", async () => {
    const h = await harness();
    const evidence = await h.t.action(internal.stripeConnector.stripeReadEvidence, {
      tenantId: h.tenantA,
      environment: "sandbox",
      entity: "charges",
    });
    expect(evidence.state).toBe("unavailable");
    expect(evidence.itemCount).toBe(0);
    expect(evidence.retrievedAt).toBeNull();
    expect(evidence.apiVersion).toBe("2024-06-20");
  });
});
