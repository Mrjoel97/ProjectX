// The OAuth callback routes (17-06 Task 2, ADR-018).
//
// The thing this file exists to prove is NEGATIVE: no authorization code, token, state, or raw
// provider error body ever reaches a redirect. A redirect is written to browser history, sent as a
// Referer, and logged by every proxy in between — it is the least private place in the request.
//
// The second thing it proves is ORDERING: state is verified BEFORE the credentialed token POST, so
// a forged callback cannot make us spend a client secret on an attacker's code.

import { MICROSOFT_CALLBACK_ERRORS, MS_CALENDARS_READWRITE_SCOPE } from "@pikar/core";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { buildMicrosoftAuthorizeUrl } from "./microsoftAuth";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_ms_callback";
const SITE = "https://app.test";
const AUTH_CODE = "super-secret-authorization-code";
const REFRESH = "crown-jewel-refresh-token";
const ACCESS = "crown-jewel-access-token";

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

beforeEach(() => {
  vi.stubEnv("SITE_URL", SITE);
  vi.stubEnv("MICROSOFT_OAUTH_CLIENT_ID", "ms-client-id");
  vi.stubEnv("MICROSOFT_OAUTH_CLIENT_SECRET", "ms-client-secret");
  vi.stubEnv("MICROSOFT_CALENDAR_REDIRECT_URI", `${SITE}/microsoft/callback`);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A signed, genuinely-valid state for TENANT — produced by the real builder, never hand-rolled. */
async function validState(): Promise<string> {
  const url = new URL(await buildMicrosoftAuthorizeUrl(TENANT));
  return url.searchParams.get("state") as string;
}

function tokenResponse(body: Record<string, unknown>, status = 200) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

const location = (res: Response) => res.headers.get("Location") ?? "";

describe("/microsoft/callback — failures never reach the provider or leak detail", () => {
  test("a provider refusal collapses to `cancelled` and never posts to the token endpoint", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await harness().fetch(
      "/microsoft/callback?error=access_denied&error_description=user%20declined%20for%20contoso",
      { method: "GET" },
    );
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${SITE}/connect-microsoft?microsoftError=cancelled`);
    // The provider's description named a directory. None of it may survive into the redirect.
    expect(location(res)).not.toContain("contoso");
    expect(location(res)).not.toContain("access_denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ["?state=x", "no code"],
    ["?code=abc", "no state"],
    ["", "neither"],
  ])("missing_callback for %s (%s), with no token POST", async (query) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await harness().fetch(`/microsoft/callback${query}`, { method: "GET" });
    expect(location(res)).toBe(`${SITE}/connect-microsoft?microsoftError=missing_callback`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // THE ORDERING GUARANTEE. If state were verified after the exchange, a forged callback would
  // spend the client secret on an attacker-supplied code before we ever noticed.
  test("a tampered state fails BEFORE the credentialed token POST", async () => {
    // The mock returns a WORKING token response on purpose, so a removed guard produces a real
    // failure rather than an incidental TypeError from an undefined stub.
    //
    // Mutation-measured 2026-08-14: deleting the early return turns this red at
    // `Validator error: Expected string, got null` — `store`'s v.string() refuses the null tenantId,
    // which is a genuine SECOND line of defence and worth knowing about. But it fires too late:
    // by then the client secret has ALREADY been spent on the attacker's code at the token
    // endpoint. That wasted credentialed round-trip is what the early return exists to prevent,
    // and why the assertion below is on the fetch and not only on the stored row.
    const fetchMock = tokenResponse({
      access_token: ACCESS,
      refresh_token: REFRESH,
      expires_in: 3600,
      scope: "offline_access Calendars.ReadWrite",
    });
    vi.stubGlobal("fetch", fetchMock);
    const t = harness();
    const res = await t.fetch(
      `/microsoft/callback?code=${AUTH_CODE}&state=${TENANT}.${"0".repeat(64)}`,
      { method: "GET" },
    );
    expect(location(res)).toBe(`${SITE}/connect-microsoft?microsoftError=invalid_state`);
    expect(fetchMock).not.toHaveBeenCalled();
    // And no grant was grafted onto the tenant the forged state named.
    expect(await t.run((ctx) => ctx.db.query("microsoftCalendarTokens").collect())).toHaveLength(0);
  });

  test("a failed exchange returns `exchange_failed` and leaks no part of the error body", async () => {
    vi.stubGlobal(
      "fetch",
      tokenResponse(
        { error: "invalid_grant", error_description: "AADSTS70008 for contoso.onmicrosoft.com" },
        400,
      ),
    );
    const res = await harness().fetch(
      `/microsoft/callback?code=${AUTH_CODE}&state=${await validState()}`,
      { method: "GET" },
    );
    expect(location(res)).toBe(`${SITE}/connect-microsoft?microsoftError=exchange_failed`);
    expect(location(res)).not.toContain("AADSTS");
    expect(location(res)).not.toContain("contoso");
  });

  test("a token response without a refresh token is refused as missing_refresh", async () => {
    vi.stubGlobal("fetch", tokenResponse({ access_token: ACCESS, expires_in: 3600 }));
    const t = harness();
    const res = await t.fetch(`/microsoft/callback?code=${AUTH_CODE}&state=${await validState()}`, {
      method: "GET",
    });
    expect(location(res)).toBe(`${SITE}/connect-microsoft?microsoftError=missing_refresh`);
    // A half-connection must not be persisted: it works until the first expiry, then dies silently.
    expect(await t.run((ctx) => ctx.db.query("microsoftCalendarTokens").collect())).toHaveLength(0);
  });

  test("every failure redirect carries a code from the CLOSED set and nothing else", async () => {
    vi.stubGlobal("fetch", tokenResponse({ error: "nope" }, 400));
    const t = harness();
    const cases = [
      "/microsoft/callback?error=access_denied",
      "/microsoft/callback?code=abc",
      `/microsoft/callback?code=abc&state=${TENANT}.${"0".repeat(64)}`,
      `/microsoft/callback?code=abc&state=${await validState()}`,
    ];
    for (const path of cases) {
      const value = new URL(location(await t.fetch(path, { method: "GET" }))).searchParams.get(
        "microsoftError",
      );
      expect(MICROSOFT_CALLBACK_ERRORS).toContain(value);
    }
  });
});

describe("/microsoft/callback — success", () => {
  test("stores the grant, lands on Connections, and puts no secret in the redirect", async () => {
    vi.stubGlobal(
      "fetch",
      tokenResponse({
        access_token: ACCESS,
        refresh_token: REFRESH,
        expires_in: 3600,
        scope: `offline_access ${MS_CALENDARS_READWRITE_SCOPE} Mail.Send Mail.Read`,
      }),
    );
    const t = harness();
    const res = await t.fetch(`/microsoft/callback?code=${AUTH_CODE}&state=${await validState()}`, {
      method: "GET",
    });

    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${SITE}/dashboard/profile`);
    // The three things that must never travel through the browser.
    expect(location(res)).not.toContain(REFRESH);
    expect(location(res)).not.toContain(ACCESS);
    expect(location(res)).not.toContain(AUTH_CODE);

    const row = await t.run((ctx) => ctx.db.query("microsoftCalendarTokens").unique());
    expect(row?.tenantId).toBe(TENANT);
    expect(row?.refreshToken).toBe(REFRESH);
  });

  test("posts the authorization-code grant form-urlencoded to the common token endpoint", async () => {
    const fetchMock = tokenResponse({
      access_token: ACCESS,
      refresh_token: REFRESH,
      expires_in: 3600,
      scope: "offline_access Calendars.ReadWrite",
    });
    vi.stubGlobal("fetch", fetchMock);
    await harness().fetch(`/microsoft/callback?code=${AUTH_CODE}&state=${await validState()}`, {
      method: "GET",
    });

    // Asserting on the REQUEST, not the response: a stub answers whatever it was told to answer,
    // so a response assertion cannot see a query that changed. (vault.md's rule, same class.)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe(AUTH_CODE);
    expect(body.get("redirect_uri")).toBe(`${SITE}/microsoft/callback`);
  });

  // The lie the derived-readiness booleans exist to prevent: Microsoft may grant LESS than was
  // requested. Storing the REQUESTED scope would make mailReady claim a capability the grant lacks.
  test("stores the GRANTED scope, not the requested one, so a partial grant reads partial", async () => {
    vi.stubGlobal(
      "fetch",
      tokenResponse({
        access_token: ACCESS,
        refresh_token: REFRESH,
        expires_in: 3600,
        scope: `offline_access ${MS_CALENDARS_READWRITE_SCOPE}`, // NO mail scopes granted
      }),
    );
    const t = harness();
    await t.fetch(`/microsoft/callback?code=${AUTH_CODE}&state=${await validState()}`, {
      method: "GET",
    });
    const row = await t.run((ctx) => ctx.db.query("microsoftCalendarTokens").unique());
    expect(row?.scope).toBe(`offline_access ${MS_CALENDARS_READWRITE_SCOPE}`);
    expect(row?.scope).not.toContain("Mail.Send");

    const status = await t
      .withIdentity({ subject: TENANT })
      .query((await import("./_generated/api")).api.microsoftAuth.microsoftStatus, {});
    expect(status.calendarReady).toBe(true);
    expect(status.mailReady).toBe(false);
  });

  // An absent scope must read as UN-ready, never as fully ready.
  test("a token response with no scope field stores empty and reads un-ready for both halves", async () => {
    vi.stubGlobal(
      "fetch",
      tokenResponse({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 }),
    );
    const t = harness();
    await t.fetch(`/microsoft/callback?code=${AUTH_CODE}&state=${await validState()}`, {
      method: "GET",
    });
    const status = await t
      .withIdentity({ subject: TENANT })
      .query((await import("./_generated/api")).api.microsoftAuth.microsoftStatus, {});
    expect(status.connected).toBe(true);
    expect(status.calendarReady).toBe(false);
    expect(status.mailReady).toBe(false);
  });
});

describe("the Google callback is untouched by the Microsoft one", () => {
  test("/gmail/callback still exchanges and stores on its own route and table", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "google-client-secret");
    vi.stubEnv("GMAIL_OAUTH_REDIRECT_URI", `${SITE}/gmail/callback`);
    vi.stubGlobal(
      "fetch",
      tokenResponse({
        access_token: "g-access",
        refresh_token: "g-refresh",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/gmail.modify",
      }),
    );

    const { buildAuthorizeUrl } = await import("./gmailAuth");
    const state = new URL(await buildAuthorizeUrl(TENANT)).searchParams.get("state") as string;
    const t = harness();
    const res = await t.fetch(`/gmail/callback?code=g-code&state=${state}`, { method: "GET" });

    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${SITE}/dashboard/workspace`);
    // Landed in the GOOGLE table, and the Microsoft one is untouched.
    expect(await t.run((ctx) => ctx.db.query("gmailTokens").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("microsoftCalendarTokens").collect())).toHaveLength(0);
  });
});
