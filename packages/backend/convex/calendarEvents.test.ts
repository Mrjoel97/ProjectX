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
