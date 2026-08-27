// The QuickBooks lane, proven offline against a real in-memory Convex backend. $0 — convex-test
// only, no network, no Intuit, no model.
//
// FOUR THINGS THESE TESTS EXIST FOR, in order of how expensive the bug would be.
//
//  1. THE ROLLING-REFRESH HAZARD. Intuit documents that two concurrent refreshes with the same
//     refresh token leave the first successful and the second `invalid_grant`, and that Intuit MAY
//     THEN REVOKE the token the first call issued — the connection dies and the tenant re-consents
//     from scratch. So the lease, the fence and the one-attempt rule each get a test that observes
//     THAT SPECIFIC GUARD refusing, alone. 28-03 shipped a `revision` fence whose test was silently
//     satisfied by the lease in front of it, so "something refused" is not evidence here; the
//     refusal has to be attributable.
//  2. THE SCOPE IS WRITE-CAPABLE AND THE ALLOW-LIST IS THE ONLY BOUNDARY.
//     `com.intuit.quickbooks.accounting` grants the whole Accounting API. There is a source scan
//     below, because no type can express "this module contains no way to name another verb".
//  3. REVOKE BEFORE DELETE, AND SAY WHICH ONE WORKED. QuickBooks is the one Phase 28 provider that
//     can honestly reach `confirmed`, which is exactly why it must not reach it when it did not.
//  4. NOTHING PLAINTEXT SURVIVES A WRITE. A sentinel token is hunted across the stored row and the
//     client projection.
import { importCredentialKey, openCredential, sealCredential } from "@pikar/revenue";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import {
  ACCESS_TOKEN_TTL_S,
  classifyTokenFailure,
  isRealmId,
  parseQbCredential,
  parseQbGrant,
  QB_AUTHORIZE_ENDPOINT,
  QB_REVOKE_ENDPOINT,
  QB_SCOPE,
  QB_TOKEN_ENDPOINT,
  quickbooksAuthorizeUrl,
} from "./quickbooksAuth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

/** Raw sources for the write-verb scan. edge-runtime has no `node:fs`. */
const rawSources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const REALM = "9130350000000001";
const OTHER_REALM = "9130350000000002";
const ACCESS_1 = "SENTINEL-ACCESS-1-DO-NOT-LEAK";
const REFRESH_1 = "SENTINEL-REFRESH-1-DO-NOT-LEAK";
const ACCESS_2 = "SENTINEL-ACCESS-2-DO-NOT-LEAK";
const REFRESH_2 = "SENTINEL-REFRESH-2-DO-NOT-LEAK";

function keyB64(fill: number): string {
  let binary = "";
  for (const b of new Uint8Array(32).fill(fill)) binary += String.fromCharCode(b);
  return btoa(binary);
}

const KEY_B64 = keyB64(7);

beforeEach(() => {
  process.env.CONNECTOR_CREDENTIAL_KEY_V1 = KEY_B64;
  process.env.QUICKBOOKS_CLIENT_ID = "test-client-id";
  process.env.QUICKBOOKS_CLIENT_SECRET = "test-client-secret";
  process.env.QUICKBOOKS_REDIRECT_URI = "https://example.test/quickbooks/callback";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const APP = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "https://example.test/quickbooks/callback",
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

const grantBody = (access: string, refresh: string) => ({
  access_token: access,
  refresh_token: refresh,
  expires_in: 3600,
  x_refresh_token_expires_in: 8_640_000,
  token_type: "bearer",
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Seal a connection straight into the DB, the way a completed callback would leave it. */
async function seedConnection(
  t: Awaited<ReturnType<typeof harness>>["t"],
  tenantId: string,
  over: { access?: string; refresh?: string; realmId?: string } = {},
) {
  const connectionId = `conn_${tenantId}`;
  const key = await importCredentialKey(KEY_B64, "v1");
  const realmId = over.realmId ?? REALM;
  const sealed = await sealCredential(
    key,
    { tenantId, provider: "quickbooks", connectionId, environment: "sandbox" },
    JSON.stringify({
      accessToken: over.access ?? ACCESS_1,
      refreshToken: over.refresh ?? REFRESH_1,
      realmId,
      scope: QB_SCOPE,
    }),
  );
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(realmId));
  const externalAccountHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await t.run((ctx) =>
    ctx.db.insert("connectorConnections", {
      tenantId,
      provider: "quickbooks",
      environment: "sandbox",
      connectionId,
      status: "connected",
      credentialCiphertextB64: sealed.ciphertextB64,
      credentialIvB64: sealed.ivB64,
      keyVersion: "v1",
      accessExpiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: Date.now() + 8_640_000_000,
      externalAccountHash,
      revision: 1,
      connectedAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  return connectionId;
}

async function readCredential(
  t: Awaited<ReturnType<typeof harness>>["t"],
  tenantId: string,
  connectionId: string,
) {
  const row = await t.run((ctx) =>
    ctx.db
      .query("connectorConnections")
      .withIndex("by_tenant_provider_environment", (q) =>
        q.eq("tenantId", tenantId).eq("provider", "quickbooks").eq("environment", "sandbox"),
      )
      .unique(),
  );
  if (row === null || !row.credentialCiphertextB64 || !row.credentialIvB64) return null;
  const key = await importCredentialKey(KEY_B64, "v1");
  const plain = await openCredential(
    key,
    { tenantId, provider: "quickbooks", connectionId, environment: "sandbox" },
    {
      ciphertextB64: row.credentialCiphertextB64,
      ivB64: row.credentialIvB64,
      keyVersion: "v1",
      algorithm: "AES-256-GCM",
    },
  );
  return parseQbCredential(plain);
}

// ── The write-verb scan ───────────────────────────────────────────────────────────────────

describe("the lane modules contain no write verb and no transport of their own", () => {
  const laneModules = Object.entries(rawSources).filter(
    ([path]) => /\/quickbooks[A-Za-z]*\.ts$/.test(path) && !path.endsWith(".test.ts"),
  );

  test("the lane modules were found", () => {
    // A scan over an empty list passes vacuously, which is the failure mode this guards.
    expect(laneModules.map(([p]) => p)).toContain("./quickbooksAuth.ts");
  });

  // This mirrors `scripts/check-provider-lane.mjs`'s `read-only` row exactly, so the rule is
  // enforced by the test suite as well as by the lane gate — a gate that only runs at release is a
  // gate someone discovers at release.
  test.each([
    ['a quoted POST verb', '"POST"'],
    ['a quoted PUT verb', '"PUT"'],
    ['a quoted PATCH verb', '"PATCH"'],
    ['a quoted DELETE verb', '"DELETE"'],
    ["a direct transport call", "fetch("],
    ["a method parameter", "method:"],
  ])("no lane module contains %s", (_label, marker) => {
    for (const [path, src] of laneModules) {
      expect(`${path}:${src.includes(marker)}`).toBe(`${path}:false`);
    }
  });

  test("the only Accounting scope in existence is the one requested, verbatim", () => {
    // Asserted as a LITERAL once. A constant the test merely imports cannot be pinned by mutating
    // the constant, because the assertion would move with it.
    expect(QB_SCOPE).toBe("com.intuit.quickbooks.accounting");
  });

  test("the pinned Intuit endpoints are the documented ones", () => {
    expect(QB_AUTHORIZE_ENDPOINT).toBe("https://appcenter.intuit.com/connect/oauth2");
    expect(QB_TOKEN_ENDPOINT).toBe("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
    expect(QB_REVOKE_ENDPOINT).toBe("https://developer.api.intuit.com/v2/oauth2/tokens/revoke");
  });
});

// ── Pure helpers ──────────────────────────────────────────────────────────────────────────

describe("realm ids", () => {
  test("a plain numeric company id is accepted", () => {
    expect(isRealmId(REALM)).toBe(true);
  });

  test.each([
    ["a path traversal", "../../v3/company/9/invoice"],
    ["an encoded slash", "9130%2f350"],
    ["a slash", "9130/350"],
    ["a query string", "9130?x=1"],
    ["letters", "realm9130"],
    ["empty", ""],
    ["absurdly long", "9".repeat(33)],
    ["a number", 9130350000000001],
    ["absent", undefined],
  ])("%s is refused before it can become a path segment", (_label, value) => {
    expect(isRealmId(value)).toBe(false);
  });
});

describe("grant parsing", () => {
  const now = 1_800_000_000_000;

  test("both tokens and both lifetimes are carried", () => {
    const grant = parseQbGrant(grantBody(ACCESS_1, REFRESH_1), now);
    expect(grant).toEqual({
      accessToken: ACCESS_1,
      refreshToken: REFRESH_1,
      accessExpiresAt: now + 3_600_000,
      refreshExpiresAt: now + 8_640_000_000,
    });
  });

  test("a response without a refresh token is refused, never merged with the old one", () => {
    const body: Record<string, unknown> = grantBody(ACCESS_1, REFRESH_1);
    delete body.refresh_token;
    expect(parseQbGrant(body, now)).toBeNull();
  });

  test("a missing expires_in falls back to Intuit's hour, never to zero", () => {
    const body: Record<string, unknown> = grantBody(ACCESS_1, REFRESH_1);
    delete body.expires_in;
    // A zero would make a brand-new token look already-expired and trigger the immediate second
    // refresh Intuit warns can kill the grant.
    expect(parseQbGrant(body, now)?.accessExpiresAt).toBe(now + ACCESS_TOKEN_TTL_S * 1000);
  });

  test.each([[null], [undefined], ["{}"], [7], [[]], [{ access_token: "" }]])(
    "a malformed body %s is refused",
    (body) => {
      expect(parseQbGrant(body, now)).toBeNull();
    },
  );
});

describe("token failures are classified without ever reading a provider body", () => {
  test.each([
    [400, "reauth"],
    [403, "reauth"],
    [404, "reauth"],
    [401, "forbidden"],
    [500, "provider_error"],
    [503, "provider_error"],
    [null, "network"],
  ])("status %s is %s", (status, expected) => {
    expect(classifyTokenFailure(status as number | null)).toBe(expected);
  });
});

describe("the consent URL", () => {
  test("carries the scope, the configured redirect and the server-minted state", () => {
    const url = new URL(quickbooksAuthorizeUrl(APP, "NONCE-123"));
    expect(url.origin + url.pathname).toBe(QB_AUTHORIZE_ENDPOINT);
    expect(url.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(APP.redirectUri);
    expect(url.searchParams.get("state")).toBe("NONCE-123");
    expect(url.searchParams.get("client_id")).toBe(APP.clientId);
  });

  test("no client secret reaches the consent URL", () => {
    expect(quickbooksAuthorizeUrl(APP, "NONCE-123")).not.toContain(APP.clientSecret);
  });
});

// ── Begin connect ─────────────────────────────────────────────────────────────────────────

describe("beginConnect", () => {
  test("mints a one-time state row for the calling tenant and returns Intuit's URL", async () => {
    const { t, asA, tenantA } = await harness();
    const { url } = await asA.action(api.quickbooksAuth.beginConnect, {
      environment: "sandbox",
      redirectPath: "/dashboard/profile",
    });
    expect(url.startsWith(QB_AUTHORIZE_ENDPOINT)).toBe(true);

    const states = await t.run((ctx) => ctx.db.query("connectorOAuthStates").collect());
    expect(states).toHaveLength(1);
    expect(states[0]?.tenantId).toBe(tenantA);
    expect(states[0]?.provider).toBe("quickbooks");
    // The raw nonce is returned in the URL and never stored.
    const state = new URL(url).searchParams.get("state") ?? "";
    expect(state.length).toBeGreaterThan(20);
    expect(states[0]?.stateHash).not.toBe(state);
  });

  test("an unsafe redirect path is refused before a state exists", async () => {
    const { t, asA } = await harness();
    await expect(
      asA.action(api.quickbooksAuth.beginConnect, {
        environment: "sandbox",
        redirectPath: "//evil.example",
      }),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("connectorOAuthStates").collect())).toHaveLength(0);
  });
});

// ── The callback ──────────────────────────────────────────────────────────────────────────

async function mintState(as: Awaited<ReturnType<typeof harness>>["asA"]): Promise<string> {
  const { url } = await as.action(api.quickbooksAuth.beginConnect, {
    environment: "sandbox",
    redirectPath: "/dashboard/profile",
  });
  return new URL(url).searchParams.get("state") ?? "";
}

describe("the callback", () => {
  test("an unknown state performs zero external calls and zero writes", async () => {
    const { t, asA } = await harness();
    await mintState(asA);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(internal.quickbooksAuth.handleCallback, {
      environment: "sandbox",
      state: "not-a-real-state",
      code: "auth-code",
      realmId: REALM,
    });

    expect(result.result).toBe("invalid_state");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("connectorConnections").collect())).toHaveLength(0);
  });

  test("a replayed state is refused the second time, with no second exchange", async () => {
    const { t, asA } = await harness();
    const state = await mintState(asA);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(grantBody(ACCESS_1, REFRESH_1)));
    vi.stubGlobal("fetch", fetchMock);

    const first = await t.action(internal.quickbooksAuth.handleCallback, {
      environment: "sandbox",
      state,
      code: "auth-code",
      realmId: REALM,
    });
    const second = await t.action(internal.quickbooksAuth.handleCallback, {
      environment: "sandbox",
      state,
      code: "auth-code",
      realmId: REALM,
    });

    expect(first.result).toBe("connected");
    expect(second.result).toBe("invalid_state");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a malformed realm id is refused BEFORE the single-use code is spent", async () => {
    const { t, asA } = await harness();
    const state = await mintState(asA);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(internal.quickbooksAuth.handleCallback, {
      environment: "sandbox",
      state,
      code: "auth-code",
      realmId: "../invoice",
    });

    expect(result.result).toBe("account_mismatch");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a denied consent exchanges nothing", async () => {
    const { t, asA } = await harness();
    const state = await mintState(asA);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(internal.quickbooksAuth.handleCallback, {
      environment: "sandbox",
      state,
      denied: true,
    });

    expect(result.result).toBe("denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a successful callback seals the realm inside the ciphertext, not on the row", async () => {
    const { t, asA, tenantA } = await harness();
    const state = await mintState(asA);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(grantBody(ACCESS_1, REFRESH_1))));

    const result = await t.action(internal.quickbooksAuth.handleCallback, {
      environment: "sandbox",
      state,
      code: "auth-code",
      realmId: REALM,
    });
    expect(result.result).toBe("connected");
    expect(result.redirectTo).toBe("/dashboard/profile?connect=quickbooks&result=connected");

    const row = await t.run((ctx) => ctx.db.query("connectorConnections").unique());
    expect(row?.status).toBe("connected");
    expect(row?.externalAccountHash).toBeTypeOf("string");
    // The realm id itself never sits in a column.
    expect(JSON.stringify(row)).not.toContain(REALM);
    expect(JSON.stringify(row)).not.toContain(ACCESS_1);
    expect(JSON.stringify(row)).not.toContain(REFRESH_1);

    const credential = await readCredential(t, tenantA, row?.connectionId ?? "");
    expect(credential).toEqual({
      accessToken: ACCESS_1,
      refreshToken: REFRESH_1,
      realmId: REALM,
      scope: QB_SCOPE,
    });
  });

  test("re-consenting with a DIFFERENT realm is terminal and leaves the old grant alone", async () => {
    const { t, asA, tenantA } = await harness();
    const connectionId = await seedConnection(t, tenantA);
    const state = await mintState(asA);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(grantBody(ACCESS_2, REFRESH_2)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(internal.quickbooksAuth.handleCallback, {
      environment: "sandbox",
      state,
      code: "auth-code",
      realmId: OTHER_REALM,
    });

    expect(result.result).toBe("account_mismatch");
    // The exchange DID happen (the realm is only knowable after it), but nothing was written.
    const credential = await readCredential(t, tenantA, connectionId);
    expect(credential?.realmId).toBe(REALM);
    expect(credential?.accessToken).toBe(ACCESS_1);
  });

  test("a failed exchange writes nothing and echoes no provider text", async () => {
    const { t, asA } = await harness();
    const state = await mintState(asA);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid_grant", error_description: "Acme Ltd" }), {
          status: 400,
        }),
      ),
    );

    const result = await t.action(internal.quickbooksAuth.handleCallback, {
      environment: "sandbox",
      state,
      code: "auth-code",
      realmId: REALM,
    });

    expect(result.result).toBe("exchange_failed");
    expect(result.redirectTo).not.toContain("Acme");
    expect(result.redirectTo).not.toContain("invalid_grant");
    expect(await t.run((ctx) => ctx.db.query("connectorConnections").collect())).toHaveLength(0);
  });

  test("a state minted by tenant A cannot seal a connection for tenant B", async () => {
    const { t, asA, tenantA, tenantB } = await harness();
    const state = await mintState(asA);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(grantBody(ACCESS_1, REFRESH_1))));

    // `handleCallback` takes no tenantId at all — the tenant is read out of the state row. This
    // asserts the property that omission buys.
    await t.action(internal.quickbooksAuth.handleCallback, {
      environment: "sandbox",
      state,
      code: "auth-code",
      realmId: REALM,
    });

    const rows = await t.run((ctx) => ctx.db.query("connectorConnections").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(tenantA);
    expect(rows[0]?.tenantId).not.toBe(tenantB);
  });
});

// ── Refresh: the lease, the fence, and the one-attempt rule ───────────────────────────────

describe("refresh rotates both tokens atomically", () => {
  test("the rotated refresh token is persisted, not the old one", async () => {
    const { t, tenantA } = await harness();
    const connectionId = await seedConnection(t, tenantA);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(grantBody(ACCESS_2, REFRESH_2))));

    const outcome = await t.action(internal.quickbooksAuth.refreshConnection, {
      tenantId: tenantA,
      environment: "sandbox",
    });

    expect(outcome).toMatchObject({ ok: true, accessToken: ACCESS_2, rotated: true });
    const credential = await readCredential(t, tenantA, connectionId);
    // BOTH replaced, in one blob. A stale refresh token beside a fresh access token is the state
    // that reads as a dead connection tomorrow.
    expect(credential?.accessToken).toBe(ACCESS_2);
    expect(credential?.refreshToken).toBe(REFRESH_2);
  });

  test("the realm survives a refresh untouched — a refresh can never rebind the company", async () => {
    const { t, tenantA } = await harness();
    const connectionId = await seedConnection(t, tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        // A hostile/confused response that names another realm. There is no code path that reads
        // it, and this proves that rather than assuming it.
        jsonResponse({ ...grantBody(ACCESS_2, REFRESH_2), realmId: OTHER_REALM }),
      ),
    );

    const outcome = await t.action(internal.quickbooksAuth.refreshConnection, {
      tenantId: tenantA,
      environment: "sandbox",
    });

    expect(outcome).toMatchObject({ ok: true, realmId: REALM });
    expect((await readCredential(t, tenantA, connectionId))?.realmId).toBe(REALM);
  });

  test("the token request is a Basic-authenticated refresh grant to the pinned endpoint", async () => {
    const { t, tenantA } = await harness();
    await seedConnection(t, tenantA);
    let seen: { url: string; init: RequestInit } | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen = { url, init };
        return jsonResponse(grantBody(ACCESS_2, REFRESH_2));
      }),
    );

    await t.action(internal.quickbooksAuth.refreshConnection, {
      tenantId: tenantA,
      environment: "sandbox",
    });

    expect(seen?.url).toBe(QB_TOKEN_ENDPOINT);
    // Intuit documents `Authorization: Basic base64(client_id:client_secret)` and nothing else for
    // this endpoint. RFC 6749 makes body credentials the OPTIONAL half a server may not support, so
    // sending them in the form instead is a guess that only fails live.
    const headers = seen?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa("test-client-id:test-client-secret")}`);
    const form = new URLSearchParams(String(seen?.init.body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe(REFRESH_1);
    // The secret is in a header, never in the URL — a URL lands in logs and proxies.
    expect(seen?.url).not.toContain("test-client-secret");
  });

  test("the lease is released on success, so the next refresh is not locked out", async () => {
    const { t, tenantA } = await harness();
    await seedConnection(t, tenantA);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(grantBody(ACCESS_2, REFRESH_2))));

    await t.action(internal.quickbooksAuth.refreshConnection, {
      tenantId: tenantA,
      environment: "sandbox",
    });
    const row = await t.run((ctx) => ctx.db.query("connectorConnections").unique());
    expect(row?.refreshLeaseId).toBeUndefined();
    expect(row?.revision).toBe(2);
  });
});

describe("THE LEASE refuses — and it is the lease that refuses", () => {
  test("a second refresher never sends a token request while a lease is held", async () => {
    const { t, tenantA } = await harness();
    await seedConnection(t, tenantA);
    // Somebody else took the lease a moment ago and is still working.
    const held = await t.mutation(internal.connectorCredentials.acquireRefreshLease, {
      tenantId: tenantA,
      provider: "quickbooks",
      environment: "sandbox",
      leaseId: "lease-held-by-someone-else",
      ttlMs: 45_000,
    });
    expect(held.ok).toBe(true);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await t.action(internal.quickbooksAuth.refreshConnection, {
      tenantId: tenantA,
      environment: "sandbox",
    });

    // The named reason is what makes this attributable: the lease refused, not the fence, not the
    // grant, not a missing row.
    expect(outcome).toEqual({ ok: false, reason: "refresh_in_flight" });
    // The whole point. Intuit's hazard is the SECOND REQUEST existing at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("an absent connection is `not_connected`, distinct from a held lease", async () => {
    const { t, tenantA } = await harness();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await t.action(internal.quickbooksAuth.refreshConnection, {
      tenantId: tenantA,
      environment: "sandbox",
    });

    // Both come out of the same `ok: false` from `acquireRefreshLease`. Collapsing them would make
    // the lease test above pass for the wrong reason.
    expect(outcome).toEqual({ ok: false, reason: "not_connected" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("an EXPIRED lease is takeable, so a crashed refresher cannot wedge the connection", async () => {
    const { t, tenantA } = await harness();
    const connectionId = await seedConnection(t, tenantA);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("connectorConnections").unique();
      if (row) {
        await ctx.db.patch(row._id, {
          refreshLeaseId: "lease-from-a-process-that-died",
          refreshLeaseExpiresAt: Date.now() - 1,
        });
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(grantBody(ACCESS_2, REFRESH_2))));

    const outcome = await t.action(internal.quickbooksAuth.refreshConnection, {
      tenantId: tenantA,
      environment: "sandbox",
    });

    expect(outcome).toMatchObject({ ok: true });
    expect((await readCredential(t, tenantA, connectionId))?.refreshToken).toBe(REFRESH_2);
  });
});

describe("THE FENCE refuses — and it is the fence, with the lease still valid", () => {
  test("a refresher whose row moved under it discards its own new tokens", async () => {
    const { t, tenantA } = await harness();
    const connectionId = await seedConnection(t, tenantA);

    // The interleaving, made real: while the token request is in flight, something else bumps the
    // row's revision — a fresh consent, a disconnect, another refresher that already committed.
    // The refresher below still HOLDS ITS LEASE, so only `revision` can refuse it.
    let bumped = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!bumped) {
          bumped = true;
          await t.run(async (ctx) => {
            const row = await ctx.db.query("connectorConnections").unique();
            if (row) await ctx.db.patch(row._id, { revision: row.revision + 1 });
          });
        }
        return jsonResponse(grantBody(ACCESS_2, REFRESH_2));
      }),
    );

    const outcome = await t.action(internal.quickbooksAuth.refreshConnection, {
      tenantId: tenantA,
      environment: "sandbox",
    });

    expect(outcome).toEqual({ ok: false, reason: "stale_revision" });
    // The refusal is not cosmetic: the perfectly good new tokens were thrown away rather than
    // written over whatever replaced them.
    const credential = await readCredential(t, tenantA, connectionId);
    expect(credential?.accessToken).toBe(ACCESS_1);
    expect(credential?.refreshToken).toBe(REFRESH_1);
  });

  // These three run `commitRefresh` DIRECTLY so each guard is observed alone. 28-03's own fence
  // test never reached the fence because the lease check in front of it answered first; the fix is
  // to disable one guard at a time and watch the other refuse.
  describe("commitRefresh's two guards, each observed refusing alone", () => {
    const credentialArgs = {
      credentialCiphertextB64: "Y2lwaGVy",
      credentialIvB64: "aXZpdml2aXZpdml2",
      keyVersion: "v1" as const,
    };

    async function prepared() {
      const { t, tenantA } = await harness();
      await seedConnection(t, tenantA);
      const lease = await t.mutation(internal.connectorCredentials.acquireRefreshLease, {
        tenantId: tenantA,
        provider: "quickbooks",
        environment: "sandbox",
        leaseId: "lease-mine",
        ttlMs: 45_000,
      });
      return { t, tenantA, revision: lease.revision ?? 0 };
    }

    test("right lease + right revision commits (the control — otherwise both tests below are vacuous)", async () => {
      const { t, tenantA, revision } = await prepared();
      const out = await t.mutation(internal.connectorCredentials.commitRefresh, {
        tenantId: tenantA,
        provider: "quickbooks",
        environment: "sandbox",
        leaseId: "lease-mine",
        revision,
        ...credentialArgs,
      });
      expect(out).toEqual({ ok: true });
    });

    test("right lease + STALE revision is refused by the fence", async () => {
      const { t, tenantA, revision } = await prepared();
      const out = await t.mutation(internal.connectorCredentials.commitRefresh, {
        tenantId: tenantA,
        provider: "quickbooks",
        environment: "sandbox",
        leaseId: "lease-mine",
        revision: revision - 1,
        ...credentialArgs,
      });
      expect(out).toEqual({ ok: false });
    });

    test("WRONG lease + right revision is refused by the lease", async () => {
      const { t, tenantA, revision } = await prepared();
      const out = await t.mutation(internal.connectorCredentials.commitRefresh, {
        tenantId: tenantA,
        provider: "quickbooks",
        environment: "sandbox",
        leaseId: "lease-someone-elses",
        revision,
        ...credentialArgs,
      });
      expect(out).toEqual({ ok: false });
    });
  });
});

describe("a failed refresh is never retried", () => {
  test.each([
    [500, "provider_error"],
    [400, "reauth"],
    [401, "forbidden"],
  ])("status %s sends exactly one token request", async (status, failureClass) => {
    const { t, tenantA } = await harness();
    await seedConnection(t, tenantA);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await t.action(internal.quickbooksAuth.refreshConnection, {
      tenantId: tenantA,
      environment: "sandbox",
    });

    expect(outcome).toEqual({ ok: false, reason: "grant_failed", failureClass });
    // A retry is a SECOND request with the same refresh token, which is the exact hazard Intuit
    // documents as able to revoke the grant outright. One means one.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a stale grant is modelled as reauth, and the connection says so", async () => {
    const { t, tenantA } = await harness();
    await seedConnection(t, tenantA);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })),
    );

    await t.action(internal.quickbooksAuth.refreshConnection, {
      tenantId: tenantA,
      environment: "sandbox",
    });

    const row = await t.run((ctx) => ctx.db.query("connectorConnections").unique());
    expect(row?.status).toBe("reauth_required");
    expect(row?.lastFailureClass).toBe("reauth");
    // A CLASS, never Intuit's message.
    expect(JSON.stringify(row)).not.toContain("invalid_grant");
  });

  test("a network throw is `network`, and one attempt is still one attempt", async () => {
    const { t, tenantA } = await harness();
    await seedConnection(t, tenantA);
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await t.action(internal.quickbooksAuth.refreshConnection, {
      tenantId: tenantA,
      environment: "sandbox",
    });

    expect(outcome).toEqual({ ok: false, reason: "grant_failed", failureClass: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("two tenants refresh independently", () => {
  test("tenant B's refresh never touches tenant A's credential", async () => {
    const { t, tenantA, tenantB } = await harness();
    const connA = await seedConnection(t, tenantA);
    const connB = await seedConnection(t, tenantB, { realmId: OTHER_REALM });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(grantBody(ACCESS_2, REFRESH_2))));

    await t.action(internal.quickbooksAuth.refreshConnection, {
      tenantId: tenantB,
      environment: "sandbox",
    });

    expect((await readCredential(t, tenantA, connA))?.accessToken).toBe(ACCESS_1);
    expect((await readCredential(t, tenantB, connB))?.accessToken).toBe(ACCESS_2);
    expect((await readCredential(t, tenantB, connB))?.realmId).toBe(OTHER_REALM);
  });
});

// ── Disconnect ────────────────────────────────────────────────────────────────────────────

describe("disconnect revokes upstream first, then clears locally", () => {
  test("a 200 from Intuit is the one honest `confirmed` in Phase 28", async () => {
    const { t, asA, tenantA } = await harness();
    await seedConnection(t, tenantA);
    // The credential must still exist when the revoke goes out — clearing first would leave a live
    // Intuit grant with no token left to kill it.
    let ciphertextAtRevokeTime: string | undefined;
    let seen: { url: string; init: RequestInit } | undefined;
    vi.stubGlobal(
      "fetch",
      // Asserting INSIDE the stub would be swallowed: `postTokenForm` catches a throw and reports
      // a network failure, so a broken expectation would read as a passing test about a 200.
      vi.fn(async (url: string, init: RequestInit) => {
        seen = { url, init };
        const row = await t.run((ctx) => ctx.db.query("connectorConnections").unique());
        ciphertextAtRevokeTime = row?.credentialCiphertextB64;
        return new Response("", { status: 200 });
      }),
    );

    const result = await asA.action(api.quickbooksAuth.disconnect, { environment: "sandbox" });

    expect(seen?.url).toBe(QB_REVOKE_ENDPOINT);
    const revokeHeaders = seen?.init.headers as Record<string, string>;
    expect(revokeHeaders.Authorization).toBe(`Basic ${btoa("test-client-id:test-client-secret")}`);
    expect(revokeHeaders["Content-Type"]).toBe("application/json");
    // The REFRESH token, not the access token: Intuit kills the whole grant from either, and
    // revoking the 60-minute token would leave the 100-day one alive.
    expect(JSON.parse(String(seen?.init.body))).toEqual({ token: REFRESH_1 });
    expect(ciphertextAtRevokeTime).toBeTypeOf("string");
    expect(result).toEqual({ cleared: true, upstream: "confirmed", statusCode: 200 });
    const row = await t.run((ctx) => ctx.db.query("connectorConnections").unique());
    expect(row?.status).toBe("revoked");
    expect(row?.credentialCiphertextB64).toBeUndefined();
    expect(row?.revocation?.upstream).toBe("confirmed");
  });

  test("a 400 clears locally but records `attempted_failed`, never `confirmed`", async () => {
    const { t, asA, tenantA } = await harness();
    await seedConnection(t, tenantA);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 400 })));

    const result = await asA.action(api.quickbooksAuth.disconnect, { environment: "sandbox" });

    // Intuit documents 400 as plain failure. Google's "400 also counts as revoked" rule is
    // Google's, and borrowing it here would manufacture a success.
    expect(result.upstream).toBe("attempted_failed");
    const row = await t.run((ctx) => ctx.db.query("connectorConnections").unique());
    expect(row?.credentialCiphertextB64).toBeUndefined();
    expect(row?.revocation?.upstream).toBe("attempted_failed");
  });

  test("a network failure records `attempted_failed` with no status code", async () => {
    const { t, asA, tenantA } = await harness();
    await seedConnection(t, tenantA);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await asA.action(api.quickbooksAuth.disconnect, { environment: "sandbox" });

    expect(result).toMatchObject({ upstream: "attempted_failed", statusCode: null });
  });

  test("with no credential to revoke, the record says `not_attempted`", async () => {
    const { t, asA, tenantA } = await harness();
    await seedConnection(t, tenantA);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("connectorConnections").unique();
      if (row) {
        await ctx.db.patch(row._id, {
          credentialCiphertextB64: undefined,
          credentialIvB64: undefined,
        });
      }
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await asA.action(api.quickbooksAuth.disconnect, { environment: "sandbox" });

    // "We had nothing to revoke with" and "the provider has no endpoint" are different apologies.
    expect(result.upstream).toBe("not_attempted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("tenant B cannot disconnect tenant A", async () => {
    const { t, asB, tenantA } = await harness();
    const connA = await seedConnection(t, tenantA);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));

    const result = await asB.action(api.quickbooksAuth.disconnect, { environment: "sandbox" });

    expect(result.cleared).toBe(false);
    expect((await readCredential(t, tenantA, connA))?.accessToken).toBe(ACCESS_1);
  });

  test("the client projection never carries a token, a realm or a status code", async () => {
    const { t, asA, tenantA } = await harness();
    await seedConnection(t, tenantA);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    await asA.action(api.quickbooksAuth.disconnect, { environment: "sandbox" });

    const view = JSON.stringify(await asA.query(api.connectorCredentials.connectorStatuses, {}));
    for (const secret of [ACCESS_1, REFRESH_1, REALM, "test-client-secret"]) {
      expect(view).not.toContain(secret);
    }
    expect(view).toContain("confirmed");
  });
});
