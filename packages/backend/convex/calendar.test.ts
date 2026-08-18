import type { RunId } from "@convex-dev/action-retrier";
import retrierTest from "@convex-dev/action-retrier/test";
import {
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_FREEBUSY_SCOPE,
  DRIVE_READONLY_SCOPE,
  GMAIL_MODIFY_SCOPE,
} from "@pikar/core";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import { buildAuthorizeUrl } from "./gmailAuth";
import { contentHash } from "./lib/hash";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const convexSources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  retrierTest.register(t);
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
  test("the one authorize URL requests mail, free/busy, event and Drive scopes", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret");
    vi.stubEnv("GMAIL_OAUTH_REDIRECT_URI", "https://example.test/gmail/callback");

    const url = new URL(await buildAuthorizeUrl(TENANT));
    const scopes = new Set(url.searchParams.get("scope")?.split(" ") ?? []);
    // An EXACT set, so widening the grant is always a deliberate edit here — a scope that appears
    // in the consent screen without a test saying so is a permission nobody decided to ask for.
    expect(scopes).toEqual(
      new Set([
        GMAIL_MODIFY_SCOPE,
        CALENDAR_FREEBUSY_SCOPE,
        CALENDAR_EVENTS_SCOPE,
        DRIVE_READONLY_SCOPE,
      ]),
    );
  });

  test("the client query returns a bounded unavailable state when OAuth env is incomplete", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "");
    vi.stubEnv("GMAIL_OAUTH_REDIRECT_URI", "https://example.test/gmail/callback");
    const t = harness();
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));

    await expect(
      t.withIdentity({ subject: `${userId}|session_a` }).query(api.gmailAuth.gmailConnectUrl, {}),
    ).resolves.toEqual({ configured: false, url: null });
  });

  test("the client query returns a signed URL when every OAuth env value is present", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret");
    vi.stubEnv("GMAIL_OAUTH_REDIRECT_URI", "https://example.test/gmail/callback");
    const t = harness();
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));

    const result = await t
      .withIdentity({ subject: `${userId}|session_a` })
      .query(api.gmailAuth.gmailConnectUrl, {});
    expect(result.configured).toBe(true);
    expect(result.url).not.toBeNull();
    expect(new URL(result.url ?? "").searchParams.get("state")).toMatch(
      new RegExp(`^${userId}\\.[a-f0-9]{64}$`),
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

describe("store — a fresh consent retires the reconnect prompt", () => {
  // The bug this guards: the user reconnects, but the "Reconnect Gmail" banner stays up forever
  // because nothing ever marked the gmail_reconnect notification read.
  test("unread gmail_reconnect rows go read; other kinds and other tenants are untouched", async () => {
    const t = harness();
    await t.run(async (ctx) => {
      for (const row of [
        { tenantId: TENANT, kind: "gmail_reconnect", read: false },
        { tenantId: TENANT, kind: "request.rejected", read: false },
        { tenantId: "tenant_other", kind: "gmail_reconnect", read: false },
      ]) {
        await ctx.db.insert("notifications", { ...row, message: "m", createdAt: BASE_MS });
      }
    });

    await t.mutation(internal.gmailAuth.store, {
      tenantId: TENANT,
      refreshToken: "refresh-token",
      accessToken: "access-token",
      expiresAt: BASE_MS,
      scope: GMAIL_MODIFY_SCOPE,
    });

    const rows = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(rows.map((r) => [r.tenantId, r.kind, r.read])).toEqual([
      [TENANT, "gmail_reconnect", true],
      [TENANT, "request.rejected", false],
      ["tenant_other", "gmail_reconnect", false],
    ]);
  });
});

describe("disconnectGoogle — revoke at Google, then delete locally", () => {
  // The bug this guards: a disconnect that deletes our row but never tells Google leaves the
  // grant live on the user's account, and privacy/page.tsx:312 promises otherwise.
  test("revokes the refresh token, deletes the row, and audits refs-only", async () => {
    const t = harness();
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await seedGoogleToken(t, String(userId), GMAIL_MODIFY_SCOPE);
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const as = t.withIdentity({ subject: `${userId}|session_a` });
    expect(await as.action(api.gmailAuth.disconnectGoogle, {})).toEqual({ revoked: true });

    // 1. Google was actually told. Anti-vacuity: a delete-only regression makes this RED
    //    rather than silently passing.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(init.method).toBe("POST");
    // The REFRESH token, not the access token — revoking the access token would kill one
    // short-lived credential and leave the grant standing.
    expect(String(init.body)).toBe("token=refresh-token");

    // 2. The row is gone and the client-facing status agrees.
    expect(await t.run((ctx) => ctx.db.query("gmailTokens").collect())).toEqual([]);
    expect(await as.query(api.gmailAuth.gmailStatus, {})).toEqual({
      connected: false,
      expiresAt: null,
      // A disconnected tenant is not Drive-ready either — the flag is derived from the scope of a
      // row that no longer exists, so it must read false rather than absent.
      driveReady: false,
    });

    // 3. One audit row, flags only, and no token material anywhere in it (CLAUDE.md §4).
    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    const ev = rows.filter((r) => r.eventType === "google.disconnected");
    expect(ev).toHaveLength(1);
    expect(Object.keys(ev[0]?.payload as object).sort()).toEqual(["revoked", "status"]);
    expect(ev[0]?.actor).toBe("user");
    const serialized = JSON.stringify(ev[0]);
    expect(serialized).not.toContain("refresh-token");
    expect(serialized).not.toContain("old-access-token");
  });

  test("a 400 from Google (already revoked) still deletes the local row", async () => {
    const t = harness();
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await seedGoogleToken(t, String(userId), GMAIL_MODIFY_SCOPE);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 400 })));

    // 400 means Google already considers the token invalid — same end state as 200.
    expect(
      await t
        .withIdentity({ subject: `${userId}|session_a` })
        .action(api.gmailAuth.disconnectGoogle, {}),
    ).toEqual({ revoked: true });
    // The assertion that matters: a non-200 must never leave the crown jewel at rest.
    expect(await t.run((ctx) => ctx.db.query("gmailTokens").collect())).toEqual([]);
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
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await t.action(internal.calendar.freeBusy, freeBusyArgs)).toEqual({
      ok: false,
      reason: "reauth",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  });

  // ── H3, the OFFLINE half (17-06). The live negative is repeated in Plan 17-11. ──────────────
  //
  // WHY THIS EXISTS WHEN THE ZERO-FETCH TEST ABOVE ALREADY PASSES. `not.toHaveBeenCalled()` is
  // satisfied just as well by a `freeBusy` that never fetches under ANY conditions — a broken
  // adapter passes it perfectly. The guard is only proven by the CONTRAST: same action, same
  // fixture shape, two stored scopes, one fetch and one not. That is what makes the stored-scope
  // check the cause, rather than something else silently short-circuiting the call.
  //
  // The pre-widening row is not hypothetical: `include_granted_scopes` is FORWARD-only, so every
  // tenant who connected before 17-02 holds a mail-only grant that refreshes perfectly and 403s on
  // the first calendar call. Catching it BEFORE `freshAccessToken` is what turns that into a
  // reconnect prompt instead of a raw provider error.
  test("H3 — a pre-widening grant reauths with ZERO fetches while a calendar grant reaches the adapter", async () => {
    // NEGATIVE: mail-only, the shape a pre-17-02 connection actually has.
    const preWidening = harness();
    await seedGoogleToken(preWidening, TENANT, GMAIL_MODIFY_SCOPE);
    // A VALID body on purpose. With an empty one, removing the guard makes this test die on
    // "Unexpected end of JSON input" — a crash, not the claim. Answering plausibly means a removed
    // guard fails on "expected spy not to be called", which is what a future reader needs to see.
    const noFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "a", expires_in: 3600, calendars: {} }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", noFetch);

    expect(await preWidening.action(internal.calendar.freeBusy, freeBusyArgs)).toEqual({
      ok: false,
      reason: "reauth",
    });
    expect(noFetch, "a pre-widening grant must never reach the network").not.toHaveBeenCalled();
    // Nothing is audited for a call that never happened.
    expect(await preWidening.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);

    // POSITIVE WITNESS: the same action, the same args, one scope wider — and it DOES go out.
    // Without this half the assertion above is satisfied by an adapter that fetches nothing ever.
    const widened = harness();
    await seedGoogleToken(widened, TENANT, `${GMAIL_MODIFY_SCOPE} ${CALENDAR_FREEBUSY_SCOPE}`);
    const didFetch = vi.fn().mockResolvedValue(new Response("", { status: 400 }));
    vi.stubGlobal("fetch", didFetch);

    await widened.action(internal.calendar.freeBusy, freeBusyArgs);
    expect(
      didFetch.mock.calls.length,
      "the positive witness never fetched — the negative assertion above is therefore vacuous",
    ).toBeGreaterThan(0);
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

const SECRET_TITLE = "ZZQX-secret-offsite";
const EVENT_START_MS = BASE_MS + 172_800_000;
const EVENT_DURATION_MS = 3_600_000;
const FUTURE_TOKEN_EXPIRY_MS = 4_102_444_800_000;

type EventField = "eventTitle" | "eventStartMs" | "eventDurationMs" | "eventTz";
type PlanStatus = "collecting" | "proposed" | "delivering";
type CalendarEventFields = {
  eventTitle?: string;
  eventStartMs?: number;
  eventDurationMs?: number;
  eventTz?: string;
};

async function seedCalendarPlan(
  t: ReturnType<typeof harness>,
  options: {
    tenantId?: string;
    status?: PlanStatus;
    missing?: EventField;
    calendarRunId?: RunId;
    calendarProvider?: "google" | "microsoft";
  } = {},
) {
  const eventFields: CalendarEventFields = {
    eventTitle: SECRET_TITLE,
    eventStartMs: EVENT_START_MS,
    eventDurationMs: EVENT_DURATION_MS,
    eventTz: "Africa/Dar_es_Salaam",
  };
  if (options.missing) delete eventFields[options.missing];

  return t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId: options.tenantId ?? TENANT,
      threadId: `calendar-thread-${options.tenantId ?? TENANT}`,
      status: options.status ?? "delivering",
      ...(options.calendarProvider ? { calendarProvider: options.calendarProvider } : {}),
      kind: "calendar_event",
      ...eventFields,
      calendarRunId: options.calendarRunId,
      createdAt: BASE_MS,
    }),
  );
}

async function seedCalendarGrant(t: ReturnType<typeof harness>, tenantId = TENANT) {
  await t.run((ctx) =>
    ctx.db.insert("gmailTokens", {
      tenantId,
      refreshToken: "calendar-refresh-token",
      accessToken: "calendar-access-token",
      expiresAt: FUTURE_TOKEN_EXPIRY_MS,
      scope: `${GMAIL_MODIFY_SCOPE} ${CALENDAR_EVENTS_SCOPE}`,
      updatedAt: BASE_MS,
    }),
  );
}

function createdReturn(
  planId: Awaited<ReturnType<typeof seedCalendarPlan>>,
  tenantId = TENANT,
  eventId = "calendar-event-id",
  duplicate = false,
) {
  return {
    planId,
    tenantId,
    correlationId: `calendar-correlation-${tenantId}`,
    outcome: "created" as const,
    eventId,
    duplicate,
  };
}

async function completeSuccess(
  t: ReturnType<typeof harness>,
  runId: RunId,
  returnValue: ReturnType<typeof createdReturn> | Record<string, unknown>,
) {
  await t.mutation(internal.calendarComplete.onCreateComplete, {
    runId,
    result: { type: "success", returnValue },
  });
}

describe("calendar event creation terminal", () => {
  test("a delivering plan becomes done with exactly one refs-only created audit", async () => {
    const t = harness();
    const planId = await seedCalendarPlan(t);
    await completeSuccess(t, "calendar-run-success" as RunId, createdReturn(planId));

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan).toMatchObject({ status: "done", calendarEventId: "calendar-event-id" });

    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    const created = rows.filter((row) => row.eventType === "calendar.event.created");
    expect(created).toHaveLength(1);
    expect(Object.keys(created[0]?.payload as Record<string, unknown>).sort()).toEqual([
      "eventId",
      "planId",
    ]);
    expect(created[0]?.payload).toEqual({ planId, eventId: "calendar-event-id" });
    expect(JSON.stringify(rows)).not.toContain(SECRET_TITLE);
    expect(await t.run((ctx) => ctx.db.query("deadLetters").collect())).toEqual([]);
  });

  test.each([
    "collecting",
    "proposed",
  ] as const)("a %s plan ignores a stale success terminal and writes nothing", async (status) => {
    const t = harness();
    const planId = await seedCalendarPlan(t, { status });
    await completeSuccess(t, `calendar-run-${status}` as RunId, createdReturn(planId));

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe(status);
    expect(plan).not.toHaveProperty("calendarEventId");
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("deadLetters").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toEqual([]);
  });

  test("two tenants complete independently and both sides write a terminal", async () => {
    const t = harness();
    const tenantA = "calendar-tenant-a";
    const tenantB = "calendar-tenant-b";
    const planA = await seedCalendarPlan(t, { tenantId: tenantA });
    const planB = await seedCalendarPlan(t, { tenantId: tenantB });

    await completeSuccess(
      t,
      "calendar-run-tenant-a" as RunId,
      createdReturn(planA, tenantA, "event-a"),
    );
    await completeSuccess(
      t,
      "calendar-run-tenant-b" as RunId,
      createdReturn(planB, tenantB, "event-b"),
    );

    expect(await t.run((ctx) => ctx.db.get(planA))).toMatchObject({
      tenantId: tenantA,
      calendarEventId: "event-a",
    });
    expect(await t.run((ctx) => ctx.db.get(planB))).toMatchObject({
      tenantId: tenantB,
      calendarEventId: "event-b",
    });
    const rows = (await t.run((ctx) => ctx.db.query("audit").collect())).filter(
      (row) => row.eventType === "calendar.event.created",
    );
    expect(rows.filter((row) => row.tenantId === tenantA)).toHaveLength(1);
    expect(rows.filter((row) => row.tenantId === tenantB)).toHaveLength(1);
    expect(rows.find((row) => row.tenantId === tenantA)?.payload).toEqual({
      planId: planA,
      eventId: "event-a",
    });
    expect(rows.find((row) => row.tenantId === tenantB)?.payload).toEqual({
      planId: planB,
      eventId: "event-b",
    });
  });
});

describe("createEvent — idempotent governed write", () => {
  // ── 17-07 provider dispatch ────────────────────────────────────────────────────────────────
  //
  // The compatibility guarantee is the whole point: every plan staged before this phase has NO
  // `calendarProvider`, and each one must still take the Google path byte-for-byte. Expressed as a
  // pure default (`parseCalendarProvider`) rather than an `if` per call site, and proven here by
  // WHICH HOST is contacted — the only evidence that cannot be faked by a stubbed response shape.
  test("an ABSENT calendarProvider still takes the Google path", async () => {
    const t = harness();
    const planId = await seedCalendarPlan(t);
    await seedCalendarGrant(t);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "a", expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ id: "google-event", etag: '"g1"' }));
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await t.action(internal.calendar.createEvent, {
        planId,
        tenantId: TENANT,
        correlationId: "c",
      }),
    ).toMatchObject({ outcome: "created", provider: "google", etag: '"g1"' });

    // Google's host, and NOTHING went to Graph.
    const hosts = fetchMock.mock.calls.map((c) => new URL(String(c[0])).host);
    expect(hosts).toContain("www.googleapis.com");
    expect(hosts).not.toContain("graph.microsoft.com");
    expect(hosts).not.toContain("login.microsoftonline.com");
  });

  test("an EXPLICIT microsoft provider takes only the Graph path", async () => {
    const t = harness();
    const planId = await seedCalendarPlan(t, { calendarProvider: "microsoft" });
    // A Google grant EXISTS and must go untouched — the branch is the provider, never "whichever
    // token happens to be present".
    await seedCalendarGrant(t);
    await t.run((ctx) =>
      ctx.db.insert("microsoftCalendarTokens", {
        tenantId: TENANT,
        refreshToken: "ms-refresh",
        accessToken: "ms-access",
        expiresAt: Date.now() + 3_600_000,
        scope: "offline_access Calendars.ReadWrite",
        updatedAt: BASE_MS,
      }),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ id: "AAMkGraph", "@odata.etag": 'W/"m1"' }, { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await t.action(internal.calendar.createEvent, {
        planId,
        tenantId: TENANT,
        correlationId: "c",
      }),
    ).toMatchObject({
      outcome: "created",
      eventId: "AAMkGraph",
      provider: "microsoft",
      etag: 'W/"m1"',
    });

    const hosts = fetchMock.mock.calls.map((c) => new URL(String(c[0])).host);
    expect(hosts).toEqual(["graph.microsoft.com"]);
    expect(hosts).not.toContain("www.googleapis.com");
  });

  test("a Microsoft plan with no Microsoft grant reauths without touching Google", async () => {
    const t = harness();
    const planId = await seedCalendarPlan(t, { calendarProvider: "microsoft" });
    await seedCalendarGrant(t); // Google is connected; that must not rescue Microsoft.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await t.action(internal.calendar.createEvent, {
        planId,
        tenantId: TENANT,
        correlationId: "c",
      }),
    ).toMatchObject({ outcome: "reauth" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("the shared refusals run BEFORE the provider branch, for both providers", async () => {
    const t = harness();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const calendarProvider of ["google", "microsoft"] as const) {
      const planId = await seedCalendarPlan(t, { calendarProvider, missing: "eventStartMs" });
      expect(
        await t.action(internal.calendar.createEvent, {
          planId,
          tenantId: TENANT,
          correlationId: "c",
        }),
      ).toMatchObject({ outcome: "terminal", reason: "incomplete_stage" });
    }
    // A partially staged row is permanently unsatisfiable on EITHER provider; neither may spend a
    // token or a network call discovering that.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a repeated create sends the same id and treats Google's 409 as success", async () => {
    const t = harness();
    const planId = await seedCalendarPlan(t);
    await seedCalendarGrant(t);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ access_token: "first-access-token", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(Response.json({ id: "provider-event-id" }))
      .mockResolvedValueOnce(
        Response.json({ access_token: "second-access-token", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(new Response("", { status: 409 }))
      // 17-07: the 409 is now followed by ONE bounded GET of the deterministic id, because a
      // duplicate arrives with no body and therefore no etag — and 17-08 needs the version of the
      // event that actually exists.
      .mockResolvedValueOnce(Response.json({ id: "provider-event-id", etag: '"dup-etag"' }));
    vi.stubGlobal("fetch", fetchMock);

    const args = { planId, tenantId: TENANT, correlationId: "create-correlation" };
    expect(await t.action(internal.calendar.createEvent, args)).toMatchObject({
      outcome: "created",
      eventId: "provider-event-id",
      duplicate: false,
      provider: "google",
    });
    const duplicate = await t.action(internal.calendar.createEvent, args);
    expect(duplicate).toMatchObject({
      outcome: "created",
      duplicate: true,
      provider: "google",
      etag: '"dup-etag"',
    });

    // 5, not 4: refresh, create, refresh, create(409), etag-recovery GET.
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const recovery = fetchMock.mock.calls[4] as [string, RequestInit | undefined];
    expect(String(recovery[0])).toContain(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/",
    );
    // A GET — the recovery must never re-attempt a write.
    expect(recovery[1]?.method ?? "GET").toBe("GET");
    const eventCalls = fetchMock.mock.calls.filter((_, index) => index === 1 || index === 3);
    const requestBodies = eventCalls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)),
    );
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]?.id).toBe(requestBodies[1]?.id);
    expect(requestBodies[0]).toMatchObject({
      summary: SECRET_TITLE,
      start: {
        dateTime: "2020-01-03T12:00:00.000Z",
        timeZone: "Africa/Dar_es_Salaam",
      },
      end: {
        dateTime: "2020-01-03T13:00:00.000Z",
        timeZone: "Africa/Dar_es_Salaam",
      },
    });

    await completeSuccess(t, "calendar-run-duplicate" as RunId, duplicate);
    expect(await t.run((ctx) => ctx.db.get(planId))).toMatchObject({
      status: "done",
      calendarEventId: requestBodies[0]?.id,
    });
  });

  test("a terminal 400 dead-letters status and reason code without the echoed title", async () => {
    const t = harness();
    const planId = await seedCalendarPlan(t);
    await seedCalendarGrant(t);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ access_token: "terminal-access-token", expires_in: 3600 }),
        )
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                errors: [{ reason: "invalid" }],
                message: `Invalid summary: ${SECRET_TITLE}`,
              },
            },
            { status: 400 },
          ),
        ),
    );

    const result = await t.action(internal.calendar.createEvent, {
      planId,
      tenantId: TENANT,
      correlationId: "terminal-correlation",
    });
    expect(result).toMatchObject({ outcome: "terminal", status: 400 });
    await completeSuccess(t, "calendar-run-terminal" as RunId, result);

    const deadLetters = await t.run((ctx) => ctx.db.query("deadLetters").collect());
    expect(deadLetters).toHaveLength(1);
    const audit = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(JSON.stringify({ deadLetters, audit })).not.toContain(SECRET_TITLE);
    expect(deadLetters[0]?.error).toBe("calendar_insert 400 invalid");
    expect(deadLetters[0]?.payload).toEqual({ planId, status: 400 });
    expect(audit.filter((row) => row.eventType === "deadletter.written")).toHaveLength(1);
  });

  test("503 throws a refs-only transient error so the retrier retries", async () => {
    const t = harness();
    const planId = await seedCalendarPlan(t);
    await seedCalendarGrant(t);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ access_token: "transient-access-token", expires_in: 3600 }),
        )
        .mockResolvedValueOnce(new Response(`provider echoed ${SECRET_TITLE}`, { status: 503 })),
    );

    await expect(
      t.action(internal.calendar.createEvent, {
        planId,
        tenantId: TENANT,
        correlationId: "transient-correlation",
      }),
    ).rejects.toThrow("calendar_insert_transient status=503");
  });

  test("a 403 scope reason returns reauth and lights the existing reconnect banner", async () => {
    const t = harness();
    const planId = await seedCalendarPlan(t);
    await seedCalendarGrant(t);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ access_token: "reauth-access-token", expires_in: 3600 }),
        )
        .mockResolvedValueOnce(
          Response.json(
            { error: { errors: [{ reason: "insufficientPermissions" }] } },
            { status: 403 },
          ),
        ),
    );

    const result = await t.action(internal.calendar.createEvent, {
      planId,
      tenantId: TENANT,
      correlationId: "reauth-correlation",
    });
    expect(result).toMatchObject({ outcome: "reauth" });
    await completeSuccess(t, "calendar-run-reauth" as RunId, result);

    const notifications = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ tenantId: TENANT, kind: "gmail_reconnect" });
    expect(await t.run((ctx) => ctx.db.query("deadLetters").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  });

  test.each([
    "eventTitle",
    "eventStartMs",
    "eventDurationMs",
    "eventTz",
  ] as const)("missing %s is terminal before token or network work", async (missing) => {
    const t = harness();
    const planId = await seedCalendarPlan(t, { missing });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(internal.calendar.createEvent, {
      planId,
      tenantId: TENANT,
      correlationId: `incomplete-${missing}`,
    });
    expect(result).toMatchObject({
      outcome: "terminal",
      status: 0,
      reason: "incomplete_stage",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await completeSuccess(t, `calendar-run-incomplete-${missing}` as RunId, result);
    expect((await t.run((ctx) => ctx.db.query("deadLetters").collect()))[0]?.error).toBe(
      "calendar_insert 0 incomplete_stage",
    );
  });

  test("a cross-tenant plan reference is terminal before token or network work", async () => {
    const t = harness();
    const planId = await seedCalendarPlan(t, { tenantId: "calendar-owner" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await t.action(internal.calendar.createEvent, {
        planId,
        tenantId: "calendar-intruder",
        correlationId: "cross-tenant",
      }),
    ).toMatchObject({ outcome: "terminal", status: 0, reason: "tenant_mismatch" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("action-retrier failed/canceled terminals", () => {
  test.each([
    {
      runId: "calendar-run-failed" as RunId,
      result: { type: "failed" as const, error: "calendar_insert_transient status=503" },
      expectedError: "calendar_insert_transient status=503",
    },
    {
      runId: "calendar-run-canceled" as RunId,
      result: { type: "canceled" as const },
      expectedError: "canceled",
    },
  ])("$result.type run resolves its plan by calendarRunId", async ({
    runId,
    result,
    expectedError,
  }) => {
    const t = harness();
    const planId = await seedCalendarPlan(t, { calendarRunId: runId });

    await t.mutation(internal.calendarComplete.onCreateComplete, { runId, result });

    const rows = await t.run((ctx) => ctx.db.query("deadLetters").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: TENANT,
      correlationId: "",
      workflowId: runId,
      error: expectedError,
      status: "new",
    });
    const payload = rows[0]?.payload as Record<string, unknown> | undefined;
    expect(payload?.planId).toBe(planId);
  });
});

describe("calendar tenant isolation (SC#3)", () => {
  test("two tenants approve the same staged event and both write without crossing rows", async () => {
    const t = harness();
    const tenantA = "calendar-isolation-a";
    const tenantB = "calendar-isolation-b";
    const planA = await seedCalendarPlan(t, { tenantId: tenantA, status: "proposed" });
    const planB = await seedCalendarPlan(t, { tenantId: tenantB, status: "proposed" });
    await t.mutation(internal.smoke.seedCalendarFixture, { tenantId: tenantA, baseMs: BASE_MS });
    await t.mutation(internal.smoke.seedCalendarFixture, {
      tenantId: tenantB,
      baseMs: BASE_MS + 60_000,
    });
    await t.action(internal.calendar.freeBusy, { ...freeBusyArgs, tenantId: tenantA });
    await t.action(internal.calendar.freeBusy, { ...freeBusyArgs, tenantId: tenantB });
    const fetchMock = vi.fn(() => {
      throw new Error("the no-token retrier path must not call Google");
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await t
        .withIdentity({ subject: tenantA })
        .mutation(api.cockpit.executePlan, { planId: planA }),
    ).toEqual({ ok: true });
    expect(
      await t
        .withIdentity({ subject: tenantB })
        .mutation(api.cockpit.executePlan, { planId: planB }),
    ).toEqual({ ok: true });
    await t.finishInProgressScheduledFunctions();

    expect(fetchMock).not.toHaveBeenCalled();
    const plans = await t.run((ctx) => ctx.db.query("plans").collect());
    const audits = await t.run((ctx) => ctx.db.query("audit").collect());
    const aPlans = plans.filter((row) => row.tenantId === tenantA);
    const bPlans = plans.filter((row) => row.tenantId === tenantB);
    const aAudits = audits.filter((row) => row.tenantId === tenantA);
    const bAudits = audits.filter((row) => row.tenantId === tenantB);
    expect(
      aPlans.length,
      "tenant A wrote no plan rows — the isolation check is vacuous",
    ).toBeGreaterThan(0);
    expect(
      bPlans.length,
      "tenant B wrote no plan rows — the isolation check is vacuous",
    ).toBeGreaterThan(0);
    expect(
      aAudits.length,
      "tenant A wrote no audit rows — the isolation check is vacuous",
    ).toBeGreaterThan(0);
    expect(
      bAudits.length,
      "tenant B wrote no audit rows — the isolation check is vacuous",
    ).toBeGreaterThan(0);
    expect(aPlans.every((row) => row.tenantId === tenantA)).toBe(true);
    expect(bPlans.every((row) => row.tenantId === tenantB)).toBe(true);
    expect(aAudits.every((row) => row.tenantId === tenantA)).toBe(true);
    expect(bAudits.every((row) => row.tenantId === tenantB)).toBe(true);
    expect(aPlans[0]).toMatchObject({
      status: "delivering",
      eventTitle: SECRET_TITLE,
      eventStartMs: EVENT_START_MS,
      eventDurationMs: EVENT_DURATION_MS,
      calendarRunId: expect.any(String),
    });
    expect(bPlans[0]).toMatchObject({
      status: "delivering",
      eventTitle: SECRET_TITLE,
      eventStartMs: EVENT_START_MS,
      eventDurationMs: EVENT_DURATION_MS,
      calendarRunId: expect.any(String),
    });
    expect(await t.run((ctx) => ctx.db.query("deadLetters").collect())).toEqual([]);
  });

  test("each tenant can read its own plan by thread and never the other tenant's", async () => {
    const t = harness();
    const tenantA = "calendar-reader-a";
    const tenantB = "calendar-reader-b";
    const planA = await seedCalendarPlan(t, { tenantId: tenantA, status: "proposed" });
    const planB = await seedCalendarPlan(t, { tenantId: tenantB, status: "proposed" });
    const threadA = `calendar-thread-${tenantA}`;
    const threadB = `calendar-thread-${tenantB}`;

    expect(
      await t.withIdentity({ subject: tenantA }).query(api.plans.byThread, { threadId: threadA }),
    ).toMatchObject({ _id: planA, tenantId: tenantA });
    expect(
      await t.withIdentity({ subject: tenantB }).query(api.plans.byThread, { threadId: threadB }),
    ).toMatchObject({ _id: planB, tenantId: tenantB });
    expect(
      await t.withIdentity({ subject: tenantA }).query(api.plans.byThread, { threadId: threadB }),
    ).toBeNull();
    expect(
      await t.withIdentity({ subject: tenantB }).query(api.plans.byThread, { threadId: threadA }),
    ).toBeNull();
  });

  test("createEvent rejects tenant A with tenant B's plan before token or network work", async () => {
    const t = harness();
    const planId = await seedCalendarPlan(t, { tenantId: "calendar-owner-b" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await t.action(internal.calendar.createEvent, {
        planId,
        tenantId: "calendar-caller-a",
        correlationId: "cross-tenant-create",
      }),
    ).toMatchObject({ outcome: "terminal", status: 0, reason: "tenant_mismatch" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("deadLetters").collect())).toEqual([]);
  });

  test("freeBusy returns each tenant's distinct fixture blocks and never the other's", async () => {
    const t = harness();
    const tenantA = "calendar-fixture-a";
    const tenantB = "calendar-fixture-b";
    await t.mutation(internal.smoke.seedCalendarFixture, { tenantId: tenantA, baseMs: BASE_MS });
    await t.mutation(internal.smoke.seedCalendarFixture, {
      tenantId: tenantB,
      baseMs: BASE_MS + 60_000,
    });

    const resultA = await t.action(internal.calendar.freeBusy, {
      ...freeBusyArgs,
      tenantId: tenantA,
    });
    const resultB = await t.action(internal.calendar.freeBusy, {
      ...freeBusyArgs,
      tenantId: tenantB,
    });

    expect(resultA).toMatchObject({ ok: true, fixture: true });
    expect(resultB).toMatchObject({ ok: true, fixture: true });
    if (!resultA.ok || !resultB.ok) throw new Error("fixture reads unexpectedly failed");
    expect(resultA.busy[0]?.startMs).toBe(BASE_MS + 3_600_000);
    expect(resultB.busy[0]?.startMs).toBe(BASE_MS + 60_000 + 3_600_000);
    expect(resultA.busy).not.toEqual(resultB.busy);
  });

  test("onCreateComplete resolves tenant A's run id and ignores an unowned run id", async () => {
    const t = harness();
    const tenantA = "calendar-run-owner-a";
    const runA = "calendar-isolation-run-a" as RunId;
    const planA = await seedCalendarPlan(t, { tenantId: tenantA, calendarRunId: runA });

    await t.mutation(internal.calendarComplete.onCreateComplete, {
      runId: runA,
      result: { type: "failed", error: "calendar_insert_transient status=503" },
    });
    await t.mutation(internal.calendarComplete.onCreateComplete, {
      runId: "calendar-isolation-run-unowned" as RunId,
      result: { type: "failed", error: "must-not-write" },
    });

    const rows = await t.run((ctx) => ctx.db.query("deadLetters").collect());
    expect(
      rows.length,
      "tenant A's run wrote no terminal row — the lookup check is vacuous",
    ).toBeGreaterThan(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: tenantA,
      workflowId: runA,
      payload: { planId: planA, runId: runA },
    });
  });
});

// ── The durable managed-event registry (17-05, the ACTN-02 G2 substrate) ─────────────────────
//
// 17-05 adds NO provider call. What it adds is the table 17-08's create landing and 17-09's
// read-only listing will use, and the only thing worth asserting today is the property that
// makes those two safe: the composite identity lookup is TENANT-FIRST, so one tenant's
// managed-event id can never resolve to another tenant's row.
//
// Two tenants holding the SAME provider event id is not a contrived case — a shared calendar, a
// restored backup, or (as here) a seeded fixture all produce it, and it is exactly the input an
// index without `tenantId` would get wrong.
describe("calendarEvents registry (17-05 — tenant-scoped identity, reset-proof)", () => {
  const TENANT_A = "tenant_registry_a";
  const TENANT_B = "tenant_registry_b";
  const SHARED_EXTERNAL_ID = "0123456789abc"; // base32hex, the eventIdFor grammar

  async function seedRow(
    t: ReturnType<typeof harness>,
    tenantId: string,
    overrides: Partial<{
      provider: "google" | "microsoft";
      externalEventId: string;
      etag: string | undefined;
      title: string;
      status: "active" | "deleted";
      attendeeFree: boolean;
    }> = {},
  ) {
    return t.run(async (ctx) => {
      const sourcePlanId = await ctx.db.insert("plans", {
        tenantId,
        threadId: `registry_thread_${crypto.randomUUID()}`,
        kind: "calendar_event" as const,
        status: "done" as const,
        createdAt: BASE_MS,
      });
      return ctx.db.insert("calendarEvents", {
        tenantId,
        provider: overrides.provider ?? "google",
        externalEventId: overrides.externalEventId ?? SHARED_EXTERNAL_ID,
        etag: "etag" in overrides ? overrides.etag : 'W/"1"',
        title: overrides.title ?? `${tenantId} planning review`,
        startMs: BASE_MS + 3_600_000,
        durationMs: 30 * 60_000,
        tz: "Africa/Dar_es_Salaam",
        sourcePlanId,
        attendeeFree: overrides.attendeeFree ?? true,
        status: overrides.status ?? "active",
        createdAt: BASE_MS,
        updatedAt: BASE_MS,
      });
    });
  }

  /** THE composite lookup, exactly as 17-08/17-09 must perform it. */
  const lookup = (
    t: ReturnType<typeof harness>,
    tenantId: string,
    provider: "google" | "microsoft",
    externalEventId: string,
  ) =>
    t.run((ctx) =>
      ctx.db
        .query("calendarEvents")
        .withIndex("by_tenant_provider_external", (q) =>
          q
            .eq("tenantId", tenantId)
            .eq("provider", provider)
            .eq("externalEventId", externalEventId),
        )
        .unique(),
    );

  // Named mutation that turns this RED: drop `tenantId` from the `by_tenant_provider_external`
  // index in schema.ts (and the matching `.eq("tenantId", …)` above — a Convex index query must
  // eq its prefix in order, so the two are one edit). The lookup then matches BOTH rows and
  // `.unique()` throws.
  test("two tenants may hold the SAME provider event id and neither lookup crosses", async () => {
    const t = harness();
    const a = await seedRow(t, TENANT_A);
    const b = await seedRow(t, TENANT_B);

    // Anti-vacuity floor: both sides really wrote a row, and they really share the identity that
    // a tenant-less index would collide on.
    expect(a).not.toBe(b);
    expect(await t.run((ctx) => ctx.db.query("calendarEvents").collect())).toHaveLength(2);

    const foundA = await lookup(t, TENANT_A, "google", SHARED_EXTERNAL_ID);
    const foundB = await lookup(t, TENANT_B, "google", SHARED_EXTERNAL_ID);
    expect(foundA?._id).toBe(a);
    expect(foundB?._id).toBe(b);
    expect(foundA?.tenantId).toBe(TENANT_A);
    expect(foundB?.tenantId).toBe(TENANT_B);
    expect(foundA?.title).not.toBe(foundB?.title);
  });

  // The provider is part of the identity too: Google and Graph mint ids in different grammars,
  // but nothing stops them colliding, and an update aimed at one must not resolve to the other.
  test("the same tenant may hold the same id on BOTH providers without collision", async () => {
    const t = harness();
    const google = await seedRow(t, TENANT_A, { provider: "google" });
    const microsoft = await seedRow(t, TENANT_A, { provider: "microsoft" });

    expect((await lookup(t, TENANT_A, "google", SHARED_EXTERNAL_ID))?._id).toBe(google);
    expect((await lookup(t, TENANT_A, "microsoft", SHARED_EXTERNAL_ID))?._id).toBe(microsoft);
  });

  // The listing index 17-09 reads. Tenant-scoped and status-scoped, so a deleted event never
  // appears in "what can I change?" and a foreign tenant's events never appear at all.
  test("by_tenant_status lists only THIS tenant's active rows", async () => {
    const t = harness();
    await seedRow(t, TENANT_A, { externalEventId: "aaaaaaaaaaaa1" });
    await seedRow(t, TENANT_A, { externalEventId: "aaaaaaaaaaaa2", status: "deleted" });
    await seedRow(t, TENANT_B, { externalEventId: "bbbbbbbbbbbb1" });

    const active = await t.run((ctx) =>
      ctx.db
        .query("calendarEvents")
        .withIndex("by_tenant_status", (q) => q.eq("tenantId", TENANT_A).eq("status", "active"))
        .collect(),
    );

    expect(active).toHaveLength(1);
    expect(active[0]?.externalEventId).toBe("aaaaaaaaaaaa1");
    // Anti-vacuity floor: the other two rows exist, they are simply not in this tenant's window.
    expect(await t.run((ctx) => ctx.db.query("calendarEvents").collect())).toHaveLength(3);
  });

  // The manageability gate is pure (@pikar/core) and unit-tested there; what this proves is that
  // the SCHEMA can actually hold each of the three refusable shapes — an etag-less legacy row, an
  // attendee-bearing row and a deleted row — so 17-08/17-09 have something real to refuse.
  test("the registry can store every shape `manageability` refuses", async () => {
    const t = harness();
    const legacy = await seedRow(t, TENANT_A, { externalEventId: "l1", etag: undefined });
    const guests = await seedRow(t, TENANT_A, { externalEventId: "g1", attendeeFree: false });
    const gone = await seedRow(t, TENANT_A, { externalEventId: "d1", status: "deleted" });

    expect((await t.run((ctx) => ctx.db.get(legacy)))?.etag).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(guests)))?.attendeeFree).toBe(false);
    expect((await t.run((ctx) => ctx.db.get(gone)))?.status).toBe("deleted");
  });
});

// ── 17-08 Task 2: manageEvent — one decision tree, two providers ───────────────────────────────
//
// The assertions that matter most here are about what was NOT sent: no request at all on a refusal,
// no PATCH when the provider already holds the desired state, no `sendUpdates`, no `attendees`, and
// — the ADR-023 pin — no Graph request of any kind for a Microsoft cancel.
describe("manageEvent — conditional, attendee-free, provider-neutral management", () => {
  const MANAGE_TENANT = "tenant_manage";
  const OTHER_TENANT = "tenant_manage_other";
  const APPROVED_ETAG = 'W/"approved-v1"';
  const MANAGE_DEPLOYMENT = "https://manage-deployment.convex.cloud";

  /** The committed 17-07 measurement, re-bound to this run's deployment and tenant. The two
   *  `staleDelete*` fields are carried verbatim so the fixture cannot drift into an optimistic one
   *  — and they still unlock nothing, which is the point. */
  async function manageProbeEnv(tenantId: string) {
    return JSON.stringify({
      schema: "phase17-graph-concurrency-probe.v1",
      deploymentUrlHash: await contentHash(MANAGE_DEPLOYMENT),
      accountIdHash: await contentHash(tenantId),
      stalePatchStatus: 412,
      stalePatchPreserved: true,
      staleDeleteStatus: 204,
      staleDeletePreserved: false,
      supported: false,
    });
  }
  const NEW_TITLE = "Moved offsite";
  const NEW_START_MS = BASE_MS + 259_200_000;

  async function seedManaged(
    t: ReturnType<typeof harness>,
    over: Partial<{
      tenantId: string;
      provider: "google" | "microsoft";
      etag: string | undefined;
      status: "active" | "deleted";
      attendeeFree: boolean;
      externalEventId: string;
    }> = {},
  ) {
    const tenantId = over.tenantId ?? MANAGE_TENANT;
    return t.run(async (ctx) => {
      const sourcePlanId = await ctx.db.insert("plans", {
        tenantId,
        threadId: `manage_src_${crypto.randomUUID()}`,
        kind: "calendar_event" as const,
        status: "done" as const,
        createdAt: BASE_MS,
      });
      return ctx.db.insert("calendarEvents", {
        tenantId,
        provider: over.provider ?? "google",
        externalEventId: over.externalEventId ?? "managed-event-1",
        ...("etag" in over
          ? over.etag === undefined
            ? {}
            : { etag: over.etag }
          : { etag: APPROVED_ETAG }),
        title: SECRET_TITLE,
        startMs: EVENT_START_MS,
        durationMs: EVENT_DURATION_MS,
        tz: "Africa/Dar_es_Salaam",
        sourcePlanId,
        attendeeFree: over.attendeeFree ?? true,
        status: over.status ?? "active",
        createdAt: BASE_MS,
        updatedAt: BASE_MS,
      });
    });
  }

  async function seedManagePlan(
    t: ReturnType<typeof harness>,
    managedEventId: Awaited<ReturnType<typeof seedManaged>> | undefined,
    over: Partial<{
      tenantId: string;
      status: PlanStatus;
      kind: "calendar_manage" | "calendar_event";
      operation: "update" | "delete" | undefined;
      expectedEtag: string | undefined;
      provider: "google" | "microsoft";
      eventTitle: string;
      eventStartMs: number;
    }> = {},
  ) {
    const tenantId = over.tenantId ?? MANAGE_TENANT;
    return t.run((ctx) =>
      ctx.db.insert("plans", {
        tenantId,
        threadId: `manage_thread_${tenantId}`,
        kind: over.kind ?? ("calendar_manage" as const),
        status: over.status ?? ("delivering" as const),
        ...(managedEventId ? { calendarManagedEventId: managedEventId } : {}),
        ...("operation" in over
          ? over.operation === undefined
            ? {}
            : { calendarOperation: over.operation }
          : { calendarOperation: "update" as const }),
        ...("expectedEtag" in over
          ? over.expectedEtag === undefined
            ? {}
            : { calendarExpectedEtag: over.expectedEtag }
          : { calendarExpectedEtag: APPROVED_ETAG }),
        ...(over.provider ? { calendarProvider: over.provider } : {}),
        ...(over.eventTitle === undefined ? {} : { eventTitle: over.eventTitle }),
        ...(over.eventStartMs === undefined ? {} : { eventStartMs: over.eventStartMs }),
        createdAt: BASE_MS,
      }),
    );
  }

  const run = (
    t: ReturnType<typeof harness>,
    planId: Awaited<ReturnType<typeof seedManagePlan>>,
    tenantId = MANAGE_TENANT,
  ) => t.action(internal.calendar.manageEvent, { planId, tenantId, correlationId: "manage-c" });

  /** Google always refreshes first (`freshAccessToken`), so the token response leads every queue. */
  function googleFetch(...responses: Response[]) {
    const mock = vi.fn();
    mock.mockResolvedValueOnce(Response.json({ access_token: "a", expires_in: 3600 }));
    for (const r of responses) mock.mockResolvedValueOnce(r);
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  const eventBody = (
    over: Partial<{ etag: string; summary: string; startMs: number; attendees: unknown[] }> = {},
  ) => ({
    id: "managed-event-1",
    etag: over.etag ?? APPROVED_ETAG,
    summary: over.summary ?? SECRET_TITLE,
    start: { dateTime: new Date(over.startMs ?? EVENT_START_MS).toISOString() },
    end: {
      dateTime: new Date((over.startMs ?? EVENT_START_MS) + EVENT_DURATION_MS).toISOString(),
    },
    ...(over.attendees ? { attendees: over.attendees } : {}),
  });

  // ── Refusals that must cost NOTHING: no token, no provider round trip ───────────────────────
  test.each([
    ["a plan of the wrong kind", { kind: "calendar_event" as const }, "wrong_kind"],
    ["a plan that is no longer delivering", { status: "proposed" as const }, "not_delivering"],
  ])("%s is terminal before any network work", async (_label, over, reason) => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId, over);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await run(t, planId)).toMatchObject({ outcome: "terminal", reason });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a plan belonging to another tenant is a tenant mismatch, not a managed event", async () => {
    const t = harness();
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await run(t, planId, OTHER_TENANT)).toMatchObject({
      outcome: "terminal",
      reason: "tenant_mismatch",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // THE ISOLATION CASE. A plan in tenant A pointing at tenant B's registry row must resolve to
  // NOTHING — the `_id` alone is a global handle, and the tenant is part of the identity.
  test("a registry ref owned by another tenant resolves to nothing", async () => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const foreignRow = await seedManaged(t, { tenantId: OTHER_TENANT });
    const planId = await seedManagePlan(t, foreignRow);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await run(t, planId)).toMatchObject({ outcome: "refused", code: "not_managed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ["a deleted row", { status: "deleted" as const }, "not_found"],
    ["a row that grew guests", { attendeeFree: false }, "attendees_present"],
    ["a legacy row with no etag", { etag: undefined }, "needs_inspection"],
  ])("%s is refused from STORED FACTS, before a provider round trip", async (_l, over, code) => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t, over);
    const planId = await seedManagePlan(t, managedEventId);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await run(t, planId)).toMatchObject({ outcome: "refused", code });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("an approval staged against a version the registry has moved past is a conflict", async () => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t, { etag: 'W/"registry-v2"' });
    const planId = await seedManagePlan(t, managedEventId, { expectedEtag: APPROVED_ETAG });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await run(t, planId)).toMatchObject({ outcome: "refused", code: "conflict" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── ADR-023: the Microsoft cancel refusal ───────────────────────────────────────────────────
  test("a Microsoft DELETE is refused before any token, GET or write — no Graph request at all", async () => {
    const t = harness();
    // Both grants exist and both are irrelevant: the refusal is about the PROVIDER's semantics,
    // never about whether a token happens to be available.
    await seedCalendarGrant(t, MANAGE_TENANT);
    await t.run((ctx) =>
      ctx.db.insert("microsoftCalendarTokens", {
        tenantId: MANAGE_TENANT,
        refreshToken: "ms-refresh",
        accessToken: "ms-access",
        expiresAt: FUTURE_TOKEN_EXPIRY_MS,
        scope: "offline_access Calendars.ReadWrite",
        updatedAt: BASE_MS,
      }),
    );
    const managedEventId = await seedManaged(t, { provider: "microsoft" });
    const planId = await seedManagePlan(t, managedEventId, { operation: "delete" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await run(t, planId)).toMatchObject({
      outcome: "refused",
      code: "provider_unsupported",
    });
    // Not a no-op, not a best-effort delete, not a fallback that leaves the event live: NOTHING
    // was sent. The event on the user's calendar is untouched and the refusal is nameable.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("the SAME registry row accepts an update — the refusal is per-operation, not per-provider", async () => {
    const t = harness();
    await t.run((ctx) =>
      ctx.db.insert("microsoftCalendarTokens", {
        tenantId: MANAGE_TENANT,
        refreshToken: "ms-refresh",
        accessToken: "ms-access",
        expiresAt: FUTURE_TOKEN_EXPIRY_MS,
        scope: "offline_access Calendars.ReadWrite",
        updatedAt: BASE_MS,
      }),
    );
    vi.stubEnv("CONVEX_SITE_URL", MANAGE_DEPLOYMENT);
    vi.stubEnv("PHASE17_GRAPH_PROBE", await manageProbeEnv(MANAGE_TENANT));
    const managedEventId = await seedManaged(t, { provider: "microsoft" });
    const planId = await seedManagePlan(t, managedEventId, {
      operation: "update",
      eventTitle: NEW_TITLE,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: "managed-event-1",
          "@odata.etag": APPROVED_ETAG,
          subject: SECRET_TITLE,
          start: { dateTime: "2020-01-03T12:00:00.0000000", timeZone: "UTC" },
          end: { dateTime: "2020-01-03T13:00:00.0000000", timeZone: "UTC" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ "@odata.etag": 'W/"graph-v2"' }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await run(t, planId)).toMatchObject({
      outcome: "updated",
      provider: "microsoft",
      etag: 'W/"graph-v2"',
    });
    const hosts = fetchMock.mock.calls.map((c) => new URL(String(c[0])).host);
    expect(hosts).toEqual(["graph.microsoft.com", "graph.microsoft.com"]);
    const methods = fetchMock.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method);
    expect(methods).not.toContain("DELETE");
  });

  test("a Microsoft update on a deployment with no probe refuses and issues NO write", async () => {
    const t = harness();
    await t.run((ctx) =>
      ctx.db.insert("microsoftCalendarTokens", {
        tenantId: MANAGE_TENANT,
        refreshToken: "ms-refresh",
        accessToken: "ms-access",
        expiresAt: FUTURE_TOKEN_EXPIRY_MS,
        scope: "offline_access Calendars.ReadWrite",
        updatedAt: BASE_MS,
      }),
    );
    vi.stubEnv("PHASE17_GRAPH_PROBE", "");
    const managedEventId = await seedManaged(t, { provider: "microsoft" });
    const planId = await seedManagePlan(t, managedEventId, { eventTitle: NEW_TITLE });
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: "managed-event-1",
        "@odata.etag": APPROVED_ETAG,
        subject: SECRET_TITLE,
        start: { dateTime: "2020-01-03T12:00:00.0000000", timeZone: "UTC" },
        end: { dateTime: "2020-01-03T13:00:00.0000000", timeZone: "UTC" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await run(t, planId)).toMatchObject({
      outcome: "refused",
      code: "provider_unsupported",
    });
    const methods = fetchMock.mock.calls.map(
      (c) => (c[1] as RequestInit | undefined)?.method ?? "GET",
    );
    expect(methods).not.toContain("PATCH");
    expect(methods).not.toContain("DELETE");
  });

  // ── Google update ───────────────────────────────────────────────────────────────────────────
  test("a real change GETs narrowly, then PATCHes with the HUMAN-APPROVED If-Match", async () => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId, {
      eventTitle: NEW_TITLE,
      eventStartMs: NEW_START_MS,
    });
    // The provider has ALREADY moved on to a newer version. The conditional write must still carry
    // the version the human approved — using the freshly-read one would be a read-modify-write race
    // with the comparison moved client-side, which is exactly what ADR-023 forbids.
    const fetchMock = googleFetch(
      Response.json(eventBody({ etag: 'W/"provider-v9"' })),
      Response.json({ id: "managed-event-1", etag: 'W/"provider-v10"' }),
    );

    expect(await run(t, planId)).toMatchObject({
      outcome: "updated",
      provider: "google",
      etag: 'W/"provider-v10"',
    });

    const [getUrl, getInit] = fetchMock.mock.calls[1] as [string, RequestInit | undefined];
    expect(new URL(getUrl).searchParams.get("fields")).toBe("id,etag,summary,start,end,attendees");
    expect(getInit?.method ?? "GET").toBe("GET");

    const [patchUrl, patchInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(patchInit.method).toBe("PATCH");
    expect((patchInit.headers as Record<string, string>)["If-Match"]).toBe(APPROVED_ETAG);
    const sent = JSON.parse(patchInit.body as string);
    expect(Object.keys(sent).sort()).toEqual(["end", "start", "summary"]);
    expect(sent.summary).toBe(NEW_TITLE);
    expect(sent.start).toEqual({
      dateTime: new Date(NEW_START_MS).toISOString(),
      timeZone: "Africa/Dar_es_Salaam",
    });
    // Either of these would make Google email people outside the governed send path.
    expect(sent.attendees).toBeUndefined();
    expect(patchUrl).not.toContain("sendUpdates");
    expect(patchUrl).not.toContain("/cancel");
  });

  // EXACTLY-ONCE. The retrier lost the success response and redelivered; the provider already holds
  // the desired state, so the honest answer is success — not the false conflict a blind conditional
  // re-write would produce, because the etag moved precisely BECAUSE our earlier write landed.
  test("a retry after a lost success reconciles instead of reporting a false conflict", async () => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId, {
      eventTitle: NEW_TITLE,
      eventStartMs: NEW_START_MS,
    });
    const fetchMock = googleFetch(
      Response.json(
        eventBody({ etag: 'W/"already-v2"', summary: NEW_TITLE, startMs: NEW_START_MS }),
      ),
    );

    expect(await run(t, planId)).toMatchObject({
      outcome: "updated",
      provider: "google",
      etag: 'W/"already-v2"',
    });
    // Token + GET, and NOTHING else. A PATCH here would bump the version for no change.
    expect(fetchMock.mock.calls).toHaveLength(2);
    const methods = fetchMock.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method);
    expect(methods).not.toContain("PATCH");
  });

  test("a 412 on the conditional PATCH is a conflict, and carries no provider prose", async () => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId, { eventTitle: NEW_TITLE });
    googleFetch(
      Response.json(eventBody()),
      Response.json({ error: { message: `conflict on ${SECRET_TITLE}` } }, { status: 412 }),
    );

    const result = await run(t, planId);
    expect(result).toMatchObject({ outcome: "refused", code: "conflict" });
    expect(JSON.stringify(result)).not.toContain(SECRET_TITLE);
  });

  // The registry said attendee-free at CREATE time; the event grew guests since. The refusal has to
  // come from the LIVE read, or a stale stored boolean would authorise a write that mails people.
  test("guests added at the provider refuse the write, even though the registry says attendee-free", async () => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t, { attendeeFree: true });
    const planId = await seedManagePlan(t, managedEventId, { eventTitle: NEW_TITLE });
    const fetchMock = googleFetch(
      Response.json(
        eventBody({ attendees: [{ email: "guest@example.test", responseStatus: "accepted" }] }),
      ),
    );

    const result = await run(t, planId);
    expect(result).toMatchObject({ outcome: "refused", code: "attendees_present" });
    expect(fetchMock.mock.calls).toHaveLength(2); // token + GET; no write was attempted
    expect(JSON.stringify(result)).not.toContain("guest@example.test");
  });

  test("an event that vanished cannot be updated", async () => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId, { eventTitle: NEW_TITLE });
    googleFetch(new Response("", { status: 404 }));
    expect(await run(t, planId)).toMatchObject({ outcome: "refused", code: "not_found" });
  });

  // ── Google delete ───────────────────────────────────────────────────────────────────────────
  test("a delete sends a conditional DELETE with no body and no notification option", async () => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId, { operation: "delete" });
    // A 204 must be constructed with a NULL body — Google's real delete response has none.
    const fetchMock = googleFetch(Response.json(eventBody()), new Response(null, { status: 204 }));

    expect(await run(t, planId)).toMatchObject({
      outcome: "deleted",
      provider: "google",
      managedEventId,
    });
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe(APPROVED_ETAG);
    expect(init.body).toBeUndefined();
    expect(url).not.toContain("sendUpdates");
    // Google's `sendUpdates` and Graph's `/cancel` both EMAIL attendees on the app's behalf.
    expect(url).not.toContain("/cancel");
  });

  test("an event already gone is an idempotent delete success, with no DELETE issued", async () => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId, { operation: "delete" });
    const fetchMock = googleFetch(new Response("", { status: 404 }));

    expect(await run(t, planId)).toMatchObject({ outcome: "deleted", provider: "google" });
    expect(fetchMock.mock.calls).toHaveLength(2);
    const methods = fetchMock.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method);
    expect(methods).not.toContain("DELETE");
  });

  // THE RACE, not the replay: the event still existed at the GET and was gone by the DELETE —
  // someone cancelled it in the Calendar UI, or a second run of this same plan won. Already-gone is
  // still the desired end state, so this is success. Reported as a failure it would send the user
  // to fix something that is already exactly as they asked.
  test("an event that disappears BETWEEN the GET and the DELETE is still an idempotent success", async () => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId, { operation: "delete" });
    const fetchMock = googleFetch(Response.json(eventBody()), new Response(null, { status: 404 }));

    expect(await run(t, planId)).toMatchObject({ outcome: "deleted", provider: "google" });
    // The DELETE really was attempted — this is the race, not the pre-flight short-circuit.
    expect(fetchMock.mock.calls).toHaveLength(3);
    const [, deleteInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(deleteInit.method).toBe("DELETE");
  });

  // The mirror case for update, and the answer is the OPPOSITE: there is nothing left to move, so
  // an update must not claim success over an event that no longer exists.
  test("an event that disappears BETWEEN the GET and the PATCH is not_found, not a success", async () => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId, { eventTitle: NEW_TITLE });
    const fetchMock = googleFetch(Response.json(eventBody()), new Response(null, { status: 404 }));

    expect(await run(t, planId)).toMatchObject({ outcome: "refused", code: "not_found" });
    const [, patchInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(patchInit.method).toBe("PATCH");
  });

  test("a 412 on the conditional DELETE refuses rather than forcing", async () => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId, { operation: "delete" });
    googleFetch(Response.json(eventBody()), new Response("", { status: 412 }));
    expect(await run(t, planId)).toMatchObject({ outcome: "refused", code: "conflict" });
  });

  // ── Transport ───────────────────────────────────────────────────────────────────────────────
  test.each([429, 500, 503])("a %i THROWS so the retrier owns it", async (status) => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId, { eventTitle: NEW_TITLE });
    googleFetch(Response.json({ error: { message: SECRET_TITLE } }, { status }));
    await expect(run(t, planId)).rejects.toThrow(/calendar_manage_transient/);
  });

  test("a 401 anywhere in the flow is a reconnect, not a terminal failure", async () => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId, { eventTitle: NEW_TITLE });
    googleFetch(new Response("", { status: 401 }));
    expect(await run(t, planId)).toMatchObject({ outcome: "reauth", provider: "google" });
  });

  test("a Google grant without the Calendar scope reauths before the network", async () => {
    const t = harness();
    await t.run((ctx) =>
      ctx.db.insert("gmailTokens", {
        tenantId: MANAGE_TENANT,
        refreshToken: "r",
        accessToken: "a",
        expiresAt: FUTURE_TOKEN_EXPIRY_MS,
        scope: GMAIL_MODIFY_SCOPE, // Mail only — a refresh would succeed and the write would 403.
        updatedAt: BASE_MS,
      }),
    );
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId, { eventTitle: NEW_TITLE });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await run(t, planId)).toMatchObject({ outcome: "reauth", provider: "google" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // §4: the result crosses the retrier boundary and is stored in its run record. The event TITLE is
  // content and must never be in it — the terminal recomputes desired state from the plan instead.
  test("no successful result carries the event title", async () => {
    const t = harness();
    await seedCalendarGrant(t, MANAGE_TENANT);
    const managedEventId = await seedManaged(t);
    const planId = await seedManagePlan(t, managedEventId, { eventTitle: NEW_TITLE });
    googleFetch(
      Response.json(eventBody()),
      Response.json({ id: "managed-event-1", etag: 'W/"v2"' }),
    );

    const wire = JSON.stringify(await run(t, planId));
    expect(wire).not.toContain(SECRET_TITLE);
    expect(wire).not.toContain(NEW_TITLE);
  });
});
