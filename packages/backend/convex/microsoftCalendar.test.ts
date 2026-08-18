// The Microsoft Graph Calendar adapter (17-07 Tasks 1-2, ACTN-02).
//
// Most assertions here are on the REQUEST, not the response. A stub answers with whatever it was
// told to answer, so asserting on the result cannot see a QUERY that changed — the rule vault.md
// records after a mutation walked straight through a response-shaped test. The content firewall
// ($select) and the idempotency key live in the request, so that is where they are pinned.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { internal } from "./_generated/api";
import { contentHash } from "./lib/hash";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_ms_cal";
const NOW = 1_777_000_000_000;
const HOUR = 3_600_000;

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

async function seedToken(
  t: ReturnType<typeof harness>,
  over: Partial<{ accessToken: string; expiresAt: number; refreshToken: string }> = {},
) {
  await t.run((ctx) =>
    ctx.db.insert("microsoftCalendarTokens", {
      tenantId: TENANT,
      refreshToken: over.refreshToken ?? "stored-refresh",
      accessToken: over.accessToken ?? "cached-access",
      expiresAt: over.expiresAt ?? NOW + 10 * HOUR,
      scope: "offline_access Calendars.ReadWrite Mail.Send Mail.Read",
      updatedAt: NOW,
    }),
  );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * A mock that builds a FRESH Response per call.
 *
 * `mockResolvedValue(json(...))` hands back the SAME Response every time and a body can only be
 * read once — the second page then fails to parse and the adapter correctly reports `unavailable`,
 * which looks exactly like a code bug. Measured while writing the page-cap test.
 */
const always = (body: unknown, status = 200) =>
  vi.fn().mockImplementation(() => Promise.resolve(json(body, status)));

/** A real `plans` row — the action takes `v.id("plans")`, so a string literal is rejected. */
async function seedPlan(t: ReturnType<typeof harness>) {
  return t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId: TENANT,
      threadId: "thread_ms_cal",
      status: "approved",
      createdAt: NOW,
    }),
  );
}

const freeBusyArgs = {
  tenantId: TENANT,
  correlationId: "ms-cal-correlation",
  range: "today",
  tz: "Europe/London",
  nowMs: NOW,
};

beforeEach(() => {
  vi.stubEnv("MICROSOFT_OAUTH_CLIENT_ID", "ms-id");
  vi.stubEnv("MICROSOFT_OAUTH_CLIENT_SECRET", "ms-secret");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("freshGraphToken — the cached-token skip and the ROTATION Google does not have", () => {
  test("a still-valid access token skips the refresh entirely", async () => {
    const t = harness();
    await seedToken(t, { expiresAt: NOW + 10 * HOUR });
    const fetchMock = always({ value: [] });
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.microsoftCalendar.freeBusy, freeBusyArgs);

    // Exactly one call, and it is the calendarView — no token round-trip.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/me/calendarView");
  });

  test("an expired token refreshes first, then reads", async () => {
    const t = harness();
    await seedToken(t, { expiresAt: NOW - HOUR });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "fresh-access", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ value: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.microsoftCalendar.freeBusy, freeBusyArgs);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    );
    const body = new URLSearchParams(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("stored-refresh");
    // The freshly-minted token is what the read carries.
    expect(fetchMock.mock.calls[1]?.[1]?.headers?.Authorization).toBe("Bearer fresh-access");
  });

  // THE PROVIDER DIFFERENCE. Dropping a rotated token leaves the stored one dead and the connection
  // unrecoverable without re-consent.
  test("a ROTATED refresh token replaces the stored one", async () => {
    const t = harness();
    await seedToken(t, { expiresAt: NOW - HOUR });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          json({ access_token: "a", expires_in: 3600, refresh_token: "rotated-refresh" }),
        )
        .mockResolvedValueOnce(json({ value: [] })),
    );

    await t.action(internal.microsoftCalendar.freeBusy, freeBusyArgs);

    const row = await t.run((ctx) => ctx.db.query("microsoftCalendarTokens").unique());
    expect(row?.refreshToken).toBe("rotated-refresh");
    expect(row?.accessToken).toBe("a");
  });

  test("an OMITTED refresh token keeps the stored one", async () => {
    const t = harness();
    await seedToken(t, { expiresAt: NOW - HOUR });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ access_token: "a", expires_in: 3600 }))
        .mockResolvedValueOnce(json({ value: [] })),
    );

    await t.action(internal.microsoftCalendar.freeBusy, freeBusyArgs);

    const row = await t.run((ctx) => ctx.db.query("microsoftCalendarTokens").unique());
    expect(row?.refreshToken).toBe("stored-refresh");
  });

  test("no grant is not_connected, and nothing goes out", async () => {
    const t = harness();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await t.action(internal.microsoftCalendar.freeBusy, freeBusyArgs)).toEqual({
      ok: false,
      reason: "not_connected",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  });

  test.each([
    [400, "reauth"],
    [401, "reauth"],
    [429, "transient"],
    [503, "transient"],
  ])("a %i from the token endpoint maps to %s", async (status, reason) => {
    const t = harness();
    await seedToken(t, { expiresAt: NOW - HOUR });
    vi.stubGlobal("fetch", always({}, status));
    expect(await t.action(internal.microsoftCalendar.freeBusy, freeBusyArgs)).toEqual({
      ok: false,
      reason,
    });
  });
});

describe("freeBusy — the content firewall lives in the REQUEST", () => {
  async function callWith(events: unknown[], extra: Record<string, unknown> = {}) {
    const t = harness();
    await seedToken(t);
    const fetchMock = always({ value: events, ...extra });
    vi.stubGlobal("fetch", fetchMock);
    const result = await t.action(internal.microsoftCalendar.freeBusy, freeBusyArgs);
    return { t, fetchMock, result };
  }

  test("asks for start,end,showAs ONLY — never subject, body, location, organizer or attendees", async () => {
    const { fetchMock } = await callWith([]);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://graph.microsoft.com/v1.0/me/calendarView");
    expect(url.searchParams.get("$select")).toBe("start,end,showAs");
    const whole = url.toString();
    for (const forbidden of ["subject", "body", "location", "organizer", "attendees"]) {
      expect(whole).not.toContain(forbidden);
    }
  });

  test("uses calendarView, NOT getSchedule — getSchedule is unsupported for personal accounts", async () => {
    const { fetchMock } = await callWith([]);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("getSchedule");
  });

  test("asks Graph to speak UTC so no offset has to be guessed", async () => {
    const { fetchMock } = await callWith([]);
    expect(fetchMock.mock.calls[0]?.[1]?.headers?.Prefer).toBe('outlook.timezone="UTC"');
  });

  test("returns only busy ranges as epoch ms, and no other property survives", async () => {
    const { result } = await callWith([
      {
        start: { dateTime: "2026-04-24T09:00:00.0000000", timeZone: "UTC" },
        end: { dateTime: "2026-04-24T10:00:00.0000000", timeZone: "UTC" },
        showAs: "busy",
        subject: "SECRET BOARD REVIEW",
        location: { displayName: "Room 1" },
      },
    ]);
    expect(result).toEqual({
      ok: true,
      truncated: false,
      busy: [
        { startMs: Date.parse("2026-04-24T09:00:00Z"), endMs: Date.parse("2026-04-24T10:00:00Z") },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("SECRET BOARD REVIEW");
    expect(JSON.stringify(result)).not.toContain("Room 1");
  });

  // A bare `2026-04-24T09:00:00.0000000` is parsed as LOCAL time by the runtime, which would shift
  // every block by the server's offset. The adapter appends the Z itself.
  test("a zone-less dateTime is read as UTC, not as server-local time", async () => {
    const { result } = await callWith([
      {
        start: { dateTime: "2026-04-24T09:00:00.0000000", timeZone: "UTC" },
        end: { dateTime: "2026-04-24T09:30:00.0000000", timeZone: "UTC" },
        showAs: "tentative",
      },
    ]);
    expect(result).toMatchObject({
      busy: [{ startMs: Date.parse("2026-04-24T09:00:00Z") }],
    });
  });

  test("showAs free is NOT busy — a transparent event leaves the slot open", async () => {
    const { result } = await callWith([
      {
        start: { dateTime: "2026-04-24T09:00:00", timeZone: "UTC" },
        end: { dateTime: "2026-04-24T10:00:00", timeZone: "UTC" },
        showAs: "free",
      },
    ]);
    expect(result).toMatchObject({ ok: true, busy: [] });
  });

  test("a malformed or non-UTC instant is DROPPED, never guessed", async () => {
    const { result } = await callWith([
      {
        start: { dateTime: "not-a-date", timeZone: "UTC" },
        end: { dateTime: "x", timeZone: "UTC" },
        showAs: "busy",
      },
      {
        start: { dateTime: "2026-04-24T09:00:00", timeZone: "Pacific Standard Time" },
        end: { dateTime: "2026-04-24T10:00:00", timeZone: "Pacific Standard Time" },
        showAs: "busy",
      },
      { end: { dateTime: "2026-04-24T10:00:00", timeZone: "UTC" }, showAs: "busy" },
    ]);
    expect(result).toMatchObject({ ok: true, busy: [] });
  });

  test("the audit row is refs and counts only", async () => {
    const { t } = await callWith([
      {
        start: { dateTime: "2026-04-24T09:00:00", timeZone: "UTC" },
        end: { dateTime: "2026-04-24T10:00:00", timeZone: "UTC" },
        showAs: "busy",
        subject: "SECRET BOARD REVIEW",
      },
    ]);
    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]?.payload as object).sort()).toEqual([
      "busyCount",
      "provider",
      "range",
      "truncated",
    ]);
    expect(JSON.stringify(rows[0])).not.toContain("SECRET BOARD REVIEW");
    expect(JSON.stringify(rows[0])).not.toContain("cached-access");
  });

  test("no audit row is written when the read failed", async () => {
    const t = harness();
    await seedToken(t);
    vi.stubGlobal("fetch", always({}, 500));
    expect(await t.action(internal.microsoftCalendar.freeBusy, freeBusyArgs)).toEqual({
      ok: false,
      reason: "transient",
    });
    expect(await t.run((ctx) => ctx.db.query("audit").collect())).toEqual([]);
  });
});

describe("pagination — a provider-supplied URL carries our bearer token", () => {
  test("follows a valid graph.microsoft.com/v1.0 next link", async () => {
    const t = harness();
    await seedToken(t);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          value: [
            {
              start: { dateTime: "2026-04-24T09:00:00", timeZone: "UTC" },
              end: { dateTime: "2026-04-24T10:00:00", timeZone: "UTC" },
              showAs: "busy",
            },
          ],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skip=100",
        }),
      )
      .mockResolvedValueOnce(
        json({
          value: [
            {
              start: { dateTime: "2026-04-24T11:00:00", timeZone: "UTC" },
              end: { dateTime: "2026-04-24T12:00:00", timeZone: "UTC" },
              showAs: "busy",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(internal.microsoftCalendar.freeBusy, freeBusyArgs);
    expect(result).toMatchObject({ ok: true, truncated: false });
    expect((result as { busy: unknown[] }).busy).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // AN UNVALIDATED NEXT LINK IS A CREDENTIAL-EXFILTRATION PRIMITIVE: this code puts a bearer token
  // on whatever URL the provider names. Each of these must stop the walk instead of being followed.
  test.each([
    ["https://evil.test/v1.0/me/calendarView", "foreign origin"],
    ["http://graph.microsoft.com/v1.0/me/calendarView", "plain http"],
    ["https://graph.microsoft.com.evil.test/v1.0/x", "suffix-attached lookalike"],
    ["https://graph.microsoft.com/beta/me/calendarView", "non-v1.0 path"],
    ["/v1.0/me/calendarView?$skip=100", "relative"],
    ["javascript:alert(1)", "non-http scheme"],
  ])("refuses to follow %s (%s), and the token never leaves", async (link) => {
    const t = harness();
    await seedToken(t);
    const fetchMock = always({ value: [], "@odata.nextLink": link });
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.microsoftCalendar.freeBusy, freeBusyArgs);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "graph.microsoft.com/v1.0/me/calendarView",
    );
  });

  test("stops at the page cap and says so rather than paging forever", async () => {
    const t = harness();
    await seedToken(t);
    // Always returns another next link — an infinite calendar.
    vi.stubGlobal(
      "fetch",
      always({
        value: [],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skip=1",
      }),
    );

    const result = await t.action(internal.microsoftCalendar.freeBusy, freeBusyArgs);
    expect(result).toMatchObject({ ok: true, truncated: true });
    const rows = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(rows).toHaveLength(1);
    expect((rows[0]?.payload as { truncated?: boolean } | undefined)?.truncated).toBe(true);
  });
});

// The probe touches a REAL calendar, so its refusal is the safety property — the one thing about
// it that can be proven offline. Its actual 412 behaviour can only be measured against a live
// disposable account (that is the entire point of the probe).
describe("graphConcurrencyProbe — the gate, not the probe", () => {
  test.each([
    undefined,
    "",
    "false",
    "TRUE",
    "1",
    "yes",
  ])("refuses and touches nothing when the flag is %j", async (flag) => {
    const t = harness();
    await seedToken(t);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    if (flag === undefined) vi.stubEnv("PHASE17_ALLOW_DISPOSABLE_GRAPH_PROBE", "");
    else vi.stubEnv("PHASE17_ALLOW_DISPOSABLE_GRAPH_PROBE", flag);

    await expect(
      t.action(internal.microsoftCalendar.graphConcurrencyProbe, { tenantId: TENANT }),
    ).rejects.toThrow(/refused/i);
    // The refusal happens BEFORE the token is read and before anything reaches the network —
    // a probe that authenticated first would already have touched the account.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Exact-string gating: "TRUE" and "1" above must NOT open it, so the flag cannot be tripped by a
  // truthy-looking value someone set for a different purpose.
  test("only the exact string 'true' passes the gate", async () => {
    const t = harness();
    vi.stubEnv("PHASE17_ALLOW_DISPOSABLE_GRAPH_PROBE", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // No grant seeded, so it gets PAST the gate and fails on the token instead — which is how we
    // know the gate opened rather than the call being refused for the same reason as above.
    await expect(
      t.action(internal.microsoftCalendar.graphConcurrencyProbe, { tenantId: TENANT }),
    ).rejects.toThrow(/no usable grant/i);
  });
});

describe("createEvent — subject and UTC times ONLY, with a retry-safe key", () => {
  async function create(body: unknown, status: number) {
    const t = harness();
    await seedToken(t);
    const planId = await seedPlan(t);
    const fetchMock = always(body, status);
    vi.stubGlobal("fetch", fetchMock);
    const result = await t.action(internal.microsoftCalendar.createEvent, {
      planId,
      tenantId: TENANT,
      correlationId: "c",
      subject: "Quarterly review",
      startMs: Date.parse("2026-04-24T09:00:00Z"),
      endMs: Date.parse("2026-04-24T10:00:00Z"),
      nowMs: NOW,
    });
    return { fetchMock, result };
  }

  test("posts subject and UTC start/end, and nothing that could mail anyone", async () => {
    const t = harness();
    await seedToken(t);
    const planId = await seedPlan(t);
    const fetchMock = always({ id: "AAMk", "@odata.etag": 'W/"1"' }, 201);
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.microsoftCalendar.createEvent, {
      planId,
      tenantId: TENANT,
      correlationId: "c",
      subject: "Quarterly review",
      startMs: Date.parse("2026-04-24T09:00:00Z"),
      endMs: Date.parse("2026-04-24T10:00:00Z"),
      nowMs: NOW,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/calendar/events");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body as string);
    expect(Object.keys(sent).sort()).toEqual(["end", "start", "subject", "transactionId"]);
    expect(sent.start).toEqual({ dateTime: "2026-04-24T09:00:00.000Z", timeZone: "UTC" });
    // An attendees array would turn an approved plan into an INVITATION that mails people,
    // routing around the send path and its suppression checks entirely.
    expect(sent.attendees).toBeUndefined();
    expect(sent.body).toBeUndefined();
    expect(sent.location).toBeUndefined();
    expect(sent.isOnlineMeeting).toBeUndefined();
  });

  test("the transactionId is deterministic for the plan, so a retry cannot duplicate", async () => {
    const t = harness();
    await seedToken(t);
    const planId = await seedPlan(t);
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_u: string, init: RequestInit) => {
        seen.push(JSON.parse(init.body as string).transactionId);
        return Promise.resolve(json({ id: "AAMk", "@odata.etag": 'W/"1"' }, 201));
      }),
    );

    const args = {
      planId,
      tenantId: TENANT,
      correlationId: "c",
      subject: "Quarterly review",
      startMs: Date.parse("2026-04-24T09:00:00Z"),
      endMs: Date.parse("2026-04-24T10:00:00Z"),
      nowMs: NOW,
    };
    await t.action(internal.microsoftCalendar.createEvent, args);
    await t.action(internal.microsoftCalendar.createEvent, args);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toMatch(/^pikar-[0-9a-v]{13}$/);
  });

  test("a created event returns its id and etag", async () => {
    const { result } = await create({ id: "AAMkAGI", "@odata.etag": 'W/"CQ"' }, 201);
    expect(result).toEqual({
      outcome: "created",
      eventId: "AAMkAGI",
      etag: 'W/"CQ"',
      duplicate: false,
    });
  });

  test.each([401, 403])("a %i is a reconnect outcome, not a terminal failure", async (status) => {
    const { result } = await create({ error: { code: "InvalidAuth" } }, status);
    expect(result).toEqual({ outcome: "reauth" });
  });

  test.each([
    429, 500, 503,
  ])("a %i THROWS for the retrier, carrying refs and status only", async (status) => {
    const t = harness();
    await seedToken(t);
    const planId = await seedPlan(t);
    vi.stubGlobal("fetch", always({ error: { message: "contoso" } }, status));
    await expect(
      t.action(internal.microsoftCalendar.createEvent, {
        planId,
        tenantId: TENANT,
        correlationId: "c",
        subject: "s",
        startMs: NOW,
        endMs: NOW + HOUR,
        nowMs: NOW,
      }),
    ).rejects.toThrow(/microsoft_calendar_transient/);
  });

  test("a 4xx rejection returns status only — no provider body in the reason", async () => {
    const { result } = await create(
      { error: { code: "ErrorInvalidUser", message: "user contoso.onmicrosoft.com" } },
      400,
    );
    expect(result).toEqual({ outcome: "terminal", status: 400, reason: "create_rejected" });
    expect(JSON.stringify(result)).not.toContain("contoso");
  });

  test("a 2xx without an id is terminal rather than a silent success", async () => {
    const { result } = await create({ "@odata.etag": 'W/"1"' }, 201);
    expect(result).toMatchObject({ outcome: "terminal", reason: "create_without_id" });
  });
});

// ── 17-08 Task 2: inspection and the probe-gated conditional PATCH ─────────────────────────────
//
// There is deliberately no `deleteEvent` in this module and no test asks for one. ADR-023: the
// 17-07 probe measured `staleDeleteStatus: 204` with `staleDeletePreserved: false` — Graph IGNORES
// `If-Match` on event DELETE and the stale delete destroyed the event anyway. The refusal is raised
// in `calendar.manageEvent` before a token is ever fetched; see calendar.test.ts.

const DEPLOYMENT = "https://probe-deployment.convex.cloud";

/** The committed 17-07 measurement, re-bound to whatever this test run's deployment/tenant hash is
 *  — the SHAPE is the artifact's, the hashes are computed the same way the runtime computes them. */
async function probeEnv(
  over: Partial<{
    schema: string;
    deploymentUrlHash: string;
    accountIdHash: string;
    stalePatchStatus: number;
    stalePatchPreserved: boolean;
  }> = {},
) {
  return JSON.stringify({
    schema: "phase17-graph-concurrency-probe.v1",
    deploymentUrlHash: over.deploymentUrlHash ?? (await contentHash(DEPLOYMENT)),
    accountIdHash: over.accountIdHash ?? (await contentHash(TENANT)),
    stalePatchStatus: over.stalePatchStatus ?? 412,
    stalePatchPreserved: over.stalePatchPreserved ?? true,
    // Carried verbatim from the real artifact so the fixture cannot drift into an optimistic one.
    staleDeleteStatus: 204,
    staleDeletePreserved: false,
    supported: false,
    ...(over.schema ? { schema: over.schema } : {}),
  });
}

/** A Graph event body with every field the projection must NOT carry out of this module. */
const FAT_EVENT = {
  id: "AAMkFat",
  "@odata.etag": 'W/"v7"',
  subject: "Board sync",
  start: { dateTime: "2026-04-24T09:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-04-24T09:45:00.0000000", timeZone: "UTC" },
  attendees: [
    { emailAddress: { address: "cfo@contoso.example", name: "Dana Reed" }, type: "required" },
  ],
  location: { displayName: "Contoso HQ, room 4" },
  organizer: { emailAddress: { address: "owner@contoso.example" } },
  body: { content: "<p>the confidential agenda</p>", contentType: "html" },
  onlineMeeting: { joinUrl: "https://teams.example/xyz" },
};

describe("inspectEvent — a narrow projection, and the body is discarded", () => {
  test("asks for the five allowlisted fields in UTC and nothing else", async () => {
    const t = harness();
    await seedToken(t);
    const fetchMock = always({ ...FAT_EVENT, attendees: [] }, 200);
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.microsoftCalendar.inspectEvent, {
      tenantId: TENANT,
      externalEventId: "AAMkFat",
      nowMs: NOW,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://graph.microsoft.com/v1.0/me/calendar/events/AAMkFat",
    );
    expect(parsed.searchParams.get("$select")).toBe("id,subject,start,end,attendees");
    expect(init.method ?? "GET").toBe("GET");
    expect((init.headers as Record<string, string>).Prefer).toBe('outlook.timezone="UTC"');
    // `/cancel` mails attendees on the app's behalf. It is never a URL this module builds.
    expect(url).not.toContain("/cancel");
  });

  test("returns the allowlisted keys ONLY — subject is the title, everything else is dropped", async () => {
    const t = harness();
    await seedToken(t);
    vi.stubGlobal("fetch", always(FAT_EVENT, 200));

    const result = await t.action(internal.microsoftCalendar.inspectEvent, {
      tenantId: TENANT,
      externalEventId: "AAMkFat",
      nowMs: NOW,
    });

    expect(result).toEqual({
      outcome: "ok",
      inspection: {
        exists: true,
        externalEventId: "AAMkFat",
        etag: 'W/"v7"',
        title: "Board sync",
        startMs: Date.parse("2026-04-24T09:00:00Z"),
        durationMs: 45 * 60_000,
        attendeeCount: 1,
      },
    });
    // The guest is a COUNT, never an identity — and no location, organizer, body or join URL.
    const wire = JSON.stringify(result);
    for (const leak of [
      "cfo@contoso.example",
      "Dana Reed",
      "Contoso HQ",
      "owner@contoso.example",
      "confidential agenda",
      "teams.example",
    ]) {
      expect(wire, leak).not.toContain(leak);
    }
  });

  test("a 404 is a definite absence, not a failure — the delete path reads it as done", async () => {
    const t = harness();
    await seedToken(t);
    vi.stubGlobal("fetch", always({ error: { code: "ErrorItemNotFound" } }, 404));
    expect(
      await t.action(internal.microsoftCalendar.inspectEvent, {
        tenantId: TENANT,
        externalEventId: "gone",
        nowMs: NOW,
      }),
    ).toEqual({ outcome: "ok", inspection: { exists: false } });
  });

  test.each([401, 403])("a %i is a reconnect outcome", async (status) => {
    const t = harness();
    await seedToken(t);
    vi.stubGlobal("fetch", always({ error: { message: "contoso directory" } }, status));
    expect(
      await t.action(internal.microsoftCalendar.inspectEvent, {
        tenantId: TENANT,
        externalEventId: "AAMk",
        nowMs: NOW,
      }),
    ).toEqual({ outcome: "reauth" });
  });

  test.each([429, 500, 503])("a %i THROWS for the retrier", async (status) => {
    const t = harness();
    await seedToken(t);
    vi.stubGlobal("fetch", always({ error: { message: "contoso" } }, status));
    await expect(
      t.action(internal.microsoftCalendar.inspectEvent, {
        tenantId: TENANT,
        externalEventId: "AAMk",
        nowMs: NOW,
      }),
    ).rejects.toThrow(/microsoft_calendar_transient/);
  });
});

describe("patchEvent — the probe gate, then a CONDITIONAL write and nothing else", () => {
  const patchArgs = {
    tenantId: TENANT,
    externalEventId: "AAMkFat",
    expectedEtag: 'W/"v7"',
    title: "Board sync — moved",
    startMs: Date.parse("2026-04-25T09:00:00Z"),
    durationMs: 45 * 60_000,
    nowMs: NOW,
  };

  beforeEach(() => {
    vi.stubEnv("CONVEX_SITE_URL", DEPLOYMENT);
  });

  test("with the measured probe bound to this deployment and account, it PATCHes conditionally", async () => {
    const t = harness();
    await seedToken(t);
    vi.stubEnv("PHASE17_GRAPH_PROBE", await probeEnv());
    const fetchMock = always({ id: "AAMkFat", "@odata.etag": 'W/"v8"' }, 200);
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(internal.microsoftCalendar.patchEvent, patchArgs);
    expect(result).toEqual({ outcome: "updated", etag: 'W/"v8"' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/calendar/events/AAMkFat");
    expect(init.method).toBe("PATCH");
    // THE WHOLE POINT. Without If-Match this is a lost update wearing a seatbelt.
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('W/"v7"');
    const sent = JSON.parse(init.body as string);
    expect(Object.keys(sent).sort()).toEqual(["end", "start", "subject"]);
    expect(sent.start).toEqual({ dateTime: "2026-04-25T09:00:00.000Z", timeZone: "UTC" });
    expect(sent.end).toEqual({ dateTime: "2026-04-25T09:45:00.000Z", timeZone: "UTC" });
    expect(sent.attendees).toBeUndefined();
    expect(sent.isReminderOn).toBeUndefined();
    expect(url).not.toContain("/cancel");
  });

  test("a 412 is a CONFLICT the retrier must not retry", async () => {
    const t = harness();
    await seedToken(t);
    vi.stubEnv("PHASE17_GRAPH_PROBE", await probeEnv());
    vi.stubGlobal("fetch", always({ error: { message: "contoso precondition" } }, 412));
    const result = await t.action(internal.microsoftCalendar.patchEvent, patchArgs);
    expect(result).toEqual({ outcome: "refused", code: "conflict" });
    expect(JSON.stringify(result)).not.toContain("contoso");
  });

  test("a 404 between inspect and write is not_found, not a silent success", async () => {
    const t = harness();
    await seedToken(t);
    vi.stubEnv("PHASE17_GRAPH_PROBE", await probeEnv());
    vi.stubGlobal("fetch", always({}, 404));
    expect(await t.action(internal.microsoftCalendar.patchEvent, patchArgs)).toEqual({
      outcome: "refused",
      code: "not_found",
    });
  });

  // Each of these is the gate refusing, and the assertion that matters in every one is the same:
  // NO NETWORK CALL AT ALL. Refusing after a token fetch would still be a refusal, but it would
  // prove the gate runs somewhere rather than proving it runs FIRST.
  test.each([
    ["missing", undefined],
    ["blank", "   "],
    ["malformed", "{not json"],
    ["a different schema version", "schema"],
    ["a stale PATCH that was NOT refused", "status"],
    ["a 412 that still wrote", "preserved"],
    ["bound to another deployment", "deployment"],
    ["bound to another account", "account"],
  ] as const)("refuses when the probe is %s, before any token or network", async (_label, kind) => {
    const t = harness();
    await seedToken(t);
    const value =
      kind === undefined
        ? undefined
        : kind === "   " || kind === "{not json"
          ? kind
          : kind === "schema"
            ? await probeEnv({ schema: "phase17-graph-concurrency-probe.v2" })
            : kind === "status"
              ? await probeEnv({ stalePatchStatus: 200 })
              : kind === "preserved"
                ? await probeEnv({ stalePatchPreserved: false })
                : kind === "deployment"
                  ? await probeEnv({ deploymentUrlHash: "deadbeef" })
                  : await probeEnv({ accountIdHash: "deadbeef" });
    if (value === undefined) vi.stubEnv("PHASE17_GRAPH_PROBE", "");
    else vi.stubEnv("PHASE17_GRAPH_PROBE", value);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await t.action(internal.microsoftCalendar.patchEvent, patchArgs)).toEqual({
      outcome: "refused",
      code: "provider_unsupported",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
