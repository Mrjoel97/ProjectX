import { CALENDAR_EVENTS_SCOPE, CALENDAR_FREEBUSY_SCOPE, GMAIL_MODIFY_SCOPE } from "@pikar/core";
import type { RunId } from "@convex-dev/action-retrier";
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

async function seedCalendarPlan(
  t: ReturnType<typeof harness>,
  options: {
    tenantId?: string;
    status?: PlanStatus;
    missing?: EventField;
    calendarRunId?: RunId;
  } = {},
) {
  const eventFields: Partial<Record<EventField, string | number>> = {
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

  test.each(["collecting", "proposed"] as const)(
    "a %s plan ignores a stale success terminal and writes nothing",
    async (status) => {
      const t = harness();
      const planId = await seedCalendarPlan(t, { status });
      await completeSuccess(t, `calendar-run-${status}` as RunId, createdReturn(planId));

      expect(await t.run((ctx) => ctx.db.get(planId))).toMatchObject({
        status,
        calendarEventId: undefined,
      });
      expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
      expect(await t.run((ctx) => ctx.db.query("deadLetters").collect())).toEqual([]);
      expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toEqual([]);
    },
  );

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
      .mockResolvedValueOnce(Response.json({ id: "provider-event-id" }))
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

    const requestBodies = fetchMock.mock.calls.map((call) =>
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
      vi.fn().mockResolvedValue(
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
    expect(result).toMatchObject({ outcome: "terminal", status: 400, reason: "invalid" });
    await completeSuccess(t, "calendar-run-terminal" as RunId, result);

    const deadLetters = await t.run((ctx) => ctx.db.query("deadLetters").collect());
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.error).toBe("calendar_insert 400 invalid");
    expect(deadLetters[0]?.payload).toEqual({ planId, status: 400 });
    const audit = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(audit.filter((row) => row.eventType === "deadletter.written")).toHaveLength(1);
    expect(JSON.stringify({ deadLetters, audit })).not.toContain(SECRET_TITLE);
  });

  test("503 throws a refs-only transient error so the retrier retries", async () => {
    const t = harness();
    const planId = await seedCalendarPlan(t);
    await seedCalendarGrant(t);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(`provider echoed ${SECRET_TITLE}`, { status: 503 })),
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
      vi.fn().mockResolvedValue(
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
  ])("$result.type run resolves its plan by calendarRunId", async ({ runId, result, expectedError }) => {
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
    expect((rows[0]?.payload as Record<string, unknown>).planId).toBe(planId);
  });
});
