import { classifyPayload, worst } from "@pikar/core/payloadShape";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
// `audit.log` maintains the auditCounts aggregate (audit.ts:40), so the component must be
// registered or the REAL insert path throws. Same idiom as audit.test.ts.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { internal } from "./_generated/api";
import { DST_PROBE_EVENT, DST_PROBE_TENANT } from "./dstProbe";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const harness = () => {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
};

/**
 * Cancel every job this test armed.
 *
 * NOT TIDINESS — a real defect, found by attribution rather than by guessing. `dstProbe.test.ts`
 * passed alone (exit 0) and passed inside the full backend suite (4116/4116 green), but the SUITE
 * exited 1 with `ReferenceError: process is not defined` in vitest's fork teardown. Running the
 * suite with only this file excluded exited 0, which is what named the culprit.
 *
 * The cause is a job left PENDING when the test ends: unlike every other scheduler call site here,
 * `arm` targets an instant weeks away, so nothing in the run ever drains it and the harness is
 * still holding it at teardown — in an edge runtime where `process` does not exist.
 *
 * A green suite that exits 1 is the worst possible signal: `ci.yml` reads the exit code, and the
 * repo already carries a memory that backend "exits 1 while green" on Windows. Left alone, this
 * would have been filed under that known artifact and hidden the next real one.
 */
async function cancelArmedJobs(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
      await ctx.scheduler.cancel(job._id);
    }
  });
}

const offsetAt = (ms: number, zone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(new Date(ms))
    .find((p) => p.type === "timeZoneName")?.value ?? "";

/**
 * The next instant after `fromMs` at which `zone` changes offset, to day granularity plus an hour.
 *
 * DERIVED, NEVER A DATE LITERAL. A test that hardcoded "2026-09-26" would pass today and fail
 * silently forever after that date — the arm would be in the past and the refusal below would fire
 * for the wrong reason, which is the worst kind of green. Asking ICU keeps this test correct in
 * 2030. Same argument `collect-recurrence-evidence.mjs` records for deleting its own date constant,
 * which was wrong by seven weeks.
 */
function transitionAfter(zone: string, fromMs: number): number {
  let prev = offsetAt(fromMs, zone);
  for (let d = 1; d <= 400; d++) {
    const ms = fromMs + d * 86_400_000;
    const now = offsetAt(ms, zone);
    if (now !== prev) return ms;
    prev = now;
  }
  throw new Error(`${zone} has no transition within 400 days — pick a zone that does`);
}

// A zone that always has two transitions a year, so this is never a flake, and one that has none.
const DST_ZONE = "Pacific/Auckland";
const FLAT_ZONE = "Africa/Nairobi";

describe("arm refuses a window that could not evidence anything", () => {
  test("a zone with NO transition in the window is refused, and the reason says so", async () => {
    const t = harness();
    // Nairobi is UTC+3 year-round — the owner's own zone, and the reason this row could never be
    // collected locally however long anyone waited.
    await expect(
      t.mutation(internal.dstProbe.arm, {
        zone: FLAT_ZONE,
        fireAtMs: Date.now() + 200 * 86_400_000,
      }),
    ).rejects.toThrow(/no transition falls inside it/);
    // NOTHING was booked. A refusal that still left a row would be a half-armed probe nobody
    // could tell from a real one.
    const rows = await t.run(async (ctx) => await ctx.db.query("audit").collect());
    expect(rows).toHaveLength(0);
  });

  test("an instant in the PAST is refused", async () => {
    const t = harness();
    await expect(
      t.mutation(internal.dstProbe.arm, { zone: DST_ZONE, fireAtMs: Date.now() - 1000 }),
    ).rejects.toThrow(/must be a safe integer in the future/);
  });
});

describe("the armed half", () => {
  test("it books ONE scheduled call at the requested instant and ONE audit row", async () => {
    const t = harness();
    const fireAtMs = transitionAfter(DST_ZONE, Date.now()) + 3_600_000;

    const result = await t.mutation(internal.dstProbe.arm, { zone: DST_ZONE, fireAtMs });
    expect(result.offsetAtArm).not.toBe(result.offsetAtTarget);

    // POSITIVE CONTROL ON THE SCHEDULER ITSELF: the row the far side depends on really exists, at
    // the instant asked for. Without this the test would pass on a probe that wrote its audit row
    // and armed nothing at all.
    const scheduled = await t.run(
      async (ctx) => await ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.scheduledTime).toBe(fireAtMs);

    const rows = await t.run(async (ctx) => await ctx.db.query("audit").collect());
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    await cancelArmedJobs(t);
    expect(row.eventType).toBe(DST_PROBE_EVENT);
    expect(row.tenantId).toBe(DST_PROBE_TENANT);
    expect(row.payload.phase).toBe("armed");
    expect(row.payload.zone).toBe(DST_ZONE);
  });
});

describe("the observed half records what ADR-046 D9 names", () => {
  test("it writes the fired instant AND the resolved wall time", async () => {
    const t = harness();
    const armedAtMs = Date.now();
    const fireAtMs = transitionAfter(DST_ZONE, armedAtMs) + 3_600_000;

    // Driving `observe` directly is what the scheduler does on the far side, with the same args.
    // The alternative — advancing the harness clock 18 days — would test convex-test's timers
    // rather than this handler.
    await t.mutation(internal.dstProbe.observe, {
      zone: DST_ZONE,
      correlationId: `dst-probe:${DST_ZONE}:${fireAtMs}`,
      fireAtMs,
      armedAtMs,
    });

    const rows = await t.run(async (ctx) => await ctx.db.query("audit").collect());
    expect(rows).toHaveLength(1);
    const p = rows[0]!.payload;
    expect(p.phase).toBe("fired");
    // The three facts D9 asks for, by name.
    expect(typeof p.armedAtMs).toBe("number");
    expect(typeof p.firedAtMs).toBe("number");
    expect(p.wallClockAtFire).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    // And the offset really was read in the requested zone, not in UTC or the runner's locale.
    expect(p.offsetAtFire).toMatch(/^GMT[+-]/);
  });

  test("a wall time never contains WHITESPACE — the §4 gate reads a space as prose", async () => {
    // This is the trap the `T` separator exists to avoid, pinned in the direction that matters:
    // `2026-09-27 07:00:00` would be classified `short_text_with_space` and reported as a suspect
    // by check-audit-payloads.mjs on every future run.
    const t = harness();
    await t.mutation(internal.dstProbe.observe, {
      zone: DST_ZONE,
      correlationId: "dst-probe:x:1",
      fireAtMs: 1,
      armedAtMs: 1,
    });
    const rows = await t.run(async (ctx) => await ctx.db.query("audit").collect());
    expect(String(rows[0]!.payload.wallClockAtFire)).not.toMatch(/\s/);
  });
});

describe("NEITHER HALF MAY POISON THE ARCHIVE IT EXISTS TO UNBLOCK", () => {
  // The whole point of this probe is to open the `dst-boundary` row so recurring routines can be
  // built. WORM arming is gated separately on ADR-044 T3, which is now green because every audit
  // payload on production classifies clean. A probe that wrote one dirty row would close one gate
  // by opening another — and because `audit` is insert-only and destined for COMPLIANCE-mode
  // object lock, that row would be permanent. So the REAL classifier is run over the REAL rows.
  test("every payload this probe writes is refs, ids, counts and timestamps only", async () => {
    const t = harness();
    const fireAtMs = transitionAfter(DST_ZONE, Date.now()) + 3_600_000;
    const armed = await t.mutation(internal.dstProbe.arm, { zone: DST_ZONE, fireAtMs });
    await t.mutation(internal.dstProbe.observe, {
      zone: DST_ZONE,
      correlationId: armed.correlationId,
      fireAtMs,
      armedAtMs: armed.armedAtMs,
    });

    await cancelArmedJobs(t);
    const rows = await t.run(async (ctx) => await ctx.db.query("audit").collect());
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const findings = classifyPayload(row.payload);
      // Reported with the paths, so a failure names the offending field rather than just failing.
      expect(findings.map((f) => `${f.path}:${f.reason}`)).toEqual([]);
      expect(worst(findings)).toBe("ok");
    }
  });

  test("POSITIVE CONTROL: the classifier used above really does convict a dirty payload", () => {
    // Without this, the assertion above would also pass against a classifier that had been
    // accidentally neutered — the exact "a check that cannot fail" defect this repo keeps finding.
    //
    // An EMAIL, not prose. The first draft of this control used a 39-character sentence and read
    // `suspect`, because `classifyString` only calls whitespace prose at >40 chars — so the control
    // itself was one character away from asserting the wrong grade. An address is a violation
    // regardless of length, which is the property a control wants: no threshold to sit next to.
    expect(worst(classifyPayload({ detail: "someone@example.com" }))).toBe("violation");
  });
});
