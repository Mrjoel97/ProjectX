// The Microsoft grant trust boundary (17-06, ADR-018).
//
// Two things here are worth more than the rest put together:
//   1. a GOOGLE-issued state must not verify against the Microsoft callback, even when both
//      providers are configured with the SAME client secret — that is the cross-provider replay
//      this module's discriminator exists to stop, and it is invisible without the test;
//   2. no token material may reach a client query or an audit payload (CLAUDE.md §4).

import { MICROSOFT_SCOPES, MS_CALENDARS_READWRITE_SCOPE, MS_MAIL_SEND_SCOPE } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import { buildAuthorizeUrl } from "./gmailAuth";
import {
  buildMicrosoftAuthorizeUrl,
  constantTimeEquals,
  MICROSOFT_AUTH_ENDPOINT,
  verifyMicrosoftState,
} from "./microsoftAuth";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_microsoft";
const BASE_MS = 1_577_880_000_000;
const SECRET = "microsoft-client-secret";

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

function configureMicrosoft(secret = SECRET) {
  vi.stubEnv("MICROSOFT_OAUTH_CLIENT_ID", "ms-client-id");
  vi.stubEnv("MICROSOFT_OAUTH_CLIENT_SECRET", secret);
  vi.stubEnv("MICROSOFT_CALENDAR_REDIRECT_URI", "https://example.test/microsoft/callback");
}

describe("buildMicrosoftAuthorizeUrl", () => {
  test("uses the tenant-independent common v2 endpoint so personal AND work accounts pass", async () => {
    configureMicrosoft();
    const url = new URL(await buildMicrosoftAuthorizeUrl(TENANT));
    expect(`${url.origin}${url.pathname}`).toBe(MICROSOFT_AUTH_ENDPOINT);
    expect(url.pathname).toContain("/common/");
  });

  test("requests the exact ADR-018 union grant, code flow, query response mode", async () => {
    configureMicrosoft();
    const p = new URL(await buildMicrosoftAuthorizeUrl(TENANT)).searchParams;
    expect(p.get("scope")).toBe(MICROSOFT_SCOPES);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("response_mode")).toBe("query");
    expect(p.get("client_id")).toBe("ms-client-id");
    expect(p.get("redirect_uri")).toBe("https://example.test/microsoft/callback");
  });

  // Without prompt=consent a WIDENED grant silently returns the user's old narrower one and the
  // tenant stays un-upgraded while the product believes they reconnected.
  test("forces consent so a reconnect actually re-consents", async () => {
    configureMicrosoft();
    const p = new URL(await buildMicrosoftAuthorizeUrl(TENANT)).searchParams;
    expect(p.get("prompt")).toBe("consent");
  });

  test("never puts the client secret in the URL", async () => {
    configureMicrosoft();
    expect(await buildMicrosoftAuthorizeUrl(TENANT)).not.toContain(SECRET);
  });

  test("throws rather than building a half-configured authorize URL", async () => {
    vi.stubEnv("MICROSOFT_OAUTH_CLIENT_ID", "ms-client-id");
    vi.stubEnv("MICROSOFT_OAUTH_CLIENT_SECRET", "");
    vi.stubEnv("MICROSOFT_CALENDAR_REDIRECT_URI", "https://example.test/microsoft/callback");
    await expect(buildMicrosoftAuthorizeUrl(TENANT)).rejects.toThrow(
      /Microsoft OAuth env not configured/,
    );
  });
});

describe("verifyMicrosoftState — the callback trust boundary", () => {
  test("returns the bound tenant for an untampered state", async () => {
    configureMicrosoft();
    const state = new URL(await buildMicrosoftAuthorizeUrl(TENANT)).searchParams.get("state");
    expect(await verifyMicrosoftState(state as string)).toBe(TENANT);
  });

  test("a swapped tenant fails, so a forged state cannot graft a grant onto another tenant", async () => {
    configureMicrosoft();
    const state = new URL(await buildMicrosoftAuthorizeUrl(TENANT)).searchParams.get("state");
    const forged = `tenant_victim.${(state as string).split(".")[1]}`;
    expect(await verifyMicrosoftState(forged)).toBeNull();
  });

  test("a tampered signature fails", async () => {
    configureMicrosoft();
    const state = (await buildMicrosoftAuthorizeUrl(TENANT)).split("state=")[1];
    expect(await verifyMicrosoftState(`${TENANT}.${"0".repeat(64)}`)).toBeNull();
    expect(state).toBeTruthy();
  });

  test.each(["", "no-dot", ".onlysig", "tenant."])("malformed state %j fails", async (bad) => {
    configureMicrosoft();
    expect(await verifyMicrosoftState(bad)).toBeNull();
  });

  // THE CROSS-PROVIDER REPLAY. Both providers are deliberately configured with the SAME secret —
  // the worst realistic misconfiguration. The wire format of the two states is identical; only the
  // signed provider discriminator distinguishes them. Remove it and this test is the one that dies.
  test("a Google-issued state is REJECTED even when both providers share a client secret", async () => {
    const shared = "identical-secret";
    configureMicrosoft(shared);
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", shared);
    vi.stubEnv("GMAIL_OAUTH_REDIRECT_URI", "https://example.test/gmail/callback");

    const googleState = new URL(await buildAuthorizeUrl(TENANT)).searchParams.get("state");
    expect(googleState).toContain(TENANT); // same shape...
    expect(await verifyMicrosoftState(googleState as string)).toBeNull(); // ...different trust
  });
});

describe("constantTimeEquals", () => {
  test("equal strings match, unequal do not, length mismatch does not throw", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abd")).toBe(false);
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(true);
  });
});

describe("store — the token row and the reconnect banner", () => {
  test("replaces the existing row rather than accumulating grants", async () => {
    const t = harness();
    for (const scope of [MS_CALENDARS_READWRITE_SCOPE, MICROSOFT_SCOPES]) {
      await t.mutation(internal.microsoftAuth.store, {
        tenantId: TENANT,
        refreshToken: `refresh-${scope.length}`,
        accessToken: "access",
        expiresAt: BASE_MS,
        scope,
      });
    }
    const rows = await t.run((ctx) => ctx.db.query("microsoftCalendarTokens").collect());
    expect(rows).toHaveLength(1);
    // The WIDENED scope won. If store patched instead of replacing, mailReady would stay false
    // forever after a widening — the exact silent-narrow-grant failure ADR-018 has to survive.
    expect(rows[0]?.scope).toBe(MICROSOFT_SCOPES);
  });

  // A Microsoft reconnect must never clear a Google warning: the user would lose the notice about
  // a Gmail connection that is still genuinely broken.
  test("retires only microsoft_calendar_reconnect; gmail_reconnect and other tenants survive", async () => {
    const t = harness();
    await t.run(async (ctx) => {
      for (const row of [
        { tenantId: TENANT, kind: "microsoft_calendar_reconnect", read: false },
        { tenantId: TENANT, kind: "gmail_reconnect", read: false },
        { tenantId: TENANT, kind: "request.rejected", read: false },
        { tenantId: "tenant_other", kind: "microsoft_calendar_reconnect", read: false },
      ]) {
        await ctx.db.insert("notifications", { ...row, message: "m", createdAt: BASE_MS });
      }
    });

    await t.mutation(internal.microsoftAuth.store, {
      tenantId: TENANT,
      refreshToken: "refresh",
      accessToken: "access",
      expiresAt: BASE_MS,
      scope: MICROSOFT_SCOPES,
    });

    const rows = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(rows.map((r) => [r.tenantId, r.kind, r.read])).toEqual([
      [TENANT, "microsoft_calendar_reconnect", true],
      [TENANT, "gmail_reconnect", false],
      [TENANT, "request.rejected", false],
      ["tenant_other", "microsoft_calendar_reconnect", false],
    ]);
  });
});

describe("updateAccess — Microsoft rotates refresh tokens, Google does not", () => {
  async function seeded() {
    const t = harness();
    await t.mutation(internal.microsoftAuth.store, {
      tenantId: TENANT,
      refreshToken: "original-refresh",
      accessToken: "old-access",
      expiresAt: BASE_MS,
      scope: MICROSOFT_SCOPES,
    });
    return t;
  }

  test("keeps the stored refresh token when the response carried none", async () => {
    const t = await seeded();
    await t.mutation(internal.microsoftAuth.updateAccess, {
      tenantId: TENANT,
      accessToken: "new-access",
      expiresAt: BASE_MS + 3600_000,
    });
    const row = await t.run((ctx) => ctx.db.query("microsoftCalendarTokens").unique());
    expect(row?.refreshToken).toBe("original-refresh");
    expect(row?.accessToken).toBe("new-access");
  });

  // Dropping a rotated token leaves the stored one dead and the connection unrecoverable
  // without re-consent. This is the provider difference that makes the optional arg necessary.
  test("persists a ROTATED refresh token when the response carried one", async () => {
    const t = await seeded();
    await t.mutation(internal.microsoftAuth.updateAccess, {
      tenantId: TENANT,
      accessToken: "new-access",
      expiresAt: BASE_MS + 3600_000,
      refreshToken: "rotated-refresh",
    });
    const row = await t.run((ctx) => ctx.db.query("microsoftCalendarTokens").unique());
    expect(row?.refreshToken).toBe("rotated-refresh");
  });
});

describe("microsoftStatus — booleans and timestamps ONLY", () => {
  test("an unconnected tenant reads connected:false and ready for neither half", async () => {
    const t = harness();
    const status = await t
      .withIdentity({ subject: TENANT })
      .query(api.microsoftAuth.microsoftStatus, {});
    expect(status).toEqual({
      connected: false,
      expiresAt: null,
      calendarReady: false,
      mailReady: false,
    });
  });

  // The pre-widening grant, read through the REAL query rather than through the core predicate —
  // a test that re-runs the predicate proves the predicate, not that the query calls it.
  test("a calendar-only grant reads calendar-ready and mail-UNready", async () => {
    const t = harness();
    await t.mutation(internal.microsoftAuth.store, {
      tenantId: TENANT,
      refreshToken: "refresh",
      accessToken: "access",
      expiresAt: BASE_MS,
      scope: `offline_access ${MS_CALENDARS_READWRITE_SCOPE}`,
    });
    const status = await t
      .withIdentity({ subject: TENANT })
      .query(api.microsoftAuth.microsoftStatus, {});
    expect(status).toEqual({
      connected: true,
      expiresAt: BASE_MS,
      calendarReady: true,
      mailReady: false,
    });
  });

  // toEqual above is exact, so this is belt-and-braces on the thing that actually matters:
  // the query is the client's view, and a token or scope string must never appear in it.
  test("the returned object carries no token material and no scope string", async () => {
    const t = harness();
    await t.mutation(internal.microsoftAuth.store, {
      tenantId: TENANT,
      refreshToken: "refresh-secret-value",
      accessToken: "access-secret-value",
      expiresAt: BASE_MS,
      scope: MICROSOFT_SCOPES,
    });
    const status = await t
      .withIdentity({ subject: TENANT })
      .query(api.microsoftAuth.microsoftStatus, {});
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("refresh-secret-value");
    expect(serialized).not.toContain("access-secret-value");
    expect(serialized).not.toContain(MS_CALENDARS_READWRITE_SCOPE);
  });
});

describe("the crown-jewel boundary", () => {
  test("the status query's declared shape carries no token or scope field", async () => {
    // A source assertion, deliberately: the failure it guards is a FIELD BEING ADDED later, and a
    // response-shape check on a stubbed row would pass whatever the handler happened to return.
    const src = (await import("./microsoftAuth?raw")).default as unknown as string;
    const start = src.indexOf("export const microsoftStatus");
    const end = src.indexOf("export const microsoftConnectUrl");
    // Anti-vacuity: if the raw import or either anchor ever fails, `body` becomes empty or
    // reversed and EVERY not.toMatch below passes for free. Pin the extraction itself first.
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain("connected:");
    expect(body.length).toBeGreaterThan(200);
    expect(body).not.toMatch(/\brefreshToken\b/);
    expect(body).not.toMatch(/\baccessToken\b/);
    expect(body).not.toMatch(/scope:/);
  });

  test("disconnect deletes the row and records that the provider grant was NOT revoked", async () => {
    const t = harness();
    await t.mutation(internal.microsoftAuth.store, {
      tenantId: TENANT,
      refreshToken: "refresh-secret-value",
      accessToken: "access-secret-value",
      expiresAt: BASE_MS,
      scope: MICROSOFT_SCOPES,
    });
    const { deleted } = await t.mutation(internal.microsoftAuth.deleteTokens, {
      tenantId: TENANT,
    });
    expect(deleted).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("microsoftCalendarTokens").collect())).toHaveLength(0);
  });

  test("no audit row anywhere can contain token material", async () => {
    const t = harness();
    await t.mutation(internal.microsoftAuth.store, {
      tenantId: TENANT,
      refreshToken: "refresh-secret-value",
      accessToken: "access-secret-value",
      expiresAt: BASE_MS,
      scope: MICROSOFT_SCOPES,
    });
    const audits = await t.run((ctx) => ctx.db.query("audit").collect());
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain("refresh-secret-value");
    expect(serialized).not.toContain("access-secret-value");
  });
});

describe("scope minimality reaches the wire", () => {
  test("the authorize URL requests Mail.Send but no Contacts or Directory permission", async () => {
    configureMicrosoft();
    const scope = new URL(await buildMicrosoftAuthorizeUrl(TENANT)).searchParams.get("scope") ?? "";
    expect(scope).toContain(MS_MAIL_SEND_SCOPE);
    expect(scope).not.toContain("Contacts.");
    expect(scope).not.toContain("Directory.");
    expect(scope).not.toContain(".All");
  });
});

// ── 25-06: the mail half of the ONE grant, and the surfaces this plan must NOT have created ────
//
// The strongest thing here is a NEGATIVE. 17-06 built the authorize URL, the callback, the consent
// page and the token row; `http.ts` carries an in-source instruction that a second callback must
// not be added. A plan called "provider lifecycle" is exactly the one that would quietly add one,
// so the absence is asserted rather than assumed.

describe("25-06: no second OAuth surface exists, and mail readiness is derived not assumed", () => {
  const httpSource = Object.entries(
    import.meta.glob("./http.ts", { query: "?raw", import: "default", eager: true }) as Record<
      string,
      string
    >,
  )[0]?.[1] as string;

  test("http.ts was actually read, so the counts below cannot be vacuous", () => {
    expect(httpSource?.length ?? 0).toBeGreaterThan(1000);
  });

  test("there is exactly ONE Microsoft OAuth callback route, not two", () => {
    const routes = [...httpSource.matchAll(/http\.route\(/g)].length;
    // Pinned exactly: a new route of ANY kind fails this and has to be justified deliberately.
    expect(routes).toBe(8);
    const microsoftCallbacks = [...httpSource.matchAll(/microsoft/gi)].length;
    expect(microsoftCallbacks).toBeGreaterThan(0);
    // One path literal, however many times it is mentioned.
    const paths = new Set(
      [...httpSource.matchAll(/path:\s*"([^"]*microsoft[^"]*)"/gi)].map(([, p]) => p),
    );
    expect(paths.size).toBeLessThanOrEqual(1);
  });

  test("mailReady is FALSE on a legacy calendar-only grant, and connected is still true", async () => {
    // The whole reason the boolean is derived: `connected` cannot tell these apart, and a mail
    // control that trusts `connected` walks the user into a 403 instead of into reconnect.
    const t = harness();
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const asUser = t.withIdentity({ subject: `${userId}|session_a` });
    await t.run((ctx) =>
      ctx.db.insert("microsoftCalendarTokens", {
        tenantId: String(userId),
        refreshToken: "r",
        accessToken: "a",
        expiresAt: BASE_MS,
        scope: `offline_access ${MS_CALENDARS_READWRITE_SCOPE}`,
        updatedAt: BASE_MS,
      }),
    );

    const status = await asUser.query(api.microsoftAuth.microsoftStatus, {});
    expect(status.connected).toBe(true);
    expect(status.calendarReady).toBe(true);
    expect(status.mailReady).toBe(false);
  });

  test("mailReady is TRUE on the union grant", async () => {
    const t = harness();
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const asUser = t.withIdentity({ subject: `${userId}|session_a` });
    await t.run((ctx) =>
      ctx.db.insert("microsoftCalendarTokens", {
        tenantId: String(userId),
        refreshToken: "r",
        accessToken: "a",
        expiresAt: BASE_MS,
        scope: MICROSOFT_SCOPES,
        updatedAt: BASE_MS,
      }),
    );
    expect((await asUser.query(api.microsoftAuth.microsoftStatus, {})).mailReady).toBe(true);
  });

  test("grantedScope returns the scope and NEVER token material", async () => {
    const t = harness();
    await t.run((ctx) =>
      ctx.db.insert("microsoftCalendarTokens", {
        tenantId: "t_scope",
        refreshToken: "refresh-secret-value",
        accessToken: "access-secret-value",
        expiresAt: BASE_MS,
        scope: MICROSOFT_SCOPES,
        updatedAt: BASE_MS,
      }),
    );

    const scope = await t.query(internal.microsoftAuth.grantedScope, { tenantId: "t_scope" });
    expect(scope).toBe(MICROSOFT_SCOPES);
    expect(scope).not.toContain("refresh-secret-value");
    expect(scope).not.toContain("access-secret-value");
    // An unconnected tenant is null, which the caller must distinguish from calendar-only.
    expect(await t.query(internal.microsoftAuth.grantedScope, { tenantId: "nobody" })).toBeNull();
  });
});
