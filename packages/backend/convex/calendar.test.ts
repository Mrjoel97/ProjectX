import { CALENDAR_EVENTS_SCOPE, CALENDAR_FREEBUSY_SCOPE, GMAIL_MODIFY_SCOPE } from "@pikar/core";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { internal } from "./_generated/api";
import { buildAuthorizeUrl } from "./gmailAuth";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const convexSources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

const TENANT = "tenant_calendar";
const BASE_MS = 1_577_880_000_000;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("calendar fixture seam", () => {
  test("seed/get round-trip is deterministic and replaces the tenant row", async () => {
    const t = harness();
    expect(await t.query(internal.smoke.getCalendarFixture, { tenantId: TENANT })).toBeNull();

    expect(
      await t.mutation(internal.smoke.seedCalendarFixture, {
        tenantId: TENANT,
        baseMs: BASE_MS,
      }),
    ).toEqual({ busyCount: 3 });
    await t.mutation(internal.smoke.seedCalendarFixture, {
      tenantId: TENANT,
      baseMs: BASE_MS + 1_000,
    });

    const fixture = await t.query(internal.smoke.getCalendarFixture, { tenantId: TENANT });
    expect(fixture?.busy).toEqual([
      { startMs: BASE_MS + 1_000 + 3_600_000, endMs: BASE_MS + 1_000 + 7_200_000 },
      { startMs: BASE_MS + 1_000 + 14_400_000, endMs: BASE_MS + 1_000 + 19_800_000 },
      { startMs: BASE_MS + 1_000 + 93_600_000, endMs: BASE_MS + 1_000 + 97_200_000 },
    ]);
    const rows = await t.run((ctx) => ctx.db.query("calendarFixtures").collect());
    expect(rows).toHaveLength(1);
  });
});

describe("one Google consent flow", () => {
  test("the one authorize URL requests mail, free/busy, and event scopes", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret");
    vi.stubEnv("GMAIL_OAUTH_REDIRECT_URI", "https://example.test/gmail/callback");

    const url = new URL(await buildAuthorizeUrl(TENANT));
    const scopes = new Set(url.searchParams.get("scope")?.split(" ") ?? []);
    expect(scopes).toEqual(
      new Set([GMAIL_MODIFY_SCOPE, CALENDAR_FREEBUSY_SCOPE, CALENDAR_EVENTS_SCOPE]),
    );
  });

  test("buildAuthorizeUrl is the only Google authorize-URL construction in convex", () => {
    const constructions = Object.entries(convexSources).flatMap(([path, source]) =>
      [...source.matchAll(/accounts\.google\.com\/o\/oauth2/g)].map(() => path),
    );
    expect(constructions.length, "the scan found no authorize URL and is vacuous").toBeGreaterThan(
      0,
    );
    // Mutation check: adding a second GOOGLE_AUTH_ENDPOINT template literal makes this RED.
    expect(constructions).toEqual(["./gmailAuth.ts"]);
  });
});

async function seedGoogleToken(t: ReturnType<typeof harness>, tenantId: string, scope: string) {
  await t.run((ctx) =>
    ctx.db.insert("gmailTokens", {
      tenantId,
      refreshToken: "refresh-token",
      accessToken: "old-access-token",
      expiresAt: BASE_MS,
      scope,
      updatedAt: BASE_MS,
    }),
  );
}

const freeBusyArgs = {
  tenantId: TENANT,
  correlationId: "calendar-correlation",
  range: "today",
  tz: "Africa/Dar_es_Salaam",
  nowMs: BASE_MS,
};

describe("freeBusy — fixture-first, governed read", () => {
  test("a fixture tenant needs neither a Google token nor network", async () => {
    const t = harness();
    await t.mutation(internal.smoke.seedCalendarFixture, {
      tenantId: TENANT,
      baseMs: BASE_MS,
    });
    const fetchMock = vi.fn(() => {
      throw new Error("fixture path must not call fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(internal.calendar.freeBusy, freeBusyArgs);

    expect(result).toEqual({
      ok: true,
      fixture: true,
      busy: [
        { startMs: BASE_MS + 3_600_000, endMs: BASE_MS + 7_200_000 },
        { startMs: BASE_MS + 14_400_000, endMs: BASE_MS + 19_800_000 },
      ],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a successful fixture read writes exactly one refs-only audit row", async () => {
    const t = harness();
    await t.mutation(internal.smoke.seedCalendarFixture, {
      tenantId: TENANT,
      baseMs: BASE_MS,
    });

    await t.action(internal.calendar.freeBusy, freeBusyArgs);

    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    const listed = rows.filter((row) => row.eventType === "calendar.availability.listed");
    expect(listed).toHaveLength(1);
    const payload = listed[0]?.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["busyCount", "range"]);
    expect(payload).toEqual({ range: "today", busyCount: 2 });
    const serialized = JSON.stringify(payload);
    for (const timestamp of [
      BASE_MS + 3_600_000,
      BASE_MS + 7_200_000,
      BASE_MS + 14_400_000,
      BASE_MS + 19_800_000,
    ]) {
      expect(serialized).not.toContain(String(timestamp));
    }
  });

  test("a missing token returns not_connected and writes no audit", async () => {
    const t = harness();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await t.action(internal.calendar.freeBusy, freeBusyArgs)).toEqual({
      ok: false,
      reason: "not_connected",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  });

  test("a grant lacking free/busy scope returns reauth before even the refresh POST", async () => {
    const t = harness();
    await seedGoogleToken(t, TENANT, GMAIL_MODIFY_SCOPE);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await t.action(internal.calendar.freeBusy, freeBusyArgs)).toEqual({
      ok: false,
      reason: "reauth",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  });

  test("a failed refresh returns reauth rather than throwing", async () => {
    const t = harness();
    await seedGoogleToken(t, TENANT, `${GMAIL_MODIFY_SCOPE} ${CALENDAR_FREEBUSY_SCOPE}`);
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await t.action(internal.calendar.freeBusy, freeBusyArgs)).toEqual({
      ok: false,
      reason: "reauth",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  });

  test("the live adapter maps RFC3339 ranges to epoch ms and audits only after success", async () => {
    const t = harness();
    await seedGoogleToken(t, TENANT, `${GMAIL_MODIFY_SCOPE} ${CALENDAR_FREEBUSY_SCOPE}`);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ access_token: "fresh-access-token", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          calendars: {
            primary: {
              busy: [
                {
                  start: "2020-01-01T13:00:00.000Z",
                  end: "2020-01-01T14:00:00.000Z",
                },
              ],
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    expect(await t.action(internal.calendar.freeBusy, freeBusyArgs)).toEqual({
      ok: true,
      fixture: false,
      busy: [{ startMs: BASE_MS + 3_600_000, endMs: BASE_MS + 7_200_000 }],
    });
    const listed = (await t.run((ctx) => ctx.db.query("audit").collect())).filter(
      (row) => row.eventType === "calendar.availability.listed",
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.payload).toEqual({ range: "today", busyCount: 1 });
  });

  test("invalid ranges and failed Google reads are unavailable and audit nothing", async () => {
    const invalid = harness();
    const invalidFetch = vi.fn();
    vi.stubGlobal("fetch", invalidFetch);
    expect(
      await invalid.action(internal.calendar.freeBusy, {
        ...freeBusyArgs,
        range: "model-prose",
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(invalidFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    const failed = harness();
    await seedGoogleToken(failed, TENANT, `${GMAIL_MODIFY_SCOPE} ${CALENDAR_FREEBUSY_SCOPE}`);
    const failedFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "fresh" }))
      .mockResolvedValueOnce(new Response("ZZQX echoed request", { status: 503 }));
    vi.stubGlobal("fetch", failedFetch);
    expect(await failed.action(internal.calendar.freeBusy, freeBusyArgs)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await failed.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  });
});
