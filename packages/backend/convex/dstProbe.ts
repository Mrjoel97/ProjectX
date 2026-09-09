/**
 * dstProbe — THE THROWAWAY SCHEDULED FUNCTION ADR-046 D9 ASKS FOR, AND NOTHING ELSE.
 *
 * WHY THIS FILE EXISTS. `check-routine-gate.mjs` will not offer `enable-safe` until the
 * `dst-boundary` row carries `evidenceType: live`, and `collect-recurrence-evidence.mjs` is candid
 * that a `live` row must cite a collected artifact rather than a unit test. Until today the
 * `dst-boundary` collector answered the question with LOCAL CLOCK ARITHMETIC — it compared a zone's
 * UTC offset 24 hours ago with its offset now. That is a true statement about ICU's tz database and
 * says NOTHING about whether this deployment's scheduler survives a transition, which is the thing
 * the row is actually about. ADR-046 D9 names the replacement verbatim:
 *
 *   > A throwaway `ctx.scheduler` function, armed on a real deployment before a real DST transition
 *   > and observed to fire on the far side of it, with its armed instant, its fired instant and the
 *   > resolved wall time recorded. No `routines` table, no feature, no schema change.
 *
 * This module is that, and it is deliberately the smallest thing that satisfies the sentence.
 *
 * ═══ WHAT THIS IS NOT ═══
 *
 * IT CONTAINS NO CADENCE LOGIC AT ALL. It takes ONE absolute instant, arms ONE call, writes ONE
 * audit row, and never re-arms itself. All zone reasoning — which transition, which zone, which
 * instant — lives in `collect-recurrence-evidence.mjs`, outside the convex namespace. That split is
 * not tidiness: `29-RECURRENCE-DECISION.md` still records `decision: defer`, and `routines.test.ts`
 * enforces the absence of a recurrence implementation with two closed allowlists and a ten-token
 * line scan. A probe that imported `@pikar/core`'s wall-clock engine would redden that scan on the
 * IMPORT LINE, because two of that module's exports are banned identifiers. Keeping this file dumb
 * is what makes it legal to exist while the defer stands.
 *
 * IT PROVES ONE THING: that a scheduled execution armed before a transition lands after it, and
 * what the local clock read when it did. It claims nothing about routines, overlap, retries or
 * approval. ADR-046 is explicit that this is "precisely and only what the row asks".
 *
 * ═══ THE THREE FACTS THAT SHAPED THE DESIGN, EACH MEASURED ═══
 *
 * 1. THE AUDIT ROW IS THE EVIDENCE — NOT `_scheduled_functions`. Production reaps completed
 *    scheduler rows after about three days (measured 2026-09-09: 28-31 rows/day for exactly three
 *    days, nothing older, against an unreached `--limit 800`), while `audit` goes back to
 *    2026-08-13 on the same deployment. An 18-day arm read out of `_scheduled_functions` would find
 *    nothing at all. So both halves write to `audit`, and the collector reads `audit`.
 *
 * 2. THE TARGET MUST BE A MUTATION, NEVER AN ACTION. Convex schedules mutations exactly-once with
 *    automatic retry on transient errors; scheduled ACTIONS are at-most-once and are never retried
 *    (`convex@1.42.1` server/scheduler.ts:22-25). A transient blip on transition day would silently
 *    destroy the only datapoint, and the next chance is six months away.
 *
 * 3. THE PENDING JOB STORES A LATE-BOUND NAME STRING. Production rows literally read
 *    `dispatchRun.js:startDispatchRun`, resolved at fire time. **Renaming or deleting this module
 *    or either export before the fire orphans the pending call**, and it fails at fire time rather
 *    than at deploy time — which reads exactly like a scheduler defect and would poison the very
 *    conclusion the probe exists to support. THIS FILE AND BOTH EXPORT NAMES ARE FROZEN until the
 *    last armed transition has fired. `convex deploy` pushes functions and never touches tables, so
 *    ordinary deploys in between are safe; a rename is not.
 *
 * ponytail: no table, no component, no dependency — one audit row per half, read back through the
 * `recentByType` query that already exists. If a future probe ever needs to survive being renamed,
 * that is the point to give it a row of its own; it does not need one to answer this question.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/**
 * The tenant this probe books its rows under.
 *
 * A CODE-OWNED SENTINEL, deliberately not shaped like a `users` document id, exactly as
 * `billingWebhook.ts`'s `UNATTRIBUTED_TENANT` is. It belongs to no person, so nothing here is ever
 * within reach of an erasure request and nothing here can collide with a real tenant's namespace.
 */
export const DST_PROBE_TENANT = "dst-probe:unattributed";

/** One `eventType` for BOTH halves, so a single `recentByType` call returns the pair. The half is
 *  in `payload.phase`, which is what the collector matches on. */
export const DST_PROBE_EVENT = "clock.dst_probe";

/**
 * The zone's UTC offset at an instant, asked of ICU rather than derived from a table.
 *
 * NEVER THROWS. A probe whose whole purpose is to leave a record must not fail to leave one because
 * a formatting call was unhappy — a thrown mutation becomes a terminal `failed` state and the
 * datapoint is gone until the next transition. An unavailable offset is recorded as the string
 * `unavailable`, which is a finding rather than a silence.
 */
function offsetAt(utcMs: number, zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date(utcMs));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * The local wall-clock reading at an instant, as `YYYY-MM-DDTHH:MM:SS`.
 *
 * THE `T` IS LOAD-BEARING AND IS NOT COSMETIC. `payloadShape.ts` classifies any string containing
 * WHITESPACE as prose — that is how it catches free text in an audit payload — so a wall time
 * written `2026-09-27 07:00:00` would be reported as a `suspect` by the §4 gate that guards WORM
 * arming. With the `T` it is an ISO timestamp, which §4 permits outright. The probe must not make
 * the archive it is unblocking look dirty.
 */
function wallClockAt(utcMs: number, zone: string): string {
  try {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(utcMs));
    const get = (type: string) => p.find((x) => x.type === type)?.value ?? "??";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
  } catch {
    return "unavailable";
  }
}

/**
 * Arm one probe against one transition.
 *
 * REFUSES TO ARM A USELESS WINDOW. If the zone's offset is the same at arm time and at the target
 * instant, no transition falls between them and the resulting trace would evidence nothing — so
 * this throws instead of booking a row that would later have to be explained away. Read that guard
 * for what it is: it stops a pointless arm, and it is NOT the evidence. The evidence is that a real
 * scheduled execution landed on the far side and reported what the local clock said when it did.
 * Those are different claims, and conflating them is exactly the relabelling the gate exists for.
 */
export const arm = internalMutation({
  args: { fireAtMs: v.number(), zone: v.string() },
  handler: async (ctx, { fireAtMs, zone }) => {
    const armedAtMs = Date.now();
    if (!Number.isSafeInteger(fireAtMs) || fireAtMs <= armedAtMs) {
      throw new Error("dstProbe: the target instant must be a safe integer in the future");
    }
    const offsetAtArm = offsetAt(armedAtMs, zone);
    const offsetAtTarget = offsetAt(fireAtMs, zone);
    if (offsetAtArm === "unavailable" || offsetAtTarget === "unavailable") {
      throw new Error(`dstProbe: this runtime cannot read a UTC offset for ${zone}`);
    }
    if (offsetAtArm === offsetAtTarget) {
      throw new Error(
        `dstProbe: ${zone} holds ${offsetAtArm} across the whole window, so no transition falls ` +
          "inside it and the trace would evidence nothing. Pick an instant on the far side of a " +
          "real transition.",
      );
    }

    const correlationId = `dst-probe:${zone}:${fireAtMs}`;
    const handle = await ctx.scheduler.runAt(fireAtMs, internal.dstProbe.observe, {
      zone,
      correlationId,
      fireAtMs,
      armedAtMs,
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: DST_PROBE_TENANT,
      correlationId,
      eventType: DST_PROBE_EVENT,
      actor: "system",
      // REFS, IDS, COUNTS AND TIMESTAMPS ONLY (CLAUDE.md §4). There is nowhere here to put a person
      // and no field that could carry one — a zone name, two instants and a scheduler id.
      payload: {
        phase: "armed",
        zone,
        armedAtMs,
        armedAtUtc: new Date(armedAtMs).toISOString(),
        fireAtMs,
        targetAtUtc: new Date(fireAtMs).toISOString(),
        wallClockAtArm: wallClockAt(armedAtMs, zone),
        wallClockAtTarget: wallClockAt(fireAtMs, zone),
        offsetAtArm,
        offsetAtTarget,
        scheduledFnId: String(handle),
      },
    });
    return { correlationId, armedAtMs, fireAtMs, offsetAtArm, offsetAtTarget };
  },
});

/**
 * The far side. Records what the clock ACTUALLY read when this execution ran.
 *
 * Everything it needs travelled with the scheduled call, so the observation does not depend on any
 * row surviving 18 days — only on this function still being reachable under this name.
 */
export const observe = internalMutation({
  args: {
    zone: v.string(),
    correlationId: v.string(),
    fireAtMs: v.number(),
    armedAtMs: v.number(),
  },
  handler: async (ctx, a) => {
    const firedAtMs = Date.now();
    await ctx.runMutation(internal.audit.log, {
      tenantId: DST_PROBE_TENANT,
      correlationId: a.correlationId,
      eventType: DST_PROBE_EVENT,
      actor: "system",
      payload: {
        phase: "fired",
        zone: a.zone,
        armedAtMs: a.armedAtMs,
        fireAtMs: a.fireAtMs,
        firedAtMs,
        firedAtUtc: new Date(firedAtMs).toISOString(),
        // THE FIELD ADR-046 D9 NAMES: "the resolved wall time". Read at fire time, on the
        // deployment, in the zone — not reconstructed afterwards by whoever reads the row.
        wallClockAtFire: wallClockAt(firedAtMs, a.zone),
        offsetAtArm: offsetAt(a.armedAtMs, a.zone),
        offsetAtFire: offsetAt(firedAtMs, a.zone),
        // How late the platform was, in ms. A count, and the only number anyone has ever had for
        // this deployment: the longest fire lag observed in production to date is ~20.6 minutes,
        // and every one of those was a short-horizon call.
        driftMs: firedAtMs - a.fireAtMs,
        heldForMs: firedAtMs - a.armedAtMs,
      },
    });
  },
});
