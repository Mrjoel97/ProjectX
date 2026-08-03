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
      await t.withIdentity({ subject: `${userId}|session_a` }).action(api.gmailAuth.disconnectGoogle, {}),
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
      .mockResolvedValueOnce(new Response("", { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    const args = { planId, tenantId: TENANT, correlationId: "create-correlation" };
    expect(await t.action(internal.calendar.createEvent, args)).toMatchObject({
      outcome: "created",
      eventId: "provider-event-id",
      duplicate: false,
    });
    const duplicate = await t.action(internal.calendar.createEvent, args);
    expect(duplicate).toMatchObject({ outcome: "created", duplicate: true });

    expect(fetchMock).toHaveBeenCalledTimes(4);
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
      await t.withIdentity({ subject: tenantA }).mutation(api.cockpit.executePlan, { planId: planA }),
    ).toEqual({ ok: true });
    expect(
      await t.withIdentity({ subject: tenantB }).mutation(api.cockpit.executePlan, { planId: planB }),
    ).toEqual({ ok: true });
    await t.finishInProgressScheduledFunctions();

    expect(fetchMock).not.toHaveBeenCalled();
    const plans = await t.run((ctx) => ctx.db.query("plans").collect());
    const audits = await t.run((ctx) => ctx.db.query("audit").collect());
    const aPlans = plans.filter((row) => row.tenantId === tenantA);
    const bPlans = plans.filter((row) => row.tenantId === tenantB);
    const aAudits = audits.filter((row) => row.tenantId === tenantA);
    const bAudits = audits.filter((row) => row.tenantId === tenantB);
    expect(aPlans.length, "tenant A wrote no plan rows — the isolation check is vacuous").toBeGreaterThan(
      0,
    );
    expect(bPlans.length, "tenant B wrote no plan rows — the isolation check is vacuous").toBeGreaterThan(
      0,
    );
    expect(aAudits.length, "tenant A wrote no audit rows — the isolation check is vacuous").toBeGreaterThan(
      0,
    );
    expect(bAudits.length, "tenant B wrote no audit rows — the isolation check is vacuous").toBeGreaterThan(
      0,
    );
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
    expect(rows.length, "tenant A's run wrote no terminal row — the lookup check is vacuous").toBeGreaterThan(
      0,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: tenantA,
      workflowId: runA,
      payload: { planId: planA, runId: runA },
    });
  });
});
