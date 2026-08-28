// The HubSpot rail (28-05), against a real in-memory Convex backend and a stubbed provider.
// Every test is $0 — convex-test plus a fake `fetch`; no network, no HubSpot, no model.
//
// FIVE THINGS ARE BEING PROVEN, and only the first is ordinary:
//
//  1. TWO-TENANT ISOLATION. A state minted by A cannot seal a credential onto B, and B's read runs
//     on B's token or on nothing.
//  2. NO PLAINTEXT SURVIVES. A sentinel access token is hunted for across the stored row and the
//     client-facing projection.
//  3. THE READ-ONLY INVARIANT IS STRUCTURAL. The lane modules contain no write verb and no direct
//     fetch, the endpoint allow-lists agree with the pure package, and the property allow-list
//     never asks HubSpot for a person.
//  4. PARTIAL IS NEVER A SMALLER COMPLETE. A 429 on page two returns page one as `partial`, and a
//     cap can never produce `ready`.
//  5. THE OPEN CONDITION IS TESTED, NOT ASSUMED. `probeRevocationCascade` reports `true`, `false`
//     and `null`, and reporting `null` for an inconclusive probe is the point of it.
import {
  CAPS,
  importCredentialKey,
  openCredential,
  PROVIDER_OPEN_CONDITIONS,
} from "@pikar/revenue";
import {
  HUBSPOT_DATASET_PATHS,
  HUBSPOT_DATASET_PROPERTIES,
  HUBSPOT_DATASETS,
  HUBSPOT_READ_PATHS,
  HUBSPOT_READ_SCOPES,
  HUBSPOT_REVOKE_URL,
  HUBSPOT_TOKEN_URL,
} from "@pikar/revenue/providers/hubspot";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { isAllowedRead, PROVIDER_READ_PATHS } from "./connectorFetch";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

/** Raw sources for the read-only / literal-parity scans. edge-runtime has no `node:fs`. */
const rawSources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const ACCESS = "SENTINEL-HUBSPOT-ACCESS-TOKEN";
const REFRESH = "SENTINEL-HUBSPOT-REFRESH-TOKEN";

function keyB64(fill: number): string {
  let binary = "";
  for (const b of new Uint8Array(32).fill(fill)) binary += String.fromCharCode(b);
  return btoa(binary);
}

// ── The fake provider ─────────────────────────────────────────────────────────────────────

type Recorded = { url: string; method: string; body: string };
type Reply = { status: number; body?: unknown };

let calls: Recorded[] = [];

/** Install a fake `fetch`. The handler sees the URL and the form/query and returns a status+body. */
function stubProvider(handler: (call: Recorded) => Reply): void {
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const call: Recorded = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    const reply = handler(call);
    return new Response(reply.body === undefined ? "" : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  });
}

const tokenReply = (over: Record<string, unknown> = {}): Reply => ({
  status: 200,
  body: {
    access_token: ACCESS,
    refresh_token: REFRESH,
    expires_in: 1800,
    hub_id: 12345,
    ...over,
  },
});

/** A HubSpot object list page. `after` present means "there is another page". */
const objectPage = (ids: readonly string[], after?: string): Reply => ({
  status: 200,
  body: {
    results: ids.map((id) => ({
      id,
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      updatedAt: new Date().toISOString(),
      properties: {
        amount: "100.00",
        deal_currency_code: "USD",
        dealstage: "appointmentscheduled",
        pipeline: "default",
        dealname: "VENDOR-FREE-TEXT-MUST-NOT-LEAK",
      },
    })),
    ...(after === undefined ? {} : { paging: { next: { after } } }),
  },
});

// ── Harness ───────────────────────────────────────────────────────────────────────────────

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

type Harness = Awaited<ReturnType<typeof harness>>;

const rows = (h: Harness) => h.t.run((ctx) => ctx.db.query("connectorConnections").collect());

/** Drive a real consent end to end: mint a state through the public action, then complete it. */
async function connect(
  h: Harness,
  who: "asA" | "asB",
  opts: { token?: Reply; environment?: "sandbox" | "production" } = {},
) {
  const environment = opts.environment ?? "production";
  stubProvider(() => opts.token ?? tokenReply());
  const { url } = await h[who].action(api.hubspotAuth.hubspotConnectUrl, { environment });
  const state = new URL(url).searchParams.get("state") ?? "";
  const result = await h.t.action(internal.hubspotAuth.completeHubSpotConnect, {
    code: "auth-code",
    state,
    environment,
  });
  return { url, state, result };
}

/** Age the stored access token so the next read must refresh. */
const expireAccess = (h: Harness) =>
  h.t.run(async (ctx) => {
    for (const row of await ctx.db.query("connectorConnections").collect()) {
      await ctx.db.patch(row._id, { accessExpiresAt: Date.now() - 1000 });
    }
  });

beforeEach(() => {
  calls = [];
  vi.stubEnv("HUBSPOT_OAUTH_CLIENT_ID", "test-client-id");
  vi.stubEnv("HUBSPOT_OAUTH_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("HUBSPOT_OAUTH_REDIRECT_URI", "https://app.example.com/api/connect/hubspot");
  vi.stubEnv("CONNECTOR_CREDENTIAL_KEY_V1", keyB64(0x22));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ── The allow-lists ───────────────────────────────────────────────────────────────────────

describe("endpoint allow-list — the transport and the pure package cannot drift", () => {
  test("connectorFetch's hubspot entry equals the pure module's list, as a WHOLE set", () => {
    // Whole-value compare, not `includes`: a substring test would survive a rename, and this repo
    // has already shipped one through a green symbol gate.
    expect([...PROVIDER_READ_PATHS.hubspot].sort()).toEqual([...HUBSPOT_READ_PATHS].sort());
  });

  test("every dataset resolves to an allow-listed path", () => {
    for (const dataset of HUBSPOT_DATASETS) {
      expect(isAllowedRead("hubspot", HUBSPOT_DATASET_PATHS[dataset])).toBe(true);
    }
  });

  test("no single-object, search, batch or write-shaped path is reachable", () => {
    for (const path of [
      "/crm/v3/objects/deals/5001",
      "/crm/v3/objects/deals/search",
      "/crm/v3/objects/deals/batch/read",
      "/crm/v3/objects/tickets",
      "/crm/v3/objects/deals/",
      "/crm/v3/objects/../../oauth/2026-03/token",
    ]) {
      expect(isAllowedRead("hubspot", path)).toBe(false);
    }
  });

  test("the requested properties never include a person's name, email or a deal title", () => {
    for (const dataset of HUBSPOT_DATASETS) {
      for (const property of HUBSPOT_DATASET_PROPERTIES[dataset]) {
        expect(["email", "firstname", "lastname", "phone", "dealname", "name"]).not.toContain(
          property,
        );
      }
    }
  });
});

describe("the lane modules are read-only by construction", () => {
  const laneSources = Object.entries(rawSources).filter(([path]) =>
    /\.\/hubspot[A-Za-z]*\.ts$/.test(path),
  );

  test("the scan actually finds both lane modules, so it cannot pass vacuously", () => {
    expect(laneSources.map(([p]) => p).sort()).toEqual(["./hubspot.ts", "./hubspotAuth.ts"]);
  });

  test.each([
    '"POST"',
    '"PUT"',
    '"PATCH"',
    '"DELETE"',
    "fetch(",
  ])("no lane module contains %s", (marker) => {
    for (const [path, src] of laneSources) {
      expect([path, src.includes(marker)]).toEqual([path, false]);
    }
  });

  test("the dataset validator literals equal the closed set, compared whole", () => {
    const src = rawSources["./hubspot.ts"] ?? "";
    const block = src.slice(src.indexOf("const datasetArg"), src.indexOf("const PAGE_LIMIT"));
    const literals = [...block.matchAll(/v\.literal\("([A-Za-z]+)"\)/g)].map((m) => m[1]);
    expect(literals.sort()).toEqual([...HUBSPOT_DATASETS].sort());
  });
});

// ── Configuration ─────────────────────────────────────────────────────────────────────────

describe("deployment configuration fails closed", () => {
  test.each([
    "HUBSPOT_OAUTH_CLIENT_ID",
    "HUBSPOT_OAUTH_CLIENT_SECRET",
    "HUBSPOT_OAUTH_REDIRECT_URI",
  ])("a missing %s refuses the connect and names only the variable", async (missing) => {
    vi.stubEnv(missing, "");
    const h = await harness();
    await expect(
      h.asA.action(api.hubspotAuth.hubspotConnectUrl, { environment: "production" }),
    ).rejects.toThrow(missing);
    expect(calls).toHaveLength(0);
  });
});

// ── Connect ───────────────────────────────────────────────────────────────────────────────

describe("consent", () => {
  test("the authorize URL carries the one-time state and exactly the read scopes", async () => {
    const h = await harness();
    const { url } = await h.asA.action(api.hubspotAuth.hubspotConnectUrl, {
      environment: "production",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("scope")).toBe(HUBSPOT_READ_SCOPES.join(" "));
    expect(parsed.searchParams.get("state")).toBeTruthy();

    const states = await h.t.run((ctx) => ctx.db.query("connectorOAuthStates").collect());
    expect(states).toHaveLength(1);
    expect(states[0]?.tenantId).toBe(h.tenantA);
    // The raw nonce is never stored.
    expect(states[0]?.stateHash).not.toBe(parsed.searchParams.get("state"));
  });

  test("a completed consent seals a credential for the minting tenant and nobody else", async () => {
    const h = await harness();
    const { result } = await connect(h, "asA");
    expect(result.result).toBe("connected");

    const stored = await rows(h);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tenantId).toBe(h.tenantA);
    expect(stored[0]?.status).toBe("connected");
    expect(stored[0]?.credentialCiphertextB64).toBeTruthy();
  });

  test("neither the stored row nor the client projection contains the token", async () => {
    const h = await harness();
    await connect(h, "asA");
    const stored = JSON.stringify(await rows(h));
    expect(stored).not.toContain(ACCESS);
    expect(stored).not.toContain(REFRESH);
    const view = JSON.stringify(await h.asA.query(api.connectorCredentials.connectorStatuses, {}));
    expect(view).not.toContain(ACCESS);
    expect(view).not.toContain(REFRESH);
  });

  test("a replayed state is refused and costs ZERO token exchanges", async () => {
    const h = await harness();
    const { state } = await connect(h, "asA");
    const exchangesAfterFirst = calls.filter((c) => c.url === HUBSPOT_TOKEN_URL).length;

    const replay = await h.t.action(internal.hubspotAuth.completeHubSpotConnect, {
      code: "auth-code",
      state,
      environment: "production",
    });
    expect(replay.result).toBe("invalid_state");
    expect(calls.filter((c) => c.url === HUBSPOT_TOKEN_URL)).toHaveLength(exchangesAfterFirst);
  });

  test("a state minted for a different environment is refused before the exchange", async () => {
    const h = await harness();
    stubProvider(() => tokenReply());
    const { url } = await h.asA.action(api.hubspotAuth.hubspotConnectUrl, {
      environment: "sandbox",
    });
    const state = new URL(url).searchParams.get("state") ?? "";
    const result = await h.t.action(internal.hubspotAuth.completeHubSpotConnect, {
      code: "c",
      state,
      environment: "production",
    });
    expect(result.result).toBe("invalid_state");
    expect(calls.filter((c) => c.url === HUBSPOT_TOKEN_URL)).toHaveLength(0);
    expect(await rows(h)).toHaveLength(0);
  });

  test("a failed exchange writes nothing", async () => {
    const h = await harness();
    const { result } = await connect(h, "asA", { token: { status: 400, body: { message: "no" } } });
    expect(result.result).toBe("exchange_failed");
    expect(await rows(h)).toHaveLength(0);
  });

  test("a token response with no access token is a failed exchange, not a half-connection", async () => {
    const h = await harness();
    const { result } = await connect(h, "asA", {
      token: { status: 200, body: { refresh_token: REFRESH, expires_in: 100 } },
    });
    expect(result.result).toBe("exchange_failed");
    expect(await rows(h)).toHaveLength(0);
  });

  test("re-consent from a DIFFERENT portal is refused and leaves the sealed credential intact", async () => {
    const h = await harness();
    await connect(h, "asA");
    const before = (await rows(h))[0]?.credentialCiphertextB64;

    const { result } = await connect(h, "asA", { token: tokenReply({ hub_id: 99999 }) });
    expect(result.result).toBe("account_mismatch");
    expect((await rows(h))[0]?.credentialCiphertextB64).toBe(before);
  });

  test("a response with NO hub_id records no binding — unknown never satisfies the check", async () => {
    const h = await harness();
    const { result } = await connect(h, "asA", {
      token: {
        status: 200,
        body: { access_token: ACCESS, refresh_token: REFRESH, expires_in: 900 },
      },
    });
    expect(result.result).toBe("connected");
    expect((await rows(h))[0]?.externalAccountHash).toBeUndefined();
  });

  test("two tenants each get their own connection and cannot see the other's", async () => {
    const h = await harness();
    await connect(h, "asA");
    await connect(h, "asB");
    const stored = await rows(h);
    expect(stored).toHaveLength(2);
    expect(new Set(stored.map((r) => r.tenantId))).toEqual(new Set([h.tenantA, h.tenantB]));

    const seenByA = await h.asA.query(api.connectorCredentials.connectorStatuses, {});
    expect(seenByA).toHaveLength(1);
  });

  test("tenant A's ciphertext does not open under tenant B's scope", async () => {
    const h = await harness();
    await connect(h, "asA");
    const row = (await rows(h))[0];
    if (!row?.credentialCiphertextB64 || !row.credentialIvB64) throw new Error("no credential");
    const key = await importCredentialKey(keyB64(0x22), "v1");
    await expect(
      openCredential(
        key,
        {
          tenantId: h.tenantB,
          provider: "hubspot",
          connectionId: row.connectionId,
          environment: "production",
        },
        {
          ciphertextB64: row.credentialCiphertextB64,
          ivB64: row.credentialIvB64,
          keyVersion: row.keyVersion,
          algorithm: "AES-256-GCM",
        },
      ),
    ).rejects.toThrow();
  });
});

// ── Reads ─────────────────────────────────────────────────────────────────────────────────

describe("bounded CRM reads", () => {
  test("a read with no connection is UNAVAILABLE, never an empty ready list", async () => {
    const h = await harness();
    stubProvider(() => ({ status: 200, body: { results: [] } }));
    const { projection } = await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "deals",
    });
    expect(projection.state).toBe("unavailable");
    if (projection.state !== "unavailable") throw new Error("unreachable");
    expect(projection.because).toBe("not_connected");
  });

  test("walks pagination, returns a ready projection and leaks no vendor free text", async () => {
    const h = await harness();
    await connect(h, "asA");
    stubProvider((call) =>
      call.url.includes("after=cur2") ? objectPage(["3"]) : objectPage(["1", "2"], "cur2"),
    );

    const { projection } = await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "deals",
    });
    expect(projection.state).toBe("ready");
    if (projection.state !== "ready") throw new Error("unreachable");
    expect(projection.items).toHaveLength(3);
    expect(projection.meta.authority).toBe("supplemental");
    expect(projection.meta.provider).toBe("hubspot");
    expect(JSON.stringify(projection)).not.toContain("VENDOR-FREE-TEXT-MUST-NOT-LEAK");
    expect(JSON.stringify(projection)).not.toContain(ACCESS);
  });

  test("only allow-listed properties are ever requested", async () => {
    const h = await harness();
    await connect(h, "asA");
    stubProvider(() => objectPage(["1"]));
    await h.asA.action(api.hubspot.hubspotRead, { environment: "production", dataset: "deals" });

    const read = calls.find((c) => c.url.includes("/crm/v3/objects/deals"));
    const requested = new URL(read?.url ?? "https://x.test").searchParams.get("properties") ?? "";
    expect(requested.split(",").sort()).toEqual([...HUBSPOT_DEAL_PROPERTIES_SORTED]);
  });

  test("a 429 on page two returns page one as PARTIAL — never as zero and never as complete", async () => {
    const h = await harness();
    await connect(h, "asA");
    stubProvider((call) =>
      call.url.includes("after=cur2") ? { status: 429, body: {} } : objectPage(["1", "2"], "cur2"),
    );

    const { projection } = await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "deals",
    });
    expect(projection.state).toBe("partial");
    if (projection.state !== "partial") throw new Error("unreachable");
    expect(projection.items).toHaveLength(2);
    expect(projection.missing).toContain("rate_limited");
  });

  test("a 401 mid-read marks the connection reauth_required and reports partial", async () => {
    const h = await harness();
    await connect(h, "asA");
    stubProvider((call) =>
      call.url.includes("/crm/v3/objects/contacts") ? { status: 401, body: {} } : tokenReply(),
    );
    const { projection } = await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "contacts",
    });
    expect(projection.state).toBe("partial");
    expect((await rows(h))[0]?.status).toBe("reauth_required");
  });

  test("a provider that never stops paginating is capped, and a cap is always partial", async () => {
    const h = await harness();
    await connect(h, "asA");
    let page = 0;
    stubProvider((call) =>
      call.url.includes("/crm/v3/objects/deals")
        ? objectPage([String(++page)], `cur${page}`)
        : tokenReply(),
    );

    const { projection } = await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "deals",
    });
    expect(projection.state).toBe("partial");
    if (projection.state !== "partial") throw new Error("unreachable");
    expect(projection.meta.capped).toBe(true);
    expect(projection.items.length).toBeLessThanOrEqual(CAPS.maxItems);
  });

  test("a connected row whose sealed credential is gone is not_connected, never a crash", async () => {
    // The guard this pins is defence in depth: no code path produces a `connected` row with no
    // ciphertext today. Mutation testing caught it surviving, which is what a guard nothing
    // exercises always does right up until the day something reaches it.
    const h = await harness();
    await connect(h, "asA");
    await h.t.run(async (ctx) => {
      for (const row of await ctx.db.query("connectorConnections").collect()) {
        await ctx.db.patch(row._id, {
          credentialCiphertextB64: undefined,
          credentialIvB64: undefined,
        });
      }
    });

    stubProvider(() => objectPage(["1"]));
    const { projection } = await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "deals",
    });
    expect(projection.state).toBe("unavailable");
    if (projection.state !== "unavailable") throw new Error("unreachable");
    expect(projection.because).toBe("not_connected");
  });

  test("tenant B cannot read through tenant A's connection", async () => {
    const h = await harness();
    await connect(h, "asA");
    stubProvider(() => objectPage(["1"]));
    const { projection } = await h.asB.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "deals",
    });
    expect(projection.state).toBe("unavailable");
  });

  test("pipelines and owners are not window-filtered out of existence", async () => {
    const h = await harness();
    await connect(h, "asA");
    stubProvider((call) =>
      call.url.includes("/crm/v3/pipelines/deals")
        ? {
            status: 200,
            body: { results: [{ id: "default", label: "Sales", stages: [{ id: "s1" }] }] },
          }
        : tokenReply(),
    );
    const { projection } = await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "dealPipelines",
      windowDays: 1,
    });
    expect(projection.state).toBe("ready");
    if (projection.state !== "ready") throw new Error("unreachable");
    expect(projection.items).toHaveLength(1);
    expect(JSON.stringify(projection)).not.toContain("Sales");
  });
});

// ── Refresh ───────────────────────────────────────────────────────────────────────────────

describe("refresh", () => {
  test("an expiring token is refreshed once and the row's revision advances", async () => {
    const h = await harness();
    await connect(h, "asA");
    const before = (await rows(h))[0];
    await expireAccess(h);

    stubProvider((call) =>
      call.url === HUBSPOT_TOKEN_URL ? tokenReply({ access_token: "AT2" }) : objectPage(["1"]),
    );
    await h.asA.action(api.hubspot.hubspotRead, { environment: "production", dataset: "deals" });

    const after = (await rows(h))[0];
    // ONE refresh, not one token call: the consent exchange also posted to this endpoint, and
    // counting both would let a double refresh (the race the lease exists to stop) pass.
    const refreshes = calls.filter(
      (c) => c.url === HUBSPOT_TOKEN_URL && c.body.includes("grant_type=refresh_token"),
    );
    expect(refreshes).toHaveLength(1);
    expect(after?.revision ?? 0).toBeGreaterThan(before?.revision ?? 0);
    expect(after?.credentialCiphertextB64).not.toBe(before?.credentialCiphertextB64);
    // The refresh grant is what was posted — never the authorization code again.
    expect(refreshes[0]?.body).not.toContain("authorization_code");
  });

  test("a rejected refresh marks reauth_required and the read is unavailable, not empty", async () => {
    const h = await harness();
    await connect(h, "asA");
    await expireAccess(h);
    stubProvider((call) =>
      call.url === HUBSPOT_TOKEN_URL ? { status: 400, body: {} } : objectPage(["1"]),
    );

    const { projection } = await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "deals",
    });
    expect(projection.state).toBe("unavailable");
    expect((await rows(h))[0]?.status).toBe("reauth_required");
  });

  test("a 500 on refresh is a provider error, NOT a reconnect prompt the user cannot act on", async () => {
    const h = await harness();
    await connect(h, "asA");
    await expireAccess(h);
    stubProvider((call) =>
      call.url === HUBSPOT_TOKEN_URL ? { status: 500, body: {} } : objectPage(["1"]),
    );

    const { projection } = await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "deals",
    });
    expect(projection.state).toBe("unavailable");
    if (projection.state !== "unavailable") throw new Error("unreachable");
    expect(projection.because).toBe("provider_error");
    expect((await rows(h))[0]?.status).not.toBe("reauth_required");
  });
});

// ── Revocation and the open condition ─────────────────────────────────────────────────────

describe("disconnect records the HONEST upstream outcome", () => {
  test("a 200 revoke is `confirmed` but carries a residual-access window, because the cascade is UNPROVEN", async () => {
    const h = await harness();
    await connect(h, "asA");
    stubProvider(() => ({ status: 200, body: {} }));

    const result = await h.asA.action(api.hubspotAuth.disconnectHubSpot, {
      environment: "production",
    });
    expect(result.upstream).toBe("confirmed");
    // THE POINT: HubSpot's revoke provably kills the refresh token and only MAYBE the access
    // token. A null here would be the product claiming a completeness nobody proved.
    expect(result.residualAccessUntil).not.toBeNull();

    const row = (await rows(h))[0];
    expect(row?.status).toBe("revoked");
    expect(row?.credentialCiphertextB64).toBeUndefined();
    expect(row?.revocation?.upstream).toBe("confirmed");
    expect(row?.revocation?.residualAccessUntil).toBe(result.residualAccessUntil);
  });

  test("the revoke posts to the versioned endpoint with an RFC-7009 body", async () => {
    const h = await harness();
    await connect(h, "asA");
    stubProvider(() => ({ status: 200, body: {} }));
    await h.asA.action(api.hubspotAuth.disconnectHubSpot, { environment: "production" });

    const revoke = calls.find((c) => c.url === HUBSPOT_REVOKE_URL);
    expect(revoke).toBeDefined();
    expect(revoke?.body).toContain("token_type_hint=refresh_token");
    expect(revoke?.body).toContain("client_id=");
    // Never the legacy surface, which deleted the refresh token ONLY.
    expect(calls.some((c) => c.url.includes("refresh-tokens"))).toBe(false);
  });

  test("a failed revoke is `attempted_failed` and the local copy still goes", async () => {
    const h = await harness();
    await connect(h, "asA");
    stubProvider(() => ({ status: 500, body: {} }));

    const result = await h.asA.action(api.hubspotAuth.disconnectHubSpot, {
      environment: "production",
    });
    expect(result.upstream).toBe("attempted_failed");
    expect(result.residualAccessUntil).toBeNull();
    expect((await rows(h))[0]?.credentialCiphertextB64).toBeUndefined();
  });

  test("disconnecting a connection that was never sealed is `not_attempted`", async () => {
    const h = await harness();
    stubProvider(() => ({ status: 200, body: {} }));
    const result = await h.asA.action(api.hubspotAuth.disconnectHubSpot, {
      environment: "production",
    });
    expect(result.upstream).toBe("not_attempted");
    expect(calls.filter((c) => c.url === HUBSPOT_REVOKE_URL)).toHaveLength(0);
  });

  test("a revoked connection cannot be read through, and a late read does not resurrect it", async () => {
    const h = await harness();
    await connect(h, "asA");
    stubProvider(() => ({ status: 200, body: {} }));
    await h.asA.action(api.hubspotAuth.disconnectHubSpot, { environment: "production" });

    stubProvider(() => objectPage(["1"]));
    const { projection } = await h.asA.action(api.hubspot.hubspotRead, {
      environment: "production",
      dataset: "deals",
    });
    expect(projection.state).toBe("unavailable");
    if (projection.state !== "unavailable") throw new Error("unreachable");
    expect(projection.because).toBe("revoked");
    expect((await rows(h))[0]?.status).toBe("revoked");
  });
});

describe("probeRevocationCascade — the open condition, tested rather than assumed", () => {
  /** Reply for the owners probe read, switching once the revoke has happened. */
  function cascadeStub(afterRevoke: Reply) {
    let revoked = false;
    stubProvider((call) => {
      if (call.url === HUBSPOT_REVOKE_URL) {
        revoked = true;
        return { status: 200, body: {} };
      }
      if (call.url === HUBSPOT_TOKEN_URL) return tokenReply();
      return revoked ? afterRevoke : { status: 200, body: { results: [] } };
    });
  }

  test("a 401 after the revoke is recorded as a cascade", async () => {
    const h = await harness();
    await connect(h, "asA");
    cascadeStub({ status: 401, body: {} });
    const probe = await h.t.action(internal.hubspotAuth.probeRevocationCascade, {
      tenantId: h.tenantA,
      environment: "production",
      confirm: "revoke",
    });
    expect(probe).toEqual({
      before: "ok",
      upstream: "confirmed",
      after: "rejected",
      cascaded: true,
    });
  });

  test("a 200 after the revoke is recorded as NO cascade — the honest bad news", async () => {
    const h = await harness();
    await connect(h, "asA");
    cascadeStub({ status: 200, body: { results: [] } });
    const probe = await h.t.action(internal.hubspotAuth.probeRevocationCascade, {
      tenantId: h.tenantA,
      environment: "production",
      confirm: "revoke",
    });
    expect(probe.cascaded).toBe(false);
    expect(probe.after).toBe("ok");
  });

  test("a 500 after the revoke proves NOTHING and is recorded as inconclusive", async () => {
    const h = await harness();
    await connect(h, "asA");
    cascadeStub({ status: 500, body: {} });
    const probe = await h.t.action(internal.hubspotAuth.probeRevocationCascade, {
      tenantId: h.tenantA,
      environment: "production",
      confirm: "revoke",
    });
    // A rate limit or an outage must never be reported as "revocation works".
    expect(probe.cascaded).toBeNull();
    expect(probe.after).toBe("failed");
  });

  test("a token that already fails BEFORE the revoke proves nothing and revokes nothing", async () => {
    const h = await harness();
    await connect(h, "asA");
    stubProvider((call) =>
      call.url === HUBSPOT_TOKEN_URL ? tokenReply() : { status: 403, body: {} },
    );
    const probe = await h.t.action(internal.hubspotAuth.probeRevocationCascade, {
      tenantId: h.tenantA,
      environment: "production",
      confirm: "revoke",
    });
    expect(probe).toEqual({
      before: "failed",
      upstream: "not_attempted",
      after: "failed",
      cascaded: null,
    });
    expect(calls.filter((c) => c.url === HUBSPOT_REVOKE_URL)).toHaveLength(0);
    expect((await rows(h))[0]?.status).not.toBe("revoked");
  });

  test("the probe clears NOTHING: the open condition and the empty gate table both survive", async () => {
    const h = await harness();
    await connect(h, "asA");
    cascadeStub({ status: 401, body: {} });
    await h.t.action(internal.hubspotAuth.probeRevocationCascade, {
      tenantId: h.tenantA,
      environment: "production",
      confirm: "revoke",
    });

    // Evidence is not a seal. 28-22 decides; this plan only produces the observation.
    expect(PROVIDER_OPEN_CONDITIONS.hubspot.map((c) => c.id)).toContain(
      "revoke-cascades-to-access-tokens",
    );
    expect(await h.t.run((ctx) => ctx.db.query("providerGates").collect())).toHaveLength(0);
  });
});

/** Sorted copy, so the properties assertion compares a whole set rather than an order. */
const HUBSPOT_DEAL_PROPERTIES_SORTED = [
  "amount",
  "closedate",
  "createdate",
  "deal_currency_code",
  "dealstage",
  "hs_lastmodifieddate",
  "hubspot_owner_id",
  "pipeline",
].sort();
