// The durable managed-event registry (17-08 Task 1).
//
// The registry is what makes a created event MANAGEABLE later: without a row carrying the provider,
// the external id and the etag, an update is a read-modify-write against a version nobody recorded.
// `manageability` (@pikar/core) is the pre-provider gate that reads it, and every refusal it can
// return traces back to a fact stored here.
//
// The tenant-first composite index is the isolation linchpin: two tenants can legitimately hold the
// same provider event id (a shared calendar, a restored backup, a fixture), so a lookup without the
// tenant predicate would let one tenant's update resolve to another tenant's row.
import type { RunId } from "@convex-dev/action-retrier";
import retrierTest from "@convex-dev/action-retrier/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  retrierTest.register(t);
  return t;
}

const TENANT = "tenant_cal_a";
const OTHER = "tenant_cal_b";
const BASE_MS = 1_577_880_000_000;
const TZ = "Europe/Athens";

type T = ReturnType<typeof harness>;

/** A `calendar_event` plan already at `delivering` — what the retrier terminal expects to find. */
async function deliveringPlan(t: T, tenantId = TENANT): Promise<Id<"plans">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("plans", {
      tenantId,
      threadId: "thread_cal",
      kind: "calendar_event",
      status: "delivering",
      correlationId: "corr_cal",
      subject: "Quarterly review",
      body: "",
      createdAt: BASE_MS,
      calendarRunId: `run_${tenantId}`,
      // The staged event (17-01). These are what the registry row is BUILT from — the terminal
      // never invents a title or an instant, it copies the ones the human approved.
      eventTitle: "Quarterly review",
      eventStartMs: BASE_MS,
      eventDurationMs: 30 * 60 * 1000,
      eventTz: TZ,
    } as never),
  );
}

/** The exact success payload `calendar.createEvent` returns to the retrier terminal (17-07 shape). */
const createdResult = (
  planId: Id<"plans">,
  over: Partial<{
    tenantId: string;
    eventId: string;
    provider: "google" | "microsoft";
    etag: string;
  }> = {},
) => ({
  type: "success" as const,
  returnValue: {
    planId,
    tenantId: over.tenantId ?? TENANT,
    correlationId: "corr_cal",
    outcome: "created",
    eventId: over.eventId ?? "evt_ext_1",
    duplicate: false,
    provider: over.provider ?? "google",
    etag: over.etag ?? "etag_v1",
  },
});

const rows = (t: T) => t.run(async (ctx) => ctx.db.query("calendarEvents").collect());

describe("17-08 Task 1 — the create terminal lands a durable managed-event row", () => {
  test("a successful create upserts ONE active row carrying provider, external id and etag", async () => {
    const t = harness();
    const planId = await deliveringPlan(t);

    await t.mutation(internal.calendarComplete.onCreateComplete, {
      runId: "run_1" as RunId,
      result: createdResult(planId),
    });

    const all = await rows(t);
    expect(all).toHaveLength(1);
    const row = all[0]!;
    expect(row.tenantId).toBe(TENANT);
    expect(row.provider).toBe("google");
    expect(row.externalEventId).toBe("evt_ext_1");
    expect(row.etag).toBe("etag_v1");
    expect(row.status).toBe("active");
    expect(row.sourcePlanId).toBe(planId);
    // Asserted at CREATE time: we know the body we sent carried no attendees.
    expect(row.attendeeFree).toBe(true);

    // …and the plan still finishes. The registry write is not a replacement for the terminal.
    const plan = await t.run(async (ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("done");
    expect(plan?.calendarEventId).toBe("evt_ext_1");
  });

  test("replaying the SAME terminal updates the one row instead of duplicating it", async () => {
    const t = harness();
    const planId = await deliveringPlan(t);

    await t.mutation(internal.calendarComplete.onCreateComplete, {
      runId: "run_1" as RunId,
      result: createdResult(planId),
    });
    // A retrier can deliver the same success twice; the plan is `done` by then, so the second
    // delivery must be a no-op on BOTH the plan and the registry — never a second row.
    await t.mutation(internal.calendarComplete.onCreateComplete, {
      runId: "run_1" as RunId,
      result: createdResult(planId, { etag: "etag_v2" }),
    });

    expect(await rows(t)).toHaveLength(1);
  });

  test("upsertManaged itself is idempotent on (tenant, provider, externalEventId)", async () => {
    // Tested DIRECTLY, because the terminal above cannot reach this branch: a replayed delivery is
    // stopped earlier by the `status !== "delivering"` guard, so routing this assertion through
    // `onCreateComplete` proves the guard and leaves the upsert's own contract unproven. The
    // contract matters on its own terms — `stagingSnapshot` and the migration both use `.unique()`
    // on this index, and `.unique()` THROWS on a duplicate, so a second row is not a cosmetic
    // problem but a permanently broken lookup.
    const t = harness();
    const planId = await deliveringPlan(t);
    const args = {
      tenantId: TENANT,
      sourcePlanId: planId,
      provider: "google" as const,
      externalEventId: "evt_ext_1",
      title: "Quarterly review",
      startMs: BASE_MS,
      durationMs: 30 * 60 * 1000,
      tz: TZ,
      attendeeFree: true,
    };

    const first = await t.mutation(internal.calendarEvents.upsertManaged, {
      ...args,
      etag: "etag_v1",
    });
    const second = await t.mutation(internal.calendarEvents.upsertManaged, {
      ...args,
      etag: "etag_v2",
    });

    expect(second).toBe(first); // the SAME row id, not a twin
    const all = await rows(t);
    expect(all).toHaveLength(1);
    expect(all[0]?.etag).toBe("etag_v2"); // latest provider truth wins
  });

  test("the same provider event id in TWO tenants stays two distinct rows", async () => {
    const t = harness();
    const mine = await deliveringPlan(t, TENANT);
    const theirs = await deliveringPlan(t, OTHER);

    await t.mutation(internal.calendarComplete.onCreateComplete, {
      runId: "run_a" as RunId,
      result: createdResult(mine),
    });
    await t.mutation(internal.calendarComplete.onCreateComplete, {
      runId: "run_b" as RunId,
      result: createdResult(theirs, { tenantId: OTHER }),
    });

    const all = await rows(t);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((r) => r.tenantId))).toEqual(new Set([TENANT, OTHER]));
    // Same external id, different owners — the composite index must not collapse them.
    expect(new Set(all.map((r) => r.externalEventId))).toEqual(new Set(["evt_ext_1"]));
  });

  test("a create whose result carries NO etag lands a row that is not yet manageable", async () => {
    // Absent etag means "unknown version", never "no concurrency check needed". `manageability`
    // returns `needs_inspection` for exactly this row, and 17-08 Task 2 must refuse to write.
    const t = harness();
    const planId = await deliveringPlan(t);

    await t.mutation(internal.calendarComplete.onCreateComplete, {
      runId: "run_1" as RunId,
      result: {
        type: "success" as const,
        returnValue: {
          planId,
          tenantId: TENANT,
          correlationId: "corr_cal",
          outcome: "created",
          eventId: "evt_no_etag",
          duplicate: false,
          provider: "google",
          etag: null,
        },
      },
    });

    const row = (await rows(t))[0]!;
    expect(row.etag).toBeUndefined();
    expect(row.status).toBe("active");
  });
  test("a created event whose plan lost its staged fields still FINISHES, with no half-built row", async () => {
    // A DECISION, pinned so it cannot become an accident. The registry row is built from the plan's
    // staged title/instant; if they are gone there is nothing honest to record. Throwing would
    // strand a real, already-created provider event at `delivering` forever while the retrier
    // redelivered into the same failure — worse than an unmanageable row. So: finish the plan,
    // write nothing, and let `listManaged`/`manageability` report the absence downstream.
    const t = harness();
    const planId = await t.run(async (ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_cal",
        kind: "calendar_event",
        status: "delivering",
        correlationId: "corr_cal",
        subject: "No staged event",
        body: "",
        createdAt: BASE_MS,
      } as never),
    );

    await t.mutation(internal.calendarComplete.onCreateComplete, {
      runId: "run_1" as RunId,
      result: createdResult(planId),
    });

    expect(await rows(t)).toHaveLength(0);
    const plan = await t.run(async (ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("done");
  });
});

describe("17-08 Task 1 — the bounded legacy migration is explicit, never automatic", () => {
  /** A pre-17-05 success: plan done with a calendarEventId, and no registry row anywhere. */
  async function legacyPlan(t: T, eventId: string, tenantId = TENANT): Promise<Id<"plans">> {
    return await t.run(async (ctx) =>
      ctx.db.insert("plans", {
        tenantId,
        threadId: "thread_legacy",
        kind: "calendar_event",
        status: "done",
        correlationId: "corr_legacy",
        subject: "Legacy standup",
        body: "",
        createdAt: BASE_MS,
        calendarEventId: eventId,
        eventTitle: "Legacy standup",
        eventStartMs: BASE_MS,
        eventDurationMs: 15 * 60 * 1000,
        eventTz: TZ,
      } as never),
    );
  }

  test("a legacy plan MISSING its staged event is skipped, never invented", async () => {
    // A row with no title/instant cannot become a registry row without the migration making one up,
    // and an invented time on a real calendar is the worst possible repair. Count it and move on.
    const t = harness();
    await t.run(async (ctx) =>
      ctx.db.insert("plans", {
        tenantId: TENANT,
        threadId: "thread_legacy",
        kind: "calendar_event",
        status: "done",
        correlationId: "corr_legacy",
        subject: "No staged event",
        body: "",
        createdAt: BASE_MS,
        calendarEventId: "evt_orphan",
      } as never),
    );

    const out = await t.mutation(internal.calendarEvents.migrateLegacyCalendarEvents, {
      dryRun: false,
    });
    expect(out.skipped).toBe(1);
    expect(out.inserted).toBe(0);
    expect(await rows(t)).toHaveLength(0);
  });

  test("dry-run counts what it WOULD do and writes nothing", async () => {
    const t = harness();
    await legacyPlan(t, "evt_legacy_1");
    await legacyPlan(t, "evt_legacy_2");

    const out = await t.mutation(internal.calendarEvents.migrateLegacyCalendarEvents, {
      dryRun: true,
    });

    expect(out.scanned).toBe(2);
    expect(out.inserted).toBe(0);
    expect(await rows(t)).toHaveLength(0);
  });

  test("apply mode inserts etag-ABSENT rows, defaults to google, and is idempotent", async () => {
    const t = harness();
    await legacyPlan(t, "evt_legacy_1");

    const first = await t.mutation(internal.calendarEvents.migrateLegacyCalendarEvents, {
      dryRun: false,
    });
    expect(first.inserted).toBe(1);

    const row = (await rows(t))[0]!;
    // No network, no invented version data: the absence is recorded honestly.
    expect(row.etag).toBeUndefined();
    expect(row.provider).toBe("google");
    expect(row.status).toBe("active");

    // Running it again finds the row already there and inserts nothing.
    const second = await t.mutation(internal.calendarEvents.migrateLegacyCalendarEvents, {
      dryRun: false,
    });
    expect(second.inserted).toBe(0);
    expect(second.existing).toBe(1);
    expect(await rows(t)).toHaveLength(1);
  });

  test("limit is CLAMPED, so an operator cannot ask for an unbounded scan", async () => {
    const t = harness();
    const out = await t.mutation(internal.calendarEvents.migrateLegacyCalendarEvents, {
      dryRun: true,
      limit: 5_000,
    });
    // The clamp is the contract; `done` still reports honestly on an empty table.
    expect(out.scanned).toBeLessThanOrEqual(100);
    expect(out.done).toBe(true);
  });
});

// ── 17-09 Task 1: the listing the cockpit tool reads ────────────────────────────────────────────
//
// The listing is the model's ONLY route to a managed-event ref, so what it omits is the real
// contract: a row the manage path would refuse must not appear here, or the model proposes a change
// that dies at the provider gate after the user has been told it was staged.

/** Insert a registry row directly. Everything the listing decides on is a stored fact. */
async function managedRow(
  t: T,
  o: Partial<{
    tenantId: string;
    externalEventId: string;
    title: string;
    startMs: number;
    etag: string | undefined;
    attendeeFree: boolean;
    status: "active" | "deleted";
  }> = {},
): Promise<Id<"calendarEvents">> {
  const sourcePlanId = await deliveringPlan(t, o.tenantId ?? TENANT);
  const etag = "etag" in o ? o.etag : '"v1"';
  return await t.run(async (ctx) =>
    ctx.db.insert("calendarEvents", {
      tenantId: o.tenantId ?? TENANT,
      provider: "google" as const,
      externalEventId: o.externalEventId ?? `evt_${Math.random()}`,
      ...(etag === undefined ? {} : { etag }),
      title: o.title ?? "Quarterly review",
      startMs: o.startMs ?? BASE_MS,
      durationMs: 30 * 60 * 1000,
      tz: TZ,
      sourcePlanId,
      attendeeFree: o.attendeeFree ?? true,
      status: o.status ?? ("active" as const),
      createdAt: BASE_MS,
      updatedAt: BASE_MS,
    }),
  );
}

describe("17-09 Task 1 — the bounded, manageable-only listing", () => {
  test("only rows the manage path would ACCEPT are listed; the rest are counted, not named", async () => {
    const t = harness();
    await managedRow(t, { title: "Manageable" });
    await managedRow(t, { title: "Legacy", etag: undefined }); // needs_inspection
    await managedRow(t, { title: "Has guests", attendeeFree: false }); // attendees_present
    await managedRow(t, { title: "Gone", status: "deleted" }); // not_found

    const out = await t.query(internal.calendarEvents.listManageable, { tenantId: TENANT });

    expect(out.events.map((e) => e.title)).toEqual(["Manageable"]);
    // Counts, never titles — an omitted row is reported as a NUMBER so the model can say "2 more I
    // can't change" without being handed content it was not allowed to list.
    //
    // TWO, not three, and the difference is worth pinning: `omitted` counts rows the scan SAW and
    // `manageability` then refused. A DELETED row is equated away by the index and never reaches
    // the filter at all — it is not "an event you can't change", it is not an event any more.
    expect(out.omitted).toBe(2);
    expect(JSON.stringify(out)).not.toMatch(/Legacy|Has guests|Gone/);
  });

  test("a FOREIGN tenant's manageable row is absent — the listing is the isolation boundary", async () => {
    const t = harness();
    await managedRow(t, { tenantId: OTHER, title: "Someone else's event" });
    const out = await t.query(internal.calendarEvents.listManageable, { tenantId: TENANT });
    expect(out.events).toEqual([]);
    expect(out.omitted).toBe(0);
  });

  test("the page is capped at 20 and NEWEST START FIRST, with truncation disclosed", async () => {
    const t = harness();
    // 22 manageable rows, inserted oldest-start first so creation order and start order disagree —
    // a listing that just took the index order would pass a weaker version of this test.
    for (let i = 0; i < 22; i++) {
      await managedRow(t, { title: `Event ${i}`, startMs: BASE_MS + i * 86_400_000 });
    }

    const out = await t.query(internal.calendarEvents.listManageable, { tenantId: TENANT });

    expect(out.events).toHaveLength(20);
    expect(out.events[0]?.title).toBe("Event 21");
    expect(out.truncated).toBe(true);
    const starts = out.events.map((e) => e.startMs);
    expect([...starts].sort((a, b) => b - a)).toEqual(starts);
  });

  test("an empty registry lists nothing and truncates nothing", async () => {
    const t = harness();
    const out = await t.query(internal.calendarEvents.listManageable, { tenantId: TENANT });
    expect(out).toEqual({ events: [], omitted: 0, truncated: false });
  });
});

// ── 17-09 Task 2: one fresh-snapshot staging transaction ──────────────────────────────────────

async function collectingPlan(t: T, tenantId = TENANT): Promise<Id<"plans">> {
  return await t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId,
      threadId: `thread_stage_${tenantId}`,
      status: "collecting",
      createdAt: BASE_MS,
    }),
  );
}

const stageArgs = (
  planId: Id<"plans">,
  managedEventId: Id<"calendarEvents">,
  over: Partial<{
    tenantId: string;
    operation: "update" | "delete";
    etag: string | undefined;
    attendeeCount: number;
    desired: { title?: string; startMs?: number; durationMs?: number } | undefined;
  }> = {},
) => ({
  tenantId: over.tenantId ?? TENANT,
  planId,
  managedEventId,
  operation: over.operation ?? ("update" as const),
  storedEtag: '"v1"',
  ...(over.etag === undefined && "etag" in over ? {} : { etag: over.etag ?? '"fresh"' }),
  observed: {
    title: "Provider title",
    startMs: BASE_MS + 60_000,
    durationMs: 45 * 60_000,
    attendeeCount: over.attendeeCount ?? 0,
  },
  ...(over.desired === undefined && "desired" in over
    ? {}
    : { desired: over.desired ?? { title: "New title" } }),
});

describe("17-09 Task 2 — stageChange is atomic, tenant-safe, and etag-pinned", () => {
  test("copies the fresh provider snapshot into the registry and proposes only actual overrides", async () => {
    const t = harness();
    const managedEventId = await managedRow(t);
    const planId = await collectingPlan(t);

    const out = await t.mutation(
      internal.calendarEvents.stageChange,
      stageArgs(planId, managedEventId, {
        desired: { title: "New title", startMs: BASE_MS + 3_600_000 },
      }),
    );

    expect(out).toEqual({ ok: true, changed: ["title", "startMs"] });
    const row = await t.run((ctx) => ctx.db.get(managedEventId));
    expect(row).toMatchObject({
      etag: '"fresh"',
      title: "Provider title",
      startMs: BASE_MS + 60_000,
      durationMs: 45 * 60_000,
      attendeeFree: true,
    });
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan).toMatchObject({
      kind: "calendar_manage",
      status: "proposed",
      calendarManagedEventId: managedEventId,
      calendarExpectedEtag: '"fresh"',
      calendarOperation: "update",
      eventTitle: "New title",
      eventStartMs: BASE_MS + 3_600_000,
    });
    expect(plan?.eventDurationMs).toBeUndefined();
  });

  test("missing and foreign refs collapse to not_managed and write no plan proposal", async () => {
    const t = harness();
    const foreign = await managedRow(t, { tenantId: OTHER });
    const own = await managedRow(t);
    const planId = await collectingPlan(t);

    const foreignOut = await t.mutation(
      internal.calendarEvents.stageChange,
      stageArgs(planId, foreign),
    );
    expect(foreignOut).toEqual({ ok: false, code: "not_managed" });

    await t.run((ctx) => ctx.db.delete(own));
    const missingOut = await t.mutation(
      internal.calendarEvents.stageChange,
      stageArgs(planId, own),
    );
    expect(missingOut).toEqual(foreignOut);
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("collecting");
  });

  test("a fresh attendee count refuses before refreshing either registry or plan", async () => {
    const t = harness();
    const managedEventId = await managedRow(t, { title: "Stored title" });
    const planId = await collectingPlan(t);

    const out = await t.mutation(
      internal.calendarEvents.stageChange,
      stageArgs(planId, managedEventId, { attendeeCount: 1 }),
    );

    expect(out).toEqual({ ok: false, code: "attendees_present" });
    expect((await t.run((ctx) => ctx.db.get(managedEventId)))?.title).toBe("Stored title");
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("collecting");
  });

  test("a missing fresh etag refuses instead of staging an unconditional write", async () => {
    const t = harness();
    const managedEventId = await managedRow(t);
    const planId = await collectingPlan(t);

    const out = await t.mutation(
      internal.calendarEvents.stageChange,
      stageArgs(planId, managedEventId, { etag: undefined }),
    );

    expect(out).toEqual({ ok: false, code: "needs_inspection" });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.status).toBe("collecting");
  });

  test("an unchanged update and a delete carrying desired content both write nothing", async () => {
    const t = harness();
    const managedEventId = await managedRow(t);
    const unchangedPlan = await collectingPlan(t);
    const deletePlan = await collectingPlan(t);

    expect(
      await t.mutation(
        internal.calendarEvents.stageChange,
        stageArgs(unchangedPlan, managedEventId, {
          desired: { title: "Provider title", startMs: BASE_MS + 60_000 },
        }),
      ),
    ).toEqual({ ok: false, code: "empty_update" });
    expect(
      await t.mutation(
        internal.calendarEvents.stageChange,
        stageArgs(deletePlan, managedEventId, {
          operation: "delete",
          desired: { title: "Must not ride a delete" },
        }),
      ),
    ).toEqual({ ok: false, code: "delete_has_desired" });
    expect((await t.run((ctx) => ctx.db.get(unchangedPlan)))?.status).toBe("collecting");
    expect((await t.run((ctx) => ctx.db.get(deletePlan)))?.status).toBe("collecting");
  });

  test("a stale row or superseded plan is re-checked inside the mutation", async () => {
    const t = harness();
    const deleted = await managedRow(t, { status: "deleted" });
    const planId = await collectingPlan(t);
    expect(
      await t.mutation(internal.calendarEvents.stageChange, stageArgs(planId, deleted)),
    ).toEqual({ ok: false, code: "not_found" });

    const raced = await managedRow(t);
    await t.run((ctx) => ctx.db.patch(raced, { etag: '"newer-app-stage"' }));
    expect(await t.mutation(internal.calendarEvents.stageChange, stageArgs(planId, raced))).toEqual(
      { ok: false, code: "conflict" },
    );
    expect((await t.run((ctx) => ctx.db.get(raced)))?.etag).toBe('"newer-app-stage"');

    await t.run((ctx) => ctx.db.patch(planId, { kind: "finance_write", status: "proposed" }));
    const live = await managedRow(t);
    expect(await t.mutation(internal.calendarEvents.stageChange, stageArgs(planId, live))).toEqual({
      ok: false,
      code: "plan_mismatch",
    });
    expect((await t.run((ctx) => ctx.db.get(planId)))?.kind).toBe("finance_write");
  });
});
